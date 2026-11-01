/**
 * dsh-skill-mcp-panel —— MCP 宿主服务（mcpManager）。
 */
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { resolveDshHome } from "../host-paths.js";
import { loadToolFilter, saveToolFilter } from "../tool-filter.js";
import { authorizationHeader, buildAuthorizationUrl, createPkce, discoverMetadataDetailed, discoveryFailureMessage, exchangeCode, isExpired, loadOAuthStore, normalizeServerUrl, registerClient, removeOAuthRecord, saveOAuthRecord, startLoopbackServer } from "../oauth.js";
import { MCP_PLUGIN_NAME, isJsExprValue, isManagedRow, listMcpPatchRows, readManagedBlock, readMcpEntryText, readPatchFile, removeMcpEntry, replaceMcpEntryText, replaceMcpEntryWithRow, setEntryDisabled, writeManagedRows, writeEvacuatedForeign } from "../patch-editor.js";
import { applyServerEdit, describeSchemaError, inputFromPatchRow, patchRowToView, rowEnabled, serverNameOfRow } from "./model.js";
import { mcpOAuthPollPayloadSchema, mcpOAuthServerPayloadSchema, mcpOAuthStartPayloadSchema, mcpRawReadPayloadSchema, mcpRawWritePayloadSchema, mcpRemovePayloadSchema, mcpSavePayloadSchema, mcpSetEnabledPayloadSchema, mcpTestPayloadSchema, mcpToolsPayloadSchema, mcpToolFilterPayloadSchema } from "./wire.js";
import { fiberPhaseOf, getLoaderEntry, mcpToolCount, waitForLoaderState } from "./status.js";
import { probeMcpServer } from "./probe.js";
function stripUndefined(value) {
    if (Array.isArray(value))
        return value.map((item) => stripUndefined(item));
    if (value !== null && typeof value === "object") {
        const out = {};
        for (const [key, item] of Object.entries(value)) {
            if (item === undefined)
                continue;
            out[key] = stripUndefined(item);
        }
        return out;
    }
    return value;
}
const MANAGED_ROW_IDS = new Set();
/**
 * 布尔 `disabled` 等 loader 跟上。`!!js` 由宿主求值，结果可以不是 true，
 * 再等 `disabled === true` 或等它变成启用都会空转到超时。
 * 这种行写完即结束，卡片仍按停用展示，表达式留在文件里。
 */
async function reconcileToggle(ctx, id, disabled) {
    if (typeof id !== "string" || id === "")
        return false;
    if (isJsExprValue(disabled))
        return true;
    return disabled === true
        ? await waitForLoaderState(ctx, id, (entry) => entry !== undefined && entry.disabled === true)
        : await waitForLoaderState(ctx, id, (entry) => entry !== undefined && entry.disabled !== true);
}
/**
 * handler 内校验 payload：失败抛「字段：原因」的中文错误。
 * 网关边界的 codec 是宽松 schema（见 wire.ts），校验必须在这里做，
 * 否则失败会退化成宿主那句泛化的 `failed boundary validation`。
 */
