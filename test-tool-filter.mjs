import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { ToolFilterController, attachToolFilter, loadToolFilter, saveToolFilter, toolFilterFile } from "./lib/tool-filter.js";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

// 1. 配置往返：缺失/损坏按空列表，写入后能读回来，并且落在 .system 隐藏区里。
const dir = await mkdtemp(join(tmpdir(), "dsh-panel-toolfilter-"));
try {
  const dshHome = join(dir, "home");
  assert.deepEqual(await loadToolFilter(dshHome), [], "配置缺失时必须按空列表处理");
  await saveToolFilter(dshHome, ["mcp__demo__beta", "mcp__github__search"]);
  assert.deepEqual(await loadToolFilter(dshHome), ["mcp__demo__beta", "mcp__github__search"]);
  const raw = JSON.parse(await readFile(toolFilterFile(dshHome), "utf8"));
  assert.equal(raw.version, 1);
  assert.equal(toolFilterFile(dshHome).includes(join("skills", ".system", "skill-viewer")), true, "配置要落在发现服务会跳过的隐藏区");
  pass("tool filter config round-trips");

  // 2. 名字未知时静默跳过（不能因为一个对不上的名字就把限制注册炸掉）
  const stub = new ToolFilterController({ get: () => undefined }, ["mcp__demo__beta"]);
  const stubAgent = { id: "stub-1", ctx: { tools: { view: () => ({ restrictableNames: [] }) } } };
  stub.applyTo(stubAgent);
  assert.equal(stub.activeCount(), 0, "没有任何已知名字时不该注册限制");
  stub.dispose();
  pass("unknown tool names are skipped instead of throwing");

  // 3. 真实注册表验证：用宿主自带的 @deepseek-ai/dsh-tools 起一个真工具注册表，
  //    给「agent」作用域施加限制，断言被禁用的工具从模型可见 schema 里消失。
  //    宿主安装路径不存在时整段 SKIP（这是本机集成验证，不是通用单测）。
  const hostRoot = process.env.DSH_HOST_MODULES ?? "D:/DeepSeek Harness/resources/app/dsh/node_modules/@deepseek-ai";
  if (!existsSync(join(hostRoot, "dsh-tools"))) {
    console.log("SKIP  找不到宿主 @deepseek-ai 包（" + hostRoot + "），跳过真实注册表验证");
  } else {
    const loadHost = (name) => import(pathToFileURL(join(hostRoot, name, "lib", "index.js")).href);
    // 必须和 dsh-tools 用**同一份** cordis 实例：仓库自带的 @deepseek-ai/cordis 与宿主
    // 那份是两个模块实例，混用会让 scope 记账错位（实测症状：限制看起来泄漏到全局）。
    const { Context } = await loadHost("cordis");
    const { default: ToolRuntime } = await loadHost("dsh-tools");
    const { createScope, scopeOf } = await loadHost("dsh-scope");

    const ctx = new Context();
    ctx.provide("systemPrompt", { section: () => () => {}, tools: () => () => {} });
    ctx.plugin(ToolRuntime, {});
    await new Promise((resolve) => setTimeout(resolve, 20));
    const tools = ctx.get("tools");
    assert.notEqual(tools, undefined, "宿主工具注册表必须挂上");

    const definition = (name) => ({
      name,
      description: name + " fixture",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      output: { schema: { type: "string" }, render: () => [{ type: "text", text: name }] },
      execute: async () => name + " ok"
    });
    for (const name of ["mcp__demo__alpha", "mcp__demo__beta", "mcp__demo__gamma"]) tools.register(definition(name));

    const visible = (key) => [...tools.wireSchemas(key).schemas].map((schema) => schema.name).sort();
    const preset = createScope(ctx, Symbol("preset-fixture"));
    const agent = createScope(preset.ctx, Symbol("agent-fixture"), { parent: scopeOf(preset.ctx) });
    const agentKey = scopeOf(agent.ctx);
    assert.deepEqual(visible(agentKey), ["mcp__demo__alpha", "mcp__demo__beta", "mcp__demo__gamma"], "施加前三个工具都可见");

    const controller = attachToolFilter(ctx, ["mcp__demo__beta"]);
    controller.applyTo({ id: "agent-fixture", ctx: agent.ctx });
    // 挂载是异步落地的（cordis 会在自己的调度里执行插件 apply），等一拍再看效果。
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(controller.activeCount(), 1, "限制要真的注册到 agent 作用域上");
    assert.deepEqual(visible(agentKey), ["mcp__demo__alpha", "mcp__demo__gamma"], "被禁用的工具必须从模型可见 schema 里消失");
    assert.deepEqual(
      visible(undefined),
      ["mcp__demo__alpha", "mcp__demo__beta", "mcp__demo__gamma"],
      "全局视角不受影响（限制只作用于这个作用域链）"
    );
    controller.dispose();
    // dispose 是异步的（cordis 要等纤维退休），等一拍再断言工具回来。
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(visible(agentKey), ["mcp__demo__alpha", "mcp__demo__beta", "mcp__demo__gamma"], "解绑后工具要回来");
    pass("restrict() hides denied MCP tools from the agent's model-facing schemas");
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log("\n" + passed + " passed, 0 failed");
console.log("ALL TOOL FILTER TESTS PASSED");
