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

  // 7.【#46】受管块里混进外来行：list 必须报给界面，save 不得把它折叠进 insert
  const mixedPath = join(dir, "cordis.patch.yml");
  const before = await readFile(mixedPath, "utf8");
  const beginMark = "# >>> dsh-skill-mcp-panel:mcp:begin";
  const endMark = "# <<< dsh-skill-mcp-panel:mcp:end";
  const blockBody = before.slice(before.indexOf(beginMark) + beginMark.length + 1, before.indexOf(endMark));
  const mixedText =
    before.slice(0, before.indexOf(beginMark) + beginMark.length) +
    "\n- id: ui-theme\n" +
    '  name: "@deepseek-ai/dsh-client-ui-theme"\n' +
    "  config:\n" +
    "    fontSize: 14\n" +
    blockBody +
    before.slice(before.indexOf(endMark));
  await writeFile(mixedPath, mixedText);

  const mixedList = await gateway.list();
  assert.equal(mixedList.patch.ok, true);
  assert.equal(
    mixedList.patch.foreign.some((entry) => entry.id === "ui-theme" && entry.managed === false),
    true,
    "块内外来行必须报给界面"
  );
  const mixedSave = await gateway.save({
    input: { serverName: "demo", transport: "stdio", command: "node" },
    enabled: false
  });
  assert.equal(mixedSave.server.serverName, "demo");
  const mixedOnDisk = await readFile(mixedPath, "utf8");
  assert.match(mixedOnDisk, /^- id: ui-theme$/m, "外来顶层行必须仍是顶层行");
  assert.equal(/- insert:[\s\S]*- id: ui-theme/.test(mixedOnDisk), false, "外来行不得被折叠进 insert");
  assert.equal(mcpListResultSchema.parse(await gateway.list()).patch.foreign.length >= 1, true);
  pass("gateway never folds foreign rows inside the managed block");

  // 8.【#45】OAuth 状态与断开：无记录时 connected=false；断开只删 Authorization 头
  const oauthBefore = await gateway.oauthStatus({ serverName: "expr" });
  assert.equal(oauthBefore.connected, false, "no OAuth record means not connected");
  assert.equal(oauthBefore.headerReady, false);
  const disconnected = await gateway.oauthDisconnect({ serverName: "expr" });
  assert.equal(disconnected.disconnected, true);
  const afterDisconnect = await readFile(join(dir, "cordis.patch.yml"), "utf8");
  assert.equal(afterDisconnect.includes("Authorization"), false, "disconnect must drop the header");
  assert.equal(afterDisconnect.includes("panel-mcp-expr"), true, "the row itself must survive");
  pass("gateway clears the OAuth header only");

  // 9. 面板自己的行（id 前缀 panel-mcp-）落在受管块外时：只读，但必须标 orphan，
  //    让界面能说清"这行是面板的，只是不在块内"，而不是笼统的"外部管理"。
  await writeFile(join(dir, "cordis.patch.yml"), "# profile\n[]\n");
  await gateway.save({ input: { serverName: "alpha", transport: "stdio", command: "node" }, enabled: false });
  await gateway.save({ input: { serverName: "beta", transport: "stdio", command: "node" }, enabled: false });
  const blocked = await readFile(join(dir, "cordis.patch.yml"), "utf8");
  const withoutMarkers = blocked
    .split("\n")
    .filter((line) => !line.includes("dsh-skill-mcp-panel:mcp:begin") && !line.includes("dsh-skill-mcp-panel:mcp:end"))
    .join("\n")
    .replace("id: panel-mcp-beta", "id: custom-beta");
  await writeFile(join(dir, "cordis.patch.yml"), withoutMarkers);

  const orphaned = await gateway.list();
  assert.equal(orphaned.patch.ok, true);
  assert.equal(orphaned.servers.length, 0, "no managed block means nothing is managed");
  const panelOwned = orphaned.externalServers.find((server) => server.serverName === "alpha");
  const foreignOwned = orphaned.externalServers.find((server) => server.serverName === "beta");
  assert.equal(panelOwned?.orphan, true, "panel-prefixed row outside the block must be flagged orphan");
  assert.equal(Boolean(foreignOwned?.orphan), false, "a row with a foreign id is not orphan");
  mcpListResultSchema.parse(orphaned);
  pass("gateway flags panel-owned rows that sit outside the managed block");
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log("\n" + passed + " passed, 0 failed");
console.log("ALL MCP GATEWAY TESTS PASSED");
