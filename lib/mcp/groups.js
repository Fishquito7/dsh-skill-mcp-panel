/**
 * MCP 服务器逻辑分组（Issue #55）。
 *
 * 保存在 `<dshHome>/skills/.system/skill-viewer/mcp-groups.json`，
 * 与技能分组 `groups.json` 并排存放、彼此独立，**绝不写入 `cordis.patch.yml`**，
 * 因此不会干扰宿主的 `@deepseek-ai/dsh-mcp-client` schema 校验与 HMR 调和。
 * 成员按 `serverName` 索引，重命名保留原组前同步或编辑服务器后仍可识别。
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../fs-utils.js";
import { groupsRoot } from "../groups.js";
export function mcpGroupsFile(dshHome) {
    return join(groupsRoot(dshHome), "mcp-groups.json");
}
function uniqueServerNames(raw) {
    if (!Array.isArray(raw))
        return [];
    const seen = new Set();
    const out = [];
    for (const item of raw) {
        if (typeof item !== "string")
            continue;
        const name = item.trim();
        if (name === "" || seen.has(name))
            continue;
        seen.add(name);
        out.push(name);
    }
    return out;
}
export async function loadMcpGroups(dshHome) {
    try {
        const raw = JSON.parse(await readFile(mcpGroupsFile(dshHome), "utf8"));
        if (raw === null || typeof raw !== "object" || raw.groups === null || typeof raw.groups !== "object" || Array.isArray(raw.groups)) {
            return {};
        }
        const result = {};
        for (const [id, entry] of Object.entries(raw.groups)) {
            if (id === "" || entry === null || typeof entry !== "object")
                continue;
            const name = typeof entry.name === "string" ? entry.name.trim() : "";
            if (name === "")
                continue;
            result[id] = { name, servers: uniqueServerNames(entry.servers) };
        }
        return result;
    }
    catch {
        return {};
    }
}
export async function saveMcpGroups(dshHome, groups) {
    const normalized = {};
    for (const [id, entry] of Object.entries(groups)) {
        if (id === "" || entry === null || typeof entry !== "object")
            continue;
        const name = typeof entry.name === "string" ? entry.name.trim() : "";
        if (name === "")
            continue;
        normalized[id] = { name, servers: uniqueServerNames(entry.servers) };
    }
    await writeFileAtomic(mcpGroupsFile(dshHome), JSON.stringify({ version: 1, groups: normalized }, null, 2) + "\n");
}
function makeGroupId(name, existing) {
    const base = name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    const prefix = base !== "" ? base.slice(0, 24) : "mcp-group";
    let candidate = prefix;
    while (existing[candidate] !== undefined) {
        candidate = prefix + "-" + randomUUID().slice(0, 6);
    }
    return candidate;
}
export async function upsertMcpGroup(dshHome, input) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (name === "")
        throw new Error("MCP 分组名称不能为空");
    const groups = await loadMcpGroups(dshHome);
    const id = typeof input.id === "string" && input.id.trim() !== "" ? input.id.trim() : makeGroupId(name, groups);
    const current = groups[id];
    const servers = input.servers !== undefined ? uniqueServerNames(input.servers) : (current?.servers ?? []);
    groups[id] = { name, servers };
    await saveMcpGroups(dshHome, groups);
    return { id, groups };
}
export async function deleteMcpGroup(dshHome, id) {
    const groups = await loadMcpGroups(dshHome);
    if (groups[id] !== undefined) {
        delete groups[id];
        await saveMcpGroups(dshHome, groups);
    }
    return groups;
}
