/**
 * 回归：DSH 0.2.2 起桌面 / Web profile 用官方 @deepseek-ai/dsh-mcp-manager 挂载 MCP，
 * 服务器写在它那一行的 config.servers 里。面板此前只认 dsh-mcp-client 行，
 * 于是这类 profile 打开 MCP 页一台服务器都看不到。
 *
 * 这里用假的 settings / mcpManager / loader 服务驱动网关，覆盖列表、启停、表单编辑、
 * 原文编辑、删除、测试连接与跨来源查重。
 */
import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { McpManagerGateway } from "../lib/mcp/gateway.js";
import { mcpListResultSchema, mcpSaveResultSchema } from "../lib/mcp/wire.js";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const MANAGER_NS = "mcp-manager";
const MANAGER_DEFAULTS = { enabled: true, command: "", args: [], env: {}, cwd: "", url: "", headers: {}, startupTimeoutMs: 30000 };

/** 只实现面板用到的 settings 接口：describe + mutate（set / unset，带 revision）。 */
function fakeSettings(initialServers) {
  const state = { revision: 0, servers: structuredClone(initialServers), calls: [] };
  const withDefaults = (servers) => Object.fromEntries(Object.entries(servers).map(([name, entry]) => [name, { ...MANAGER_DEFAULTS, ...entry }]));
  const setPath = (path, value) => {
    const [, name, field] = path;
    if (field === undefined) state.servers[name] = structuredClone(value);
    else state.servers[name] = { ...state.servers[name], [field]: value };
  };
  return {
    state,
    describe() {
      return [
        { ns: "other", revision: 0, user: {}, value: {} },
        { ns: MANAGER_NS, revision: state.revision, user: { servers: structuredClone(state.servers) }, value: { servers: withDefaults(state.servers) } }
      ];
    },
    async mutate(ns, ops, expected) {
      assert.equal(ns, MANAGER_NS);
      assert.equal(expected, state.revision, "mutate 必须带上 describe 的 revision");
      state.calls.push(structuredClone(ops));
      for (const op of ops) {
        if (op.op === "set") setPath(op.path, op.value);
        else delete state.servers[op.path[1]];
      }
      state.revision += 1;
    }
  };
}

