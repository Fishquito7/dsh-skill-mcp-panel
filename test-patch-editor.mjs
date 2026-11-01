import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MCP_PLUGIN_NAME,
  extractManagedRows,
  generateManagedBlock,
  isJsExprValue,
  listMcpPatchRows,
  readManagedBlock,
  readMcpEntryText,
  readPatchFile,
  removeMcpEntryInText,
  replaceMcpEntryTextInText,
  replaceMcpEntryWithRowInText,
  replaceManagedBlock,
  evacuateForeignRows,
  setEntryDisabledInText,
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

{
  // #67：块外手写行的 disabled 翻转往返后与原文逐字节一致，且只动这一条。
  const original = [
    "# user comment",
    "- id: ui-theme",
    "  name: '@deepseek-ai/dsh-client-ui-theme'",
    "  config:",
    "    fontSize: 14",
    "- id: mcp-memory",
    "  name: '@deepseek-ai/dsh-mcp-client'",
    "  # hand-written",
    "  config:",
    "    serverName: memory",
    "    transport: stdio",
    "    command: npx",
    "    maxInstructionBytes: 8000",
    "    env:",
    "      TOKEN: !!js '`${process.env.TOKEN}`'",
    ""
  ].join("\n");
  const disabled = setEntryDisabledInText(original, { id: "mcp-memory" }, true);
  assert.notEqual(disabled, original);
  // 启停不改写别的键，disabled 落在这一条最后一个键之后（没有 id 的行也能这么插）。
  assert.match(disabled, /\n {2}disabled: true\n/);
  assert.equal(disabled.indexOf("disabled: true") > disabled.indexOf("TOKEN: !!js"), true);
  assert.equal(disabled.includes("maxInstructionBytes: 8000"), true);
  assert.equal(disabled.includes("TOKEN: !!js"), true);
  assert.equal(disabled.includes("fontSize: 14"), true);
  assert.equal(disabled.includes("# hand-written"), true);
  assert.equal(disabled.includes("# user comment"), true);
  const enabled = setEntryDisabledInText(disabled, { id: "mcp-memory" }, false);
  assert.equal(enabled, original, "disable then enable must restore the file byte for byte");
  assert.equal(setEntryDisabledInText(original, { id: "mcp-memory" }, false), original);
  pass("setEntryDisabledInText toggles one entry and round-trips byte for byte");
}

await expectThrow("!!js disabled is refused", () => setEntryDisabledInText([
  "- id: mcp-memory",
  "  name: '@deepseek-ai/dsh-mcp-client'",
  "  disabled: !!js process.env.OFF === '1'",
  "  config:",
  "    serverName: memory",
  ""
].join("\n"), { id: "mcp-memory" }, false), /!!js/);

{
  const original = [
    "# keep",
    "- insert:",
    "    - id: mcp-memory",
    "      name: '@deepseek-ai/dsh-mcp-client'",
    "      config:",
    "        serverName: memory",
    "        transport: stdio",
    "        command: npx",
    "        maxInstructionBytes: 8000",
    "    - id: other-plugin",
    "      name: 'dsh-client-pricing'",
    "- id: tail",
    "  name: 'not-mcp'",
    ""
  ].join("\n");
  const text = readMcpEntryText(original, { id: "mcp-memory" });
  assert.match(text, /^ {4}- id: mcp-memory\n/);
  assert.equal(text.includes("maxInstructionBytes: 8000"), true);
  const edited = text.replace("maxInstructionBytes: 8000", "maxInstructionBytes: 4096");
  const next = replaceMcpEntryTextInText(original, { id: "mcp-memory" }, edited);
  assert.equal(next.row.config.maxInstructionBytes, 4096);
  assert.equal(next.raw.includes("# keep"), true);
  assert.equal(next.raw.includes("id: other-plugin"), true);
  assert.equal(next.raw.includes("id: tail"), true);
  assert.equal(next.raw.includes("maxInstructionBytes: 4096"), true);
  assert.equal(next.raw.includes("maxInstructionBytes: 8000"), false);
  // 跨度之外与原文一致：把被替换的那一段扣掉后，两边剩余字节相同。
  const beforeSpan = original.indexOf(text);
  assert.equal(original.slice(0, beforeSpan) + original.slice(beforeSpan + text.length), next.raw.slice(0, beforeSpan) + next.raw.slice(beforeSpan + edited.length));
  pass("raw edit replaces one entry and leaves every other byte alone");
}

{
  const original = [
    "# >>> dsh-skill-mcp-panel:mcp:begin",
    "- insert:",
    "    - id: panel-mcp-demo",
    "      name: '@deepseek-ai/dsh-mcp-client'",
    "      config:",
    "        serverName: demo",
    "        transport: stdio",
    "        command: node",
    "# <<< dsh-skill-mcp-panel:mcp:end",
    ""
  ].join("\n");
  const removed = removeMcpEntryInText(original, { serverName: "demo" });
  assert.equal(removed.includes("panel-mcp-demo"), false);
  assert.match(removed, /\[\]/);
  await validatePatchText(removed);
  pass("removing the last managed-block row restores a valid empty patch");
}

