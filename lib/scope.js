/**
 * dsh-skill-viewer —— 作用域布局 + 迁移引擎（实体模型）。
 *
 * 自 0.3.0 起插件不再有中心仓库和联接点：技能实体直接存放在其作用域的
 * 技能文件夹里——
 *
 *   - 全局：    <dshHome>/skills/<name>/SKILL.md   （或 <file>.md）
 *   - 工作区：  <workspaceProjectRoot>/.dsh/skills/<name>/SKILL.md
 *
 * 会话看到什么，完全等于提供方在各根目录里发现了什么——没有需要解释的
 * 隐藏层。改变技能作用域就是一次真实的迁移：把实体复制或移动到目标作用域
 * 文件夹，先校验，中途失败则回滚。
 *
 * 本模块零依赖（仅 node:fs / node:path / node:os）。
 */
import { cp, mkdir, rename, rm, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { findProjectRoot, pathExists } from "./skill-files.js";
/** 某工作区项目根对应的技能文件夹。 */
export function workspaceSkillRoot(projectRoot) {
    return join(projectRoot, ".dsh", "skills");
}
/**
 * 作用域目标对应的目标技能文件夹：
 *   null    → 全局用户根（<dshHome>/skills）
 *   路径    → <projectRoot>/.dsh/skills
 */
export function scopeRootOf(target, dshHome) {
    return target === null || target === undefined ? join(dshHome, "skills") : workspaceSkillRoot(target);
}
/**
 * 把一组原始工作区路径归一化为互不相同的项目根路径。
 * 每个路径必须存在，并解析到最近的 `.git` 祖先（没有则退回路径本身），
 * 因为提供方只在那里找 `<projectRoot>/.dsh/skills`。Windows 上大小写
 * 不敏感去重。
 */
export async function normalizeWorkspaces(paths) {
    const seen = new Set();
    const result = [];
    for (const raw of paths) {
        if (typeof raw !== "string" || raw.trim() === "")
            continue;
        const absolute = resolve(raw.trim());
        const info = await stat(absolute).catch(() => undefined);
        if (info === undefined || !info.isDirectory())
            throw new Error('工作区不存在或不是目录："' + raw + '"');
        const project = await findProjectRoot(absolute);
        const key = process.platform === "win32" ? project.toLowerCase() : project;
        if (seen.has(key))
            continue;
        seen.add(key);
        result.push(project);
    }
    return result;
}
/** 归一化单个工作区路径（一个都解析不出来时抛错）。 */
export async function normalizeWorkspace(raw) {
    const list = await normalizeWorkspaces([raw]);
    if (list.length === 0)
        throw new Error("至少需要指定一个存在的工作区");
    return list[0];
}
/**
 * 读取 DSH 自己的工作区注册表（<dshHome>/storages/workspace.json），
 * 返回「项目根路径 → 工作区名称（title）」的映射。
 *
 * DSH 的工作区名称与文件夹名是分开的：在工作区设置里改名只改 title，
 * 不会重命名文件夹，所以显示名称必须取 title 而不是文件夹名。
 * 注册表缺失/损坏时返回空 Map，调用方回退文件夹名。
 */
export async function workspaceTitleMap(dshHome) {
    const map = new Map();
    try {
        const raw = readFileSync(join(dshHome, "storages", "workspace.json"), "utf8");
        const data = JSON.parse(raw);
        const rows = data !== null && typeof data === "object" ? data.tables?.workspaces : undefined;
        if (rows === undefined || rows === null || typeof rows !== "object")
            return map;
        for (const row of Object.values(rows)) {
            if (row === null || typeof row !== "object")
                continue;
            const path = row.path;
            const title = row.title;
            if (typeof path !== "string" || path === "" || typeof title !== "string" || title === "")
                continue;
            const project = await findProjectRoot(resolve(path));
            const key = process.platform === "win32" ? project.toLowerCase() : project;
            map.set(key, title);
        }
    }
    catch {
        // 注册表不可用：调用方回退文件夹名
    }
    return map;
}
/** Windows 共享冲突 / 权限错误码：稍等片刻可能自行恢复。 */
function isBusyError(error) {
    return error !== null && typeof error === "object" && ["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"].includes(error.code);
}
/** 删除文件或目录；遇到瞬态共享冲突自动重试。 */
async function removeRetry(path) {
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            await rm(path, { recursive: true, force: true });
            return true;
        }
        catch (error) {
            if (!isBusyError(error))
                throw error;
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 300 * (attempt + 1)));
        }
    }
    return false;
}
/**
 * 把单个技能实体（目录束或单文件）从当前位置迁移到 `targetRoot`，
 * 按需复制或移动。
 *
 * 操作顺序：
 *   1. 校验（目标冲突、同位置空操作）——此时尚未写入任何东西
 *   2. 在目标处落地实体（先在 targetRoot 内暂存，再改名就位）——
 *      任何失败都会清掉暂存残留
 *   3. 移动模式下：删除源；若源无法删除，则回滚刚写好的目标副本，
 *      保证不会留下两份
 *
 * @param entry - 技能条目（{ name, file, dirBundle, enabled }）。
 * @param targetRoot - 目标技能文件夹的绝对路径。
 * @param mode - "copy"（保留源）或 "move"（删除源）。
 * @returns 实体的新位置（目录束为目录，单文件为文件）。
 */
