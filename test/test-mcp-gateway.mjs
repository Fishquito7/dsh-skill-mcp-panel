import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { McpManagerGateway } from "../lib/mcp/gateway.js";
import { MCP_MANIFEST, mcpListResultSchema } from "../lib/mcp/wire.js";

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

  // 9. #67：块外的手写行和 panel-mcp-* 行都是普通 MCP 行。启停、表单、原文一视同仁，
  //    不迁进受管块，也不再标 orphan / external。
  await writeFile(join(dir, "cordis.patch.yml"), "# profile\n[]\n");
  await gateway.save({ input: { serverName: "alpha", transport: "stdio", command: "node" }, enabled: false });
  await gateway.save({ input: { serverName: "beta", transport: "stdio", command: "node" }, enabled: false });
  const blocked = await readFile(join(dir, "cordis.patch.yml"), "utf8");
  const withoutMarkers = blocked
    .split("\n")
    .filter((line) => !line.includes("dsh-skill-mcp-panel:mcp:begin") && !line.includes("dsh-skill-mcp-panel:mcp:end"))
    .join("\n")
    .replace("id: panel-mcp-beta", "id: custom-beta")
    .replace(/(id: custom-beta[\s\S]*?)([ \t]*)command: node\n/, "$1$2command: node\n$2maxInstructionBytes: 8000\n");
  await writeFile(join(dir, "cordis.patch.yml"), withoutMarkers);
  ctx.loader = {
    entries: function* () {
      yield { id: "panel-mcp-alpha", disabled: true, fiber: undefined, options: { name: "@deepseek-ai/dsh-mcp-client" } };
      yield { id: "custom-beta", disabled: true, fiber: undefined, options: { name: "@deepseek-ai/dsh-mcp-client" } };
    }
  };

  const taken = await gateway.list();
  assert.equal(taken.patch.ok, true);
  assert.equal(taken.externalServers.length, 0, "externalServers stays empty; every row is in servers");
  assert.equal(taken.servers.length, 2);
  const panelOwned = taken.servers.find((server) => server.serverName === "alpha");
  const handWritten = taken.servers.find((server) => server.serverName === "beta");
  assert.equal(panelOwned?.entryId, "panel-mcp-alpha");
  assert.equal(handWritten?.entryId, "custom-beta");
  assert.equal(panelOwned?.orphan, undefined);
  assert.equal(handWritten?.orphan, undefined);
  mcpListResultSchema.parse(taken);

  const raw = await gateway.readRaw({ serverName: "beta" });
  assert.equal(raw.entryId, "custom-beta");
  assert.match(raw.text, /maxInstructionBytes: 8000/);
  const written = await gateway.writeRaw({ serverName: "beta", text: raw.text.replace("maxInstructionBytes: 8000", "maxInstructionBytes: 4096") });
  assert.equal(written.server.serverName, "beta");
  const afterRaw = await readFile(join(dir, "cordis.patch.yml"), "utf8");
  assert.equal(afterRaw.includes("maxInstructionBytes: 4096"), true);
  assert.equal(afterRaw.includes("id: custom-beta"), true);
  assert.equal(afterRaw.includes("dsh-skill-mcp-panel:mcp:begin"), false, "raw edit must not create a managed block");
  assert.equal(afterRaw.startsWith("# profile\n"), true);

  const edited = await gateway.save({
    input: { serverName: "beta", transport: "stdio", command: "npx" },
    previousServerName: "beta",
    enabled: false
  });
  assert.equal(edited.server.serverName, "beta");
  assert.equal(edited.server.command, "npx");
  const afterForm = await readFile(join(dir, "cordis.patch.yml"), "utf8");
  assert.equal(afterForm.includes("id: custom-beta"), true, "form save keeps the hand-written id");
  assert.equal(afterForm.includes("maxInstructionBytes: 4096"), true, "form save keeps unmodeled fields");
  assert.equal(afterForm.includes("command: npx"), true);
  assert.equal(afterForm.includes("id: panel-mcp-alpha"), true, "editing beta must not drop alpha");
  assert.equal(afterForm.includes("dsh-skill-mcp-panel:mcp:begin"), false);

  await gateway.removeServer({ serverName: "beta" });
  const afterRemove = await readFile(join(dir, "cordis.patch.yml"), "utf8");
  assert.equal(afterRemove.includes("custom-beta"), false);
  assert.equal(afterRemove.includes("panel-mcp-alpha"), true);
  pass("gateway treats every mcp-client row as editable in place");

  // 10. !!js disabled 由宿主求值，当前可以是 false。不能等 loader 报 disabled === true，
  //     否则保存会空转到超时。卡片仍按停用，表达式留在文件里。
  const jsText = [
    "# profile",
    "- id: mcp-expr",
    "  name: '@deepseek-ai/dsh-mcp-client'",
    "  disabled: !!js process.env.OFF === '1'",
    "  config:",
    "    serverName: exprgate",
    "    transport: stdio",
    "    command: node",
    ""
  ].join("\n");
  await writeFile(join(dir, "cordis.patch.yml"), jsText);
  ctx.loader = {
    entries: function* () {
      yield { id: "mcp-expr", disabled: false, fiber: undefined, options: { name: "@deepseek-ai/dsh-mcp-client" } };
    }
  };
  const jsList = await gateway.list();
  assert.equal(jsList.patch.ok, true);
  assert.equal(jsList.servers.length, 1);
  assert.equal(jsList.servers[0].serverName, "exprgate");
  assert.equal(jsList.servers[0].enabled, false);
  const saveStarted = Date.now();
  const jsSaved = await gateway.save({
    input: { serverName: "exprgate", transport: "stdio", command: "npx" },
    previousServerName: "exprgate",
    enabled: true
  });
  assert.ok(Date.now() - saveStarted < 1000, "form save must not wait out the HMR timeout");
  assert.equal(jsSaved.server.enabled, false);
  assert.equal(jsSaved.reconciled, true);
  const jsOnDisk = await readFile(join(dir, "cordis.patch.yml"), "utf8");
  assert.match(jsOnDisk, /disabled: !!js /);
  assert.match(jsOnDisk, /process\.env\.OFF/);
  assert.equal(jsOnDisk.includes("command: npx"), true);
  assert.equal(jsOnDisk.includes("\ndisabled: true"), false);
  const exprRaw = await gateway.readRaw({ serverName: "exprgate" });
  const rawStarted = Date.now();
  const rawWritten = await gateway.writeRaw({
    serverName: "exprgate",
    text: exprRaw.text.replace("command: npx", "command: node")
  });
  assert.ok(Date.now() - rawStarted < 1000, "raw save must not wait out the HMR timeout");
  assert.equal(rawWritten.server.enabled, false);
  assert.equal(rawWritten.reconciled, true);
  const afterRawJs = await readFile(join(dir, "cordis.patch.yml"), "utf8");
  assert.match(afterRawJs, /disabled: !!js /);
  assert.match(afterRawJs, /process\.env\.OFF/);
  pass("gateway does not HMR-wait on a !!js disabled expression");

  // 11. 没有 id 的手写行：能开关，且只在文件里插/删 disabled，不补 id
  const handPatch = [
    "# hand written",
    "- name: '@deepseek-ai/dsh-mcp-client'",
    "  config:",
    "    serverName: hand",
    "    transport: stdio",
    "    command: node",
    ""
  ].join("\n");
  await writeFile(join(dir, "cordis.patch.yml"), handPatch);
  const handList = await gateway.list();
  assert.equal(handList.servers.length, 1);
  assert.equal(handList.servers[0].serverName, "hand");
  assert.equal(handList.servers[0].entryId, undefined);
  const handOff = await gateway.setEnabled({ serverName: "hand", enabled: false });
  assert.equal(handOff.server.enabled, false);
  const handText = await readFile(join(dir, "cordis.patch.yml"), "utf8");
  assert.match(handText, /command: node\n {2}disabled: true\n/);
  assert.equal(/^\s*id:/m.test(handText), false, "不得给手写行补 id");
  await gateway.setEnabled({ serverName: "hand", enabled: true });
  assert.equal(await readFile(join(dir, "cordis.patch.yml"), "utf8"), handPatch, "开关往返必须逐字节还原");
  pass("gateway toggles a row without an id");

  // 12. 重复 serverName：payload 带 entryId 时只动对应那一行；表单保存也按 entryId 定位
  const dupText = [
    "- id: mcp-first",
    "  name: '@deepseek-ai/dsh-mcp-client'",
    "  config:",
    "    serverName: same",
    "    transport: stdio",
    "    command: node",
    "- id: mcp-second",
    "  name: '@deepseek-ai/dsh-mcp-client'",
    "  config:",
    "    serverName: same",
    "    transport: stdio",
    "    command: node",
    ""
  ].join("\n");
  await writeFile(join(dir, "cordis.patch.yml"), dupText);
  const dupList = await gateway.list();
  assert.equal(dupList.servers.length, 2);
  const dupWithoutId = await gateway.setEnabled({ serverName: "same", enabled: false }).then(() => null, (error) => error);
  assert.ok(dupWithoutId !== null, "重复 serverName 不带 entryId 必须拒绝");
  assert.match(String(dupWithoutId.message), /entryId|--id|不唯一|多条/);
  const dupToggled = await gateway.setEnabled({ serverName: "same", entryId: "mcp-second", enabled: false });
  assert.equal(dupToggled.server.entryId, "mcp-second");
  const dupOnDisk = await readFile(join(dir, "cordis.patch.yml"), "utf8");
  const dupParts = dupOnDisk.split("- id: mcp-second");
  assert.equal(dupParts[0].includes("disabled: true"), false, "不能改到另一行");
  assert.equal(dupParts[1].includes("disabled: true"), true);
  const dupSaved = await gateway.save({
    input: { serverName: "same", transport: "stdio", command: "node2" },
    previousServerName: "same",
    previousEntryId: "mcp-second",
    enabled: false
  });
  assert.equal(dupSaved.server.entryId, "mcp-second");
  const dupAfterSave = await readFile(join(dir, "cordis.patch.yml"), "utf8");
  const dupAfterParts = dupAfterSave.split("- id: mcp-second");
  assert.equal(dupAfterParts[0].includes("command: node2"), false, "只改 entryId 指定的那一行");
  assert.equal(dupAfterParts[1].includes("command: node2"), true);
  assert.equal(dupAfterParts[1].includes("disabled: true"), true, "表单保存要保留原来的 disabled");
  pass("gateway addresses duplicated serverNames by entryId");

  // 13. !!js disabled：视图带 disabledExpr，界面据此禁用开关
  const jsExprPatch = [
    "- id: mcp-js",
    "  name: '@deepseek-ai/dsh-mcp-client'",
    "  disabled: !!js process.env.OFF === '1'",
    "  config:",
    "    serverName: jsexpr",
    "    transport: stdio",
    "    command: node",
    ""
  ].join("\n");
  await writeFile(join(dir, "cordis.patch.yml"), jsExprPatch);
  const jsExprList = await gateway.list();
  assert.equal(jsExprList.servers.length, 1);
  assert.equal(jsExprList.servers[0].enabled, false);
  assert.equal(jsExprList.servers[0].disabledExpr, true, "!!js disabled 必须标记给界面");
  assert.equal(mcpListResultSchema.parse(jsExprList).servers[0].disabledExpr, true);
  pass("gateway exposes disabledExpr for !!js rows");

} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log("\n" + passed + " passed, 0 failed");
console.log("ALL MCP GATEWAY TESTS PASSED");
