/**
 * dsh-skill-mcp-panel —— 工作区 MCP 的宿主运行时。
 *
 * 会话创建时（`agent/created`）按该会话的 cwd 解析项目根，读取
 * `<projectRoot>/.dsh/mcp.json`，把其中的服务器挂进**这个 agent 的作用域**。
 *
 * 两条时序要点：
 *   1. `agent/created` 是同步派发，而挂载是异步的（要读文件、解析凭证、连接
 *      MCP）。因此这里把挂载 Promise 记在 per-agent 账本上，并在
 *      `agent/pre-step`（waterfall）里先 await 它，保证**首个请求装配工具表
 *      之前**挂载已settle——不会出现"第一轮看不到工作区工具"。
 *   2. 官方 mcp-client 每个实例连一个服务器，因此同一工作区的每个会话各有
 *      自己的连接；这与 dsh-acp 的 per-session 行为一致。
 *
 * v1 语义：改动只影响**新会话**。凭证或文件变化不会热重挂到已存在的 agent。
 */
import { findProjectRoot } from "../skill-files.js";
import { globalServerNames } from "./gateway.js";
import { loadCredentialSeam, resolveWorkspaceServer } from "./credential-env.js";
import { loadMcpClientComponent, mountWorkspaceServers, type MountableServer } from "./mount.js";
import { readWorkspaceServers, validateWorkspaceServer, workspaceMcpFile } from "./workspace-store.js";

/**
 * 挂载结果只写日志：它是会话创建时算一次的，放进面板视图只会显示成过期信息
 * （页面不会随保存或会话切换刷新它），所以这里不再保留"挂载报告"。
 */
export class WorkspaceMcpRuntime {
  private readonly ctx: any;
  /** agent → 进行中的挂载；pre-step 会先 await 它。 */
  private readonly pending = new WeakMap<object, Promise<void>>();

  constructor(ctx: any) {
    this.ctx = ctx;
    ctx.effect(
      () => ctx.on("agent/created", ({ agent }: any) => this.begin(agent)),
      "dsh-skill-mcp-panel: workspace mcp mount"
    );
    ctx.effect(
      () =>
        ctx.on("agent/pre-step", async ({ agent }: any, next: any) => {
          const pending = this.pending.get(agent);
          if (pending !== undefined) {
            this.pending.delete(agent);
            await pending.catch(() => {});
          }
          return next();
        }),
      "dsh-skill-mcp-panel: workspace mcp first-step gate"
    );
    ctx.effect(
      () =>
        ctx.on("agent/disposed", ({ agent }: any) => {
          this.pending.delete(agent);
        }),
      "dsh-skill-mcp-panel: workspace mcp cleanup"
    );
  }

  private log(level: "info" | "warn", message: string) {
    const logger = this.ctx?.logger;
    if (level === "warn") logger?.warn?.(message);
    else logger?.info?.(message);
  }

  /** 登记一次挂载，让 pre-step 能等到它。 */
  private begin(agent: any) {
    if (agent === undefined || agent === null) return;
    this.pending.set(agent, this.composeFor(agent));
  }

  private async composeFor(agent: any): Promise<void> {
    const sessionId = typeof agent?.id === "string" ? agent.id : "";
    let cwd = "";
    try {
      cwd = typeof agent?.session?.header?.cwd === "string" ? agent.session.header.cwd : "";
      if (cwd === "") return;
      const projectRoot = await findProjectRoot(cwd);
      const store = await readWorkspaceServers(projectRoot);
      if (!store.ok) {
        this.log("warn", "[dsh-skill-mcp-panel] " + String(store.error));
        return;
      }
      if (store.servers.length === 0) return;

      const conflicts = await globalServerNames(this.ctx);
      const seam = await loadCredentialSeam(this.ctx);
      const provider = this.ctx.get?.("credentials");
      const component = await loadMcpClientComponent(this.ctx);
      if (component === undefined) {
        this.log("warn", "[dsh-skill-mcp-panel] 未找到 @deepseek-ai/dsh-mcp-client，工作区 MCP 已跳过：" + store.path);
        return;
      }

      const mountable: MountableServer[] = [];
      const missingCredentials: string[] = [];
      for (const server of store.servers) {
        if (server.enabled === false) continue; // 停用是正常状态，不记日志
        const problems = validateWorkspaceServer(server);
        if (problems.length > 0) {
          this.log("warn", "[dsh-skill-mcp-panel] 工作区声明无效，已跳过 " + server.serverName + "：" + problems.join("；"));
          continue;
        }
        if (conflicts.has(server.serverName)) {
          // 同名会让该 agent 解析出两组 mcp__X__* 工具名。这里明确拒绝并报告，
          // 而不是静默遮蔽全局配置。
          this.log(
            "warn",
            "[dsh-skill-mcp-panel] " + server.serverName + " 与全局作用域同名（cordis.patch.yml），工作区声明被忽略"
          );
          continue;
        }
        const resolved = await resolveWorkspaceServer(server, provider, seam);
        if (resolved.invalid.length > 0) {
          this.log("warn", "[dsh-skill-mcp-panel] " + server.serverName + " 凭证/声明问题：" + resolved.invalid.join("；"));
        }
        if (resolved.input === undefined) {
          if (resolved.error !== undefined) this.log("warn", "[dsh-skill-mcp-panel] " + resolved.error);
          continue;
        }
        for (const ref of resolved.missing) missingCredentials.push(server.serverName + ":" + ref);
        mountable.push({ serverName: server.serverName, input: resolved.input });
      }

      const outcomes = await mountWorkspaceServers(agent.ctx, mountable, component);
      const mounted: string[] = [];
      for (const outcome of outcomes) {
        if (outcome.ok) mounted.push(outcome.serverName);
        else this.log("warn", "[dsh-skill-mcp-panel] " + outcome.serverName + " 挂载失败：" + String(outcome.error ?? ""));
      }
      if (missingCredentials.length > 0) {
        this.log("warn", "[dsh-skill-mcp-panel] 工作区 MCP 有未配置的凭证引用（用面板设置或 dsh 凭证配置）：" + missingCredentials.join(", "));
      }
      if (mounted.length > 0) {
        this.log("info", "[dsh-skill-mcp-panel] 已为会话 " + sessionId + " 挂载工作区 MCP：" + mounted.join(", ") + "（" + workspaceMcpFile(projectRoot) + "）");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log("warn", "[dsh-skill-mcp-panel] 工作区 MCP 挂载失败：" + message);
    }
  }
}
