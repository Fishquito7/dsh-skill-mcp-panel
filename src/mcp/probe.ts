/**
 * dsh-skill-mcp-panel —— MCP 临时连接探针。
 *
 * 不写 patch、不注册 DSH 工具；Web“测试连接”与 `dsh-panel mcp test` 共用。
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { scrubbedParentEnv } from "@deepseek-ai/dsh-subprocess";
import { isJsExprValue } from "../patch-editor.js";
import { mcpServerInputSchema } from "./model.js";
import type { McpServerInput, WireScalar } from "./model.js";

export interface McpProbeTool {
  name: string;
  description?: string;
}

export interface McpProbeResult {
  ok: boolean;
  tools: McpProbeTool[];
  error?: string;
}

const PROBE_TIMEOUT_MS = 15000;

/**
 * 求值 !!js 表达式：与宿主 cordis 配置层的语义一致（with (ctx) { return eval(expr) }），
 * 区别只是测试连接跑在本进程、没有 loader 上下文。ctx 传空对象，表达式能拿到的
 * 全部来自全局（process.env 等）。
 */
function evaluateJsExpr(expression: string): unknown {
  return new Function("ctx", "expr", "with (ctx) { return eval(expr) }")({}, expression);
}

/** 把单个配置值解析成真正的字符串：!!js 表达式在这里求值，失败给出可读原因。 */
function resolveScalar(value: WireScalar | null | undefined, label: string): string | undefined {
	if (isJsExprValue(value)) {
		let resolved: unknown;
		try {
			resolved = evaluateJsExpr(value.__jsExpr);
		} catch (error) {
			throw new Error(label + " 的 !!js 表达式求值失败：" + (error instanceof Error ? error.message : String(error)));
		}
		if (resolved === undefined || resolved === null) return undefined;
		return typeof resolved === "string" ? resolved : String(resolved);
	}
	return typeof value === "string" ? value : "";
}

/** 必需值：表达式求不出结果就直接报错（命令/参数/目录/地址缺了连不上）。 */
function resolveRequired(value: WireScalar | null | undefined, label: string): string {
	const resolved = resolveScalar(value, label);
	if (resolved === undefined) throw new Error(label + " 的 !!js 表达式没有求值结果：" + (isJsExprValue(value) ? value.__jsExpr : ""));
	return resolved;
}

/** 环境变量/请求头：表达式求值为空时省略这个键，而不是把 undefined 发出去。 */
function stringMap(value: Record<string, WireScalar | null> | undefined, label: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, item] of Object.entries(value ?? {})) {
		if (item === null || item === undefined) continue;
		const resolved = resolveScalar(item, label + " " + key);
		if (resolved === undefined) continue;
		out[key] = resolved;
	}
  return out;
}

function createTransport(input: McpServerInput) {
  if (input.transport === "stdio") {
    return new StdioClientTransport({
      command: resolveRequired(input.command, "命令"),
      args: input.args.map((item) => resolveRequired(item, "参数")),
      env: {
        ...scrubbedParentEnv(),
        ...stringMap(input.env, "环境变量")
      },
      cwd: input.cwd === "" || input.cwd === undefined ? undefined : resolveRequired(input.cwd, "工作目录")
    });
  }
  return new StreamableHTTPClientTransport(new URL(resolveRequired(input.url, "服务器地址")), {
    requestInit: { headers: stringMap(input.headers, "请求头") }
  });
}

export async function probeMcpServer(raw: unknown, timeoutMs = PROBE_TIMEOUT_MS): Promise<McpProbeResult> {
  let input: McpServerInput;
  try {
    input = mcpServerInputSchema.parse(raw);
  } catch (error) {
    return { ok: false, tools: [], error: "配置无效：" + (error instanceof Error ? error.message : String(error)) };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const client = new Client({ name: "dsh-skill-mcp-panel", version: "2.0.0" });
  let transport: StdioClientTransport | StreamableHTTPClientTransport | undefined;
  try {
    transport = createTransport(input);
    await raceWithAbort(client.connect(transport), controller.signal);
    const tools: McpProbeTool[] = [];
    let cursor: string | undefined;
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
  } catch (error) {
    const reason = controller.signal.aborted ? "连接测试超时（" + timeoutMs + "ms）" : error instanceof Error ? error.message : String(error);
    return { ok: false, tools: [], error: reason };
  } finally {
    clearTimeout(timer);
    await Promise.allSettled([client.close().catch(() => {}), transport?.close().catch(() => {})]);
  }
}

async function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("aborted"));
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const onAbort = () => rejectPromise(new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolvePromise(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        rejectPromise(error);
      }
    );
  });
}