import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { McpManagerGateway } from "./lib/mcp/gateway.js";
import { mcpListResultSchema } from "./lib/mcp/wire.js";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const dir = await mkdtemp(join(tmpdir(), "dsh-panel-gateway-"));
try {
  await writeFile(join(dir, "cordis.patch.yml"), "# profile\n[]\n");
  const ctx = new Context();
  ctx.baseUrl = pathToFileURL(dir).href + "/";
  ctx.provide("loader", {
    entries: function* () {
      yield { id: "panel-mcp-demo", disabled: true, fiber: undefined, options: { name: "@deepseek-ai/dsh-mcp-client" } };
    }
  });
  ctx.provide("tools", {
    schemas() {
      return [];
    }
  });
  const gateway = new McpManagerGateway(ctx);

  // 1. list empty
  const empty = await gateway.list();
  assert.equal(empty.patch.ok, true);
  assert.equal(empty.servers.length, 0);
  assert.equal(empty.externalServers.length, 0);
  pass("gateway lists empty patch");

  // 2. save disabled row (fake loader already reports matching entry)
  const saved = await gateway.save({
    input: { serverName: "demo", transport: "stdio", command: "node" },
    enabled: false
  });
  assert.equal(saved.server.serverName, "demo");
  assert.equal(saved.server.enabled, false);
  assert.equal(saved.server.toolCount, 0);
  assert.equal(saved.reconciled, true);
  const onDisk = await readFile(join(dir, "cordis.patch.yml"), "utf8");
  assert.match(onDisk, /panel-mcp-demo/);
  assert.match(onDisk, /serverName: demo/);
  pass("gateway save writes managed block and decorates row");

  // 3. list sees managed row
  const after = await gateway.list();
  assert.equal(after.servers.length, 1);
  assert.equal(after.servers[0].serverName, "demo");
  assert.equal(after.servers[0].fiberPhase, null);
  const parsed = mcpListResultSchema.parse(after);
  assert.equal(JSON.stringify(parsed).includes("undefined"), false);
  assert.equal(JSON.stringify(parsed).includes("url"), false); // stdio view must not carry undefined optional fields
  pass("gateway list validates at the Typert JSON boundary");
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log("\n" + passed + " passed, 0 failed");
console.log("ALL MCP GATEWAY TESTS PASSED");
