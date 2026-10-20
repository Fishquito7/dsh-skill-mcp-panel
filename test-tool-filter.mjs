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

  // 4. 自激递归回归（Issue #59 / #62：禁用任一工具后宿主主线程 100% 卡死）。
  //    宿主的 ScopedLayers.effect（@deepseek-ai/dsh-scope）在 restrict() 生效后
  //    和 undo() 撤销时都会**同步** emit "tools/change"；插件又监听这个事件去
  //    undo/restrict，于是自己触发自己。这里用与宿主同构的替身复现：
  //    restrict / undo 同步广播事件、事件同步派发；不加守卫时一次事件会放大成
  //    成百上千次 restrict（真实宿主实测 7.27M 次、递归 727 万层后爆栈）。
  {
    const CAP = 200; // 失控时打断，避免测试进程把栈打爆（复位前的代码会撞到它）
    const listeners = new Set();
    const known = new Set(["mcp__demo__alpha", "mcp__demo__beta"]);
    let applied = new Set();
    let restrictCalls = 0;
    let viewCalls = 0;
    let emits = 0;
    let depth = 0;
    let maxDepth = 0;
    const emit = () => {
      emits += 1;
      depth += 1;
      if (depth > maxDepth) maxDepth = depth;
      try {
        for (const listener of [...listeners]) listener();
      } finally {
        depth -= 1;
      }
    };
    const tools = {
      view: () => {
        viewCalls += 1;
        return { restrictableNames: new Set(known) };
      },
      restrict: ({ deny }) => {
        restrictCalls += 1;
        if (restrictCalls > CAP) return () => {};
        const before = new Set(applied);
        for (const name of deny) applied.add(name);
        emit();
        let undone = false;
        return () => {
          if (undone) return;
          undone = true;
          applied = new Set(before);
          emit();
        };
      }
    };
    const agents = [];
    const controllerCtx = {
      on(name, listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      get(name) {
        return name === "agents" ? { list: () => agents } : undefined;
      }
    };
    const makeAgentCtx = () => ({
      plugin(plugin) {
        const undos = [];
        const cleanups = [];
        const c = {
          tools: {
            view: tools.view,
            restrict: (filter) => {
              const undo = tools.restrict(filter);
              undos.push(undo);
              return undo;
            }
          },
          get: () => undefined,
          effect: (fn) => {
            cleanups.push(fn());
            return () => {};
          },
          on: () => () => {}
        };
        plugin.apply(c);
        return {
          dispose() {
            for (const undo of undos.reverse()) {
              try {
                undo();
              } catch {
                // 测试替身：忽略重复撤销
              }
            }
            for (const cleanup of cleanups.reverse()) {
              try {
                cleanup?.();
              } catch {
                // 同上
              }
            }
          }
        };
      }
    });

    const controller = attachToolFilter(controllerCtx, ["mcp__demo__beta", "mcp__demo__delta"]);
    const agent = { id: "recursion-agent", ctx: makeAgentCtx() };
    agents.push(agent);
    controller.applyTo(agent);
    assert.equal(controller.activeCount(), 1, "过滤插件要挂到 agent 上");
    assert.equal(restrictCalls, 1, "挂载时只施加一次限制，实际 " + restrictCalls + " 次");
    assert.deepEqual([...applied], ["mcp__demo__beta"], "只有已知的禁用名生效");
    const afterMount = { restrictCalls, viewCalls, emits };

    // MCP 服务器连上来后新工具注册：宿主会 emit 一次 tools/change。
    known.add("mcp__demo__gamma");
    emit();
    assert.equal(restrictCalls, afterMount.restrictCalls, "新工具不在禁用列表里时不该重新施加（实际多施加了 " + (restrictCalls - afterMount.restrictCalls) + " 次）");
    assert.equal(viewCalls, afterMount.viewCalls + 1, "每次 tools/change 最多看一眼工具表");
    assert.equal(depth, 0, "事件派发结束后递归深度必须归零");

    // 禁用列表里的工具晚到（MCP 异步连上）：要补一次「撤销→重施」，且只补一次。
    known.add("mcp__demo__delta");
    emit();
    assert.equal(restrictCalls, afterMount.restrictCalls + 1, "晚到的禁用工具要补一次限制，实际 " + (restrictCalls - afterMount.restrictCalls) + " 次");
    assert.deepEqual([...applied].sort(), ["mcp__demo__beta", "mcp__demo__delta"], "两条禁用名都要生效");

    // 再触发一次无变化的事件：不能有任何 undo/restrict。
    const steady = { restrictCalls, viewCalls, emits };
    emit();
    assert.equal(restrictCalls, steady.restrictCalls, "集合没变时不许再 undo/restrict（否则就是烧 CPU 的循环）");
    assert.equal(viewCalls, steady.viewCalls + 1, "换来的只是多一次廉价的 view()");
    assert.ok(maxDepth <= 3, "tools/change 的递归深度必须很浅，实际 " + maxDepth + " 层（大于 " + CAP + " 次 restrict 即为失控）");
    pass(`tools/change re-entrancy stays bounded (restrict=${restrictCalls}, view=${viewCalls}, depth=${maxDepth})`);

    // 清空禁用列表：纤维销毁要把限制撤掉。
    controller.setDeny([]);
    assert.equal(controller.activeCount(), 0, "清空后不该还挂着插件");
    assert.deepEqual([...applied], [], "清空禁用列表后限制要撤销");
    controller.dispose();
    assert.equal(listeners.size, 0, "dispose 要把订阅全部摘掉");
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log("\n" + passed + " passed, 0 failed");
console.log("ALL TOOL FILTER TESTS PASSED");
