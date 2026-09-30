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
  // 「profile 存在」的判据是它有自己的 package.json（没有它 dsh 也起不动这个 profile）。
  // CLI 靠这条在派发 dsh plugin 之前拒绝错名，所以夹具必须是真的 profile。
  await writeFile(join(profileDir, "package.json"), JSON.stringify({ name: "dsh-profile-test", private: true, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base"] } } }, null, 2));
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

  // !!js 环境变量写法：CLI 也把值原样写成 !!js 标签，交给 DSH 装载时求值
  const BT = String.fromCharCode(96);
  const tokenExpr = BT + "Bearer " + "${process.env.MCP_TOKEN}" + BT;
  const exprAdd = run(["mcp", "add", "--name", "expr", "--http", "--url", "https://example.com/mcp", "--header", "Authorization=!!js " + tokenExpr, "--profile", "test"]);
  assert.equal(exprAdd.status, 0, exprAdd.stderr);
  const patchExpr = await readFile(join(dir, "profiles", "test", "cordis.patch.yml"), "utf8");
  assert.equal(patchExpr.includes("Authorization: !!js '" + tokenExpr + "'"), true, "!!js tag must be written by the CLI");
  const envAdd = run(["mcp", "add", "--name", "expr-env", "--stdio", "--command", "node", "--env", "TOKEN=!!js process.env.MCP_TOKEN", "--profile", "test"]);
  assert.equal(envAdd.status, 0, envAdd.stderr);
  const patchEnv = await readFile(join(dir, "profiles", "test", "cordis.patch.yml"), "utf8");
  assert.equal(patchEnv.includes("TOKEN: !!js 'process.env.MCP_TOKEN'"), true, "!!js env value must keep its tag");
  assert.equal(run(["mcp", "remove", "expr", "--yes", "--profile", "test"]).status, 0);
  assert.equal(run(["mcp", "remove", "expr-env", "--yes", "--profile", "test"]).status, 0);
  pass("dsh-panel mcp add keeps !!js values tagged in cordis.patch.yml");
  // ${NAME} 直觉写法：CLI 与面板同一套格式化规则
  const refAdd = run(["mcp", "add", "--name", "expr-ref", "--http", "--url", "https://example.com/mcp", "--header", "Authorization=Bearer ${MCP_TOKEN}", "--profile", "test"]);
  assert.equal(refAdd.status, 0, refAdd.stderr);
  const patchRef = await readFile(join(dir, "profiles", "test", "cordis.patch.yml"), "utf8");
  assert.equal(patchRef.includes("Authorization: !!js '" + String.fromCharCode(96) + "Bearer ${process.env.MCP_TOKEN}" + String.fromCharCode(96) + "'"), true, "${NAME} must be formatted into a !!js template");
  assert.equal(run(["mcp", "remove", "expr-ref", "--yes", "--profile", "test"]).status, 0);
  pass("dsh-panel mcp add formats ${NAME} into a !!js template");
  const version = run(["--version"]);
  assert.equal(version.status, 0, version.stderr);
  // 版本号从 package.json 读，避免每次发版都要改测试（旧写法硬编码 2.0.x）。
  const declared = JSON.parse(await readFile(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8")).version;
  assert.equal(version.stdout.trim(), "dsh-panel v" + declared);
  pass("dsh-panel --version reports package version");
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log("\n" + passed + " passed, 0 failed");
console.log("ALL MCP CLI TESTS PASSED");
