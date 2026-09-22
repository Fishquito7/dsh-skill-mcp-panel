/**
 * dsh-skill-mcp-panel —— 把工作区 MCP 服务器挂进单个 agent 的作用域。
 *
 * 机制与官方 dsh-acp 逐字一致（那里是
 * `for (const config of configs) await agentCtx.plugin(McpClient, config)`）：
 *
 *   - 官方 mcp-client 的 serverName 预留是 **per-scope** 的
 *     （`scopeOf(ctx) ?? ctx.root` 的 WeakMap），独立 agent 作用域可复用同名；
 *   - ToolRuntime 的契约是「Scoped registrations shadow globals」——
 *     从 `agent.ctx` 注册的工具只属于该 agent，并随作用域 unwind；
 *   - `Agent.ctx` 的官方说明：contributions are agent-local, unwind on disposal。
 *
 * dsh-acp 在 agent **发布之前**挂载（它拥有 create() 的 setup 回调）；面板是
 * 第三方插件，拿不到那个窗口（web 会话的 setup 由 dsh-api-session-controller
 * 独占），因此在 `agent/created` 之后挂载，并由 `agent/pre-step` 兜住首轮。
 */
import { toOfficialConfig } from "./model.js";
import { importFromHarness } from "./harness-resolve.js";
/** 官方 MCP 客户端的 specifier；解析交给 harness-resolve（先裸 import，再从宿主锚点找）。 */
const MCP_CLIENT_SPEC = "@deepseek-ai/dsh-mcp-client";
/**
 * 运行时解析官方 mcp-client 组件。
 *
 * 与 misakanet 同一套做法（optional peer + 动态解析 + 形状归一），但解析用
 * `importFromHarness`，不依赖"安装位置恰好能上溯到宿主"这一巧合。
 */
export async function loadMcpClientComponent(ctx) {
    const client = await importFromHarness(MCP_CLIENT_SPEC, ctx);
    if (client === undefined)
        return undefined;
    const unwrap = ctx?.loader?.unwrapExports;
    return typeof unwrap === "function" ? unwrap(client) : client;
}
/**
 * 逐条挂载到给定的 agent 作用域；单条失败只记录，不影响其余，也绝不抛给会话。
 * 返回的 handle 不需要显式释放——`agent.ctx` 的贡献随 agent 释放自动 unwind。
 */
export async function mountWorkspaceServers(agentCtx, servers, component) {
    const outcomes = [];
    for (const server of servers) {
        try {
            await agentCtx.plugin(component, toOfficialConfig(server.input));
            outcomes.push({ serverName: server.serverName, ok: true });
        }
        catch (error) {
            outcomes.push({
                serverName: server.serverName,
                ok: false,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
    return outcomes;
}
