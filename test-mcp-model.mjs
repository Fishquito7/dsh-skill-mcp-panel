import assert from "node:assert/strict";
import {
  SERVER_NAME_RE,
  applyServerEdit,
  duplicateServerNames,
  mcpServerInputSchema,
  mergeSecretPatch,
  patchRowToView,
  rowIdForServerName,
  serverNameFromRowId,
  toOfficialConfig,
  toPatchRow,
  parseWireScalar,
  formatWireScalar,
  inputFromPatchRow
} from "./lib/mcp/model.js";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}
function expectThrow(name, fn, needle) {
  let threw = false;
  try {
    fn();
  } catch (error) {
    threw = true;
    if (needle !== undefined) assert.match(String(error?.message ?? error), needle);
  }
  assert.equal(threw, true, name + " should throw");
  pass(name);
}

// 1. stdio parse + defaults + official config
const stdio = mcpServerInputSchema.parse({ serverName: "github", transport: "stdio", command: "npx" });
assert.equal(stdio.args.length, 0);
assert.equal(stdio.cwd, "");
assert.equal(stdio.toolCallTimeoutMs, 60000);
assert.equal(stdio.failOnStartupError, false);
assert.deepEqual(stdio.reconnect, { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 });
const official = toOfficialConfig(stdio);
assert.equal(official.transport, "stdio");
assert.deepEqual(official.args, []);
pass("stdio input parses with defaults and maps to official config");

// 2. http parse + headers
const http = mcpServerInputSchema.parse({ serverName: "web", transport: "streamable-http", url: "http://localhost:3000/mcp", headers: { Authorization: "Bearer x" } });
assert.equal(toOfficialConfig(http).headers.Authorization, "Bearer x");
pass("streamable-http input parses and maps headers");

// 3. invalid inputs
expectThrow("bad serverName rejected", () => mcpServerInputSchema.parse({ serverName: "bad/name", transport: "stdio", command: "npx" }), /serverName/);
expectThrow("missing command rejected", () => mcpServerInputSchema.parse({ serverName: "ok", transport: "stdio" }));
expectThrow("bad url rejected", () => mcpServerInputSchema.parse({ serverName: "ok", transport: "streamable-http", url: "not-url" }));

// 4. row id mapping
assert.equal(rowIdForServerName("github"), "panel-mcp-github");
assert.equal(serverNameFromRowId("panel-mcp-github"), "github");
assert.equal(serverNameFromRowId("other-row"), undefined);
pass("managed row id round-trips through serverName");

// 5. toPatchRow enabled/disabled
const enabledRow = toPatchRow(stdio, true);
assert.equal(enabledRow.disabled, undefined);
assert.equal(enabledRow.name, "@deepseek-ai/dsh-mcp-client");
const disabledRow = toPatchRow(stdio, false);
assert.equal(disabledRow.disabled, true);
pass("toPatchRow maps enabled flag to disabled row field");

// 6. patchRowToView redacts secrets
const secretRow = toPatchRow(mcpServerInputSchema.parse({
  serverName: "github",
  transport: "stdio",
  command: "npx",
  env: { GITHUB_TOKEN: "super-secret", FOO: "bar" }
}));
const view = patchRowToView(secretRow);
assert.deepEqual(view.envKeys.sort(), ["FOO", "GITHUB_TOKEN"]);
assert.equal(JSON.stringify(view).includes("super-secret"), false);
pass("patchRowToView redacts secret values");

const httpView = patchRowToView(toPatchRow(http));
assert.deepEqual(httpView.headerKeys, ["Authorization"]);
assert.equal(JSON.stringify(httpView).includes("Bearer x"), false);
pass("http view redacts header values");

// 7. secret merge semantics
assert.deepEqual(mergeSecretPatch({ A: "1", B: "2" }, { B: null, C: "3" }), { A: "1", C: "3" });
assert.deepEqual(mergeSecretPatch(undefined, undefined), {});
pass("secret patch null deletes, string overrides, absent preserves");

