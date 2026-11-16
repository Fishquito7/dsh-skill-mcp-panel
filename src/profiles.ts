/**
 * dsh-skill-mcp-panel —— profile 发现与校验（CLI 专用）。
 *
 * DSH 的 profile 就是 `$DSH_HOME/profiles/<name>` 下的一个目录，以其中的
 * package.json 作为「这个 profile 存在」的判据。CLI 必须自己先把名字校验掉，
 * 因为 `dsh plugin --profile <错名>` 会安静地 initProfile 出一个新 profile
 * （dsh-plugin-manager/lib/types/operations.js 的 runPluginCommand），
 * 而不是报错——打错一个字就会多出一个 profile 目录。
 *
 * 另外两个必须在这里处理的事实：
 *   - `desktop` 由 Electron 应用独占。dsh CLI 的 `dsh plugin --profile desktop`
 *     会被 rejectElectronProfile 直接拒绝（dsh/lib/bin.js 的 rejectElectronProfile），
 *     所以本模块把它标成 electronOwned，由调用方决定是拦截还是跳过。
 *   - `dsh plugin add` 只改 package.json 的 dependencies，不会把包挂进
 *     `dsh.profile.bundles`。装了但没进 bundle 列表的 profile 依然不会加载本插件，
 *     所以 mountsPanel 需要单独读出来提示。
 *
 * 本模块只读文件系统，绝不创建任何 profile。
 */
import { existsSync, openSync, readFileSync, readSync, closeSync, readdirSync, statSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { resolveDshHome } from "./host-paths.js";
import { PACKAGE_NAME } from "./version.js";

/** Electron 桌面应用独占的 profile 名（比较时忽略大小写）。 */
export const ELECTRON_PROFILE = "desktop";

/** 与 dsh 的 resolveProfileDir 同名的保留字（它会拒绝这些名字）。 */
const RESERVED_NAMES = new Set(["", ".", "..", "node_modules"]);

/** profile 校验失败。CLI 捕获它并返回退出码 2（用法错误），不打堆栈。 */
export class ProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileError";
  }
}

export interface ProfileInfo {
  name: string;
  dir: string;
  /** package.json 里声明的安装 spec；没声明是 null。 */
  spec: string | null;
  /** node_modules 里已装的版本；没装是 null。 */
  installedVersion: string | null;
  /** 是否已经在 dsh.profile.bundles 里挂载（决定这个 profile 是否真的会加载本插件）。 */
  mountsPanel: boolean;
  /** 是否由 Electron 应用独占（dsh plugin 会拒绝管理它）。 */
  electronOwned: boolean;
}

function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/** `$DSH_HOME/profiles`。 */
export function profilesRoot(home?: string): string {
  return join(home !== undefined && home !== "" ? home : resolveDshHome(), "profiles");
}

/** 名字本身是否合法（与 dsh 的 resolveProfileDir 同名规则一致）。 */
export function isValidProfileName(name: unknown): boolean {
  if (typeof name !== "string") return false;
  if (RESERVED_NAMES.has(name)) return false;
  if (name.includes("/") || name.includes("\\")) return false;
  return true;
}

function profileInfo(name: string, home?: string): ProfileInfo {
  const dir = join(profilesRoot(home), name);
  const manifest = readJson(join(dir, "package.json"));
  const declared = { ...(manifest?.dependencies ?? {}), ...(manifest?.devDependencies ?? {}) };
  const spec = typeof declared[PACKAGE_NAME] === "string" ? declared[PACKAGE_NAME] : null;
  const installed = readJson(join(dir, "node_modules", PACKAGE_NAME, "package.json"));
  const bundles = manifest?.dsh?.profile?.bundles;
  return {
    name,
    dir,
    spec,
    installedVersion: typeof installed?.version === "string" ? installed.version : null,
    mountsPanel: Array.isArray(bundles) && bundles.includes(PACKAGE_NAME),
    electronOwned: name.toLowerCase() === ELECTRON_PROFILE
  };
}

/** 已存在的 profile 名（有 package.json 的目录），按字典序。 */
export function profileNames(home?: string): string[] {
  const root = profilesRoot(home);
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (!isValidProfileName(entry.name)) continue;
    if (!existsSync(join(root, entry.name, "package.json"))) continue;
    names.push(entry.name);
  }
  return names.sort();
}

/** 列出全部已存在的 profile。 */
export function listProfiles(home?: string): ProfileInfo[] {
  return profileNames(home).map((name) => profileInfo(name, home));
}

