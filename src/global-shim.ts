/**
 * dsh-skill-mcp-panel —— 全局命令 shim 安装。
 *
 * profile 安装只会在 <profile>/node_modules/.bin 生成 dsh-panel，该目录不在
 * 用户 PATH 中。宿主启动时把 shim 写入 npm 全局 bin 目录，使用户能在
 * PowerShell / CMD / bash 中直接调用 `dsh-panel`。
 *
 * Windows 上必须写**三种**：.cmd（CMD）、.ps1（PowerShell）、以及无扩展名的
 * sh 脚本（Git Bash / MSYS2 / Cygwin）。bash 不认 .cmd，只按无扩展名查找，
 * 少一个就是 `dsh-panel: command not found`。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function globalBinDir(): string {
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

function writeIfChanged(path: string, content: string, mode?: number): boolean {
  const old = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  if (old === content) return false;
  writeFileSync(path, content, mode !== undefined ? { mode } : "utf8");
  if (mode !== undefined) chmodSync(path, mode);
  return true;
}

/** sh 单引号转义：反斜杠在单引号里是字面量，只有单引号本身需要拼接。 */
export function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

/**
 * bash/sh 入口脚本。
 *
 * 路径用单引号包住（Windows 路径里的反斜杠才不会被 sh 吃掉、空格也安全）；
 * node 先按 PATH 找，找不到再退回安装时那个解释器——Git Bash 里 `node` 一般
 * 就在 PATH 上，但 GUI 启动的宿主进程不一定继承得到。
 * 行尾必须是 LF：带 CR 的脚本在 bash 里会报 `\r: command not found`。
 */
export function posixShimBody(cliPath: string, nodeFallback: string): string {
  return [
    "#!/bin/sh",
    "# dsh-skill-mcp-panel —— bash/sh 入口（macOS / Linux，以及 Windows 上的 Git Bash / MSYS2）",
    'NODE="$(command -v node 2>/dev/null || true)"',
    '[ -n "$NODE" ] || NODE=' + shellQuote(nodeFallback),
    'exec "$NODE" ' + shellQuote(cliPath) + ' "$@"',
    ""
  ].join("\n");
}

/** 需要写入全局 bin 目录的 shim 文件（按平台）。 */
export interface ShimFile {
  name: string;
  content: string;
  mode?: number;
}

export function shimFiles(cliPath: string, nodeFallback: string, platform: string = process.platform): ShimFile[] {
  // 无扩展名那一份在所有平台都要写：macOS / Linux 靠它，Windows 上给 bash 用。
  const posix: ShimFile = { name: "dsh-panel", content: posixShimBody(cliPath, nodeFallback), mode: 0o755 };
  if (platform !== "win32") return [posix];
  return [
    posix,
    { name: "dsh-panel.cmd", content: `@ECHO off\r\nnode "${cliPath}" %*\r\n` },
    { name: "dsh-panel.ps1", content: `node "${cliPath}" @args\r\n` }
  ];
}

export function ensureGlobalShim(logger?: { info(message: string): void }): void {
  try {
    const cliPath = fileURLToPath(new URL("./cli.js", import.meta.url));
    const binDir = globalBinDir();
    mkdirSync(binDir, { recursive: true });
    const written: string[] = [];
    for (const file of shimFiles(cliPath, process.execPath)) {
      if (writeIfChanged(join(binDir, file.name), file.content, file.mode)) written.push(file.name);
    }
    const message = written.length > 0
      ? `installed global dsh-panel shim at ${binDir} (${written.join(", ")})`
      : `global dsh-panel shim already up to date at ${binDir}`;
    if (logger !== undefined) logger.info("[dsh-skill-mcp-panel] " + message);
    else console.log("[dsh-skill-mcp-panel] " + message);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (logger !== undefined) logger.info("[dsh-skill-mcp-panel] unable to install global dsh-panel shim: " + detail);
    else console.warn("[dsh-skill-mcp-panel] unable to install global dsh-panel shim: " + detail);
  }
}
