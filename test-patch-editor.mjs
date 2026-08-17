import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MCP_PLUGIN_NAME,
  extractManagedRows,
  generateManagedBlock,
  listMcpPatchRows,
  readPatchFile,
  replaceManagedBlock,
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

console.log("\n" + passed + " passed, 0 failed");
console.log("ALL PATCH EDITOR TESTS PASSED");
