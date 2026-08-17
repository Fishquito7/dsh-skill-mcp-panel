/**
 * dsh-skill-mcp-panel —— MCP 宿主服务（mcpManager）。
 */
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { MCP_PLUGIN_NAME, extractManagedRows, listMcpPatchRows, readPatchFile, writeManagedRows } from "../patch-editor.js";
import { applyServerEdit, inputFromPatchRow, patchRowToView, serverNameFromRowId } from "./model.js";
import { mcpRemovePayloadSchema, mcpSavePayloadSchema, mcpSetEnabledPayloadSchema, mcpTestPayloadSchema } from "./wire.js";
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
function isManagedRow(row) {
    return typeof row.id === "string" && row.id.startsWith("panel-mcp-");
}
export class McpManagerGateway extends TypertRemoteService {
    constructor(ctx) {
        super(ctx, "mcpManager");
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
        const managed = extractManagedRows(raw);
        const allMcp = listMcpPatchRows(raw);
        const managedIds = new Set(managed.map((row) => row.id).filter((id) => typeof id === "string"));
        const external = allMcp.filter((row) => typeof row.id === "string" && !managedIds.has(row.id));
        return { path, raw, managed, external };
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
        let patch = { path: this.patchPath(), ok: false, error: null };
        try {
            const { path, managed, external } = await this.readRows();
            patch = { path, ok: true, error: null };
            const servers = [];
            for (const row of managed) {
                const entry = typeof row.id === "string" ? getLoaderEntry(this.C, row.id) : undefined;
                const view = this.decorate(row, true, entry, row.disabled !== true);
                if (view !== undefined)
                    servers.push(view);
            }
            const externalServers = [];
            for (const row of external) {
                const entry = typeof row.id === "string" ? getLoaderEntry(this.C, row.id) : undefined;
                const view = this.decorate(row, false, entry, row.disabled !== true);
                if (view !== undefined)
                    externalServers.push(view);
            }
            return { servers, externalServers, patch };
        }
        catch (error) {
            return { servers: [], externalServers: [], patch: { ...patch, error: error instanceof Error ? error.message : String(error) } };
        }
    }
    findRowByServerName(rows, serverName) {
        return rows.find((row) => serverNameFromRowId(row.id) === serverName || (row.config?.serverName === serverName && isManagedRow(row)));
    }
    configInputFromRow(row) {
        return inputFromPatchRow(row);
    }
    async save(rawPayload) {
        const payload = mcpSavePayloadSchema.parse(rawPayload);
        const input = payload.input;
        const previousName = payload.previousServerName ?? input.serverName;
        const { managed, external } = await this.readRows();
        for (const row of external) {
            const name = row.config?.serverName;
            if (name === input.serverName)
                throw new Error('serverName "' + input.serverName + '" 已被 cordis.patch.yml 中的外部 MCP 行占用，请在文件中手动处理');
        }
        for (const row of managed) {
            const name = row.config?.serverName;
            if (name === input.serverName && serverNameFromRowId(row.id) !== previousName) {
                throw new Error('serverName "' + input.serverName + '" 已存在（受管行 ' + String(row.id) + "）");
            }
        }
        const previous = managed.find((row) => serverNameFromRowId(row.id) === previousName || row.config?.serverName === previousName);
        if (payload.previousServerName !== undefined && previous === undefined) {
            throw new Error('要编辑的 MCP 行不存在："' + previousName + '"');
        }
        const enabled = previous !== undefined ? previous.disabled !== true : payload.enabled;
        const nextRow = applyServerEdit(previous, input, enabled);
        const nextRows = managed.filter((row) => serverNameFromRowId(row.id) !== previousName && row.config?.serverName !== previousName);
        nextRows.push(nextRow);
        nextRows.sort((a, b) => String(a.config?.serverName ?? "").localeCompare(String(b.config?.serverName ?? "")));
        await writeManagedRows(this.patchPath(), nextRows);
        const reconciled = enabled
            ? await waitForLoaderState(this.C, nextRow.id, (entry) => entry !== undefined && entry.disabled !== true)
            : await waitForLoaderState(this.C, nextRow.id, (entry) => entry !== undefined && entry.disabled === true);
        const entry = getLoaderEntry(this.C, nextRow.id);
        const server = this.decorate(nextRow, true, entry, enabled);
        if (server === undefined)
            throw new Error("写入成功但生成的 MCP 行无效");
        return { server, reconciled };
    }
    async removeServer(rawPayload) {
        const payload = mcpRemovePayloadSchema.parse(rawPayload);
        const { managed } = await this.readRows();
        const row = managed.find((candidate) => serverNameFromRowId(candidate.id) === payload.serverName || candidate.config?.serverName === payload.serverName);
        if (row === undefined) {
            throw new Error('MCP 行 "' + payload.serverName + '" 不存在或不是面板受管行（外部行请在 cordis.patch.yml 中手动删除）');
        }
        const nextRows = managed.filter((candidate) => candidate !== row);
        await writeManagedRows(this.patchPath(), nextRows);
        const reconciled = await waitForLoaderState(this.C, row.id, (entry) => entry === undefined);
        return { ok: true, reconciled };
    }
    async setEnabled(rawPayload) {
        const payload = mcpSetEnabledPayloadSchema.parse(rawPayload);
        const { managed } = await this.readRows();
        const row = managed.find((candidate) => serverNameFromRowId(candidate.id) === payload.serverName || candidate.config?.serverName === payload.serverName);
        if (row === undefined)
            throw new Error('MCP 行 "' + payload.serverName + '" 不存在或不是面板受管行');
        row.disabled = !payload.enabled;
        await writeManagedRows(this.patchPath(), managed);
        const reconciled = payload.enabled
            ? await waitForLoaderState(this.C, row.id, (entry) => entry !== undefined && entry.disabled !== true)
            : await waitForLoaderState(this.C, row.id, (entry) => entry !== undefined && entry.disabled === true);
        const entry = getLoaderEntry(this.C, row.id);
        const server = this.decorate(row, true, entry, payload.enabled);
        if (server === undefined)
            throw new Error("写入成功但生成的 MCP 行无效");
        return { server, reconciled };
    }
    async test(rawPayload) {
        const payload = mcpTestPayloadSchema.parse(rawPayload);
        if (payload !== null && typeof payload === "object" && !("transport" in payload) && "serverName" in payload) {
            const { managed, external } = await this.readRows();
            const row = [...managed, ...external].find((candidate) => candidate.config?.serverName === payload.serverName || serverNameFromRowId(candidate.id) === payload.serverName);
            if (row === undefined)
                throw new Error('MCP 行 "' + String(payload.serverName) + '" 不存在');
            return probeMcpServer(this.configInputFromRow(row));
        }
        return probeMcpServer(payload);
    }
    reload() {
        return this.list();
    }
}
// 供 CLI 复用：判断一个 patch 行是否由面板管理。
export { MANAGED_ROW_IDS, isManagedRow, MCP_PLUGIN_NAME };