{
  const original = [
    "# keep-me",
    "- id: mcp-memory",
    "  name: '@deepseek-ai/dsh-mcp-client'",
    "  config:",
    "    serverName: memory",
    "    transport: stdio",
    "    command: npx",
    "- id: ui-theme",
    "  name: '@deepseek-ai/dsh-client-ui-theme'",
    "  config: { fontSize: 14 }",
    ""
  ].join("\n");
  const removed = removeMcpEntryInText(original, { id: "mcp-memory" });
  assert.equal(removed.includes("mcp-memory"), false);
  assert.equal(removed.startsWith("# keep-me\n"), true);
  assert.match(removed, /id: ui-theme/);
  await validatePatchText(removed);
  pass("removing a hand-written row leaves sibling rows byte-identical");
}

{
  const original = [
    "# keep",
    "- id: mcp-memory",
    "  name: '@deepseek-ai/dsh-mcp-client'",
    "  # hand note",
    "  config:",
    "    serverName: memory",
    "    transport: stdio",
    "    command: npx",
    "    maxInstructionBytes: 8000",
    ""
  ].join("\n");
  const row = listMcpPatchRows(original)[0];
  row.config.command = "node";
  const next = replaceMcpEntryWithRowInText(original, { id: "mcp-memory" }, row);
  assert.equal(next.includes("maxInstructionBytes: 8000"), true);
  assert.equal(next.includes("command: node"), true);
  assert.equal(next.includes("id: mcp-memory"), true);
  assert.equal(next.startsWith("# keep\n"), true);
  assert.equal(next.includes("# >>> dsh-skill-mcp-panel"), false, "template save must not move the row into a managed block");
  pass("template row replace keeps unmodeled keys and the original location");
}

{
  const original = [
    "- id: mcp-memory",
    "  name: '@deepseek-ai/dsh-mcp-client'",
    "  disabled: !!js process.env.OFF === '1'",
    "  config:",
    "    serverName: memory",
    "    transport: stdio",
    "    command: npx",
    ""
  ].join("\n");
  const row = listMcpPatchRows(original)[0];
  assert.equal(isJsExprValue(row.disabled), true);
  assert.equal(row.disabled.__jsExpr, "process.env.OFF === '1'");
  const rewritten = replaceMcpEntryWithRowInText(original, { id: "mcp-memory", serverName: "memory" }, {
    ...row,
    config: { ...row.config, command: "node" }
  });
  assert.match(rewritten, /disabled: !!js /);
  assert.match(rewritten, /process\.env\.OFF === '1'|process\.env\.OFF === ''1''/);
  assert.equal(rewritten.includes("\ndisabled: true"), false);
  assert.equal(rewritten.includes("command: node"), true);
  const again = listMcpPatchRows(rewritten)[0];
  assert.equal(isJsExprValue(again.disabled), true);
  assert.equal(again.disabled.__jsExpr, "process.env.OFF === '1'");
  pass("form/oauth rewrite keeps a !!js disabled expression");
}


{
  // #70 复测：条目后面的注释不能在表单保存 / 删除时被吞掉
  const original = [
    "- id: x",
    "  name: '@deepseek-ai/dsh-mcp-client'",
    "  config:",
    "    serverName: x",
    "    command: node",
    "  # note about x",
    "# NOTE: this belongs to z",
    "- id: z",
    "  name: '@deepseek-ai/dsh-mcp-client'",
    "  config:",
    "    serverName: z",
    ""
  ].join("\n");
  const row = listMcpPatchRows(original)[0];
  row.config.command = "node2";
  const replaced = replaceMcpEntryWithRowInText(original, { id: "x" }, row);
  assert.equal(replaced.includes("# note about x"), true, "被编辑行后面的缩进注释必须留下");
  assert.equal(replaced.includes("# NOTE: this belongs to z"), true, "下一行的说明注释必须留下");
  assert.equal(replaced.includes("command: node2"), true);
  await validatePatchText(replaced);
  const removed = removeMcpEntryInText(original, { id: "x" });
  assert.equal(removed.includes("# note about x"), true);
  assert.equal(removed.includes("# NOTE: this belongs to z"), true);
  assert.match(removed, /id: z/);
  await validatePatchText(removed);
  pass("comments after an entry survive form save and delete");
}

{
  // #70 复测：删掉受管块最后一行时，标记必须成对消失，块内注释保留，块外行留在块外
  const original = [
    "# head",
    "- id: keep",
    "  name: '@scope/other'",
    "  config:",
    "    a: 1",
    "# >>> dsh-skill-mcp-panel:mcp:begin",
    "- insert:",
    "    - id: panel-mcp-only",
    "      name: '@deepseek-ai/dsh-mcp-client'",
    "      config:",
    "        serverName: only",
    "        transport: stdio",
    "        command: node",
    "    # 块内注释",
    "# <<< dsh-skill-mcp-panel:mcp:end",
    "",
    "# 另一个插件",
    "- id: other",
    "  name: '@scope/other2'",
    "  config:",
    "    b: 2",
    ""
  ].join("\n");
  const removed = removeMcpEntryInText(original, { id: "panel-mcp-only" });
  assert.equal(removed.includes("# >>> dsh-skill-mcp-panel:mcp:begin"), false, "空块标记必须一起收掉");
  assert.equal(removed.includes("# <<< dsh-skill-mcp-panel:mcp:end"), false);
  assert.equal(removed.includes("# 块内注释"), true, "块内注释不能丢");
  assert.match(removed, /id: other/);
  assert.equal(removed.includes("id: keep"), true);
  await validatePatchText(removed);
  assert.equal(listMcpPatchRows(removed).length, 0);
  pass("removing the last block row keeps begin/end balanced");
}

