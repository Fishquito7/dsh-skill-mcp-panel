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

  // #67：手写行也能启停、删除、原文编辑，关→开后文件逐字节还原。
  const hand = [
    "# keep",
    "- id: mcp-memory",
    "  name: '@deepseek-ai/dsh-mcp-client'",
    "  config:",
    "    serverName: memory",
    "    transport: stdio",
    "    command: npx",
    "    maxInstructionBytes: 8000",
    ""
  ].join("\n");
  const patchPath = join(profileDir, "cordis.patch.yml");
  await writeFile(patchPath, hand);
  const listed = run(["mcp", "list", "--profile", "test"]);
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /启用\s+memory/);
  assert.equal(listed.stdout.includes("外部"), false);
  const off = run(["mcp", "disable", "memory", "--profile", "test"]);
  assert.equal(off.status, 0, off.stderr);
  const disabledText = await readFile(patchPath, "utf8");
  assert.match(disabledText, /disabled: true/);
  assert.equal(disabledText.includes("maxInstructionBytes: 8000"), true);
  assert.equal(disabledText.includes("# keep"), true);
  const on = run(["mcp", "enable", "memory", "--profile", "test"]);
  assert.equal(on.status, 0, on.stderr);
  assert.equal(await readFile(patchPath, "utf8"), hand, "enable must restore the hand-written file byte for byte");
  const shown = run(["mcp", "raw", "memory", "--profile", "test"]);
  assert.equal(shown.status, 0, shown.stderr);
  assert.match(shown.stdout, /id: mcp-memory/);
  const rawFile = join(dir, "memory.yml");
  await writeFile(rawFile, shown.stdout.replace("maxInstructionBytes: 8000", "maxInstructionBytes: 4096"));
  const applied = run(["mcp", "raw", "memory", "--profile", "test", "--set", rawFile]);
  assert.equal(applied.status, 0, applied.stderr);
  const afterRaw = await readFile(patchPath, "utf8");
  assert.equal(afterRaw.includes("maxInstructionBytes: 4096"), true);
  assert.equal(afterRaw.startsWith("# keep\n"), true);
  const removedHand = run(["mcp", "remove", "memory", "--yes", "--profile", "test"]);
  assert.equal(removedHand.status, 0, removedHand.stderr);
  const afterHand = await readFile(patchPath, "utf8");
  assert.equal(afterHand.includes("mcp-memory"), false);
  assert.equal(afterHand.startsWith("# keep\n"), true);
  pass("dsh-panel mcp enable/disable/raw/remove operate on hand-written rows");

  // id 后缀和 config.serverName 不一致时，list 印出的名字必须能被 disable 找到。
  const renamed = [
    "- id: panel-mcp-alpha",
    "  name: '@deepseek-ai/dsh-mcp-client'",
    "  config:",
    "    serverName: beta",
    "    transport: stdio",
    "    command: node",
    ""
  ].join("\n");
  await writeFile(patchPath, renamed);
  const listedBeta = run(["mcp", "list", "--profile", "test"]);
  assert.equal(listedBeta.status, 0, listedBeta.stderr);
  assert.match(listedBeta.stdout, /启用\s+beta/);
  assert.equal(/\balpha\b/.test(listedBeta.stdout), false);
  const disableBeta = run(["mcp", "disable", "beta", "--profile", "test"]);
  assert.equal(disableBeta.status, 0, disableBeta.stderr);
  const disabledBeta = await readFile(patchPath, "utf8");
  assert.match(disabledBeta, /disabled: true/);
  assert.equal(disabledBeta.includes("serverName: beta"), true);
  assert.equal(disabledBeta.includes("id: panel-mcp-alpha"), true);
  const disableAlpha = run(["mcp", "disable", "alpha", "--profile", "test"]);
  assert.notEqual(disableAlpha.status, 0);
  pass("dsh-panel mcp resolves serverName from config before the id suffix");

  const jsOff = [
    "- id: mcp-expr",
    "  name: '@deepseek-ai/dsh-mcp-client'",
    "  disabled: !!js process.env.OFF === '1'",
    "  config:",
    "    serverName: exprcli",
    "    transport: stdio",
    "    command: node",
    ""
  ].join("\n");
  await writeFile(patchPath, jsOff);
  const listedJs = run(["mcp", "list", "--profile", "test"]);
  assert.equal(listedJs.status, 0, listedJs.stderr);
  assert.match(listedJs.stdout, /停用\s+exprcli/);
  assert.equal(/启用\s+exprcli/.test(listedJs.stdout), false);
  pass("dsh-panel mcp list does not show a !!js disabled row as enabled");
  // 没有 id 的手写行：能启停，且开关往返逐字节还原
  const noIdPatch = [
    "# hand written",
    "- name: '@deepseek-ai/dsh-mcp-client'",
    "  config:",
    "    serverName: hand",
    "    transport: stdio",
    "    command: node",
    ""
  ].join("\n");
  await writeFile(patchPath, noIdPatch);
  const disableNoId = run(["mcp", "disable", "hand", "--profile", "test"]);
  assert.equal(disableNoId.status, 0, disableNoId.stderr);
  const noIdOff = await readFile(patchPath, "utf8");
  assert.match(noIdOff, /command: node\n {2}disabled: true\n/);
  assert.equal(noIdOff.includes("id:"), false, "不得偷偷补 id");
  const enableNoId = run(["mcp", "enable", "hand", "--profile", "test"]);
  assert.equal(enableNoId.status, 0, enableNoId.stderr);
  assert.equal(await readFile(patchPath, "utf8"), noIdPatch, "没有 id 的行开关往返必须逐字节还原");
  pass("dsh-panel mcp enable/disable works for a row without an id");

  // 重复 serverName：不加 --id 会被拒绝并提示；加 --id 能精确操作某一行；list --ids 能看到 entryId
  const dupPatch = [
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
  await writeFile(patchPath, dupPatch);
  const dupList = run(["mcp", "list", "--ids", "--profile", "test"]);
  assert.equal(dupList.status, 0, dupList.stderr);
  assert.match(dupList.stdout, /same.*mcp-first/);
  assert.match(dupList.stdout, /same.*mcp-second/);
  const dupDisable = run(["mcp", "disable", "same", "--profile", "test"]);
  assert.notEqual(dupDisable.status, 0, "重复 serverName 不带 --id 必须拒绝");
  assert.match(dupDisable.stderr, /--id/);
  const dupDisableOne = run(["mcp", "disable", "same", "--id", "mcp-second", "--profile", "test"]);
  assert.equal(dupDisableOne.status, 0, dupDisableOne.stderr);
  const afterDup = await readFile(patchPath, "utf8");
  const dupParts = afterDup.split("- id: mcp-second");
  assert.equal(dupParts[0].includes("disabled: true"), false, "不能改到另一行");
  assert.equal(dupParts[1].includes("disabled: true"), true, "要改到 --id 指定的那一行");
  pass("dsh-panel mcp --id addresses rows when serverName is duplicated");

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
