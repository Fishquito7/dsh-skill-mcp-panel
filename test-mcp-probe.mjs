import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { probeMcpServer } from "./lib/mcp/probe.js";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const fixture = fileURLToPath(new URL("./test/mcp-server-fixture.mjs", import.meta.url));
const ok = await probeMcpServer({
  serverName: "fixture",
  transport: "stdio",
  command: process.execPath,
  args: [fixture]
});
assert.equal(ok.ok, true, ok.error);
assert.equal(ok.tools.length, 1);
assert.equal(ok.tools[0].name, "hello");
pass("stdio probe discovers fixture tool");

const bad = await probeMcpServer({
  serverName: "missing",
  transport: "stdio",
  command: process.execPath,
  args: [fixture + ".missing"]
});
assert.equal(bad.ok, false);
assert.equal(bad.tools.length, 0);
assert.ok(bad.error);
pass("stdio probe reports spawn failure");

const invalid = await probeMcpServer({ serverName: "bad/name", transport: "stdio", command: "node" });
assert.equal(invalid.ok, false);
assert.match(invalid.error ?? "", /配置无效/);
pass("probe rejects invalid input without connecting");

// !!js 表达式在连接前求值：能求出来就照常连，求不出来要给可读原因，
// 绝不能把表达式原文当成命令/令牌发给服务器。
const exprOk = await probeMcpServer({
  serverName: "expr-ok",
  transport: "stdio",
  command: { __jsExpr: "process.execPath" },
  args: [fixture],
  env: { DSH_PANEL_PROBE: { __jsExpr: "process.env.DSH_PANEL_PROBE_MARK" } }
});
assert.equal(exprOk.ok, true, exprOk.error);
assert.equal(exprOk.tools.length, 1);
pass("stdio probe evaluates !!js expressions before connecting");

const emptyExpr = await probeMcpServer({
  serverName: "expr-empty",
  transport: "stdio",
  command: { __jsExpr: "process.env.DSH_PANEL_MISSING_COMMAND" }
});
assert.equal(emptyExpr.ok, false);
assert.match(emptyExpr.error ?? "", /!!js 表达式/);
pass("probe reports a readable error when a !!js expression resolves to nothing");

const brokenExpr = await probeMcpServer({
  serverName: "expr-broken",
  transport: "stdio",
  command: { __jsExpr: "process.env[" }
});
assert.equal(brokenExpr.ok, false);
assert.match(brokenExpr.error ?? "", /求值失败/);
pass("probe reports evaluation failures instead of sending the raw text");
console.log("\n" + passed + " passed, 0 failed");
console.log("ALL MCP PROBE TESTS PASSED");