const dir = await mkdtemp(join(tmpdir(), "dsh-panel-manager-"));
try {
  await writeFile(join(dir, "cordis.patch.yml"), [
    "- id: panel-mcp-local",
    "  name: \"@deepseek-ai/dsh-mcp-client\"",
    "  config:",
    "    serverName: local",
    "    transport: stdio",
    "    command: node",
    ""
  ].join("\n"));
  const settings = fakeSettings({
    "cdp-helper": { transport: "stdio", command: "node", args: ["cdp.mjs"], cwd: "/tmp", env: { CDP_BROWSER_URL: "http://127.0.0.1:9222" } },
    "ios-mcp": { transport: "streamable-http", url: "http://10.0.0.2:8090/mcp", startupTimeoutMs: 5000 }
  });
  const probes = [];
  const ctx = new Context();
  ctx.baseUrl = pathToFileURL(dir).href + "/";
  ctx.provide("loader", {
    entries: function* () {
      yield { id: "include:mcp-manager", options: { id: MANAGER_NS, name: "@deepseek-ai/dsh-mcp-manager" } };
    }
  });
  ctx.provide("tools", {
    schemas() {
      return [{ name: "mcp__cdp-helper__navigate" }, { name: "mcp__cdp-helper__eval" }];
    }
  });
  ctx.provide("settings", settings);
  ctx.provide("mcpManager", {
    list() {
      return [
        { name: "cdp-helper", configured: true, status: { state: "connected", toolCount: 2, connectedAt: 1 } },
        { name: "ios-mcp", configured: true, status: { state: "failed", reason: "gave-up", lastError: "ECONNREFUSED" } }
      ];
    },
    async probe(name) {
      probes.push(name);
      if (name === "ios-mcp") return { ok: false, stage: "connect", message: "ECONNREFUSED", durationMs: 3, closeConfirmed: true };
      return { ok: true, toolNames: ["navigate", "eval"], truncated: false, durationMs: 3, closeConfirmed: true };
    }
  });
  const gateway = new McpManagerGateway(ctx);

  // 1. 列表同时包含 mcp-client 行与 manager 条目，且能通过结果 codec
  const listed = mcpListResultSchema.parse(await gateway.list());
  assert.deepEqual(listed.servers.map((server) => [server.source, server.serverName]), [
    ["client", "local"],
    ["manager", "cdp-helper"],
    ["manager", "ios-mcp"]
  ]);
  const cdp = listed.servers.find((server) => server.serverName === "cdp-helper");
  assert.equal(cdp.transport, "stdio");
  assert.equal(cdp.enabled, true);
  assert.equal(cdp.fiberPhase, "active");
  assert.equal(cdp.toolCount, 2);
  assert.deepEqual(cdp.envKeys, ["CDP_BROWSER_URL"]);
  assert.equal(cdp.entryId, undefined);
  assert.equal(listed.servers.find((server) => server.serverName === "ios-mcp").fiberPhase, "failed");
  pass("list shows dsh-mcp-manager servers next to mcp-client rows");

  // 2. 启停只改 enabled，返回的卡片按新状态
  const toggled = mcpSaveResultSchema.parse(await gateway.setEnabled({ serverName: "ios-mcp", source: "manager", enabled: false }));
  assert.deepEqual(settings.state.calls.at(-1), [{ op: "set", path: ["servers", "ios-mcp", "enabled"], value: false }]);
  assert.equal(toggled.server.enabled, false);
  assert.equal(toggled.server.source, "manager");
  assert.equal(settings.state.servers["ios-mcp"].startupTimeoutMs, 5000);
  pass("setEnabled toggles servers.<name>.enabled through settings.mutate");

  // 3. 表单编辑：env 合并、${credential:…} 还原、未建模字段保留、默认值不落盘
  await gateway.save({
    previousServerName: "ios-mcp",
    previousSource: "manager",
    input: {
      serverName: "ios-mcp",
      transport: "streamable-http",
      url: "http://10.0.0.3:8090/mcp",
      headers: { Authorization: { __jsExpr: "`Bearer ${credential:IOS_TOKEN}`" } },
      toolCallTimeoutMs: 60000,
      failOnStartupError: true,
      reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 }
    }
  });
  assert.deepEqual(settings.state.servers["ios-mcp"], {
    transport: "streamable-http",
    url: "http://10.0.0.3:8090/mcp",
    headers: { Authorization: "Bearer ${credential:IOS_TOKEN}" },
    startupTimeoutMs: 5000,
    enabled: false
  });
  pass("save maps the form onto a manager entry without defaults or failOnStartupError");

  // 4. 表单编辑改名：一次 mutate 里 unset 旧名 + set 新名；secret 未提交的键保留
  await gateway.save({
    previousServerName: "cdp-helper",
    previousSource: "manager",
    input: {
      serverName: "cdp",
      transport: "stdio",
      command: "node",
      args: ["cdp.mjs", "--verbose"],
      env: { EXTRA: "1" },
      cwd: "",
      toolCallTimeoutMs: 90000,
      failOnStartupError: false,
      reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 }
    }
  });
  assert.deepEqual(settings.state.calls.at(-1).map((op) => op.op + ":" + op.path.join(".")), ["unset:servers.cdp-helper", "set:servers.cdp"]);
  assert.deepEqual(settings.state.servers.cdp, {
    transport: "stdio",
    command: "node",
    args: ["cdp.mjs", "--verbose"],
    env: { CDP_BROWSER_URL: "http://127.0.0.1:9222", EXTRA: "1" },
    toolCallTimeoutMs: 90000
  });
  assert.equal(settings.state.servers["cdp-helper"], undefined);
  pass("save renames a manager server and merges env");

  // 5. 跨来源查重：manager 改名撞 mcp-client 行、mcp-client 新增撞 manager 条目都拒绝
  await assert.rejects(
    gateway.save({
      previousServerName: "cdp",
      previousSource: "manager",
      input: { serverName: "local", transport: "stdio", command: "node", args: [], env: {}, cwd: "", toolCallTimeoutMs: 60000, failOnStartupError: false, reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 } }
    }),
    /dsh-mcp-client/
  );
  await assert.rejects(
    gateway.save({
      input: { serverName: "cdp", transport: "stdio", command: "node", args: [], env: {}, cwd: "", toolCallTimeoutMs: 60000, failOnStartupError: false, reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 } }
    }),
    /dsh-mcp-manager/
  );
  pass("serverName collisions across sources are refused");

  // 6. 用户手写的 !!js 表达式 manager 无法求值，拒绝并说明
  await assert.rejects(
    gateway.save({
      previousServerName: "cdp",
      previousSource: "manager",
      input: { serverName: "cdp", transport: "stdio", command: { __jsExpr: "process.execPath" }, args: [], env: {}, cwd: "", toolCallTimeoutMs: 60000, failOnStartupError: false, reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 } }
    }),
    /不支持 !!js/
  );
  pass("save refuses !!js expressions for manager entries");

  // 7. 原文：读出单个「名字: 配置」映射；写回可改名
  const raw = await gateway.readRaw({ serverName: "ios-mcp", source: "manager" });
  assert.match(raw.text, /^ios-mcp:\n {2}transport: streamable-http\n/);
  await gateway.writeRaw({ serverName: "ios-mcp", source: "manager", text: "ios:\n  transport: streamable-http\n  url: http://10.0.0.4:8090/mcp\n" });
  assert.deepEqual(settings.state.servers.ios, { transport: "streamable-http", url: "http://10.0.0.4:8090/mcp" });
  assert.equal(settings.state.servers["ios-mcp"], undefined);
  await assert.rejects(gateway.writeRaw({ serverName: "ios", source: "manager", text: "a:\n  transport: stdio\nb:\n  transport: stdio\n" }), /恰好一个/);
  await assert.rejects(gateway.writeRaw({ serverName: "ios", source: "manager", text: "ios:\n  command: !!js process.execPath\n" }), /原文解析失败/);
  pass("readRaw / writeRaw round-trip one manager entry");

  // 8. 测试连接走 manager.probe，结果换成面板的形状
  const ok = await gateway.test({ serverName: "cdp", source: "manager" });
  assert.deepEqual(ok, { ok: true, tools: [{ name: "navigate" }, { name: "eval" }] });
  const failed = await gateway.test({ serverName: "ios-mcp", source: "manager" });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /connect：ECONNREFUSED/);
  assert.deepEqual(probes, ["cdp", "ios-mcp"]);
  pass("test probes manager servers through mcpManager.probe");

  // 9. 删除 = unset servers.<name>
  await gateway.removeServer({ serverName: "ios", source: "manager" });
  assert.deepEqual(settings.state.calls.at(-1), [{ op: "unset", path: ["servers", "ios"] }]);
  assert.equal(settings.state.servers.ios, undefined);
  await assert.rejects(gateway.removeServer({ serverName: "ios", source: "manager" }), /没有服务器 "ios"/);
  pass("removeServer unsets the manager entry");

  // 10. 宿主没挂 manager 时：列表只剩 mcp-client 行，不报错
  const bare = new Context();
  bare.baseUrl = pathToFileURL(dir).href + "/";
  bare.provide("loader", { entries: function* () {} });
  bare.provide("tools", { schemas: () => [] });
  const bareList = mcpListResultSchema.parse(await new McpManagerGateway(bare).list());
  assert.deepEqual(bareList.servers.map((server) => server.serverName), ["local"]);
  pass("list degrades to mcp-client rows when dsh-mcp-manager is absent");

  console.log(passed + " passed");
} finally {
  await rm(dir, { recursive: true, force: true });
}