export async function migrateEntry(entry, targetRoot, mode) {
    const sourceDir = entry.dirBundle ? dirname(entry.file) : entry.file;
    const target = entry.dirBundle ? join(targetRoot, entry.name) : join(targetRoot, basename(entry.file));
    // ── 校验（尚未写入任何东西）──────────────────────────────────────────
    if (resolve(sourceDir) === resolve(target))
        throw new Error('技能 "' + entry.name + '" 已在此作用域中');
    if (await pathExists(target))
        throw new Error('目标位置已存在同名技能："' + target + '"');
    if (!(await pathExists(sourceDir)))
        throw new Error('技能 "' + entry.name + '" 的源文件不存在：' + sourceDir);
    await mkdir(targetRoot, { recursive: true });
    // ── 移动快路径：同卷改名是原子且廉价的 ─────────────────────────────────
    if (mode === "move") {
        try {
            await rename(sourceDir, target);
            return { target };
        }
        catch (error) {
            if (!["EXDEV", "EBUSY", "EPERM", "EACCES"].includes(error.code))
                throw new Error("移动技能文件失败：" + (error instanceof Error ? error.message : String(error)));
            // 跨卷或被临时占用：转走复制 + 删除路径
        }
    }
    // ── 复制路径：在目标根内暂存，再改名就位 ───────────────────────────────
    const staging = join(targetRoot, ".dsh-skill-staging-" + process.pid + "-" + Math.random().toString(36).slice(2, 8));
    try {
        if (entry.dirBundle) {
            await cp(sourceDir, staging, { recursive: true });
            await rename(staging, target);
        }
        else {
            await mkdir(staging, { recursive: true });
            const stagedFile = join(staging, basename(entry.file));
            await cp(entry.file, stagedFile);
            await rename(stagedFile, target);
            await rm(staging, { recursive: true, force: true }).catch(() => { });
        }
    }
    catch (error) {
        await rm(staging, { recursive: true, force: true }).catch(() => { });
        throw new Error("复制技能文件失败（已回滚）：" + (error instanceof Error ? error.message : String(error)));
    }
    // ── 移动：删除源；删除失败则回滚刚写好的副本 ────────────────────────────
    if (mode === "move") {
        try {
            if (!(await removeRetry(sourceDir)))
                throw new Error("源文件删除超时");
        }
        catch (error) {
            await rm(target, { recursive: true, force: true }).catch(() => { });
            throw new Error('技能 "' + entry.name + '" 已复制到目标，但无法删除源文件（可能被占用），已回滚新副本：' + (error instanceof Error ? error.message : String(error)));
        }
    }
    return { target };
}
/**
 * 依次迁移多个实体。每个条目完全独立：一个失败绝不中止其余，每个条目
 * 要么完整落地、要么回滚到迁移前状态。
 *
 * @param items - 待迁移的技能条目。
 * @param targetRoot - 目标技能文件夹。
 * @param mode - "copy" | "move"。
 * @returns 按输入顺序的逐条结果 [{ name, ok, error? }]。
 */
export async function batchMigrateEntries(items, targetRoot, mode) {
    const results = [];
    for (const item of items) {
        try {
            await migrateEntry(item, targetRoot, mode);
            results.push({ name: item.name, ok: true });
        }
        catch (error) {
            results.push({ name: item.name, ok: false, error: error instanceof Error ? error.message : String(error) });
        }
    }
    return results;
}
