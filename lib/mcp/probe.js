/**
 * dsh-skill-mcp-panel —— MCP 临时连接探针。
 *
 * 不写 patch、不注册 DSH 工具；Web“测试连接”与 `dsh-panel mcp test` 共用。
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { scrubbedParentEnv } from "@deepseek-ai/dsh-subprocess";
import { mcpServerInputSchema } from "./model.js";
const PROBE_TIMEOUT_MS = 15000;
function stringMap(value) {
    const out = {};
    for (const [key, item] of Object.entries(value ?? {}))
        if (typeof item === "string")
            out[key] = item;
    return out;
}
function createTransport(input) {
    if (input.transport === "stdio") {
        return new StdioClientTransport({
            command: input.command,
            args: input.args,
            env: {
                ...scrubbedParentEnv(),
                ...stringMap(input.env)
            },
            cwd: input.cwd === "" ? undefined : input.cwd
        });
    }
    return new StreamableHTTPClientTransport(new URL(input.url), {
        requestInit: { headers: stringMap(input.headers) }
    });
}
export async function probeMcpServer(raw, timeoutMs = PROBE_TIMEOUT_MS) {
    let input;
    try {
        input = mcpServerInputSchema.parse(raw);
    }
    catch (error) {
        return { ok: false, tools: [], error: "配置无效：" + (error instanceof Error ? error.message : String(error)) };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const client = new Client({ name: "dsh-skill-mcp-panel", version: "2.0.0" });
    let transport;
    try {
        transport = createTransport(input);
        await raceWithAbort(client.connect(transport), controller.signal);
        const tools = [];
        let cursor;
        do {
            const page = await client.listTools(cursor === undefined ? undefined : { cursor }, { signal: controller.signal });
            for (const tool of page.tools) {
                tools.push({
                    name: typeof tool.name === "string" ? tool.name : String(tool.name),
                    ...(typeof tool.description === "string" ? { description: tool.description } : {})
                });
            }
            cursor = page.nextCursor;
        } while (cursor !== undefined && cursor !== "");
        return { ok: true, tools };
    }
    catch (error) {
        const reason = controller.signal.aborted ? "连接测试超时（" + timeoutMs + "ms）" : error instanceof Error ? error.message : String(error);
        return { ok: false, tools: [], error: reason };
    }
    finally {
        clearTimeout(timer);
        await Promise.allSettled([client.close().catch(() => { }), transport?.close().catch(() => { })]);
    }
}
async function raceWithAbort(promise, signal) {
    if (signal.aborted)
        return Promise.reject(new Error("aborted"));
    return new Promise((resolvePromise, rejectPromise) => {
        const onAbort = () => rejectPromise(new Error("aborted"));
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then((value) => {
            signal.removeEventListener("abort", onAbort);
            resolvePromise(value);
        }, (error) => {
            signal.removeEventListener("abort", onAbort);
            rejectPromise(error);
        });
    });
}
