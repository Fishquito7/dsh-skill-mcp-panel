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

console.log("\n" + passed + " passed, 0 failed");
console.log("ALL MCP PROBE TESTS PASSED");
