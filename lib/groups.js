/**
 * dsh-skill-mcp-panel —— 技能分组的插件私有显示配置。
 *
 * 分组只影响页面上的显示与过滤，绝不改动技能目录内容。配置保存在
 * `<dshHome>/skills/.system/skill-viewer/groups.json`：
 *   - 位于发现服务会跳过的 .system 隐藏区，不会污染技能目录；
 *   - 文件损坏或缺失时一律按空配置处理，最坏情况只是丢失分组。
 *
 * 结构（version 1）：
 *   { "version": 1, "groups": {
 *       "<groupId>": {
 *         "name": "分组名",
 *         "scopes": { "global": ["skillA"], "<工作区路径>": ["skillB"] }
 *       } } }
 *
 * 成员以（作用域, 技能名）二元组计：同一名字的技能可能同时存在于全局与
 * 某个工作区，各自独立归属。
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
/** 分组配置的版本号。 */
export const GROUPS_VERSION = 1;
/** 分组配置所在的隐藏目录。 */
export function groupsRoot(dshHome) {
    return join(dshHome, "skills", ".system", "skill-viewer");
}
/** 分组配置文件的完整路径。 */
export function groupsFile(dshHome) {
    return join(groupsRoot(dshHome), "groups.json");
}
/**
 * 读取分组配置；文件缺失或损坏时返回空配置。
 * @returns { [groupId]: { name: string; scopes: { [scope]: string[] } } }
 */
export async function loadGroups(dshHome) {
    try {
        const parsed = JSON.parse(await readFile(groupsFile(dshHome), "utf8"));
        if (parsed !== null && typeof parsed === "object" && parsed.groups !== null && typeof parsed.groups === "object") {
            const cleaned = {};
            for (const [id, group] of Object.entries(parsed.groups)) {
                if (group === null || typeof group !== "object" || typeof group.name !== "string")
                    continue;
                const scopes = {};
                if (group.scopes !== null && typeof group.scopes === "object") {
                    for (const [scope, names] of Object.entries(group.scopes)) {
                        if (Array.isArray(names))
                            scopes[scope] = names.filter((name) => typeof name === "string");
                    }
                }
                cleaned[id] = { name: group.name, scopes };
            }
            return cleaned;
        }
    }
    catch {
        // 文件缺失或损坏：按空配置处理
    }
    return {};
}
/** 原子写入分组配置（临时文件 + 改名）。 */
export async function saveGroups(dshHome, groups) {
    await mkdir(groupsRoot(dshHome), { recursive: true });
    const target = groupsFile(dshHome);
    const tmp = target + ".tmp-" + process.pid;
    await writeFile(tmp, JSON.stringify({ version: GROUPS_VERSION, groups }, void 0, 2) + "\n", "utf8");
    await rename(tmp, target);
}
/**
 * 查询某技能（作用域 + 名称）所属的分组名列表。
 * @param groups - loadGroups 的结果。
 * @param scope - "global" 或工作区项目根路径。
 * @param name - 技能名。
 */
export function groupsForSkill(groups, scope, name) {
    const result = [];
    for (const [id, group] of Object.entries(groups)) {
        const names = group.scopes?.[scope];
        if (Array.isArray(names) && names.includes(name))
            result.push(group.name);
    }
    return result;
}
/**
 * 新建或更新一个分组：按（作用域）设置成员列表。
 * 分组名不可为空，且（忽略大小写）不可与其它分组重复。
 * @param dshHome - harness 主目录。
 * @param id - 已有分组 id（新建时为 undefined，自动生成）。
 * @param name - 分组名。
 * @param scope - "global" 或工作区项目根路径。
 * @param names - 该作用域下的成员技能名列表。
 * @returns 更新后的分组 id。
 */
export async function upsertGroup(dshHome, id, name, scope, names) {
    const trimmed = (name ?? "").trim();
    if (trimmed === "")
        throw new Error("分组名称不能为空");
    const groups = await loadGroups(dshHome);
    for (const [gid, group] of Object.entries(groups)) {
        if (gid !== id && group.name.toLowerCase() === trimmed.toLowerCase())
            throw new Error('分组名 "' + trimmed + '" 已存在');
    }
    const targetId = id !== undefined && id !== null && id !== "" ? id : "g-" + Math.random().toString(36).slice(2, 10);
    const existing = groups[targetId] ?? { name: trimmed, scopes: {} };
    existing.name = trimmed;
    existing.scopes = { ...(existing.scopes ?? {}) };
    if (names.length === 0)
        delete existing.scopes[scope];
    else
        existing.scopes[scope] = [...names];
    groups[targetId] = existing;
    await saveGroups(dshHome, groups);
    return targetId;
}
/**
 * 删除一个分组；不存在的 id 视为无操作。
 * @returns 是否真的删除了东西。
 */
export async function deleteGroup(dshHome, id) {
    const groups = await loadGroups(dshHome);
    if (groups[id] === undefined)
        return false;
    delete groups[id];
    await saveGroups(dshHome, groups);
    return true;
}
