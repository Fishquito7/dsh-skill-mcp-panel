/**
 * dsh-skill-mcp-panel —— 统一插件更新执行器（CLI update 与面板顶部更新按钮共用，#96）。
 *
 * 解决两个实际故障点：
 *   1. 原 `installTargetForDeclaredSpec` 把 `^2.3.10` / `~2.3.10` / `2.3.10` 等正常 npm
 *      semver 写法错判成 Git 渠道，导致每次更新都切到 github: 而撞上构建授权/网络失败；
 *   2. DSH/pnpm 在切换安装渠道（.tgz / Git tag / file: ↔ npm）、lockfile 冲突或命中
 *      minimum-release-age 时，直接 `dsh plugin add` 常报错要求用户「先卸载再重装」（Issue #96）。
 *      这里在直接 `add` 失败时自动执行 `remove` + `add` 恢复（必要时回退 GitHub Release .tgz），
 *      并在成功后保证 `dsh.profile.bundles` 保留挂载。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { writeFileAtomic } from "./fs-utils.js";
import { INSTALL_SPEC, PACKAGE_NAME, REPO_SLUG } from "./version.js";
import {
  electronBlockedMessage,
  readProfile,
  resolveDshCommand,
  type ProfileInfo
} from "./profiles.js";

export type UpdateChannel = "npm" | "tarball" | "github";

const SEMVER_OR_TAG_RE = /^(?:npm:|[*]|latest$|next$|alpha$|beta$|rc$|[\^~>=<]|v?\d+\.\d+(?:\.\d+)?(?:[-+].*)?$)/i;

/**
 * 按原本的安装渠道（或显式指定 channel）构造更新目标 spec。
 *   https://…                         → Release .tgz URL
 *   npm 包名 / npm@ / semver range    → `dsh-skill-mcp-panel@<version>`
 *   github: / git+ / file: / 未声明    → `github:Fishquito7/dsh-skill-mcp-panel#v<version>`
 */
export function installTargetForDeclaredSpec(
  spec: string | null | undefined,
  version: string,
  channel?: UpdateChannel
): string {
  if (channel === "npm") return PACKAGE_NAME + "@" + version;
  if (channel === "tarball") {
    return "https://github.com/" + REPO_SLUG + "/releases/download/v" + version + "/" + PACKAGE_NAME + "-" + version + ".tgz";
  }
  if (channel === "github") return INSTALL_SPEC + "#v" + version;
  const value = typeof spec === "string" ? spec.trim() : "";
  if (/^https?:\/\//i.test(value)) {
    return "https://github.com/" + REPO_SLUG + "/releases/download/v" + version + "/" + PACKAGE_NAME + "-" + version + ".tgz";
  }
  if (value === PACKAGE_NAME || value.startsWith(PACKAGE_NAME + "@") || SEMVER_OR_TAG_RE.test(value)) {
    return PACKAGE_NAME + "@" + version;
  }
  return INSTALL_SPEC + "#v" + version;
}

