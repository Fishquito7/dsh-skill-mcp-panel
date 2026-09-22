/**
 * test-mcp-mount.mjs —— 把工作区服务器挂进 agent 作用域。
 *
 * 用真实的 cordis Context + 假的 MCP client 组件（形状与官方一致：inject tools，
 * apply 里按 serverName 注册 mcp__<server>__<tool>），验证：
 *   - 每条声明都以 toOfficialConfig() 的形态挂载到给定作用域；
 *   - 单条失败不影响其余（错误被收敛成 outcome，不抛给会话）；
 *   - 官方 mcp-client 缺失时 loadMcpClientComponent 优雅返回 undefined。
 */
import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import { loadMcpClientComponent, mountWorkspaceServers } from "./lib/mcp/mount.js";
import { mcpServerInputSchema } from "./lib/mcp/model.js";

let passed = 0;
let failed = 0;
function check(cond, label) {
  if (cond) {
    passed += 1;
    console.log("PASS  " + label);
  } else {
    failed += 1;
    console.log("FAIL  " + label);
  }
}

const registered = new Map();
const fakeTools = {
  register(definition) {
    registered.set(definition.name, definition);
    return () => registered.delete(definition.name);
  },
  schemas() {
    return [...registered.keys()].map((name) => ({ name }));
  }
};

/** 与官方 dsh-mcp-client 同形：inject tools，apply 注册 serverName 限定的工具。 */
const FakeClient = {
  name: "fake-mcp-client",
  inject: ["tools"],
  apply(ctx, config) {
    if (config.serverName === "explodes") throw new Error("connect refused (fixture)");
    ctx.effect(
      () =>
        ctx.tools.register({
          name: "mcp__" + config.serverName + "__ping",
          description: "fake:" + config.serverName,
          parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
          output: { schema: { type: "string" }, render: () => [{ type: "text", text: "pong" }] },
          execute: async () => "pong"
        }),
      "fake-mcp-client.tool"
    );
  }
};

const stdio = mcpServerInputSchema.parse({ serverName: "comfyui", transport: "stdio", command: "node", args: ["s.js"], env: { COMFYUI_URL: "http://127.0.0.1:8188" } });
const http = mcpServerInputSchema.parse({ serverName: "remote", transport: "streamable-http", url: "https://example.com/mcp", headers: { "X-Api-Key": "k" } });
const boom = mcpServerInputSchema.parse({ serverName: "explodes", transport: "stdio", command: "node" });

const ctx = new Context();
ctx.provide("tools", fakeTools);
const agentCtx = typeof ctx.extend === "function" ? ctx.extend({}) : ctx;

const outcomes = await mountWorkspaceServers(
  agentCtx,
  [
    { serverName: "comfyui", input: stdio },
    { serverName: "explodes", input: boom },
    { serverName: "remote", input: http }
  ],
  FakeClient
);

check(outcomes.length === 3, "三条声明各有一个 outcome");
check(outcomes.find((item) => item.serverName === "comfyui")?.ok === true, "第一条挂载成功");
check(outcomes.find((item) => item.serverName === "remote")?.ok === true, "失败之后的那条照样挂载（失败隔离）");
const failedOutcome = outcomes.find((item) => item.serverName === "explodes");
check(failedOutcome?.ok === false && /connect refused/.test(String(failedOutcome?.error)), "失败条目带原因且不抛出");

check(registered.has("mcp__comfyui__ping"), "工具按 serverName 注册（mcp__<server>__<tool>）");
check(registered.has("mcp__remote__ping"), "http 服务器同样注册");
check(!registered.has("mcp__explodes__ping"), "失败的服务器没有留下工具");

// 官方客户端缺失时优雅降级（本仓库未安装该 peer）
const { importFromHarness } = await import("./lib/mcp/harness-resolve.js");
check(
  (await importFromHarness("@deepseek-ai/dsh-definitely-not-installed", ctx)) === undefined,
  "解析不到的包返回 undefined 而不抛"
);
const component = await loadMcpClientComponent(ctx);
check(
  component === undefined || typeof (component.apply ?? component.default?.apply) === "function",
  "loadMcpClientComponent 返回 undefined 或可挂载的组件（形状归一后仍是插件回调）"
);

console.log("\n" + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
console.log("ALL MCP MOUNT TESTS PASSED");