// 8. edit preserves untouched secrets
const edited = applyServerEdit(secretRow, mcpServerInputSchema.parse({ serverName: "github", transport: "stdio", command: "npx", env: { GITHUB_TOKEN: null, FOO: "changed" } }), false);
const editedConfig = edited.config;
assert.equal(editedConfig.env.GITHUB_TOKEN, undefined);
assert.equal(editedConfig.env.FOO, "changed");
assert.equal(edited.disabled, true);
pass("applyServerEdit preserves/clears secrets by key");

// 9. duplicate detection across managed + external
const managed = [toPatchRow(mcpServerInputSchema.parse({ serverName: "dup", transport: "stdio", command: "npx" }))];
const external = [{ id: "external", name: "@deepseek-ai/dsh-mcp-client", config: { serverName: "dup", transport: "stdio", command: "npx" } }];
assert.deepEqual(duplicateServerNames(managed, external), ["dup"]);
assert.deepEqual(duplicateServerNames(managed, []), []);
pass("duplicateServerNames detects conflicts only across owners");

assert.equal(SERVER_NAME_RE.test("a_b-1"), true);
assert.equal(SERVER_NAME_RE.test("bad/name"), false);
pass("serverName regex matches official contract");

// 10. !!js 表达式：文本写法 <-> wire 值
assert.equal(parseWireScalar("Bearer sk-1"), "Bearer sk-1");
assert.deepEqual(parseWireScalar("!!js process.env.MCP_TOKEN"), { __jsExpr: "process.env.MCP_TOKEN" });
assert.deepEqual(parseWireScalar("  !!js   process.env.X  "), { __jsExpr: "process.env.X" });
assert.equal(parseWireScalar("!!js"), "!!js"); // 只有前缀、没有表达式：当普通值，别吞掉
assert.equal(formatWireScalar({ __jsExpr: "process.env.X" }), "!!js process.env.X");
assert.equal(formatWireScalar("plain"), "plain");
pass("!!js text form round-trips through parseWireScalar/formatWireScalar");

// 11. 带表达式的行能过 schema，并原样进入官方配置（由 DSH 装载时求值）
const BT = String.fromCharCode(96);
const EXPR = BT + "Bearer ${process.env.MCP_TOKEN}" + BT;
const withExpr = mcpServerInputSchema.parse({
  serverName: "web",
  transport: "streamable-http",
  url: "https://example.com/mcp",
  headers: { Authorization: { __jsExpr: EXPR } }
});
assert.deepEqual(toOfficialConfig(withExpr).headers.Authorization, { __jsExpr: EXPR });
const parsedExpr = mcpServerInputSchema.parse({ serverName: "ok", transport: "streamable-http", url: { __jsExpr: "process.env.MCP_URL" } });
assert.deepEqual(parsedExpr.url, { __jsExpr: "process.env.MCP_URL" });
pass("!!js values pass the schema and stay expressions in the official config");

// 12. patch 行 -> 视图 -> 输入：表达式不能退化，也不能丢掉密钥键
const rowWithExpr = toPatchRow(withExpr);
const exprView = patchRowToView(rowWithExpr);
assert.deepEqual(exprView.headerKeys, ["Authorization"]);
const backInput = inputFromPatchRow(rowWithExpr);
assert.deepEqual(backInput.headers.Authorization, { __jsExpr: EXPR });
pass("!!js expressions survive row -> view -> input round-trips");

// 13. stdio 的 command / args / cwd / env 同样支持 !!js，视图给回面板写法
const stdioExpr = mcpServerInputSchema.parse({
  serverName: "bot",
  transport: "stdio",
  command: { __jsExpr: "process.env.MCP_CMD" },
  args: ["-y", { __jsExpr: "process.env.MCP_PKG" }],
  cwd: { __jsExpr: "process.env.MCP_CWD" },
  env: { TOKEN: { __jsExpr: "process.env.TOKEN" } }
});
const stdioView = patchRowToView(toPatchRow(stdioExpr));
assert.equal(stdioView.command, "!!js process.env.MCP_CMD");
assert.deepEqual(stdioView.args, ["-y", "!!js process.env.MCP_PKG"]);
assert.equal(stdioView.cwd, "!!js process.env.MCP_CWD");
assert.deepEqual(stdioView.envKeys, ["TOKEN"]);
assert.deepEqual(inputFromPatchRow(toPatchRow(stdioExpr)).env.TOKEN, { __jsExpr: "process.env.TOKEN" });
pass("stdio command/args/cwd/env accept !!js and show the text form");

