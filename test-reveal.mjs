/**
 * 回归守卫：「打开目录」必须真的把资源管理器拉起来（Issue：用户说按钮是假的）。
 *
 * 背景
 *   原来面板只把技能根路径复制到剪贴板——宿主没有对应 RPC。2026-10-19 用户要求
 *   真的弹资源管理器，于是把 spawn 放到宿主侧（src/reveal.ts）。
 *   这里的 spawn 用注入的假实现，断言命令/参数，**不会真的弹窗**。
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { revealCommand, revealInFileManager } from "./lib/reveal.js";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const expectedCommand = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";

check("platform command is the native file-manager launcher", () => {
  const { command, args } = revealCommand("C:/tmp/x");
  assert.equal(command, expectedCommand);
  assert.deepEqual(args, ["C:/tmp/x"]);
});

function check(name, fn) {
  try {
    fn();
    pass(name);
  } catch (error) {
    console.log("FAIL  " + name + "\n      " + (error && error.message ? error.message : error));
    process.exitCode = 1;
  }
}

const root = await mkdtemp(join(tmpdir(), "reveal-test-"));
try {
  const bundle = join(root, "alpha");
  await mkdir(bundle, { recursive: true });
  const flat = join(root, "flat.md");
  await writeFile(flat, "# flat\n", "utf8");

  const calls = [];
  const fakeSpawn = (command, args, options) => {
    calls.push({ command, args, options });
    return { on: () => {}, unref: () => {} };
  };

  const opened = await revealInFileManager(bundle, fakeSpawn);
  check("existing directory is revealed through the platform launcher", () => {
    assert.equal(opened.ok, true, "expected ok, got " + JSON.stringify(opened));
    assert.equal(opened.command, expectedCommand);
    assert.equal(calls.length, 1, "spawn must run exactly once");
    assert.equal(calls[0].command, expectedCommand);
    // 路径作为独立参数传，绝不经 shell 拼接
    assert.deepEqual(calls[0].args, [bundle]);
    assert.equal(calls[0].options.shell, undefined, "must not enable a shell");
    assert.equal(calls[0].options.detached, true, "launcher must be detached");
    assert.equal(calls[0].options.stdio, "ignore");
  });

  // 技能根还没建出来的工作区：先建出来再打开（用户 2026-10-19 要求）
  const missingPath = join(root, "fresh-workspace", ".dsh", "skills");
  const created = await revealInFileManager(missingPath, fakeSpawn);
  const createdStat = await stat(missingPath).catch(() => null);
  check("a missing skill root is created and then revealed", () => {
    assert.equal(created.ok, true, "expected ok, got " + JSON.stringify(created));
    assert.equal(calls.length, 2, "spawn must run once for the created root");
    assert.deepEqual(calls[1].args, [missingPath]);
    assert.equal(createdStat !== null && createdStat.isDirectory(), true, "the skill root must exist now");
  });

  const uncreatable = join(flat, "nested", "skills");
  const failedCreate = await revealInFileManager(uncreatable, fakeSpawn);
  check("a root that cannot be created is reported instead of thrown", () => {
    assert.equal(failedCreate.ok, false);
    assert.match(String(failedCreate.error), /不存在/);
    assert.equal(calls.length, 2, "must not spawn when the directory cannot be created");
  });

  const file = await revealInFileManager(flat, fakeSpawn);
  check("a file is not opened as a directory", () => {
    assert.equal(file.ok, false);
    assert.match(String(file.error), /不是目录/);
  });

  const relative = await revealInFileManager("skills/alpha", fakeSpawn);
  check("relative paths are rejected", () => {
    assert.equal(relative.ok, false);
    assert.match(String(relative.error), /绝对路径/);
  });

  const empty = await revealInFileManager("", fakeSpawn);
  check("empty path is rejected", () => {
    assert.equal(empty.ok, false);
    assert.match(String(empty.error), /为空/);
  });

  const throwing = await revealInFileManager(bundle, () => {
    throw new Error("spawn exploded");
  });
  check("a launcher that throws becomes a normal failure result", () => {
    assert.equal(throwing.ok, false);
    assert.match(String(throwing.error), /spawn exploded/);
  });
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("\n" + passed + " passed, 0 failed");
console.log("ALL REVEAL TESTS PASSED");
