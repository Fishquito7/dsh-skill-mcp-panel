/**
 * dsh-skill-mcp-panel —— MCP 行运行时状态读取（loader entry + 工具计数）。
 */
const FIBER_PHASE = {
    0: "pending",
    1: "loading",
    2: "active",
    3: "failed",
    4: null,
    5: "unloading"
};
export function fiberPhaseOf(state) {
    if (typeof state !== "number")
        return null;
    const phase = FIBER_PHASE[state];
    return phase === undefined ? null : phase;
}
export function getLoaderEntry(ctx, id) {
    const loader = ctx.loader;
    if (loader === undefined || typeof loader.entries !== "function")
        return undefined;
    for (const entry of loader.entries()) {
        if (entry.id === id)
            return entry;
    }
    return undefined;
}
export function loaderEntries(ctx) {
    const loader = ctx.loader;
    if (loader === undefined || typeof loader.entries !== "function")
        return [];
    return [...loader.entries()];
}
export function mcpToolCount(ctx, serverName) {
    const tools = ctx.tools;
    if (tools === undefined || typeof tools.schemas !== "function")
        return 0;
    const prefix = `mcp__${serverName}__`;
    const schemas = tools.schemas();
    return Array.isArray(schemas) ? schemas.filter((schema) => typeof schema?.name === "string" && schema.name.startsWith(prefix)).length : 0;
}
const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
/**
 * 写入 patch 后轮询 loader，直到 entry 满足 predicate 或超时。
 * 默认 8s；每 200ms 查一次。
 */
export async function waitForLoaderState(ctx, id, predicate, timeoutMs = 8000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const entry = getLoaderEntry(ctx, id);
        if (entry !== undefined && predicate(entry))
            return true;
        if (entry === undefined && predicate(undefined))
            return true;
        await delay(200);
    }
    return false;
}
