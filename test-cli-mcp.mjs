import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const dir = await mkdtemp(join(tmpdir(), "dsh-panel-cli-"));
try {
  const profileDir = join(dir, "profiles", "test");
  await mkdir(profileDir, { recursive: true });
  await writeFile(join(profileDir, "cordis.patch.yml"), "[]\n");
  const cli = fileURLToPath(new URL("./lib/cli.js", import.meta.url));
  const run = (args) => spawnSync(process.execPath, [cli, ...args], {
    cwd: dir,
    env: { ...process.env, DSH_HOME: dir },
    encoding: "utf8"
  });

  const add = run(["mcp", "add", "--name", "demo", "--stdio", "--command", "node", "--args", "-e", "--profile", "test"]);
  assert.equal(add.status, 0, add.stderr);
  const patch1 = await readFile(join(dir, "profiles", "test", "cordis.patch.yml"), "utf8");
  assert.match(patch1, /panel-mcp-demo/);
  assert.match(patch1, /command: node/);
  pass("dsh-panel mcp add writes managed row");

  const list1 = run(["mcp", "list", "--profile", "test"]);
  assert.equal(list1.status, 0, list1.stderr);
  assert.match(list1.stdout, /启用\s+demo/);
  pass("dsh-panel mcp list shows managed row");

  const disable = run(["mcp", "disable", "demo", "--profile", "test"]);
  assert.equal(disable.status, 0, disable.stderr);
  const patch2 = await readFile(join(dir, "profiles", "test", "cordis.patch.yml"), "utf8");
  assert.match(patch2, /disabled: true/);
  pass("dsh-panel mcp disable toggles disabled row");

  const enable = run(["mcp", "enable", "demo", "--profile", "test"]);
  assert.equal(enable.status, 0, enable.stderr);
  pass("dsh-panel mcp enable restores row");

  const remove = run(["mcp", "remove", "demo", "--yes", "--profile", "test"]);
  assert.equal(remove.status, 0, remove.stderr);
  const patch3 = await readFile(join(dir, "profiles", "test", "cordis.patch.yml"), "utf8");
  assert.equal(patch3.includes("panel-mcp-demo"), false);
  assert.match(patch3, /\[\]/);
  pass("dsh-panel mcp remove restores valid empty patch");

  const list2 = run(["mcp", "list", "--profile", "test"]);
  assert.equal(list2.status, 0, list2.stderr);
  assert.match(list2.stdout, /没有 MCP 服务器/);
  pass("dsh-panel mcp list empty state");

  const version = run(["--version"]);
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout, /dsh-panel v2\.0\.0/);
  pass("dsh-panel --version reports package version");
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log("\n" + passed + " passed, 0 failed");
console.log("ALL MCP CLI TESTS PASSED");