// 14. 编辑合并：没提到的表达式键保留，显式 null 仍然删除
const editedExpr = applyServerEdit(toPatchRow(withExpr), mcpServerInputSchema.parse({
  serverName: "web",
  transport: "streamable-http",
  url: "https://example.com/mcp",
  headers: { "X-Extra": "1" }
}));
assert.deepEqual(editedExpr.config.headers.Authorization, { __jsExpr: EXPR });
assert.equal(editedExpr.config.headers["X-Extra"], "1");
const clearedExpr = applyServerEdit(toPatchRow(withExpr), mcpServerInputSchema.parse({
  serverName: "web",
  transport: "streamable-http",
  url: "https://example.com/mcp",
  headers: { Authorization: null }
}));
assert.deepEqual(clearedExpr.config.headers, {});
pass("applyServerEdit keeps !!js secrets unless explicitly cleared");

// 15. ${NAME} 直觉写法：面板/CLI 的统一入口，保存时格式化成 !!js 模板
assert.deepEqual(parseWireScalar("${MCP_TOKEN}"), { __jsExpr: BT + "${process.env.MCP_TOKEN}" + BT });
assert.deepEqual(parseWireScalar("Bearer ${MCP_TOKEN}"), { __jsExpr: BT + "Bearer ${process.env.MCP_TOKEN}" + BT });
assert.deepEqual(parseWireScalar("${MCP_TOKEN} / ${OTHER_ONE}"), { __jsExpr: BT + "${process.env.MCP_TOKEN} / ${process.env.OTHER_ONE}" + BT });
// 已经写了 process.env 的不要重复加前缀
assert.deepEqual(parseWireScalar("${process.env.MCP_TOKEN}"), { __jsExpr: BT + "${process.env.MCP_TOKEN}" + BT });
// 已经写成反引号模板的：只补 process.env，不重新包一层
assert.deepEqual(parseWireScalar(BT + "Bearer ${MCP_TOKEN}" + BT), { __jsExpr: BT + "Bearer ${process.env.MCP_TOKEN}" + BT });
// 复杂表达式留给进阶写法
assert.equal(parseWireScalar("no refs here"), "no refs here");
pass("${NAME} is formatted into a !!js template literal");

// 16. 反向：!!js 模板收回成 ${NAME}，页面看到的还是直觉写法
assert.equal(formatWireScalar({ __jsExpr: BT + "Bearer ${process.env.MCP_TOKEN}" + BT }), "Bearer ${MCP_TOKEN}");
assert.equal(formatWireScalar({ __jsExpr: BT + "${process.env.A}-${process.env.B}" + BT }), "${A}-${B}");
// 复杂表达式保持 !!js 原文（不猜、不重写）
assert.equal(formatWireScalar({ __jsExpr: "process.env.A + \"-x\"" }), "!!js process.env.A + \"-x\"");
assert.equal(formatWireScalar({ __jsExpr: BT + "plain template" + BT }), "!!js " + BT + "plain template" + BT);
pass("!!js templates collapse back to the ${NAME} display form");

// 17. 往返稳定：编辑表单里回填什么，保存回去就是什么
for (const text of ["Bearer ${MCP_TOKEN}", "${A}", "C:/projects/${NAME}/bin"]) {
  assert.equal(formatWireScalar(parseWireScalar(text)), text, "round-trip failed for " + text);
}
pass("${NAME} values survive a display round-trip");
console.log("\n" + passed + " passed, 0 failed");
console.log("ALL MCP MODEL TESTS PASSED");
