import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MCP_PLUGIN_NAME,
  extractManagedRows,
  generateManagedBlock,
  listMcpPatchRows,
  readManagedBlock,
  readPatchFile,
  replaceManagedBlock,
  evacuateForeignRows,
  validatePatchText,
  writeManagedRows
} from "./lib/patch-editor.js";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}
async function expectThrow(name, fn, needle) {
  let threw = false;
  try {
    await fn();
  } catch (error) {
    threw = true;
    if (needle !== undefined) assert.match(String(error?.message ?? error), needle);
  }
  assert.equal(threw, true, name + " should throw");
  pass(name);
}

const stdioRow = {
  id: "panel-mcp-github",
  name: MCP_PLUGIN_NAME,
  config: {
    serverName: "github",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_TOKEN: "secret" },
    cwd: "",
    toolCallTimeoutMs: 60000,
    failOnStartupError: false,
    reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 }
  }
};

const externalRaw = [
  "# user comment",
  "- insert:",
  "    - id: dsh-client-pricing",
  "      name: 'dsh-client-pricing'",
  "- id: existing",
  "  disabled: !!js process.platform !== 'win32'",
  ""
].join("\n");

// 1. no markers => empty managed rows
assert.deepEqual(extractManagedRows(externalRaw), []);
pass("missing markers extracts as empty");

// 2. incomplete markers fail
await expectThrow("incomplete markers rejected", () => extractManagedRows(externalRaw + "# >>> dsh-skill-mcp-panel:mcp:begin\n"), /不完整/);

// 3. append managed block preserves every outside byte
const one = replaceManagedBlock(externalRaw, [stdioRow]);
assert.equal(one.startsWith(externalRaw + "\n"), true);
assert.equal(one.includes(externalRaw.slice(0, externalRaw.length)), true);
assert.deepEqual(extractManagedRows(one), [stdioRow]);
pass("append block preserves external content byte-for-byte");

// 4. replace managed block preserves external content
const httpRow = {
  id: "panel-mcp-web",
  name: MCP_PLUGIN_NAME,
  config: { serverName: "web", transport: "streamable-http", url: "http://localhost:3000/mcp" }
};
const two = replaceManagedBlock(one, [httpRow]);
assert.equal(two.startsWith(externalRaw + "\n"), true);
assert.deepEqual(extractManagedRows(two), [httpRow]);
pass("replace block swaps rows and keeps external content");

// 5. remove block leaves only trailing whitespace differences
const removed = replaceManagedBlock(two, []);
assert.equal(removed.includes("# >>> dsh-skill-mcp-panel:mcp:begin"), false);
assert.deepEqual(extractManagedRows(removed), []);
assert.equal(removed.startsWith(externalRaw), true);
pass("empty rows remove managed block");

// 6. generated block round-trips
const generated = generateManagedBlock([stdioRow, httpRow]);
assert.equal(generated.includes("# >>> dsh-skill-mcp-panel:mcp:begin"), true);
assert.equal(generated.includes("# <<< dsh-skill-mcp-panel:mcp:end"), true);
assert.deepEqual(extractManagedRows(generated), [stdioRow, httpRow]);
pass("generated block round-trips");

// 7. validate patch text
await validatePatchText(externalRaw);
pass("patch text with !!js validates");
await validatePatchText(externalRaw + generated);
pass("patch text with managed block validates");
await expectThrow("non-array patch rejected", () => validatePatchText("name: hello\n"), /数组/);
await expectThrow("unparsable patch rejected", () => validatePatchText(":\n  bad\n"), /解析失败|数组/);

// 8. list MCP rows
const rows = listMcpPatchRows(externalRaw + generated);
assert.equal(rows.length, 2);
assert.ok(rows.every((row) => row.name === MCP_PLUGIN_NAME));
pass("listMcpPatchRows finds all MCP rows");

// 8b. empty profile template [] is replaced instead of appended after
const fromEmpty = replaceManagedBlock("# profile comments\n[]\n", [stdioRow]);
assert.deepEqual(extractManagedRows(fromEmpty), [stdioRow]);
assert.equal(fromEmpty.includes("[] - insert"), false);
await validatePatchText(fromEmpty);
pass("empty [] profile template receives valid managed block");

// 9. writeManagedRows persists and releases lock
const dir = await mkdtemp(join(tmpdir(), "dsh-panel-patch-"));
try {
  const path = join(dir, "cordis.patch.yml");
  await writeFile(path, externalRaw);
  await writeManagedRows(path, [stdioRow]);
  const onDisk = await readPatchFile(path);
  assert.deepEqual(extractManagedRows(onDisk), [stdioRow]);
  assert.equal(onDisk.startsWith(externalRaw + "\n"), true);
  let lockExists = true;
  try {
    await readFile(path + ".panel.lock", "utf8");
  } catch {
    lockExists = false;
  }
  assert.equal(lockExists, false);
  pass("writeManagedRows persists atomically and releases lock");
} finally {
  await rm(dir, { recursive: true, force: true });
}

