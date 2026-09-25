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
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { PACKAGE_NAME } from "./version.js";
/** Electron 桌面应用独占的 profile 名（比较时忽略大小写）。 */
export const ELECTRON_PROFILE = "desktop";
/** 与 dsh 的 resolveProfileDir 同名的保留字（它会拒绝这些名字）。 */
const RESERVED_NAMES = new Set(["", ".", "..", "node_modules"]);
/** profile 校验失败。CLI 捕获它并返回退出码 2（用法错误），不打堆栈。 */
export class ProfileError extends Error {
    constructor(message) {
        super(message);
        this.name = "ProfileError";
    }
}
function readJson(path) {
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    }
    catch {
        return undefined;
    }
}
/** `$DSH_HOME/profiles`。 */
export function profilesRoot(home) {
    return join(home !== undefined && home !== "" ? home : resolveDshHome(), "profiles");
}
/** 名字本身是否合法（与 dsh 的 resolveProfileDir 同名规则一致）。 */
export function isValidProfileName(name) {
    if (typeof name !== "string")
        return false;
    if (RESERVED_NAMES.has(name))
        return false;
    if (name.includes("/") || name.includes("\\"))
        return false;
    return true;
}
function profileInfo(name, home) {
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
export function profileNames(home) {
    const root = profilesRoot(home);
    let entries;
    try {
        entries = readdirSync(root, { withFileTypes: true });
    }
    catch {
        return [];
    }
    const names = [];
    for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink())
            continue;
        if (!isValidProfileName(entry.name))
            continue;
        if (!existsSync(join(root, entry.name, "package.json")))
            continue;
        names.push(entry.name);
    }
    return names.sort();
}
/** 列出全部已存在的 profile。 */
export function listProfiles(home) {
    return profileNames(home).map((name) => profileInfo(name, home));
}
/** 读一个 profile；不存在或名字非法返回 undefined。 */
export function readProfile(name, home) {
    if (!isValidProfileName(name))
        return undefined;
    if (!existsSync(join(profilesRoot(home), name, "package.json")))
        return undefined;
    return profileInfo(name, home);
}
/** 可读的有效 profile 清单，用于报错信息。 */
export function knownProfileList(home) {
    const known = profileNames(home);
    return known.length === 0 ? "（$DSH_HOME/profiles 下还没有任何 profile）" : known.join("、");
}
/**
 * 取一个必须存在的 profile；不存在就抛 ProfileError。
 * 调用方必须在派发 pnpm / dsh plugin 之前调用它——否则 dsh 会新建 profile。
 */
export function requireProfile(name, home) {
    if (!isValidProfileName(name)) {
        throw new ProfileError('非法的 profile 名 "' + name + '"（不能为空、不能含路径分隔符）。有效：' + knownProfileList(home));
    }
    const found = readProfile(name, home);
    if (found !== undefined)
        return found;
    throw new ProfileError('profile "' + name + '" 不存在（有效：' + knownProfileList(home) + '）。本命令只操作已存在的 profile，绝不新建——要新建请用 dsh --from-default-profile <模板>。');
}
/** Electron 独占 profile 的准确说明（dsh plugin 会拒绝它，不是本插件的限制）。 */
export function electronBlockedMessage(name) {
    return 'profile "' + name + '" 由 DSH 桌面应用独占：dsh CLI 的 `dsh plugin --profile ' + name + '` 会被 rejectElectronProfile 拒绝（"profile \"' + name + '\" is managed exclusively by the Electron application"）。请在桌面应用的插件管理面板里操作，或改用 --profile 指向其它 profile。';
}