function parseWirePayload(schema, raw, label) {
    const result = schema.safeParse(raw);
    if (result.success)
        return result.data;
    throw new Error(label + "：" + describeSchemaError(result.error));
}
/** 进行中的 OAuth 登录流程（flowId → 流程状态）。一次登录一条，完成或失败即清理。 */
const OAUTH_FLOWS = new Map();
export class McpManagerGateway extends TypertRemoteService {
    toolFilter;
    constructor(ctx, toolFilter) {
        super(ctx, "mcpManager");
        this.toolFilter = toolFilter;
    }
    get C() {
        return this.ctx;
    }
    patchPath() {
        const base = this.C.baseUrl;
        if (typeof base === "string" && base.length > 0) {
            try {
                const url = new URL(base);
                if (url.protocol === "file:")
                    return join(fileURLToPath(url), "cordis.patch.yml");
            }
            catch {
                // fall through to package-location fallback
            }
        }
        const packageDir = fileURLToPath(new URL("../../", import.meta.url));
        return join(resolve(packageDir, "../.."), "cordis.patch.yml");
    }
    async readRows() {
        const path = this.patchPath();
        const raw = await readPatchFile(path);
        // managed 仍是「受管块重写器认领的行」，只用于新建时追加。
        // 启停 / 编辑 / 删除看 all：每一条 mcp-client 行，不论在不在块里。
        const { managed, foreign } = readManagedBlock(raw);
        const all = listMcpPatchRows(raw);
        return { path, raw, managed, all, foreign };
    }
    serverNameOf(row) {
        return serverNameOfRow(row);
    }
    /** 按 serverName 找唯一的 MCP 行。没有或多条都抛错。 */
    findUnique(rows, serverName) {
        const matches = rows.filter((row) => this.serverNameOf(row) === serverName);
        if (matches.length === 0)
            throw new Error('MCP 行 "' + serverName + '" 不存在');
        if (matches.length > 1)
            throw new Error('serverName "' + serverName + '" 对应多条 MCP 行，请先用原文编辑消掉重名');
        return matches[0];
    }
    decorate(row, managed, entry, enabled) {
        const view = patchRowToView(row);
        if (view === undefined)
            return undefined;
        const fiberPhase = fiberPhaseOf(entry?.fiber?.state);
        return stripUndefined({
            ...view,
            enabled,
            managed,
            fiberPhase,
            toolCount: enabled ? mcpToolCount(this.C, view.serverName) : 0
        });
    }
    async list() {
        let patch = { path: this.patchPath(), ok: false, error: null, foreign: [] };
        try {
            const { path, all, foreign } = await this.readRows();
            // 非 MCP 的外来行仍要报给界面（ADR-0003）。MCP 行已经在 servers 里，不再当成「未管理」。
            const foreignEntries = foreign.entries.filter((entry) => entry.name !== MCP_PLUGIN_NAME);
            patch = { path, ok: true, error: null, foreign: foreignEntries };
            const servers = [];
            for (const row of all) {
                const entry = typeof row.id === "string" ? getLoaderEntry(this.C, row.id) : undefined;
                const view = this.decorate(row, true, entry, rowEnabled(row));
                if (view !== undefined)
                    servers.push(view);
            }
            return { servers, externalServers: [], patch };
        }
        catch (error) {
            return { servers: [], externalServers: [], patch: { ...patch, error: error instanceof Error ? error.message : String(error) } };
        }
    }
    findRowByServerName(rows, serverName) {
        return rows.find((row) => this.serverNameOf(row) === serverName);
    }
    configInputFromRow(row) {
        return inputFromPatchRow(row);
    }
    async save(rawPayload) {
        const payload = parseWirePayload(mcpSavePayloadSchema, rawPayload, "MCP 配置无效");
        const input = payload.input;
        const { managed, all } = await this.readRows();
        let previous;
        if (payload.previousServerName !== undefined) {
            previous = this.findUnique(all, payload.previousServerName);
        }
        else {
            const same = all.filter((row) => this.serverNameOf(row) === input.serverName);
            if (same.length > 1)
                throw new Error('serverName "' + input.serverName + '" 对应多条 MCP 行，请先用原文编辑消掉重名');
            previous = same[0];
        }
        for (const row of all) {
            if (row === previous)
                continue;
            if (this.serverNameOf(row) === input.serverName) {
                throw new Error('serverName "' + input.serverName + '" 已存在（' + String(row.id ?? "未命名行") + "）");
            }
        }
        // !!js disabled 不是「未禁用」。卡片按停用展示，也不要等 loader 给出某个布尔值。
        const enabled = previous !== undefined ? rowEnabled(previous) : payload.enabled;
        const nextRow = applyServerEdit(previous, input, enabled);
        const shownEnabled = rowEnabled(nextRow);
        if (previous === undefined) {
            if (all.some((row) => row.id === nextRow.id))
                throw new Error('id "' + String(nextRow.id) + '" 已存在');
            const nextRows = [...managed, nextRow];
            nextRows.sort((a, b) => String(a.config?.serverName ?? "").localeCompare(String(b.config?.serverName ?? "")));
            await writeManagedRows(this.patchPath(), nextRows);
        }
        else {
            await replaceMcpEntryWithRow(this.patchPath(), { id: previous.id, serverName: this.serverNameOf(previous) }, nextRow);
        }
        const reconciled = await reconcileToggle(this.C, nextRow.id, nextRow.disabled);
        const entry = typeof nextRow.id === "string" ? getLoaderEntry(this.C, nextRow.id) : undefined;
        const server = this.decorate(nextRow, true, entry, shownEnabled);
        if (server === undefined)
            throw new Error("写入成功但生成的 MCP 行无效");
        return { server, reconciled };
    }
    async removeServer(rawPayload) {
        const payload = parseWirePayload(mcpRemovePayloadSchema, rawPayload, "删除参数无效");
        const { all } = await this.readRows();
        const row = this.findUnique(all, payload.serverName);
        await removeMcpEntry(this.patchPath(), { id: row.id, serverName: payload.serverName });
        const reconciled = typeof row.id === "string"
            ? await waitForLoaderState(this.C, row.id, (entry) => entry === undefined)
            : false;
        return { ok: true, reconciled };
    }
    async setEnabled(rawPayload) {
        const payload = parseWirePayload(mcpSetEnabledPayloadSchema, rawPayload, "启用参数无效");
        const { all } = await this.readRows();
        const row = this.findUnique(all, payload.serverName);
        if (typeof row.id !== "string" || row.id === "")
            throw new Error('MCP 行 "' + payload.serverName + '" 没有 id，无法就地开关；请用原文编辑补上 id');
        await setEntryDisabled(this.patchPath(), row.id, !payload.enabled);
        const reconciled = payload.enabled
            ? await waitForLoaderState(this.C, row.id, (entry) => entry !== undefined && entry.disabled !== true)
            : await waitForLoaderState(this.C, row.id, (entry) => entry !== undefined && entry.disabled === true);
        const nextRow = { ...row };
        if (payload.enabled)
            delete nextRow.disabled;
        else
            nextRow.disabled = true;
        const entry = getLoaderEntry(this.C, row.id);
        const server = this.decorate(nextRow, true, entry, payload.enabled);
        if (server === undefined)
            throw new Error("写入成功但生成的 MCP 行无效");
        return { server, reconciled };
    }
    /** 读出一条 MCP 行的原文，供面板的原文编辑框回填。 */
    async readRaw(rawPayload) {
        const payload = parseWirePayload(mcpRawReadPayloadSchema, rawPayload, "原文参数无效");
        const { raw, all } = await this.readRows();
        const row = this.findUnique(all, payload.serverName);
        return {
            serverName: payload.serverName,
            entryId: typeof row.id === "string" ? row.id : "",
            text: readMcpEntryText(raw, { id: row.id, serverName: payload.serverName })
        };
    }
    /** 用原文替换一条 MCP 行。表单未建模的字段就走这里。 */
    async writeRaw(rawPayload) {
        const payload = parseWirePayload(mcpRawWritePayloadSchema, rawPayload, "原文参数无效");
        const { all } = await this.readRows();
        const previous = this.findUnique(all, payload.serverName);
        const written = await replaceMcpEntryText(this.patchPath(), { id: previous.id, serverName: payload.serverName }, payload.text);
        const enabled = rowEnabled(written.row);
        const reconciled = await reconcileToggle(this.C, written.row.id, written.row.disabled);
        const entry = typeof written.row.id === "string" ? getLoaderEntry(this.C, written.row.id) : undefined;
        const server = this.decorate(written.row, true, entry, enabled);
        if (server === undefined)
            throw new Error("原文已写入，但生成的 MCP 行无效");
        return { server, reconciled };
    }
    async test(rawPayload) {
        const payload = parseWirePayload(mcpTestPayloadSchema, rawPayload, "测试参数无效");
        if (payload !== null && typeof payload === "object" && !("transport" in payload) && "serverName" in payload) {
            const { all } = await this.readRows();
            const row = this.findUnique(all, String(payload.serverName));
            return probeMcpServer(this.configInputFromRow(row));
        }
        return probeMcpServer(payload);
    }
    /**
     * 某个 MCP 服务器当前注册的工具（公开名 `mcp__<serverName>__<原始名>`）。
     * 只读工具注册表、不启动服务器：服务器还没连上时返回空列表，界面按「未连接」显示。
     */
    serverToolRows(serverName) {
        const prefix = "mcp__" + serverName + "__";
        const rows = [];
        try {
            const view = this.C.tools.view(undefined);
            for (const name of view.knownNames ?? []) {
                if (typeof name !== "string" || !name.startsWith(prefix))
                    continue;
                const definition = typeof view.visible?.get === "function" ? view.visible.get(name) : undefined;
                rows.push(stripUndefined({ name, description: typeof definition?.description === "string" ? definition.description : undefined }));
            }
        }
        catch {
            // 工具注册表不可用：当作「一个都不知道」，界面显示未连接。
        }
        rows.sort((a, b) => a.name.localeCompare(b.name));
        return rows;
    }
    dshHomeOf() {
        return resolveDshHome();
    }
    /** 运行中控制器的禁用列表；还没挂上（或没有控制器）时返回 undefined，由调用方读盘。 */
    liveDeny() {
        const names = this.toolFilter?.denyOf?.();
        return Array.isArray(names) ? [...names] : undefined;
    }
    /** 列出一个 MCP 服务器的工具，并标出其中已被禁用的（Issue #44）。 */
    async listTools(rawPayload) {
        const payload = parseWirePayload(mcpToolsPayloadSchema, rawPayload, "工具查询参数无效");
        const tools = this.serverToolRows(payload.serverName);
        const deny = this.liveDeny() ?? await loadToolFilter(this.dshHomeOf());
        return {
            serverName: payload.serverName,
            tools,
            disabled: deny.filter((name) => tools.some((row) => row.name === name)),
            connected: tools.length > 0
        };
    }
    /**
     * 把受管块内**不属于面板**的顶层行原样搬到块外（#46 后续）。
     * 只搬顶层行；块外内容、面板自己的行都不动，搬完语义与之前一致。
     */
    async evacuateForeign() {
        const result = await writeEvacuatedForeign(this.patchPath());
        return { moved: result.moved };
    }
    /** 读取单工具禁用列表。 */
    async getToolFilter() {
        const deny = this.liveDeny() ?? await loadToolFilter(this.dshHomeOf());
        return { deny: [...deny].sort(), applied: this.appliedAgentCount() };
    }
    /** 写入单工具禁用列表并立刻重新施加到所有 agent（Issue #44）。 */
    async setToolFilter(rawPayload) {
        const payload = parseWirePayload(mcpToolFilterPayloadSchema, rawPayload, "工具过滤参数无效");
        const deny = [
            ...new Set(payload.deny.filter((value) => typeof value === "string" && value.startsWith("mcp__")))
        ].sort();
        await saveToolFilter(this.dshHomeOf(), deny);
        if (this.toolFilter !== undefined && typeof this.toolFilter.setDeny === "function")
            this.toolFilter.setDeny(deny);
        return { deny, applied: this.appliedAgentCount() };
    }
    appliedAgentCount() {
        return this.toolFilter !== undefined && typeof this.toolFilter.activeCount === "function" ? this.toolFilter.activeCount() : 0;
    }
    /** 找到某个服务器的 MCP 行（OAuth 要读写它的 headers）。 */
    managedRow(rows, serverName) {
        return rows.find((row) => this.serverNameOf(row) === serverName);
    }
    /** 把 Authorization 头写进那一行（其它 header、未建模字段、所在位置都保留）。 */
    async writeAuthHeader(serverName, value) {
        const { all } = await this.readRows();
        const row = this.findUnique(all, serverName);
        const config = { ...(row.config ?? {}) };
        const headers = config.headers !== null && typeof config.headers === "object" && !Array.isArray(config.headers) ? { ...config.headers } : {};
        if (value === undefined)
            delete headers.Authorization;
        else
            headers.Authorization = value;
        const nextConfig = { ...config };
        if (Object.keys(headers).length === 0)
            delete nextConfig.headers;
        else
            nextConfig.headers = headers;
        await replaceMcpEntryWithRow(this.patchPath(), { id: row.id, serverName }, { ...row, config: nextConfig });
    }
    /**
     * 开始一次 OAuth 登录（Issue #45 的面板入口）。
     * 返回授权地址：前端交给浏览器打开，然后轮询 `oauthPoll`。
     */
    async oauthStart(rawPayload) {
        const payload = parseWirePayload(mcpOAuthStartPayloadSchema, rawPayload, "OAuth 参数无效");
        const { all } = await this.readRows();
        const row = this.managedRow(all, payload.serverName);
        if (row === undefined)
            throw new Error('MCP 行 "' + payload.serverName + '" 不存在');
        const config = row.config ?? {};
        if (config.transport !== "streamable-http" || typeof config.url !== "string" || config.url === "") {
            throw new Error("只有 streamable-http 的服务器能用 OAuth 登录（stdio 由本地进程自己管凭据）");
        }
        const { metadata, attempts } = await discoverMetadataDetailed(config.url);
        if (metadata === undefined)
            throw new Error(discoveryFailureMessage(attempts));
        const serverUrl = normalizeServerUrl(config.url);
        const state = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        const { verifier, challenge } = createPkce();
        const timeoutMs = Math.max(30, Math.min(900, Number(payload.timeoutSeconds ?? 300))) * 1000;
        const loopback = await startLoopbackServer(state, timeoutMs);
        const previous = (await loadOAuthStore(this.dshHomeOf()))[payload.serverName];
        const clientId = payload.clientId ?? previous?.clientId ?? (await registerClient(metadata, loopback.redirectUri))?.client_id;
        if (typeof clientId !== "string" || clientId === "") {
            await loopback.close();
            throw new Error("拿不到 client_id：服务器既不支持动态注册，也没有指定 clientId");
        }
        const authUrl = buildAuthorizationUrl(metadata, clientId, loopback.redirectUri, challenge, state, payload.scope, serverUrl);
        const flowId = Math.random().toString(36).slice(2) + Date.now().toString(36);
        const flow = {
            flowId,
            serverName: payload.serverName,
            state,
            clientId,
            metadata,
            redirectUri: loopback.redirectUri,
            verifier,
            url: serverUrl,
            status: "pending",
            error: undefined,
            startedAt: Date.now(),
            loopback
        };
        OAUTH_FLOWS.set(flowId, flow);
        // 后台等回调：失败也记在 flow 上、交给轮询回报，不在这里抛。
        loopback.waitForCode().then((result) => {
            flow.code = result.code;
        }, (error) => {
            flow.status = "failed";
            flow.error = error instanceof Error ? error.message : String(error);
        });
        return { flowId, authUrl, redirectUri: loopback.redirectUri, expiresInSeconds: Math.round(timeoutMs / 1000) };
    }
    /** 轮询一次 OAuth 流程：pending / done / failed。拿到 code 就换令牌并落盘。 */
    async oauthPoll(rawPayload) {
        const payload = parseWirePayload(mcpOAuthPollPayloadSchema, rawPayload, "OAuth 轮询参数无效");
        const flow = OAUTH_FLOWS.get(payload.flowId);
        if (flow === undefined)
            throw new Error("这次登录流程不存在或已经结束，请重新点一次登录");
        if (flow.status === "failed") {
            OAUTH_FLOWS.delete(payload.flowId);
            await flow.loopback.close();
            return { status: "failed", error: flow.error ?? "授权失败", serverName: flow.serverName };
        }
        if (flow.code === undefined)
            return { status: "pending", serverName: flow.serverName };
        if (flow.status === "done") {
            return { status: "done", serverName: flow.serverName, expiresAt: flow.expiresAt ?? null, header: flow.header ?? "" };
        }
        flow.status = "exchanging";
        try {
            const tokens = await exchangeCode(flow.metadata, flow.clientId, flow.code, flow.verifier, flow.redirectUri, flow.url);
            await saveOAuthRecord(this.dshHomeOf(), flow.serverName, {
                ...tokens,
                clientId: flow.clientId,
                serverUrl: flow.url,
                tokenEndpoint: flow.metadata.token_endpoint
            });
            const header = authorizationHeader(tokens);
            await this.writeAuthHeader(flow.serverName, header);
            flow.status = "done";
            flow.expiresAt = tokens.expiresAt;
            flow.header = header;
            await flow.loopback.close();
            const row = this.managedRow((await this.readRows()).all, flow.serverName);
            if (row !== undefined && typeof row.id === "string")
                await waitForLoaderState(this.C, row.id, (entry) => entry !== undefined);
            return { status: "done", serverName: flow.serverName, expiresAt: flow.expiresAt ?? null, header };
        }
        catch (error) {
            flow.status = "failed";
            flow.error = error instanceof Error ? error.message : String(error);
            await flow.loopback.close();
            OAUTH_FLOWS.delete(payload.flowId);
            return { status: "failed", error: flow.error, serverName: flow.serverName };
        }
    }
    /** 某个服务器当前的 OAuth 状态（给卡片显示）。 */
    async oauthStatus(rawPayload) {
        const payload = parseWirePayload(mcpOAuthServerPayloadSchema, rawPayload, "OAuth 参数无效");
        const store = await loadOAuthStore(this.dshHomeOf());
        const record = store[payload.serverName];
        if (record === undefined)
            return { connected: false, headerReady: false, expiresAt: null, expired: false };
        const { all } = await this.readRows();
        const row = this.managedRow(all, payload.serverName);
        const config = row?.config ?? {};
        const headers = config.headers !== null && typeof config.headers === "object" && !Array.isArray(config.headers) ? config.headers : {};
        return {
            connected: typeof headers.Authorization === "string" && headers.Authorization.indexOf("Bearer ") === 0,
            headerReady: typeof record.accessToken === "string",
            expiresAt: typeof record.expiresAt === "number" ? record.expiresAt : null,
            expired: isExpired(record)
        };
    }
    /** 断开 OAuth：删掉 Authorization 头与本地令牌记录。 */
    async oauthDisconnect(rawPayload) {
        const payload = parseWirePayload(mcpOAuthServerPayloadSchema, rawPayload, "OAuth 参数无效");
        await this.writeAuthHeader(payload.serverName, undefined);
        await removeOAuthRecord(this.dshHomeOf(), payload.serverName);
        const row = this.managedRow((await this.readRows()).all, payload.serverName);
        if (row !== undefined && typeof row.id === "string")
            await waitForLoaderState(this.C, row.id, (entry) => entry !== undefined);
        return { disconnected: true, serverName: payload.serverName };
    }
    reload() {
        return this.list();
    }
}
// 供 CLI 复用：判断一个 patch 行是否由面板管理。
export { MANAGED_ROW_IDS, isManagedRow, MCP_PLUGIN_NAME };
