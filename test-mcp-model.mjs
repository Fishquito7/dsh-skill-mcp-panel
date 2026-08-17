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
  toPatchRow
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

console.log("\n" + passed + " passed, 0 failed");
console.log("ALL MCP MODEL TESTS PASSED");
