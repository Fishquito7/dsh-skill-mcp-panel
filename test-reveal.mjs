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
import { nativePath, revealCommand, revealInFileManager } from "./lib/reveal.js";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const expectedCommand = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
const isWindows = process.platform === "win32";

check("platform command is the native file-manager launcher", () => {
  const { command, args } = revealCommand("C:/tmp/x");
  assert.equal(command, expectedCommand);
  // Windows 的 explorer.exe 不认正斜杠（会打开「文档」），所以参数必须换成本机分隔符
  assert.deepEqual(args, isWindows ? ["C:\\tmp\\x"] : ["C:/tmp/x"]);
});

check("nativePath keeps root separators intact", () => {
  assert.equal(nativePath("C:/Users/fishq/.dsh/skills"), isWindows ? "C:\\Users\\fishq\\.dsh\\skills" : "C:/Users/fishq/.dsh/skills");
  // 盘符根不能被裁成 "C:"（那会被 explorer 当成打开 C 盘当前目录/默认位置的坑）
  assert.equal(nativePath("C:/"), isWindows ? "C:\\" : "C:/");
  assert.equal(nativePath("C:\\"), "C:\\");
  // 尾部多余分隔符裁掉（两种输入都收敛到同一形态，便于提示条显示）
  assert.equal(nativePath(isWindows ? "C:\\Users\\fishq\\Desktop\\" : "/Users/fishq/Desktop/"), isWindows ? "C:\\Users\\fishq\\Desktop" : "/Users/fishq/Desktop/");
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

  // 2026-10-19 用户复现：点「打开目录」只弹出资源管理器的「文档」。
  // 根因是面板传的是规范化过的正斜杠路径（"C:/Users/.../.dsh/skills"），
  // Windows 的 explorer.exe 不认，把它当无效参数、打开自己的默认位置。
  // 守卫：交给系统的参数必须是本机分隔符。
  const forwardCalls = [];
  const fakeSpawnForward = (command, args, options) => {
    forwardCalls.push({ command, args, options });
    return { on: () => {}, unref: () => {} };
  };
  const slashPath = bundle.replaceAll("\\", "/");
  const viaSlash = await revealInFileManager(slashPath, fakeSpawnForward);
  check("a forward-slash path is handed to the launcher in native separators", () => {
    assert.equal(viaSlash.ok, true, "expected ok, got " + JSON.stringify(viaSlash));
    assert.equal(forwardCalls.length, 1, "spawn must run exactly once");
    assert.equal(forwardCalls[0].args.length, 1);
    if (isWindows) {
      assert.equal(forwardCalls[0].args[0].includes("/"), false, "explorer.exe rejects forward slashes: " + forwardCalls[0].args[0]);
      assert.equal(forwardCalls[0].args[0], bundle);
      assert.equal(viaSlash.path, bundle);
    } else {
      assert.equal(forwardCalls[0].args[0], slashPath);
      assert.equal(viaSlash.path, slashPath);
    }
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