/** 读一个 profile；不存在或名字非法返回 undefined。 */
export function readProfile(name: string, home?: string): ProfileInfo | undefined {
  if (!isValidProfileName(name)) return undefined;
  if (!existsSync(join(profilesRoot(home), name, "package.json"))) return undefined;
  return profileInfo(name, home);
}

/** 可读的有效 profile 清单，用于报错信息。 */
export function knownProfileList(home?: string): string {
  const known = profileNames(home);
  return known.length === 0 ? "（$DSH_HOME/profiles 下还没有任何 profile）" : known.join("、");
}

/**
 * 取一个必须存在的 profile；不存在就抛 ProfileError。
 * 调用方必须在派发 pnpm / dsh plugin 之前调用它——否则 dsh 会新建 profile。
 */
export function requireProfile(name: string, home?: string): ProfileInfo {
  if (!isValidProfileName(name)) {
    throw new ProfileError('非法的 profile 名 "' + name + '"（不能为空、不能含路径分隔符）。有效：' + knownProfileList(home));
  }
  const found = readProfile(name, home);
  if (found !== undefined) return found;
  throw new ProfileError('profile "' + name + '" 不存在（有效：' + knownProfileList(home) + '）。本命令只操作已存在的 profile，绝不新建——要新建请用 dsh --from-default-profile <模板>。');
}

/** Electron 独占 profile 的准确说明（dsh plugin 会拒绝它，不是本插件的限制）。 */
export function electronBlockedMessage(name: string): string {
  return 'profile "' + name + '" 由 DSH 桌面应用独占：dsh CLI 的 `dsh plugin --profile ' + name + '` 会被 rejectElectronProfile 拒绝（"profile \"' + name + '\" is managed exclusively by the Electron application"）。请在桌面应用的插件管理面板里操作，或改用 Electron 内置的 dsh CLI / 指向其它 profile。';
}

function isFileExecutable(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** 查找可用 dsh 可执行文件路径（先查 PATH，再查桌面端默认随包运行时）。 */
export function resolveDshCommand(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const names = process.platform === "win32" ? ["dsh.cmd", "dsh.exe", "dsh.bat", "dsh"] : ["dsh"];
  const rawPath = env.PATH ?? env.Path ?? "";
  for (const dir of rawPath.split(delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = join(dir, name);
      if (isFileExecutable(candidate)) return candidate;
    }
  }
  const desktopCandidates: string[] = [];
  if (process.platform === "win32") {
    const execDir = dirname(process.execPath);
    desktopCandidates.push(join(execDir, "resources", "runtime", "cli", "bin", "dsh.cmd"));
    if (env.LOCALAPPDATA) desktopCandidates.push(join(env.LOCALAPPDATA, "Programs", "DeepSeek Harness", "resources", "runtime", "cli", "bin", "dsh.cmd"));
    desktopCandidates.push("D:\\DeepSeek Harness\\resources\\runtime\\cli\\bin\\dsh.cmd");
    desktopCandidates.push("C:\\Program Files\\DeepSeek Harness\\resources\\runtime\\cli\\bin\\dsh.cmd");
  } else {
    const execDir = dirname(process.execPath);
    desktopCandidates.push(join(execDir, "..", "Resources", "runtime", "cli", "bin", "dsh"));
    desktopCandidates.push(join(execDir, "resources", "runtime", "cli", "bin", "dsh"));
  }
  for (const candidate of desktopCandidates) {
    if (isFileExecutable(candidate)) return candidate;
  }
  return undefined;
}

/** 判断当前生效的 `dsh` 命令是否支持直接管理 `desktop` profile（DSH 0.2.2+ 桌面端自带 CLI 开启了 manageDesktopProfile）。 */
export function supportsDesktopCli(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.DSH_ALLOW_DESKTOP_PLUGIN === "1") return true;
  if (env.DSH_ALLOW_DESKTOP_PLUGIN === "0") return false;
  const cmd = resolveDshCommand(env);
  if (cmd === undefined) return false;
  if (/deepseek harness/i.test(cmd)) return true;
  try {
    const fd = openSync(cmd, "r");
    try {
      const buf = Buffer.alloc(4096);
      const read = readSync(fd, buf, 0, buf.length, 0);
      const head = buf.subarray(0, read).toString("utf8");
      if (/dsh-desktop-host|DeepSeek Harness|manageDesktopProfile/i.test(head)) return true;
    } finally {
      closeSync(fd);
    }
  } catch {
    // binary executable without matching path
  }
  return false;
}
