import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { McpManagerGateway } from "./lib/mcp/gateway.js";
import { MCP_MANIFEST, mcpListResultSchema } from "./lib/mcp/wire.js";

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

  // 4. 名称不合法：校验在 handler 里做，错误必须是「字段 + 原因」的人话，
  //    而不是宿主那句泛化的「wire field "payload" failed boundary validation」。
  await assert.rejects(
    () => gateway.save({ input: { serverName: "Windows MCP", transport: "stdio", command: "node" } }),
    (error) => {
      assert.match(String(error.message), /serverName/);
      assert.match(String(error.message), /字母、数字、下划线或连字符/);
      assert.doesNotMatch(String(error.message), /boundary validation/);
      return true;
    }
  );
  pass("gateway save rejects an illegal serverName with a readable message");

  // 5. 网关边界 codec 必须放行这份 payload（校验已下沉到 handler），
  //    否则非法名称仍然会在边界上被拒，用户又只能看到天书。
  const saveParam = MCP_MANIFEST.invocations.find((item) => item.method === "save").parameters[0];
  assert.equal(saveParam.codec.create().safeParse({ input: { serverName: "Windows MCP" } }).success, true);
  // 6. !!js 环境变量写法：写盘保留标签，读回仍是表达式（v2.1.5）
  const BT = String.fromCharCode(96);
  const EXPR = BT + "Bearer " + "${process.env.MCP_TOKEN}" + BT;
  const savedExpr = await gateway.save({
    input: {
      serverName: "expr",
      transport: "streamable-http",
      url: "https://example.com/mcp",
      headers: { Authorization: { __jsExpr: EXPR } }
    },
    enabled: false
  });
  assert.equal(savedExpr.server.headerKeys.includes("Authorization"), true);
  const exprOnDisk = await readFile(join(dir, "cordis.patch.yml"), "utf8");
  assert.equal(exprOnDisk.includes("Authorization: !!js '" + EXPR + "'"), true, "!!js tag must reach the file");
assert.equal(exprOnDisk.includes("\"`Bearer"), false, "expression must not degrade into a quoted literal");
  const exprList = await gateway.list();
  const exprRow = exprList.servers.find((server) => server.serverName === "expr");
  assert.equal(exprRow.url, "https://example.com/mcp");
  assert.deepEqual([...exprRow.headerKeys], ["Authorization"]);
  pass("gateway writes !!js expressions with their tag and reads them back");
  pass("gateway boundary codec defers payload validation to the handler");
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log("\n" + passed + " passed, 0 failed");
console.log("ALL MCP GATEWAY TESTS PASSED");
