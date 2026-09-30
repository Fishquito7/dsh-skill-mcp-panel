import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { posixShimBody, shellQuote, shimFiles } from "./lib/global-shim.js";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const CLI = "C:\\Users\\Some User\\AppData\\Roaming\\npm\\node_modules\\dsh-skill-mcp-panel\\lib\\cli.js";
const NODE = "C:\\Program Files\\nodejs\\node.exe";

// 1. Windows 必须写三份：CMD / PowerShell / 无扩展名（bash 用）
const win = shimFiles(CLI, NODE, "win32");
assert.deepEqual(win.map((file) => file.name), ["dsh-panel", "dsh-panel.cmd", "dsh-panel.ps1"]);
pass("windows shim set covers cmd, powershell and bash");

// 2. 无扩展名那份必须是 LF 的 sh 脚本，路径要带引号（含空格）
const sh = win[0];
assert.equal(sh.mode, 0o755);
assert.equal(sh.content.includes("\r"), false, "a CRLF sh script fails in bash with \\r: command not found");
assert.ok(sh.content.startsWith("#!/bin/sh\n"), "must start with a shebang");
assert.ok(sh.content.includes("\'" + CLI + "\'"), "cli path must be single-quoted");
assert.ok(sh.content.includes("\'" + NODE + "\'"), "node fallback must be single-quoted");
assert.ok(sh.content.includes("command -v node"), "prefer node from PATH");
assert.ok(sh.content.trimEnd().endsWith("' \"$@\""), "must forward every argument");
pass("the extension-less shim is a LF sh script with quoted paths");

// 3. macOS / Linux：只要那一份，同样带执行位
const posix = shimFiles("/usr/local/lib/node_modules/dsh-skill-mcp-panel/lib/cli.js", "/usr/local/bin/node", "darwin");
assert.deepEqual(posix.map((file) => file.name), ["dsh-panel"]);
assert.equal(posix[0].mode, 0o755);
pass("posix shim stays a single executable script");

// 4. 单引号转义：路径里出现单引号时不能把脚本撕开
assert.equal(shellQuote("a b"), "\'a b\'");
assert.equal(shellQuote("it\'s"), "\'it\'\\\'\'s\'");
pass("shellQuote survives spaces and embedded quotes");

// 5. 真的跑一遍：把 shim 指到本包 CLI，在 sh 里执行（仅 POSIX 或 Git Bash 可用时）
const cliPath = fileURLToPath(new URL("./lib/cli.js", import.meta.url));
const shAvailable = spawnSync("sh", ["-c", "true"], { stdio: "ignore" }).status === 0;
if (shAvailable) {
  const dir = await mkdtemp(join(tmpdir(), "dsh-panel-shim-"));
  try {
    const shimPath = join(dir, "dsh-panel");
    await writeFile(shimPath, posixShimBody(cliPath, process.execPath), { mode: 0o755 });
    const run = spawnSync("sh", [shimPath, "--version"], { encoding: "utf8" });
    const declared = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8")).version;
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, new RegExp("dsh-panel v" + declared.replace(/\./g, "\\.")));
    // 参数必须原样透传（含带空格的参数）
    const bad = spawnSync("sh", [shimPath, "mcp", "list", "--profile", "no such profile"], { encoding: "utf8" });
    assert.equal(bad.status, 2, "unknown profile must exit 2 through the shim");
    assert.match(bad.stderr, /no such profile/);
    pass("the generated shim really runs the CLI through sh");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
} else {
  console.log("SKIP  sh is unavailable on this host");
}

console.log("\n" + passed + " passed, 0 failed");
console.log("ALL GLOBAL SHIM TESTS PASSED");
