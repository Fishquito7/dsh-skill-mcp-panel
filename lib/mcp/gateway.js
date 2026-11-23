/**
 * dsh-skill-mcp-panel —— MCP 宿主服务（skillMcpPanel）。
 */
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { resolveDshHome } from "../host-paths.js";
import { emptyToolFilterPolicy, loadToolFilterPolicy, normalizeToolNames, normalizeWorkspaceKey, profileDirOf, saveToolFilterPolicy } from "../tool-filter.js";
import { locatorOfRow, readPatchRows, resolvePatchRow } from "./rows.js";
import { deleteMcpGroup, loadMcpGroups, upsertMcpGroup } from "./groups.js";
import { authorizationHeader, buildAuthorizationUrl, createPkce, discoverMetadataDetailed, discoveryFailureMessage, exchangeCode, isExpired, loadOAuthStore, normalizeServerUrl, registerClient, removeOAuthRecord, saveOAuthRecord, startLoopbackServer } from "../oauth.js";
import { OAuthRefreshScheduler } from "../oauth-scheduler.js";
import { MCP_PLUGIN_NAME, isJsExprValue, isManagedRow, readMcpEntryText, removeMcpEntry, replaceMcpEntryText, replaceMcpEntryWithRow, setEntryDisabled, writeManagedRows, writeEvacuatedForeign } from "../patch-editor.js";
import { applyServerEdit, describeSchemaError, inputFromPatchRow, patchRowToView, rowEnabled, serverNameOfRow } from "./model.js";
import { mcpGroupDeletePayloadSchema, mcpGroupSavePayloadSchema, mcpOAuthPollPayloadSchema, mcpOAuthServerPayloadSchema, mcpOAuthStartPayloadSchema, mcpRawReadPayloadSchema, mcpRawWritePayloadSchema, mcpRemovePayloadSchema, mcpSavePayloadSchema, mcpSetEnabledPayloadSchema, mcpTestPayloadSchema, mcpToolsPayloadSchema, mcpToolFilterPayloadSchema } from "./wire.js";
import { fiberPhaseOf, getLoaderEntry, mcpToolCount, waitForLoaderState } from "./status.js";
import { probeMcpServer } from "./probe.js";
import { MANAGER_SOURCE } from "./manager-model.js";
import { ManagerServers } from "./manager-source.js";
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
    oauthScheduler;
    fetchImpl = fetch;
    /** DSH 官方 dsh-mcp-manager 的 config.servers 条目（payload 带 source: "manager" 的走这里）。 */
    manager;
    constructor(ctx, toolFilter) {
        super(ctx, "skillMcpPanel");
        this.toolFilter = toolFilter;
        this.manager = new ManagerServers(ctx);
    }
    setOAuthScheduler(scheduler) {
        this.oauthScheduler = scheduler;
    }
    filterMcpNames(raw) {
        return normalizeToolNames(Array.isArray(raw) ? raw.filter((v) => typeof v === "string" && v.startsWith("mcp__")) : []);
    }
    livePolicy() {
        const policy = this.toolFilter?.policyOf?.();
        if (policy !== null && typeof policy === "object" && Array.isArray(policy.deny))
            return policy;
        const deny = this.liveDeny();
        if (deny !== undefined)
            return emptyToolFilterPolicy(deny);
        return undefined;
    }
    liveSessionOverrides() {
        const map = this.toolFilter?.sessionOverridesObject?.();
        return map !== null && typeof map === "object" ? map : {};
    }
    applyLivePolicy(policy) {
        if (this.toolFilter === undefined)
            return;
        if (typeof this.toolFilter.setPolicy === "function")
            this.toolFilter.setPolicy(policy);
        else if (typeof this.toolFilter.setDeny === "function")
            this.toolFilter.setDeny(policy.deny);
    }
    oauthSummaryOf(serverName, headerKeys, oauthStore) {
        const record = oauthStore?.[serverName];
        if (record === null || typeof record !== "object")
            return undefined;
        return stripUndefined({
            connected: headerKeys.includes("Authorization"),
            expiresAt: typeof record.expiresAt === "number" ? record.expiresAt : null,
            expired: isExpired(record),
            needsReauth: record.needsReauth === true ? true : undefined,
            refreshError: typeof record.refreshError === "string" ? record.refreshError : undefined,
            canRefresh: typeof record.refreshToken === "string" &&
                record.refreshToken !== "" &&
                typeof record.tokenEndpoint === "string" &&
                record.tokenEndpoint !== "",
            updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : undefined
        });
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
        return readPatchRows(this.patchPath());
    }
    serverNameOf(row) {
        return serverNameOfRow(row);
    }
    resolveRow(rows, ref) {
        return resolvePatchRow(rows, ref, "gateway");
    }
    /** 这一行的 patch-editor 定位器（id + serverName，缺 id 时只给 serverName）。 */
    locatorOf(row) {
        return locatorOfRow(row);
    }
    decorate(row, managed, entry, enabled, oauthStore) {
        const view = patchRowToView(row);
        if (view === undefined)
            return undefined;
        const fiberPhase = fiberPhaseOf(entry?.fiber?.state);
        const oauth = view.transport === "streamable-http" ? this.oauthSummaryOf(view.serverName, view.headerKeys ?? [], oauthStore) : undefined;
        return stripUndefined({
            ...view,
            enabled,
            managed,
            fiberPhase,
            // 不按 enabled 归零：!!js 的 disabled 由宿主求值，行可能正在跑，显示真实工具数。
            toolCount: mcpToolCount(this.C, view.serverName),
            oauth
        });
    }
    async list() {
        let patch = { path: this.patchPath(), ok: false, error: null, foreign: [] };
        try {
            const [{ path, all, foreign }, oauthStore] = await Promise.all([
                this.readRows(),
                loadOAuthStore(this.dshHomeOf()).catch(() => ({}))
            ]);
            // 非 MCP 的外来行仍要报给界面（ADR-0003）。MCP 行已经在 servers 里，不再当成「未管理」。
            const foreignEntries = foreign.entries.filter((entry) => entry.name !== MCP_PLUGIN_NAME);
            patch = { path, ok: true, error: null, foreign: foreignEntries };
            const servers = [];
            for (const row of all) {
                const entry = typeof row.id === "string" ? getLoaderEntry(this.C, row.id) : undefined;
                const view = this.decorate(row, true, entry, rowEnabled(row), oauthStore);
                if (view !== undefined)
                    servers.push(view);
            }
            servers.push(...this.manager.list());
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
    /** 全部 mcp-client 行的 serverName：manager 条目改名时用来查重。 */
    async clientServerNames() {
        const { all } = await this.readRows();
        return all.map((row) => this.serverNameOf(row)).filter((name) => name !== undefined);
    }
    async saveManagerServer(payload) {
        if (payload.previousServerName === undefined)
            throw new Error("编辑 dsh-mcp-manager 的服务器需要 previousServerName");
        const server = await this.manager.save(payload.input, payload.previousServerName, await this.clientServerNames());
        return { server, reconciled: true };
    }
    async save(rawPayload) {
        const payload = parseWirePayload(mcpSavePayloadSchema, rawPayload, "MCP 配置无效");
        if (payload.previousSource === MANAGER_SOURCE)
            return this.saveManagerServer(payload);
        const input = payload.input;
        const { managed, all } = await this.readRows();
        let previous;
        if (payload.previousServerName !== undefined || payload.previousEntryId !== undefined) {
            previous = this.resolveRow(all, { serverName: payload.previousServerName, entryId: payload.previousEntryId });
        }
        else {
            const same = all.filter((row) => this.serverNameOf(row) === input.serverName);
            if (same.length > 1) {
                throw new Error('serverName "' + input.serverName + '" 对应多条 MCP 行，可编辑的卡片带 entryId，请从卡片进入');
            }
            previous = same[0];
        }
        const previousName = previous !== undefined ? this.serverNameOf(previous) : undefined;
        for (const row of all) {
            if (row === previous)
                continue;
            if (this.serverNameOf(row) !== input.serverName)
                continue;
            // 编辑且没改名：文件里可能本来就有重名，允许保存（用 entryId 精确定位那一条）。
            if (previous !== undefined && previousName === input.serverName)
                continue;
            throw new Error('serverName "' + input.serverName + '" 已存在（' + String(row.id ?? "未命名行") + "）");
        }
        if (previousName !== input.serverName && this.manager.names().includes(input.serverName)) {
            throw new Error('serverName "' + input.serverName + '" 已被 dsh-mcp-manager 的服务器使用');
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
            await replaceMcpEntryWithRow(this.patchPath(), this.locatorOf(previous), nextRow);
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
        if (payload.source === MANAGER_SOURCE) {
            await this.manager.remove(payload.serverName);
            return { ok: true, reconciled: true };
        }
        const { all } = await this.readRows();
        const row = this.resolveRow(all, { serverName: payload.serverName, entryId: payload.entryId });
        await removeMcpEntry(this.patchPath(), this.locatorOf(row));
        const reconciled = typeof row.id === "string"
            ? await waitForLoaderState(this.C, row.id, (entry) => entry === undefined)
            : false;
        return { ok: true, reconciled };
    }
    async setEnabled(rawPayload) {
        const payload = parseWirePayload(mcpSetEnabledPayloadSchema, rawPayload, "启用参数无效");
        if (payload.source === MANAGER_SOURCE) {
            return { server: await this.manager.setEnabled(payload.serverName, payload.enabled), reconciled: true };
        }
        const { all } = await this.readRows();
        const row = this.resolveRow(all, { serverName: payload.serverName, entryId: payload.entryId });
        // 没有 id 的手写行也能开关：disabled 键按这一条自己的缩进插入/删除。
        await setEntryDisabled(this.patchPath(), this.locatorOf(row), !payload.enabled);
        const nextRow = { ...row };
        if (payload.enabled)
            delete nextRow.disabled;
        else
            nextRow.disabled = true;
        const reconciled = await reconcileToggle(this.C, row.id, nextRow.disabled);
        const entry = typeof row.id === "string" ? getLoaderEntry(this.C, row.id) : undefined;
        const server = this.decorate(nextRow, true, entry, payload.enabled);
        if (server === undefined)
            throw new Error("写入成功但生成的 MCP 行无效");
        return { server, reconciled };
    }
    /** 读出一条 MCP 行的原文，供面板的原文编辑框回填。 */
    async readRaw(rawPayload) {
        const payload = parseWirePayload(mcpRawReadPayloadSchema, rawPayload, "原文参数无效");
        if (payload.source === MANAGER_SOURCE)
            return { serverName: payload.serverName, text: this.manager.readRaw(payload.serverName) };
        const { raw, all } = await this.readRows();
        const row = this.resolveRow(all, { serverName: payload.serverName, entryId: payload.entryId });
        return {
            serverName: this.serverNameOf(row) ?? payload.serverName,
            ...(typeof row.id === "string" ? { entryId: row.id } : {}),
            text: readMcpEntryText(raw, this.locatorOf(row))
        };
    }
    /** 用原文替换一条 MCP 行。表单未建模的字段就走这里。 */
    async writeRaw(rawPayload) {
        const payload = parseWirePayload(mcpRawWritePayloadSchema, rawPayload, "原文参数无效");
        if (payload.source === MANAGER_SOURCE) {
            const server = await this.manager.writeRaw(payload.serverName, payload.text, await this.clientServerNames());
            return { server, reconciled: true };
        }
        const { all } = await this.readRows();
        const previous = this.resolveRow(all, { serverName: payload.serverName, entryId: payload.entryId });
        const written = await replaceMcpEntryText(this.patchPath(), this.locatorOf(previous), payload.text);
        const enabled = rowEnabled(written.row);
        const reconciled = await reconcileToggle(this.C, written.row.id, written.row.disabled);
        const entry = typeof written.row.id === "string" ? getLoaderEntry(this.C, written.row.id) : undefined;
        const server = this.decorate(written.row, true, entry, enabled);
        if (server === undefined)
            throw new Error("原文已写入，但生成的 MCP 行无效");
        return { server, reconciled };
    }
    probeOptions() {
        return {
            dshHome: this.dshHomeOf(),
            resolveCredential: async (ref) => {
                try {
                    const svc = typeof this.C?.get === "function" ? this.C.get("credentials") : undefined;
                    if (svc && typeof svc.resolve === "function") {
                        const result = await svc.resolve(ref);
                        return typeof result?.value === "string" && result.value !== "" ? result.value : undefined;
                    }
                }
                catch {
                    // fall back to local credentials/env lookup inside probeMcpServer
                }
                return undefined;
            }
        };
    }
    async test(rawPayload) {
        const payload = parseWirePayload(mcpTestPayloadSchema, rawPayload, "测试参数无效");
        const opts = this.probeOptions();
        if (payload !== null && typeof payload === "object" && !("transport" in payload) && "serverName" in payload) {
            if (payload.source === MANAGER_SOURCE)
                return this.manager.probe(String(payload.serverName));
            const { all } = await this.readRows();
            const entryId = typeof payload.entryId === "string" ? String(payload.entryId) : undefined;
            const row = this.resolveRow(all, { serverName: String(payload.serverName), entryId });
            return probeMcpServer(this.configInputFromRow(row), opts);
        }
        return probeMcpServer(payload, opts);
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
        const deny = this.liveDeny() ?? (await loadToolFilterPolicy(this.dshHomeOf(), profileDirOf(this.C))).deny;
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
    /** 读取全部分层单工具禁用策略与当前内存会话覆盖（Issue #44 / #55 / #91）。 */
    async getToolFilter() {
        const policy = this.livePolicy() ?? await loadToolFilterPolicy(this.dshHomeOf(), profileDirOf(this.C));
        return {
            deny: [...policy.deny].sort(),
            applied: this.appliedAgentCount(),
            workspaces: policy.workspaces,
            roles: policy.roles,
            sessionOverrides: this.liveSessionOverrides()
        };
    }
    /** 写入全局 / 工作区 / 会话 / 子代理工具过滤规则并立刻重新施加到所有 agent。 */
    async setToolFilter(rawPayload) {
        const payload = parseWirePayload(mcpToolFilterPayloadSchema, rawPayload, "工具过滤参数无效");
        const current = this.livePolicy() ?? await loadToolFilterPolicy(this.dshHomeOf(), profileDirOf(this.C));
        const nextPolicy = {
            version: current.version,
            deny: [...current.deny],
            workspaces: { ...current.workspaces },
            roles: {
                subagentAllow: [...current.roles.subagentAllow],
                subagentDeny: [...current.roles.subagentDeny]
            }
        };
        const scopeKind = payload.scopeKind;
        if (scopeKind === "session") {
            const sessionId = typeof payload.scopeKey === "string" ? payload.scopeKey.trim() : "";
            if (sessionId === "")
                throw new Error("会话级工具覆盖缺少当前会话 ID");
            if (this.toolFilter !== undefined && typeof this.toolFilter.setSessionOverride === "function") {
                this.toolFilter.setSessionOverride(sessionId, {
                    deny: this.filterMcpNames(payload.deny),
                    allow: this.filterMcpNames(payload.allow)
                });
            }
            return {
                deny: nextPolicy.deny,
                applied: this.appliedAgentCount(),
                workspaces: nextPolicy.workspaces,
                roles: nextPolicy.roles,
                sessionOverrides: this.liveSessionOverrides()
            };
        }
        if (scopeKind === "workspace") {
            const wsKey = typeof payload.scopeKey === "string" ? normalizeWorkspaceKey(payload.scopeKey) : "";
            if (wsKey === "")
                throw new Error("工作区级工具覆盖缺少工作区路径");
            const wsDeny = this.filterMcpNames(payload.deny);
            if (wsDeny.length === 0)
                delete nextPolicy.workspaces[wsKey];
            else
                nextPolicy.workspaces[wsKey] = wsDeny;
        }
        else if (scopeKind === "subagent") {
            if (payload.roles !== undefined) {
                if (payload.roles.subagentAllow !== undefined)
                    nextPolicy.roles.subagentAllow = this.filterMcpNames(payload.roles.subagentAllow);
                if (payload.roles.subagentDeny !== undefined)
                    nextPolicy.roles.subagentDeny = this.filterMcpNames(payload.roles.subagentDeny);
            }
            else {
                if (payload.allow !== undefined)
                    nextPolicy.roles.subagentAllow = this.filterMcpNames(payload.allow);
                if (payload.deny !== undefined)
                    nextPolicy.roles.subagentDeny = this.filterMcpNames(payload.deny);
            }
        }
        else {
            if (payload.deny !== undefined)
                nextPolicy.deny = this.filterMcpNames(payload.deny);
            if (payload.workspaces !== undefined) {
                const nextWs = {};
                for (const [k, v] of Object.entries(payload.workspaces)) {
                    const wsKey = normalizeWorkspaceKey(k);
                    const list = this.filterMcpNames(v);
                    if (wsKey !== "" && list.length > 0)
                        nextWs[wsKey] = list;
                }
                nextPolicy.workspaces = nextWs;
            }
            if (payload.roles !== undefined) {
                nextPolicy.roles = {
                    subagentAllow: payload.roles.subagentAllow !== undefined ? this.filterMcpNames(payload.roles.subagentAllow) : nextPolicy.roles.subagentAllow,
                    subagentDeny: payload.roles.subagentDeny !== undefined ? this.filterMcpNames(payload.roles.subagentDeny) : nextPolicy.roles.subagentDeny
                };
            }
        }
        const saved = await saveToolFilterPolicy(this.dshHomeOf(), nextPolicy, profileDirOf(this.C));
        this.applyLivePolicy(saved);
        return {
            deny: saved.deny,
            applied: this.appliedAgentCount(),
            workspaces: saved.workspaces,
            roles: saved.roles,
            sessionOverrides: this.liveSessionOverrides()
        };
    }
    groupRowsResult(groups) {
        return {
            groups: Object.entries(groups).map(([id, g]) => ({ id, name: g.name, servers: g.servers }))
        };
    }
    /** 读取 MCP 服务器逻辑分组（存于 mcp-groups.json）。 */
    async listGroups() {
        return this.groupRowsResult(await loadMcpGroups(this.dshHomeOf()));
    }
    /** 新建或更新 MCP 服务器逻辑分组。 */
    async saveGroup(rawPayload) {
        const payload = parseWirePayload(mcpGroupSavePayloadSchema, rawPayload, "MCP 分组参数无效");
        const { groups } = await upsertMcpGroup(this.dshHomeOf(), payload);
        return this.groupRowsResult(groups);
    }
    /** 删除 MCP 服务器逻辑分组（不动 cordis.patch.yml 里的服务器）。 */
    async deleteGroup(rawPayload) {
        const payload = parseWirePayload(mcpGroupDeletePayloadSchema, rawPayload, "MCP 分组删除参数无效");
        return this.groupRowsResult(await deleteMcpGroup(this.dshHomeOf(), payload.id));
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
        const row = this.managedRow(all, serverName);
        if (row === undefined)
            return false;
        const config = { ...(row.config ?? {}) };
        const headers = config.headers !== null && typeof config.headers === "object" && !Array.isArray(config.headers) ? { ...config.headers } : {};
        if (value === undefined && !("Authorization" in headers))
            return false;
        if (value !== undefined && headers.Authorization === value)
            return false;
        if (value === undefined)
            delete headers.Authorization;
        else
            headers.Authorization = value;
        const nextConfig = { ...config };
        if (Object.keys(headers).length === 0)
            delete nextConfig.headers;
        else
            nextConfig.headers = headers;
        await replaceMcpEntryWithRow(this.patchPath(), this.locatorOf(row), { ...row, config: nextConfig });
        return true;
    }
    /**
     * 自动刷新后热同步 Authorization 头：
     *   - 行不存在则跳过（不抛错）；
     *   - 用户把 Authorization 改写为 `${...}` 凭据/环境模板或 `!!js` 表达式时绝不覆盖；
     *   - header 值未变化时不改写 YAML，避免无意义的 HMR 抖动。
     */
    async syncAuthHeaderFromOAuth(serverName, record) {
        const { all } = await this.readRows();
        const row = this.managedRow(all, serverName);
        if (row === undefined)
            return false;
        const existing = row.config?.headers?.Authorization;
        if (isJsExprValue(existing))
            return false;
        if (typeof existing === "string" && /\$\{[^}]+\}/.test(existing))
            return false;
        const nextHeader = authorizationHeader(record);
        if (existing === nextHeader)
            return false;
        const changed = await this.writeAuthHeader(serverName, nextHeader);
        if (changed && typeof row.id === "string") {
            await waitForLoaderState(this.C, row.id, (entry) => entry !== undefined).catch(() => { });
        }
        return changed;
    }
    getOrCreateScheduler() {
        if (this.oauthScheduler !== undefined)
            return this.oauthScheduler;
        const created = new OAuthRefreshScheduler({
            dshHome: this.dshHomeOf(),
            fetchImpl: this.fetchImpl,
            onTokenRefreshed: (serverName, record) => this.syncAuthHeaderFromOAuth(serverName, record),
            logger: this.C?.logger
        });
        this.oauthScheduler = created;
        return created;
    }
    /**
     * 开始一次 OAuth 登录（Issue #45 / #80 的面板入口）。
     * 返回授权地址：前端交给浏览器打开，然后轮询 `oauthPoll`。
     */
    async oauthStart(rawPayload) {
        const payload = parseWirePayload(mcpOAuthStartPayloadSchema, rawPayload, "OAuth 参数无效");
        const { all } = await this.readRows();
        const row = this.resolveRow(all, { serverName: payload.serverName });
        if (row === undefined)
            throw new Error('MCP 行 "' + payload.serverName + '" 不存在');
        const config = row.config ?? {};
        if (config.transport !== "streamable-http" || typeof config.url !== "string" || config.url === "") {
            throw new Error("只有 streamable-http 的服务器能用 OAuth 登录（stdio 由本地进程自己管凭据）");
        }
        const discovery = await discoverMetadataDetailed(config.url, this.fetchImpl, { probeChallenge: true });
        const metadata = discovery.metadata;
        if (metadata === undefined)
            throw new Error(discoveryFailureMessage(discovery.attempts));
        const configuredUrl = normalizeServerUrl(config.url);
        // PRM 声明的 resource 优先（同源才被 oauth.ts 接受）；没有就用配置里的 endpoint。
        const serverUrl = typeof discovery.resource === "string" && discovery.resource !== "" ? discovery.resource : configuredUrl;
        const state = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        const { verifier, challenge } = createPkce();
        const timeoutMs = Math.max(30, Math.min(900, Number(payload.timeoutSeconds ?? 300))) * 1000;
        const loopback = await startLoopbackServer(state, timeoutMs);
        const previous = (await loadOAuthStore(this.dshHomeOf()))[payload.serverName];
        const clientId = payload.clientId ?? previous?.clientId ?? (await registerClient(metadata, loopback.redirectUri, this.fetchImpl))?.client_id;
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
            const tokens = await exchangeCode(flow.metadata, flow.clientId, flow.code, flow.verifier, flow.redirectUri, flow.url, this.fetchImpl);
            const now = Date.now();
            const record = {
                ...tokens,
                clientId: flow.clientId,
                serverUrl: flow.url,
                resource: flow.url,
                tokenEndpoint: flow.metadata.token_endpoint,
                obtainedAt: now,
                updatedAt: now
            };
            await saveOAuthRecord(this.dshHomeOf(), flow.serverName, record);
            this.oauthScheduler?.schedule(flow.serverName, record);
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
        return stripUndefined({
            connected: typeof headers.Authorization === "string" && headers.Authorization.indexOf("Bearer ") === 0,
            headerReady: typeof record.accessToken === "string",
            expiresAt: typeof record.expiresAt === "number" ? record.expiresAt : null,
            expired: isExpired(record),
            needsReauth: record.needsReauth === true ? true : undefined,
            refreshError: typeof record.refreshError === "string" ? record.refreshError : undefined,
            canRefresh: typeof record.refreshToken === "string" &&
                record.refreshToken !== "" &&
                typeof record.tokenEndpoint === "string" &&
                record.tokenEndpoint !== "",
            updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : undefined
        });
    }
    /** 手动立即刷新一次 OAuth 令牌（卡片上的「刷新令牌」按钮或自动续期入口）。 */
    async oauthRefresh(rawPayload) {
        const payload = parseWirePayload(mcpOAuthServerPayloadSchema, rawPayload, "OAuth 刷新参数无效");
        const res = await this.getOrCreateScheduler().refreshServer(payload.serverName, { force: true });
        return stripUndefined({
            ok: res.ok,
            serverName: payload.serverName,
            expiresAt: res.expiresAt ?? null,
            syncedFromDisk: res.syncedFromDisk,
            needsReauth: res.needsReauth,
            error: res.error
        });
    }
    /** 断开 OAuth：停掉自动续期并删掉 Authorization 头与本地令牌记录。 */
    async oauthDisconnect(rawPayload) {
        const payload = parseWirePayload(mcpOAuthServerPayloadSchema, rawPayload, "OAuth 参数无效");
        this.oauthScheduler?.unschedule(payload.serverName);
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