// 10. !!js 表达式原样往返（v2.1.5）
//     面板必须把 !!js 当结构化节点读进来、再按标签写回去；一旦降级成普通字符串，
//     用户手写的 ${process.env.X} 就变成永远发不出去的字面量。
const BT = String.fromCharCode(96);
const headerExpr = BT + "Bearer " + "${process.env.MCP_TOKEN}" + BT;
const jsRow = {
  id: "panel-mcp-web",
  name: MCP_PLUGIN_NAME,
  config: {
    serverName: "web",
    transport: "streamable-http",
    url: "https://example.com/mcp",
    headers: { Authorization: { __jsExpr: headerExpr } }
  }
};
const withJs = replaceManagedBlock(externalRaw, [jsRow]);
assert.equal(withJs.includes("Authorization: !!js '" + headerExpr + "'"), true, "!!js tag must be written back");
assert.deepEqual(extractManagedRows(withJs), [jsRow]);
assert.equal(replaceManagedBlock(withJs, extractManagedRows(withJs)), withJs, "second write must be byte-identical");
pass("!!js expressions round-trip through the managed block");

// 11. 手写的 !!js 经过一次面板写入也不会被抹掉
const handwritten = externalRaw + [
  "# >>> dsh-skill-mcp-panel:mcp:begin",
  "- insert:",
  "    - id: panel-mcp-web",
  "      name: \"@deepseek-ai/dsh-mcp-client\"",
  "      config:",
  "        serverName: web",
  "        transport: streamable-http",
  "        url: http://localhost:3000/mcp",
  "        headers:",
  "          Authorization: !!js '" + headerExpr + "'",
  "# <<< dsh-skill-mcp-panel:mcp:end",
  ""
].join("\n");
const handwrittenRows = extractManagedRows(handwritten);
assert.equal(handwrittenRows[0].config.headers.Authorization.__jsExpr, headerExpr, "!!js must parse as an expression node");
const rewritten = replaceManagedBlock(handwritten, handwrittenRows);
assert.equal(rewritten.includes("Authorization: !!js '" + headerExpr + "'"), true, "hand-written !!js must survive a panel rewrite");
pass("hand-written !!js survives a panel rewrite");

// 12. 别人的 !!js 不受影响：外部行的 disabled 表达式保持原样
assert.equal(withJs.includes("disabled: !!js process.platform !== 'win32'"), true, "external !!js rows stay untouched");
assert.equal(listMcpPatchRows(withJs).length, 1, "external non-MCP rows must not be listed");
pass("external rows keep their own !!js expressions");
// 13.【#46】块内**外来顶层行**读→写往返后仍是顶层条目（id 定向覆盖语义不丢），
//     insert 里只有 panel-mcp-*；往返幂等，行内注释逐字节保留。
const blockInput = [
  "# >>> dsh-skill-mcp-panel:mcp:begin",
  "# 面板块内的某条别人的覆盖行",
  "- id: ui-theme",
  '  name: "@deepseek-ai/dsh-client-ui-theme"   # 行内注释',
  "  config:",
  "    fontSize: 14",
  "- insert:",
  "    - id: panel-mcp-camoufox",
  '      name: "@deepseek-ai/dsh-mcp-client"',
  "# <<< dsh-skill-mcp-panel:mcp:end",
  ""
].join("\n");
const split = readManagedBlock(blockInput);
assert.deepEqual(split.managed.map((row) => row.id), ["panel-mcp-camoufox"], "受管池只能含面板自己的行");
assert.deepEqual(
  split.foreign.entries,
  [{ id: "ui-theme", name: "@deepseek-ai/dsh-client-ui-theme", managed: false }],
  "外来行要能被报出来"
);
const preserved = replaceManagedBlock(blockInput, split.managed);
assert.match(preserved, /^- id: ui-theme$/m, "外来顶层行必须仍是顶层行");
assert.equal(/- insert:[\s\S]*- id: ui-theme/.test(preserved), false, "外来顶层行不得被折叠进 insert");
assert.equal(preserved.includes('name: "@deepseek-ai/dsh-client-ui-theme"   # 行内注释'), true, "外来行逐字节保留（含行内注释）");
assert.equal(preserved.includes("    - id: panel-mcp-camoufox"), true, "面板行写在自己的 insert 里");
assert.equal(replaceManagedBlock(preserved, readManagedBlock(preserved).managed), preserved, "往返必须幂等");
await validatePatchText(preserved);
pass("foreign top-level rows survive a panel rewrite");

// 13b. 块内没有面板行时不能删块（旧实现会把块连同外来行一起删掉）
const onlyForeign = [
  "# >>> dsh-skill-mcp-panel:mcp:begin",
  "- id: ui-theme",
  '  name: "@deepseek-ai/dsh-client-ui-theme"',
  "# <<< dsh-skill-mcp-panel:mcp:end",
  ""
].join("\n");
assert.deepEqual(readManagedBlock(onlyForeign).managed, []);
const keptOnlyForeign = replaceManagedBlock(onlyForeign, []);
assert.equal(keptOnlyForeign.includes("- id: ui-theme"), true, "只剩外来行时，块与外来行都要留着");
pass("a block with only foreign rows is preserved, not deleted");