function winCmdQuote(arg: string): string {
  if (arg === "") return '""';
  return /[\s"^&|<>()%]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}

export function spawnDshPlugin(
  args: string[],
  options: { cwd: string; streamOutput: boolean; env?: NodeJS.ProcessEnv }
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const env = options.env ?? process.env;
    const cmdRaw = resolveDshCommand(env) ?? "dsh";
    const isWinBatch = process.platform === "win32" && /\.(?:cmd|bat)$/i.test(cmdRaw);
    const spawnCmd = isWinBatch ? (env.ComSpec ?? "cmd.exe") : cmdRaw;
    const spawnArgs = isWinBatch
      ? ["/d", "/s", "/c", `"${[winCmdQuote(cmdRaw), ...args.map(winCmdQuote)].join(" ")}"`]
      : args;
    let output = "";
    const append = (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      output += text;
      if (output.length > 32768) output = output.slice(-32768);
    };
    const child = spawn(spawnCmd, spawnArgs, {
      cwd: options.cwd,
      env,
      shell: false,
      windowsVerbatimArguments: isWinBatch,
      windowsHide: !options.streamOutput,
      stdio: [options.streamOutput ? "inherit" : "ignore", "pipe", "pipe"]
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      if (options.streamOutput) process.stdout.write(chunk);
      append(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (options.streamOutput) process.stderr.write(chunk);
      append(chunk);
    });
    child.on("error", (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      append(msg);
      resolve({ code: 127, output });
    });
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

async function ensureMountedInBundles(profileDir: string): Promise<void> {
  const pkgPath = join(profileDir, "package.json");
  try {
    const manifest: any = JSON.parse(readFileSync(pkgPath, "utf8"));
    const bundles = manifest?.dsh?.profile?.bundles;
    if (!Array.isArray(bundles) || bundles.includes(PACKAGE_NAME)) return;
    if (manifest?.dependencies?.[PACKAGE_NAME] === undefined) return;
    manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: [...bundles, PACKAGE_NAME] } };
    await writeFileAtomic(pkgPath, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
  } catch {
    // package.json 不可读时不崩溃
  }
}

function summarizeErrorOutput(output: string, code: number): string {
  const lines = String(output ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return "退出码 " + code;
  const interesting = lines.filter((line) => /ERR_|error|failed|rejected|refused|ENOENT/i.test(line));
  const picked = (interesting.length > 0 ? interesting : lines).slice(-3).join(" | ");
  return picked.length > 260 ? picked.slice(-260) : picked;
}

export interface ProfileUpdateResult {
  ok: boolean;
  code: number;
  after: string | null;
  retriedWithRemove: boolean;
  fallbackUsed?: string;
  electronBlocked?: boolean;
  error?: string;
}

export async function updateProfilePlugin(options: {
  profile: ProfileInfo;
  spec: string;
  latestVersion?: string;
  streamOutput?: boolean;
  env?: NodeJS.ProcessEnv;
  dshHome?: string;
  log?: (message: string) => void;
}): Promise<ProfileUpdateResult> {
  const { profile, spec, latestVersion, streamOutput = false, env, dshHome, log } = options;
  const cwd = existsSync(profile.dir) ? profile.dir : process.cwd();
  const wasMounted = profile.mountsPanel;

  const first = await spawnDshPlugin(["plugin", "--profile", profile.name, "add", spec], { cwd, streamOutput, env });
  if (first.code === 0) {
    if (wasMounted) await ensureMountedInBundles(profile.dir);
    return {
      ok: true,
      code: 0,
      after: readProfile(profile.name, dshHome)?.installedVersion ?? null,
      retriedWithRemove: false
    };
  }
  if (/managed exclusively by the Electron application/i.test(first.output)) {
    return {
      ok: false,
      code: first.code,
      after: readProfile(profile.name, dshHome)?.installedVersion ?? null,
      retriedWithRemove: false,
      electronBlocked: true,
      error: electronBlockedMessage(profile.name)
    };
  }
  if (first.code === 127) {
    return {
      ok: false,
      code: 127,
      after: readProfile(profile.name, dshHome)?.installedVersion ?? null,
      retriedWithRemove: false,
      error: "找不到 dsh 命令，请确认已安装 DeepSeek Harness 或将 dsh 加入 PATH。"
    };
  }

  // 直接升级失败：常见于切换安装渠道（.tgz / github: ↔ npm）、lockfile 或 pnpm 缓存冲突，
  // 自动执行「卸载旧版本 → 重装新版本」，免去用户手动卸载重装（Issue #96）。
  log?.("[" + profile.name + "] 直接覆盖升级失败，自动卸载旧版本并重新安装…");
  await spawnDshPlugin(["plugin", "--profile", profile.name, "remove", PACKAGE_NAME], { cwd, streamOutput, env });
  let retry = await spawnDshPlugin(["plugin", "--profile", profile.name, "add", spec], { cwd, streamOutput, env });
  let fallbackUsed: string | undefined;

  if (retry.code !== 0 && spec.startsWith(PACKAGE_NAME + "@") && latestVersion !== undefined) {
    // npm 包发布不久常触发 pnpm minimum-release-age 限制：回退官方 GitHub Release .tgz 直装。
    const tarballSpec = installTargetForDeclaredSpec("https://", latestVersion, "tarball");
    log?.("[" + profile.name + "] npm 渠道安装受阻，尝试回退 Release tarball：" + tarballSpec);
    retry = await spawnDshPlugin(["plugin", "--profile", profile.name, "add", tarballSpec], { cwd, streamOutput, env });
    fallbackUsed = "tarball";
  }

  if (retry.code === 0) {
    if (wasMounted) await ensureMountedInBundles(profile.dir);
    return {
      ok: true,
      code: 0,
      after: readProfile(profile.name, dshHome)?.installedVersion ?? null,
      retriedWithRemove: true,
      ...(fallbackUsed === undefined ? {} : { fallbackUsed })
    };
  }

  return {
    ok: false,
    code: retry.code,
    after: readProfile(profile.name, dshHome)?.installedVersion ?? null,
    retriedWithRemove: true,
    ...(fallbackUsed === undefined ? {} : { fallbackUsed }),
    error: summarizeErrorOutput(retry.output, retry.code)
  };
}
