import { listMcpPatchRows, readManagedBlock, readPatchFile } from "../patch-editor.js";
import { serverNameOfRow } from "./model.js";
/** Read cordis.patch.yml along with managed-block split and all MCP rows. */
export async function readPatchRows(path) {
    const raw = await readPatchFile(path);
    const { managed, foreign } = readManagedBlock(raw);
    const all = listMcpPatchRows(raw);
    return { path, raw, managed, all, foreign };
}
/** Build a patch-editor locator for a row (preferring id + serverName when id exists). */
export function locatorOfRow(row) {
    return { id: typeof row.id === "string" ? row.id : undefined, serverName: serverNameOfRow(row) };
}
/**
 * Resolve a single unique MCP row by (serverName + entryId), falling back to single-field match
 * with domain-appropriate disambiguation instructions for GUI gateway vs CLI callers.
 */
export function resolvePatchRow(rows, ref, mode) {
    const name = typeof ref.serverName === "string" && ref.serverName !== "" ? ref.serverName : undefined;
    const entryId = typeof ref.entryId === "string" && ref.entryId !== "" ? ref.entryId : undefined;
    const both = rows.filter((row) => (name === undefined || serverNameOfRow(row) === name) && (entryId === undefined || row.id === entryId));
    if (both.length === 1)
        return both[0];
    const label = name ?? entryId ?? "";
    if (both.length > 1) {
        const how = mode === "cli" ? "用 dsh-panel mcp raw --id <entryId> 按 id 逐条修正" : "用原文按 id 逐条修正";
        throw new Error('MCP 行 "' + label + '" 在 cordis.patch.yml 里不唯一（id 或 serverName 重复）。请'
            + how + "，让每一行的 id 和 config.serverName 都唯一");
    }
    if (name !== undefined) {
        const byName = rows.filter((row) => serverNameOfRow(row) === name);
        if (byName.length === 1)
            return byName[0];
        if (byName.length > 1) {
            const hint = mode === "cli"
                ? "请加 --id <entryId>（entryId 见 dsh-panel mcp list --ids）"
                : "请从卡片进入（面板会带上 entryId），或在 CLI 里加 --id <entryId>";
            throw new Error('serverName "' + name + '" 对应多条 MCP 行：' + hint + "；也可以直接改 cordis.patch.yml 消掉重名");
        }
    }
    if (entryId !== undefined) {
        const byId = rows.filter((row) => row.id === entryId);
        if (byId.length === 1)
            return byId[0];
        if (byId.length > 1)
            throw new Error('id "' + entryId + '" 对应多条 MCP 行，请用原文按 id 逐条修正');
    }
    throw new Error((mode === "cli" ? "MCP 服务器" : "MCP 行") + ' "' + label + '" 不存在');
}