// 14. 混着外来成员的 insert 条目**整条**原样保留：认领其中长得像面板行的那几条
//     会同时触发重复写入，所以面板宁可完全不碰它，只把它报给界面。
const foreignInsertInput = [
  "# >>> dsh-skill-mcp-panel:mcp:begin",
  "- insert:",
  "    - id: panel-mcp-notmine",
  '      name: "@deepseek-ai/dsh-mcp-client"',
  "      config:",
  "        serverName: notmine",
  "    - id: someone-else",
  '      name: "@deepseek-ai/dsh-desktop-plugin"',
  "- insert:",
  "    - id: panel-mcp-mine",
  '      name: "@deepseek-ai/dsh-mcp-client"',
  "      config:",
  "        serverName: mine",
  "# <<< dsh-skill-mcp-panel:mcp:end",
  ""
].join("\n");
const split2 = readManagedBlock(foreignInsertInput);
assert.deepEqual(split2.managed.map((row) => row.id), ["panel-mcp-mine"], "只认领纯面板 insert，混合 insert 整条不碰");
assert.equal(
  split2.foreign.entries.some((entry) => entry.id === "panel-mcp-notmine" && entry.managed === true),
  true,
  "混合 insert 里的面板行要报出来（面板暂不管理）"
);
assert.equal(
  split2.foreign.entries.some((entry) => entry.id === "someone-else" && entry.managed === false),
  true,
  "混合 insert 里的外来行也要报出来"
);
const kept2 = replaceManagedBlock(foreignInsertInput, split2.managed);
assert.equal(kept2.includes("    - id: panel-mcp-notmine"), true, "混合 insert 成员逐字节保留");
assert.equal(kept2.includes("    - id: someone-else"), true, "混合 insert 里的外来行逐字节保留");
assert.equal((kept2.match(/panel-mcp-notmine/g) ?? []).length, 1, "不得重复写入");
await validatePatchText(kept2);
pass("mixed insert entries stay untouched and are reported");

// ── 受管块内的外来顶层行：搬到块外，内容与语义不变（#46 后续）────────────
{
  const input = [
    "- id: keep-me",
    "  name: \"@deepseek-ai/dsh-permission-presets\"",
    "  config:",
    "    defaultPreset: read-only",
    "",
    "# >>> dsh-skill-mcp-panel:mcp:begin",
    "- id: permission",
    "  name: \"@deepseek-ai/dsh-permission-presets\"",
    "  config:",
    "    first: 1",
    "- insert:",
    "    - id: panel-mcp-a",
    "      name: \"@deepseek-ai/dsh-mcp-client\"",
    "      config:",
    "        serverName: a",
    "        transport: stdio",
    "        command: node",
    "# <<< dsh-skill-mcp-panel:mcp:end",
    ""
  ].join("\n");
  const moved = evacuateForeignRows(input);
  assert.equal(moved.moved, 1, "只搬顶层外来行，条数要报出来");
  const begin = moved.raw.indexOf("# >>> dsh-skill-mcp-panel:mcp:begin");
  const permission = moved.raw.indexOf("- id: permission");
  assert.ok(permission >= 0 && permission < begin, "外来行要落到 begin 标记之前");
  assert.equal(moved.raw.includes("first: 1"), true, "外来行内容逐字节保留");
  const block = readManagedBlock(moved.raw);
  assert.deepEqual(block.managed.map((row) => row.id), ["panel-mcp-a"], "面板行不受影响");
  assert.equal(block.foreign.top, "", "块内不再有外来顶层行");
  const again = evacuateForeignRows(moved.raw);
  assert.equal(again.moved, 0, "重复调用必须是幂等的");
  assert.equal(again.raw, moved.raw, "幂等时不得改动文件");
  await validatePatchText(moved.raw);
  pass("foreign top-level rows move out of the managed block verbatim");
}

{
  // 外来 insert 成员不在搬运范围内：搬出去会改变「插入哪些插件」的语义
  const input = [
    "# >>> dsh-skill-mcp-panel:mcp:begin",
    "- insert:",
    "    - id: someone-else",
    "      name: \"@deepseek-ai/dsh-mcp-client\"",
    "    - id: panel-mcp-a",
    "      name: \"@deepseek-ai/dsh-mcp-client\"",
    "# <<< dsh-skill-mcp-panel:mcp:end",
    ""
  ].join("\n");
  const moved = evacuateForeignRows(input);
  assert.equal(moved.moved, 0, "混合 insert 不搬");
  assert.equal(moved.raw, input, "不搬时文件不得变动");
  pass("foreign insert members are never evacuated");
}

console.log("\n" + passed + " passed, 0 failed");
console.log("ALL PATCH EDITOR TESTS PASSED");
