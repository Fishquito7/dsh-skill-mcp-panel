// 在用户级 bin 目录创建 dsh-panel 命令 shim。
// 包安装到 DSH profile 后，profile/node_modules/.bin 不会自动进入用户 PATH，
// 因此 postinstall 显式写入 npm 全局 bin 目录，使 PowerShell / CMD / bash 都能
// 直接调用 dsh-panel。
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../lib/cli.js", import.meta.url));

function globalBinDir() {
  if (process.platform === "win32") {
    const base = process.env.APPDATA || join(process.env.USERPROFILE ?? ".", "AppData", "Roaming");
    return join(base, "npm");
  }
  try {
    return execFileSync("npm", ["prefix", "-g"], { encoding: "utf8", windowsHide: true }).trim();
  } catch {
    return "/usr/local/bin";
  }
}

function writeIfChanged(path, content, mode) {
  const old = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  if (old === content) return false;
  writeFileSync(path, content, mode !== undefined ? { mode } : "utf8");
  if (mode !== undefined) chmodSync(path, mode);
  return true;
}

const binDir = globalBinDir();
mkdirSync(binDir, { recursive: true });

let changed = false;
if (process.platform === "win32") {
  const cmd = `@ECHO off\r\nnode "${cliPath}" %*\r\n`;
  const ps1 = `node "${cliPath}" @args\r\n`;
  changed = writeIfChanged(join(binDir, "dsh-panel.cmd"), cmd) || changed;
  changed = writeIfChanged(join(binDir, "dsh-panel.ps1"), ps1) || changed;
} else {
  const sh = `#!/bin/sh\nexec node "${cliPath}" "$@"\n`;
  changed = writeIfChanged(join(binDir, "dsh-panel"), sh, 0o755) || changed;
}
if (changed) {
  console.log(`[dsh-skill-mcp-panel] installed global shim: ${join(binDir, "dsh-panel")}`);
} else {
  console.log(`[dsh-skill-mcp-panel] global shim already up to date: ${join(binDir, "dsh-panel")}`);
}