{
  // 重复 id：必须按 serverName 唯一命中，不能改到第一行
  const dup = [
    "- id: dup",
    "  name: '@deepseek-ai/dsh-mcp-client'",
    "  config:",
    "    serverName: aaa",
    "    command: node",
    "- id: dup",
    "  name: '@deepseek-ai/dsh-mcp-client'",
    "  config:",
    "    serverName: bbb",
    "    command: node",
    ""
  ].join("\n");
  const toggled = setEntryDisabledInText(dup, { id: "dup", serverName: "bbb" }, true);
  const parts = toggled.split("- id: dup");
  assert.equal(parts.length, 3);
  assert.equal(parts[1].includes("disabled: true"), false, "不能把 disabled 写到另一行");
  assert.equal(parts[2].includes("disabled: true"), true, "要写到 serverName 匹配的那一行");
  await validatePatchText(toggled);
  pass("duplicate ids toggle the row identified by serverName");
}

{
  // 没有 id 的手写行：能开关，且开关往返逐字节还原，不补 id
  const noid = [
    "# hand written",
    "- name: '@deepseek-ai/dsh-mcp-client'",
    "  config:",
    "    serverName: hand",
    "    transport: stdio",
    "    command: node",
    ""
  ].join("\n");
  const off = setEntryDisabledInText(noid, { serverName: "hand" }, true);
  assert.match(off, /command: node\n {2}disabled: true\n/);
  assert.equal(off.includes("id:"), false, "不得偷偷补一个 id");
  const on = setEntryDisabledInText(off, { serverName: "hand" }, false);
  assert.equal(on, noid, "没有 id 的行开关往返必须逐字节还原");
  await validatePatchText(off);
  pass("rows without an id can be toggled without gaining an id");
}

{
  // 原文编辑不许改缩进/位置：块内 insert 成员不能变成顶层条目
  const block = [
    "# >>> dsh-skill-mcp-panel:mcp:begin",
    "- insert:",
    "    - id: panel-mcp-a",
    "      name: '@deepseek-ai/dsh-mcp-client'",
    "      config:",
    "        serverName: a",
    "        transport: stdio",
    "# <<< dsh-skill-mcp-panel:mcp:end",
    ""
  ].join("\n");
  await expectThrow(
    "raw edit cannot move an entry out of the insert list",
    () => replaceMcpEntryTextInText(block, { id: "panel-mcp-a" }, "- id: panel-mcp-a\n  name: '@deepseek-ai/dsh-mcp-client'\n  config:\n    serverName: a\n    transport: stdio\n"),
    /位置/
  );
}

{
  // 原文编辑手写行：snippet 可以没有 id
  const noid = [
    "# hand written",
    "- name: '@deepseek-ai/dsh-mcp-client'",
    "  config:",
    "    serverName: hand",
    "    transport: stdio",
    "    command: node",
    ""
  ].join("\n");
  const next = replaceMcpEntryTextInText(noid, { serverName: "hand" }, "- name: '@deepseek-ai/dsh-mcp-client'\n  config:\n    serverName: hand\n    transport: stdio\n    command: node2\n");
  assert.equal(next.raw.includes("command: node2"), true);
  assert.equal(next.raw.includes("disabled: true"), false);
  await validatePatchText(next.raw);
  pass("raw edit accepts a snippet without an id");
}

{
  // CRLF 文件：插入/重写必须沿用 CRLF，不能掺 LF 行
  const crlf = [
    "- id: mcp-x",
    "  name: '@deepseek-ai/dsh-mcp-client'",
    "  config:",
    "    serverName: x",
    "    transport: stdio",
    "    command: node",
    ""
  ].join("\r\n");
  const off = setEntryDisabledInText(crlf, { id: "mcp-x" }, true);
  assert.equal(off.includes("  disabled: true\r\n"), true, "disabled 插入行必须用 CRLF");
  assert.equal(off.split("\n").slice(0, -1).every((line) => line.endsWith("\r")), true, "整份文件不能出现裸 LF");
  const on = setEntryDisabledInText(off, { id: "mcp-x" }, false);
  assert.equal(on, crlf, "CRLF 文件开关往返必须逐字节还原");
  pass("CRLF files keep CRLF when toggling");
}

console.log("\n" + passed + " passed, 0 failed");
console.log("ALL PATCH EDITOR TESTS PASSED");
