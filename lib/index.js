import { z } from "zod";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { attachToolFilter, loadToolFilter } from "./tool-filter.js";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import { homedir } from "node:os";
import { resolveDshHome } from "./host-paths.js";
import { strictCodec } from "./codec.js";
import { DISABLED_SUFFIX, collectSkillEntries, findProjectRoot, pathExists, validateFrontmatter, winnerEntry } from "./skill-files.js";
import { classifySkillImport, describeSkips, expandTopLevelZips, normalizeImportPath } from "./skill-import.js";
import { batchMigrateEntries, migrateEntry, normalizeWorkspace, scopeRootOf, workspaceSkillRoot } from "./scope.js";
import { deleteGroup, groupsForSkill, loadGroups, upsertGroup } from "./groups.js";
import { compareVersions, currentVersion, fetchLatestVersion } from "./version.js";
import { McpManagerGateway } from "./mcp/gateway.js";
import { ensureGlobalShim } from "./global-shim.js";
import { MCP_MANIFEST } from "./mcp/wire.js";
import { NestedSkillProvider, NESTED_SKILL_RANK, NESTED_PROVIDER_NAME } from "./provider.js";
/**
 * dsh-skill-mcp-panel —— 宿主半区。
 *
 * 一个 Typert 远程服务（"skillsViewer"），对外暴露技能目录与热管理操作：
 * 启用/停用（*.disabled 改名）、删除、添加（导入目录束或单文件技能）、
 * 以及工作区之间的迁移。
 *
 * 实体模型（0.3.0）：技能文件直接存放在其所属位置的技能文件夹——
 * 全局用户根（~/.dsh/skills）或某工作区的项目根（<workspace>/.dsh/skills）。
 * 没有中心仓库、没有联接点、没有插件私有状态：会话看到什么，完全等于
 * 技能文件系统提供方在各根目录里发现的东西。监听器约 200ms 内热感知
 * 变化，因此以上所有操作都无需重启。
 */
export const name = "dsh-skill-mcp-panel";
export const inject = ["typert", "tools", "loader", "skills", "sessions", "agents"];
// ── wire 模式（zod v4）───────────────────────────────────────────────────
const sessionIdSchema = z.string().optional();
const scopeSchema = z.object({
    kind: z.enum(["global", "workspace"]),
    path: z.string().optional(),
    label: z.string().optional()
});
const skillSummarySchema = z.object({
    name: z.string(),
    description: z.string(),
    whenToUse: z.string().optional(),
    provider: z.string(),
    source: z.string(),
    enabled: z.boolean(),
    modelInvocable: z.boolean(),
    userInvocable: z.boolean(),
    scope: scopeSchema.optional(),
    groups: z.array(z.string()).optional(),
    rel: z.string().optional(),
    pluginProvided: z.boolean()
});
const groupRowSchema = z.object({
    id: z.string(),
    name: z.string(),
    scopes: z.record(z.string(), z.array(z.string()))
});
const groupsResultSchema = z.object({ groups: z.array(groupRowSchema) });
const saveGroupPayloadSchema = z.object({
    id: z.string().optional(),
    name: z.string(),
    scope: z.string().nullable(),
    names: z.array(z.string())
});
const deleteGroupPayloadSchema = z.object({ id: z.string() });
const checkUpdateResultSchema = z.object({
    current: z.string(),
    latest: z.string().nullable(),
    updateAvailable: z.boolean()
});
const listResultSchema = z.object({ skills: z.array(skillSummarySchema) });
const workspacesResultSchema = z.object({
    workspaces: z.array(z.object({ path: z.string(), label: z.string(), sessions: z.number() }))
});
const resourceBaseSchema = z
    .object({
    kind: z.string(),
    path: z.string().optional(),
    url: z.string().optional(),
    description: z.string().optional()
})
    .optional();
const skillContentSchema = z
    .object({
    name: z.string(),
    description: z.string(),
    content: z.string(),
    provider: z.string(),
    whenToUse: z.string().optional(),
    path: z.string().optional(),
    resourceBase: resourceBaseSchema
})
    .nullable();
const setEnabledResultSchema = z.object({ name: z.string(), enabled: z.boolean() });
const deleteSkillResultSchema = z.object({ name: z.string() });
const migratePayloadSchema = z.object({
    target: z.string().nullable(),
    mode: z.enum(["copy", "move"]),
    from: z.string().nullable().optional()
});
const migrateResultSchema = z.object({ name: z.string(), scope: scopeSchema });
const batchMigratePayloadSchema = z.object({
    from: z.string().nullable(),
    targets: z.array(z.string().nullable()).min(1),
    mode: z.enum(["copy", "move"]),
    names: z.array(z.string())
});
const batchMigrateResultSchema = z.object({
    results: z.array(z.object({ name: z.string(), target: z.string().nullable().optional(), ok: z.boolean(), error: z.string().optional() }))
});
const addFileSchema = z.object({ path: z.string(), base64: z.string() });
const addPayloadSchema = z.object({
    /** 面板只发 "auto"：结构完全由宿主的统一分类器判定；旧取值保留兼容。 */
    kind: z.enum(["auto", "bundle", "flat", "zip"]).optional(),
    files: z.array(addFileSchema).min(1),
    workspace: z.string().nullable().optional()
});
const addResultSchema = z.object({
    added: z.array(z.object({ name: z.string(), kind: z.enum(["bundle", "flat"]) })),
    skipped: z.array(z.object({ name: z.string(), reason: z.string() })),
    /** 非阻断提示：跨作用域同名等合法但值得说明的情况。 */
    warnings: z.array(z.object({ name: z.string(), reason: z.string() })),
    scope: scopeSchema
});
/** 注册到 API 网关的类型化 wire 描述符。 */
const MANIFEST = {
    package: "dsh-skill-mcp-panel",
    face: "host",
    schemas: [],
    invocations: [
        {
            id: "dsh-skill-mcp-panel#skillsViewer/list",
            service: "skillsViewer",
            namespace: "skillsViewer",
            method: "list",
            invocation: { kind: "direct" },
            parameters: [
                { name: "sessionId", wire: "sessionId", source: "json", acceptsUndefined: true, codec: strictCodec("dsh-skill-mcp-panel#sessionId", sessionIdSchema) }
            ],
            result: strictCodec("dsh-skill-mcp-panel#SkillListResult", listResultSchema)
        },
        {
            id: "dsh-skill-mcp-panel#skillsViewer/workspaces",
            service: "skillsViewer",
            namespace: "skillsViewer",
            method: "workspaces",
            invocation: { kind: "direct" },
            parameters: [],
            result: strictCodec("dsh-skill-mcp-panel#WorkspacesResult", workspacesResultSchema)
        },
        {
            id: "dsh-skill-mcp-panel#skillsViewer/groups",
            service: "skillsViewer",
            namespace: "skillsViewer",
            method: "groups",
            invocation: { kind: "direct" },
            parameters: [],
            result: strictCodec("dsh-skill-mcp-panel#GroupsResult", groupsResultSchema)
        },
        {
            id: "dsh-skill-mcp-panel#skillsViewer/checkUpdate",
            service: "skillsViewer",
            namespace: "skillsViewer",
            method: "checkUpdate",
            invocation: { kind: "direct" },
            parameters: [],
            result: strictCodec("dsh-skill-mcp-panel#CheckUpdateResult", checkUpdateResultSchema)
        },
        {
            id: "dsh-skill-mcp-panel#skillsViewer/saveGroup",
            service: "skillsViewer",
            namespace: "skillsViewer",
            method: "saveGroup",
            invocation: { kind: "direct" },
            parameters: [
                { name: "payload", wire: "payload", source: "json", codec: strictCodec("dsh-skill-mcp-panel#SaveGroupPayload", saveGroupPayloadSchema) }
            ],
            result: strictCodec("dsh-skill-mcp-panel#GroupsResult", groupsResultSchema)
        },
        {
            id: "dsh-skill-mcp-panel#skillsViewer/deleteGroup",
            service: "skillsViewer",
            namespace: "skillsViewer",
            method: "deleteGroup",
            invocation: { kind: "direct" },
            parameters: [
                { name: "payload", wire: "payload", source: "json", codec: strictCodec("dsh-skill-mcp-panel#DeleteGroupPayload", deleteGroupPayloadSchema) }
            ],
            result: strictCodec("dsh-skill-mcp-panel#GroupsResult", groupsResultSchema)
        },
        {
            id: "dsh-skill-mcp-panel#skillsViewer/content",
            service: "skillsViewer",
            namespace: "skillsViewer",
            method: "content",
            invocation: { kind: "direct" },
            parameters: [
                { name: "name", wire: "name", source: "json", codec: strictCodec("dsh-skill-mcp-panel#SkillName", z.string()) },
                { name: "sessionId", wire: "sessionId", source: "json", acceptsUndefined: true, codec: strictCodec("dsh-skill-mcp-panel#sessionId", sessionIdSchema) },
                { name: "scope", wire: "scope", source: "json", acceptsUndefined: true, codec: strictCodec("dsh-skill-mcp-panel#SkillScope", z.union([z.string(), z.null()])) }
            ],
            result: strictCodec("dsh-skill-mcp-panel#SkillContent", skillContentSchema)
        },
        {
            id: "dsh-skill-mcp-panel#skillsViewer/setEnabled",
            service: "skillsViewer",
            namespace: "skillsViewer",
            method: "setEnabled",
            invocation: { kind: "direct" },
            parameters: [
                { name: "name", wire: "name", source: "json", codec: strictCodec("dsh-skill-mcp-panel#SkillName", z.string()) },
                { name: "sessionId", wire: "sessionId", source: "json", acceptsUndefined: true, codec: strictCodec("dsh-skill-mcp-panel#sessionId", sessionIdSchema) },
                { name: "enabled", wire: "enabled", source: "json", codec: strictCodec("dsh-skill-mcp-panel#EnabledFlag", z.boolean()) },
                { name: "scope", wire: "scope", source: "json", acceptsUndefined: true, codec: strictCodec("dsh-skill-mcp-panel#SkillScope", z.union([z.string(), z.null()])) }
            ],
            result: strictCodec("dsh-skill-mcp-panel#SetEnabledResult", setEnabledResultSchema)
        },
        {
            id: "dsh-skill-mcp-panel#skillsViewer/migrate",
            service: "skillsViewer",
            namespace: "skillsViewer",
            method: "migrate",
            invocation: { kind: "direct" },
            parameters: [
                { name: "name", wire: "name", source: "json", codec: strictCodec("dsh-skill-mcp-panel#SkillName", z.string()) },
                { name: "sessionId", wire: "sessionId", source: "json", acceptsUndefined: true, codec: strictCodec("dsh-skill-mcp-panel#sessionId", sessionIdSchema) },
                { name: "payload", wire: "payload", source: "json", codec: strictCodec("dsh-skill-mcp-panel#MigratePayload", migratePayloadSchema) }
            ],
            result: strictCodec("dsh-skill-mcp-panel#MigrateResult", migrateResultSchema)
        },
        {
            id: "dsh-skill-mcp-panel#skillsViewer/batchMigrate",
            service: "skillsViewer",
            namespace: "skillsViewer",
            method: "batchMigrate",
            invocation: { kind: "direct" },
            parameters: [
                { name: "sessionId", wire: "sessionId", source: "json", acceptsUndefined: true, codec: strictCodec("dsh-skill-mcp-panel#sessionId", sessionIdSchema) },
                { name: "payload", wire: "payload", source: "json", codec: strictCodec("dsh-skill-mcp-panel#BatchMigratePayload", batchMigratePayloadSchema) }
            ],
            result: strictCodec("dsh-skill-mcp-panel#BatchMigrateResult", batchMigrateResultSchema)
        },
        {
            id: "dsh-skill-mcp-panel#skillsViewer/deleteSkill",
            service: "skillsViewer",
            namespace: "skillsViewer",
            method: "deleteSkill",
            invocation: { kind: "direct" },
            parameters: [
                { name: "name", wire: "name", source: "json", codec: strictCodec("dsh-skill-mcp-panel#SkillName", z.string()) },
                { name: "sessionId", wire: "sessionId", source: "json", acceptsUndefined: true, codec: strictCodec("dsh-skill-mcp-panel#sessionId", sessionIdSchema) },
                { name: "scope", wire: "scope", source: "json", acceptsUndefined: true, codec: strictCodec("dsh-skill-mcp-panel#SkillScope", z.union([z.string(), z.null()])) }
            ],
            result: strictCodec("dsh-skill-mcp-panel#DeleteSkillResult", deleteSkillResultSchema)
        },
        {
            id: "dsh-skill-mcp-panel#skillsViewer/addSkill",
            service: "skillsViewer",
            namespace: "skillsViewer",
            method: "addSkill",
            invocation: { kind: "direct" },
            parameters: [
                { name: "sessionId", wire: "sessionId", source: "json", acceptsUndefined: true, codec: strictCodec("dsh-skill-mcp-panel#sessionId", sessionIdSchema) },
                { name: "payload", wire: "payload", source: "json", codec: strictCodec("dsh-skill-mcp-panel#AddPayload", addPayloadSchema) }
            ],
            result: strictCodec("dsh-skill-mcp-panel#AddResult", addResultSchema)
        }
    ],
    model: { services: [], events: [], objects: [] }
};
/**
 * 技能与 MCP 共用同一个 Typert package face：两个 manifest 必须合并注册，
 * 否则 typert 会因 "package face ... is already registered" 拒绝启动。
 *
 * 导出供 test-codec.mjs 做两代 codec 契约的回归校验（运行时遍历全部 invocation）。
 */
export const PANEL_MANIFEST = {
    ...MANIFEST,
    schemas: [...MANIFEST.schemas, ...MCP_MANIFEST.schemas],
    invocations: [...MANIFEST.invocations, ...MCP_MANIFEST.invocations]
};
/** 归一技能 md 文本：去 BOM、CRLF 归一为 LF（yaml 解析对孤立 \r 敏感）。 */
function normalizeSkillText(data) {
    return Buffer.from(data.toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf8");
}
/** 浏览器上传目录束的护栏。 */
const MAX_ADD_FILES = 200;
const MAX_ADD_TOTAL_BYTES = 8 * 1024 * 1024;
/**
 * 远程服务实例。构造它即注册 "skillsViewer" cordis 服务；上面的 manifest
 * 让 API 网关可以分发端点。
 */
export class SkillsViewerGateway extends TypertRemoteService {
    constructor(ctx) {
        super(ctx, "skillsViewer");
    }
    /** 对动态 harness 上下文（sessions/agents/typert）的无类型访问桥。 */
    get C() {
        return this.ctx;
    }
    /**
     * 工作区枚举缓存：一次页面打开会并发触发多次 workspaces()（客户端
     * listWorkspaces + list 内部的 allRoots / workspaceTitles），每次枚举都含
     * stat + findProjectRoot 文件系统探测。3 秒 TTL，同 promise 去重，热操作
     * （新增/迁移技能可能引入新工作区根）后显式失效。
     */
    workspaceCache;
    /** 远程方法：带缓存的已知工作区列表。 */
    workspaces() {
        const now = Date.now();
        if (this.workspaceCache === undefined || now >= this.workspaceCache.expiresAt) {
            this.workspaceCache = { expiresAt: now + 3000, promise: this.enumerateWorkspaces() };
        }
        return this.workspaceCache.promise;
    }
    invalidateWorkspaces() {
        this.workspaceCache = undefined;
    }
    // ── 目录解析（镜像宿主 api-proxy 的 skill.list）────────────────────────
    registryFor(sessionId) {
        const live = sessionId === undefined ? undefined : this.C.agents.get(sessionId);
        if (live !== undefined) {
            const scoped = this.C.get("agentPresets")?.serviceFor(live, "skills");
            if (scoped !== undefined)
                return scoped;
        }
        return this.C.skills;
    }
    viewFor(sessionId) {
        const registry = this.registryFor(sessionId);
        const session = sessionId === undefined ? undefined : this.C.sessions.get(sessionId);
        const scope = sessionId === undefined ? undefined : this.C.agents.get(sessionId);
        return { registry, cwd: session?.header?.cwd, scope };
    }
    homes() {
        return {
            dshHome: resolveDshHome(),
            agentsHome: resolvePath(process.env.DSH_AGENTS_HOME?.trim() ? process.env.DSH_AGENTS_HOME : join(homedir(), ".agents"))
        };
    }
    /** 判断候选路径是否位于某基准目录内。 */
    isWithin(baseDir, candidate) {
        if (typeof candidate !== "string" || candidate === "")
            return false;
        const base = resolvePath(baseDir);
        const value = resolvePath(candidate);
        if (value === base)
            return true;
        const b = process.platform === "win32" ? base.toLowerCase() : base;
        const v = process.platform === "win32" ? value.toLowerCase() : value;
        const sep = process.platform === "win32" ? "\\" : "/";
        return v.startsWith(b.endsWith(sep) ? b : b + sep);
    }
    /**
     * 全部管理根：用户根 + 每个已知工作区的一对项目根。
     * 与 skill-files.ts 的 buildRoots 相似但并非重复：buildRoots 面向 CLI 的
     * 单一 cwd 锚点；这里枚举网关已知的全部工作区。
     */
    async allRoots() {
        const { dshHome, agentsHome } = this.homes();
        const roots = [];
        const seen = new Set();
        const push = (path, source, projectRoot) => {
            const normalized = resolvePath(path);
            const key = process.platform === "win32" ? normalized.toLowerCase() : normalized;
            if (seen.has(key))
                return;
            seen.add(key);
            roots.push({ path, source, projectRoot });
        };
        push(join(dshHome, "skills"), "user-dsh", undefined);
        push(join(agentsHome, "skills"), "user-agents", undefined);
        for (const workspace of (await this.workspaces()).workspaces) {
            push(join(workspace.path, ".dsh", "skills"), "project-dsh", workspace.path);
            push(join(workspace.path, ".agents", "skills"), "project-agents", workspace.path);
        }
        return roots;
    }
    /**
     * 技能是否由插件随包提供（而不是用户根 / 工作区里的技能文件）。
     *
     * 判据是「有没有落在这台机器管理的技能文件夹里」：面板能管、能启停的只有文件技能，
     * 插件自带技能（bundled / 运行时注册）既不在根目录里，也改不动，因此单独打标，
     * 交给前端决定显示还是隐藏。
     */
    isPluginProvided(skill, roots) {
        if (skill.provider === NESTED_PROVIDER_NAME)
            return false;
        if (typeof skill.path === "string" && roots.some((root) => this.isWithin(root.path, skill.path)))
            return false;
        return true;
    }
    /** 用户根与所有已知工作区里的全部文件级条目。 */
    async fileEntriesAll() {
        return collectSkillEntries(await this.allRoots());
    }
    /** 注册表技能路径属于某工作区文件时，其所属的项目根。 */
    workspaceOfPath(path, roots) {
        if (typeof path !== "string" || path === "")
            return undefined;
        for (const root of roots) {
            if (root.projectRoot === undefined)
                continue;
            if (this.isWithin(root.path, path))
                return root.projectRoot;
        }
        return undefined;
    }
    /**
     * 已知工作区标题表：项目根 → 名称（注册表 title，缺省回退文件夹名）。
     * 与 scope.ts 的 workspaceTitleMap 分工不同：那个给 CLI 离线读注册表文件用；
     * 这里走网关在线的 workspaces()，口径与页面工作区横栏一致。
     */
    async workspaceTitles() {
        const map = new Map();
        const keyOf = (path) => process.platform === "win32" ? path.toLowerCase() : path;
        for (const workspace of (await this.workspaces()).workspaces) {
            const project = resolvePath(workspace.path);
            const label = workspace.label && workspace.label !== "" ? workspace.label : (basename(project) || project);
            map.set(keyOf(project), label);
        }
        return { map, keyOf };
    }
    /** 条目所属位置标签：优先用 DSH 的工作区名称，取不到回退文件夹名。 */
    async scopeForEntry(entry, titles) {
        if (entry.projectRoot !== undefined) {
            const cache = titles ?? await this.workspaceTitles();
            const project = resolvePath(entry.projectRoot);
            const label = cache.map.get(cache.keyOf(project));
            return { kind: "workspace", path: entry.projectRoot, label: label ?? (basename(entry.projectRoot) || entry.projectRoot) };
        }
        return { kind: "global" };
    }
    /** 目标位置标签：优先用 DSH 的工作区名称，取不到回退文件夹名。 */
    async scopeForTarget(targetRoot, targetProject, titles) {
        const { dshHome } = this.homes();
        if (resolvePath(targetRoot) === resolvePath(join(dshHome, "skills")))
            return { kind: "global" };
        const cache = titles ?? await this.workspaceTitles();
        const project = resolvePath(targetProject);
        const label = cache.map.get(cache.keyOf(project));
        return { kind: "workspace", path: targetProject, label: label ?? (basename(targetProject) || targetProject) };
    }
    // ── 远程方法 ─────────────────────────────────────────────────────────────
    /** 目录：注册表技能（全局）+ 按所属位置打标的每条文件条目。 */
    async list(sessionId) {
        const { registry, cwd, scope } = this.viewFor(sessionId);
        const home = this.homes().dshHome;
        // 并行取三份互不依赖的数据：工作区枚举（含文件系统探测）、会话注册表
        // 列表（通常最慢：要读大量 SKILL.md 与分析 frontmatter）、分组配置。
        const [roots, listed, groupMap] = await Promise.all([
            this.allRoots(),
            registry.list({ cwd, scope }),
            loadGroups(home)
        ]);
        const fileEntries = await collectSkillEntries(roots);
        // 嵌套技能的分类信息（rel）来自文件扫描：注册表 list() 的摘要会剥掉
        // 候选上的 rel（toSummary 只投影固定字段），这里按（名称, 作用域）回填。
        const relByKey = new Map();
        for (const entry of fileEntries) {
            relByKey.set(entry.name + "\u0000" + (entry.projectRoot ?? "global"), entry.rel ?? "");
        }
        const skills = [];
        // 按（名称, 位置）去重——不能只按名称：同一技能可能同时存在于全局
        // 和某个工作区，两行都必须出现在各自的工作区芯片下。
        const seen = new Set();
        const seenKey = (name, scopePath) => name + "\u0000" + (scopePath ?? "global");
        for (const skill of listed) {
            // 工作区文件技能由下面的文件扫描兜底；注册表行只反映当前会话的
            // 项目视图。
            if (this.workspaceOfPath(skill.path, roots) !== undefined)
                continue;
            const source = skill.source ?? (skill.provider === "runtime" ? "runtime" : "");
            skills.push({
                name: skill.name,
                description: skill.description,
                ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
                provider: skill.provider,
                source,
                enabled: true,
                modelInvocable: skill.invocation.modelInvocable,
                userInvocable: skill.invocation.userInvocable,
                scope: { kind: "global" },
                groups: groupsForSkill(groupMap, "global", skill.name),
                pluginProvided: this.isPluginProvided(skill, roots),
                ...(relByKey.get(skill.name + "\u0000global") ? { rel: relByKey.get(skill.name + "\u0000global") } : {})
            });
            seen.add(seenKey(skill.name, "global"));
        }
        const titles = await this.workspaceTitles();
        for (const entry of fileEntries) {
            const scopePath = entry.projectRoot ?? "global";
            if (seen.has(seenKey(entry.name, scopePath)))
                continue;
            seen.add(seenKey(entry.name, scopePath));
            skills.push({
                name: entry.name,
                description: entry.description,
                ...(entry.whenToUse === undefined ? {} : { whenToUse: entry.whenToUse }),
                provider: "filesystem",
                source: entry.source,
                enabled: entry.enabled,
                modelInvocable: false,
                userInvocable: false,
                scope: await this.scopeForEntry(entry, titles),
                groups: groupsForSkill(groupMap, scopePath, entry.name),
                pluginProvided: false,
                ...(entry.rel ? { rel: entry.rel } : {})
            });
        }
        return { skills };
    }
    /** 分组列表（按名称排序）。 */
    async groups() {
        return { groups: this.groupRows(await loadGroups(this.homes().dshHome)) };
    }
    /** 检查插件是否有新版本（对比 GitHub Release 最新版）。 */
    async checkUpdate() {
        const current = currentVersion();
        const latest = await fetchLatestVersion();
        if (latest === undefined)
            return { current, latest: null, updateAvailable: false };
        return { current, latest, updateAvailable: compareVersions(latest, current) > 0 };
    }
    /** 新建或更新分组（设置某工作区下的成员列表）。 */
    async saveGroup(payload) {
        const { id, name, scope: rawScope, names } = payload;
        const { dshHome } = this.homes();
        const scopeKey = rawScope === null || rawScope === undefined ? "global" : await normalizeWorkspace(rawScope);
        await upsertGroup(dshHome, id, name, scopeKey, names);
        return { groups: this.groupRows(await loadGroups(dshHome)) };
    }
    /** 删除分组。 */
    async deleteGroup(payload) {
        const { id } = payload;
        const { dshHome } = this.homes();
        await deleteGroup(dshHome, id);
        return { groups: this.groupRows(await loadGroups(dshHome)) };
    }
    /** 把分组配置转成 wire 行（含每个工作区的成员名）。 */
    groupRows(groups) {
        return Object.entries(groups)
            .map(([id, group]) => ({ id, name: group.name, scopes: group.scopes ?? {} }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }
    /** 所有已知工作区的互不相同的项目根（供工作区横栏使用）。 */
    async enumerateWorkspaces() {
        const map = new Map();
        const keyOf = (path) => process.platform === "win32" ? path.toLowerCase() : path;
        const add = async (path, label, sessions) => {
            if (typeof path !== "string" || path === "")
                return;
            // 幽灵条目防护：目录已不存在（例如被移到回收站）的工作区/会话 cwd
            // 不再出现在工作区列表中。
            const info = await stat(resolvePath(path)).catch(() => undefined);
            if (info === undefined || !info.isDirectory())
                return;
            let project;
            try {
                project = await findProjectRoot(resolvePath(path));
            }
            catch {
                return;
            }
            const key = keyOf(project);
            if (map.has(key))
                return;
            map.set(key, { path: project, label: label || basename(project) || project, sessions: sessions ?? 0 });
        };
        try {
            const registry = this.C.get("workspaceRegistry");
            if (registry !== undefined && typeof registry.list === "function") {
                for (const workspace of registry.list()) {
                    try {
                        if ((await workspace.status()) !== "ok")
                            continue;
                    }
                    catch {
                        // 状态探测不可用：保留记录
                    }
                    await add(workspace.path, workspace.title, Array.isArray(workspace.sessionIds) ? workspace.sessionIds.length : 0);
                }
            }
        }
        catch {
            // 注册表不可用：回退到下面的在线会话
        }
        try {
            for (const session of this.C.sessions.list()) {
                const cwd = session.header?.cwd;
                if (cwd === undefined || cwd === "")
                    continue;
                await add(resolvePath(cwd), undefined, 1);
            }
        }
        catch {
            // 会话列表不可用：返回空选择器
        }
        return { workspaces: [...map.values()].sort((a, b) => a.label.localeCompare(b.label) || a.path.localeCompare(b.path)) };
    }
    /** 定位技能：注册表在线行、普通文件条目，或不存在。 */
    async locate(name, sessionId) {
        const { registry, cwd, scope } = this.viewFor(sessionId);
        const skill = await registry.get(name, { cwd, scope });
        if (skill !== undefined && this.workspaceOfPath(skill.path, await this.allRoots()) === undefined)
            return { kind: "live", skill };
        const entry = winnerEntry(await this.fileEntriesAll(), name);
        if (entry !== undefined)
            return { kind: "file", entry };
        return { kind: "missing" };
    }
    /**
     * 指定作用域里的那一份文件条目（"global" 或工作区项目根路径）。
     * 同名技能可能存在于多个作用域，行级操作一律走这里精确取条目。
     */
    async entryInScope(name, scope, entries) {
        const wantGlobal = scope === "global";
        const all = entries ?? (await this.fileEntriesAll());
        return all.find((candidate) => candidate.name === name && (wantGlobal ? candidate.projectRoot === undefined : candidate.projectRoot !== undefined && resolvePath(candidate.projectRoot) === resolvePath(scope)));
    }
    /** 完整正文：注册表定义，或磁盘上的技能原文件；指定作用域时读该作用域的那一份。 */
    async content(name, sessionId, scope) {
        if (typeof scope === "string" && scope !== "") {
            const entry = await this.entryInScope(name, scope);
            if (entry !== undefined) {
                const scopedRaw = await readFile(entry.file, "utf8");
                return { name: entry.name, description: entry.description, content: scopedRaw, provider: "filesystem", path: entry.file };
            }
            // 工作区作用域下只有文件技能，找不到就是没有；global 允许落到下面的
            // 注册表分支（bundled / runtime / 插件贡献的技能没有对应文件条目）。
            if (scope !== "global")
                return null;
        }
        const located = await this.locate(name, sessionId);
        if (located.kind === "missing")
            return null;
        if (located.kind === "file") {
            const raw = await readFile(located.entry.file, "utf8");
            return {
                name: located.entry.name,
                description: located.entry.description,
                content: raw,
                provider: "filesystem",
                path: located.entry.file
            };
        }
        const skill = located.skill;
        return {
            name: skill.name,
            description: skill.description,
            content: skill.content,
            provider: skill.provider,
            ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
            ...(skill.path === undefined ? {} : { path: skill.path }),
            ...(skill.resourceBase === undefined ? {} : { resourceBase: skill.resourceBase })
        };
    }
    assertEditable(skill) {
        if (skill.source === "bundled")
            throw new Error('技能 "' + skill.name + '" 随部署附带，不可修改');
        if (typeof skill.path !== "string" || skill.path.length === 0)
            throw new Error('技能 "' + skill.name + '" 没有可修改的文件');
    }
    /** 文件条目的原地启停改名。 */
    async setEntryEnabled(name, entry, enabled) {
        if (enabled === entry.enabled)
            return { name, enabled };
        const target = enabled ? entry.file.slice(0, -DISABLED_SUFFIX.length) : entry.file + DISABLED_SUFFIX;
        if (await pathExists(target))
            throw new Error("目标文件已存在：" + target);
        await rename(entry.file, target);
        return { name, enabled };
    }
    /**
     * 热启用/停用：把技能文件原地改名 *.disabled（或改回）。
     * 指定作用域时只操作该作用域里的那一份（同名技能可能存在于多个作用域），
     * 找不到即报错——绝不回退去操作别的作用域的副本。
     */
    async setEnabled(name, sessionId, enabled, scope) {
        const scoped = typeof scope === "string" && scope !== "";
        if (scoped) {
            const entry = await this.entryInScope(name, scope);
            if (entry !== undefined)
                return this.setEntryEnabled(name, entry, enabled);
            // 工作区作用域下只有文件条目，找不到就是不存在；global 允许落到下面的
            // 在线技能分支（插件贡献等非文件技能仍以注册表路径为准）。
            if (scope !== "global")
                throw new Error('技能 "' + name + '" 在指定作用域中不存在');
        }
        const located = await this.locate(name, sessionId);
        if (located.kind === "missing")
            throw new Error('技能 "' + name + '" 不存在');
        if (located.kind === "live") {
            const skill = located.skill;
            this.assertEditable(skill);
            if (enabled)
                return { name, enabled: true };
            const target = skill.path + DISABLED_SUFFIX;
            if (await pathExists(target))
                throw new Error("目标文件已存在：" + target);
            await rename(skill.path, target);
            return { name, enabled: false };
        }
        if (scoped)
            throw new Error('技能 "' + name + '" 在指定作用域中不存在');
        return this.setEntryEnabled(name, located.entry, enabled);
    }
    /** 删除一个文件条目（目录束连目录一起删）。 */
    async removeEntry(entry) {
        if (entry.dirBundle)
            await rm(dirname(entry.file), { recursive: true, force: true });
        else
            await rm(entry.file, { force: true });
    }
    /**
     * 永久删除技能。指定作用域时只删除该作用域里的那一份（同名技能可能存在于
     * 多个作用域），找不到即报错——绝不回退去删除别的作用域的副本。
     */
    async deleteSkill(name, sessionId, scope) {
        const scoped = typeof scope === "string" && scope !== "";
        if (scoped) {
            const entry = await this.entryInScope(name, scope);
            if (entry !== undefined) {
                await this.removeEntry(entry);
                return { name };
            }
            if (scope !== "global")
                throw new Error('技能 "' + name + '" 在指定作用域中不存在');
        }
        const located = await this.locate(name, sessionId);
        if (located.kind === "missing")
            throw new Error('技能 "' + name + '" 不存在');
        if (located.kind === "live") {
            const skill = located.skill;
            this.assertEditable(skill);
            if (basename(skill.path) === "SKILL.md")
                await rm(dirname(skill.path), { recursive: true, force: true });
            else
                await rm(skill.path, { force: true });
            return { name };
        }
        if (scoped)
            throw new Error('技能 "' + name + '" 在指定作用域中不存在');
        await this.removeEntry(located.entry);
        return { name };
    }
    /** 迁移可以挪动的条目（或用户根里的在线技能）。 */
    async migratableEntry(name, sessionId) {
        const entry = winnerEntry(await this.fileEntriesAll(), name);
        if (entry !== undefined)
            return entry;
        const located = await this.locate(name, sessionId);
        if (located.kind !== "live")
            return undefined;
        const skill = located.skill;
        if (typeof skill.path !== "string" || skill.path === "")
            return undefined;
        const { dshHome, agentsHome } = this.homes();
        const userRoots = [join(dshHome, "skills"), join(agentsHome, "skills")];
        if (!userRoots.some((root) => this.isWithin(root, skill.path)))
            return undefined;
        this.assertEditable(skill);
        return { name: skill.name, file: skill.path, dirBundle: basename(skill.path) === "SKILL.md", enabled: true, source: skill.source ?? "user-dsh" };
    }
    /** 把单个技能移动或复制到另一个工作区文件夹。 */
    async migrate(name, sessionId, payload) {
        this.invalidateWorkspaces();
        const { target: rawTarget, mode, from: rawFrom } = payload;
        const { dshHome } = this.homes();
        const targetProject = rawTarget === null || rawTarget === undefined ? null : await normalizeWorkspace(rawTarget);
        const targetRoot = scopeRootOf(targetProject, dshHome);
        // 指定源作用域时按（名称+作用域）精确取条目；否则回退 winner 逻辑。
        const entry = typeof rawFrom === "string" && rawFrom !== ""
            ? await this.entryInScope(name, rawFrom)
            : await this.migratableEntry(name, sessionId);
        if (entry === undefined || entry === null)
            throw new Error('技能 "' + name + '" 没有可迁移的文件（随部署附带、运行时内置或不在指定源作用域的技能不可迁移）');
        await migrateEntry(entry, targetRoot, mode);
        return { name, scope: await this.scopeForTarget(targetRoot, targetProject) };
    }
    /** 把一批技能迁移到一个或多个目标工作区；逐条返回结果。 */
    async batchMigrate(sessionId, payload) {
        this.invalidateWorkspaces();
        const { from: rawFrom, targets: rawTargets, mode, names } = payload;
        if (mode === "move" && rawTargets.length > 1)
            throw new Error("移动模式只能选择一个目标工作区（多个目标请改用复制）");
        const { dshHome, agentsHome } = this.homes();
        const fromProject = rawFrom === null || rawFrom === undefined ? null : await normalizeWorkspace(rawFrom);
        const fromRoots = fromProject === null
            ? [{ path: join(dshHome, "skills"), source: "user-dsh" }, { path: join(agentsHome, "skills"), source: "user-agents" }]
            : [{ path: workspaceSkillRoot(fromProject), source: "project-dsh", projectRoot: fromProject }];
        const byName = new Map();
        for (const entry of await collectSkillEntries(fromRoots))
            if (!byName.has(entry.name))
                byName.set(entry.name, entry);
        const chosen = [];
        const results = [];
        for (const name of names) {
            const entry = byName.get(name);
            if (entry === undefined)
                results.push({ name, ok: false, error: '技能 "' + name + '" 不在源工作区中' });
            else
                chosen.push(entry);
        }
        for (const rawTarget of rawTargets) {
            const targetProject = rawTarget === null || rawTarget === undefined ? null : await normalizeWorkspace(rawTarget);
            const targetRoot = scopeRootOf(targetProject, dshHome);
            if (fromRoots.some((root) => resolvePath(root.path) === resolvePath(targetRoot))) {
                for (const entry of chosen)
                    results.push({ name: entry.name, target: rawTarget ?? null, ok: false, error: "目标工作区与源工作区相同" });
                continue;
            }
            for (const item of await batchMigrateEntries(chosen, targetRoot, mode)) {
                results.push({ name: item.name, target: rawTarget ?? null, ok: item.ok, ...(item.error === undefined ? {} : { error: item.error }) });
            }
        }
        return { results };
    }
    /**
     * 把新技能导入某个位置（全局或工作区）的文件夹：
     *   workspace 缺省/为 null → 全局用户根
     *   workspace 给了路径   → <workspaceProjectRoot>/.dsh/skills
     *
     * 结构由 skill-import 的统一分类器判定（与列表扫描、嵌套提供方同一套规则）：
     *   - 选择范围内直接有 SKILL.md ⇒ 整个选择就是一个技能包（内部不再拆）；
     *   - 否则遍历（含 SKILL.md 的目录即技能包且不下钻，不含则继续下钻，深度上限
     *     与扫描器一致），找到的技能一律**拍平到目标根第一层**；
     *   - 合法项逐个落盘，不合法/重名/冲突的逐条跳过并回报原因（部分成功）；
     *   - 写盘后轮询注册表确认 DSH 接收，未被接受的单独回滚。
     */
    async addSkill(sessionId, payload) {
        this.invalidateWorkspaces();
        const { files, workspace: rawWorkspace } = payload;
        if (files.length > MAX_ADD_FILES)
            throw new Error("文件数量过多（最多 " + MAX_ADD_FILES + " 个）");
        let decoded = files.map((file) => {
            const data = Buffer.from(file.base64, "base64");
            if (data.length === 0 && file.base64.length > 0)
                throw new Error("文件内容解码失败：" + file.path);
            return { path: normalizeImportPath(file.path), data };
        });
        // 顶层的 .zip 先解压，再与其余文件合并走同一套结构识别；
        // 文件夹内部的 zip 属于技能包载荷，不展开。
        decoded = expandTopLevelZips(decoded);
        if (decoded.length === 0)
            throw new Error("压缩包中没有可用的文件");
        if (decoded.length > MAX_ADD_FILES)
            throw new Error("压缩包内文件数量过多（最多 " + MAX_ADD_FILES + " 个）");
        if (decoded.reduce((sum, file) => sum + file.data.length, 0) > MAX_ADD_TOTAL_BYTES)
            throw new Error("技能总大小超过 8MB 上限（含解压后内容）");
        // 提前拒绝不安全的相对路径。
        for (const file of decoded) {
            if (file.path.startsWith("/") || file.path.split("/").some((segment) => segment === ".." || segment === "."))
                throw new Error("非法文件路径：" + file.path);
        }
        const { dshHome } = this.homes();
        let targetProject;
        let targetRoot;
        if (rawWorkspace === undefined || rawWorkspace === null || rawWorkspace === "") {
            targetRoot = join(dshHome, "skills");
        }
        else {
            targetProject = await normalizeWorkspace(rawWorkspace);
            targetRoot = workspaceSkillRoot(targetProject);
        }
        // ── 结构识别：与列表扫描 / 嵌套提供方同一套规则（skill-import）───────
        const bytesByPath = new Map(decoded.map((file) => [file.path, file.data]));
        const plan = classifySkillImport(decoded);
        const skipped = [...plan.skipped];
        const warnings = [];
        const allExisting = await this.fileEntriesAll();
        const { registry, cwd, scope } = this.viewFor(sessionId);
        const liveSkills = await registry.list({ cwd, scope });
        /*
         * 冲突只在**目标作用域内**判定，跨作用域同名降级为提示。
         *
         * 理由：DSH 的发现根按会话 cwd 解析，别的工作区根本不在这条链上，那里的同名
         * 技能既不会被看到也不会被遮蔽；同一台机器上全局与工作区同名也只是注册表按
         * 根优先级裁决（project 100 < user 400，近层遮蔽远层，被遮蔽项没有 API 可枚举）。
         * 面板自己的行级操作（查看/启停/删除/迁移）也早已按（名称 + 作用域）精确定位，
         * 所以只有"同一作用域里再落一份同名"才是真的不可调和——那会让同作用域出现两个
         * 互相遮蔽的实体，并让按名字定位的条目产生歧义。
         */
        const scopeKeyOf = (path) => {
            const resolved = resolvePath(path);
            return process.platform === "win32" ? resolved.toLowerCase() : resolved;
        };
        const entryScopeKey = (entry) => entry.projectRoot === undefined ? "" : scopeKeyOf(entry.projectRoot);
        const targetScopeKey = targetProject === undefined ? "" : scopeKeyOf(targetProject);
        // 逐条过滤：同作用域重名与目标冲突只跳过该条，不影响其余（部分成功）。
        const accepted = [];
        const batchNames = new Set();
        const plannedTargets = new Set();
        for (const candidate of plan.candidates) {
            const skillFile = bytesByPath.get(candidate.skillFile);
            if (skillFile === undefined) {
                skipped.push({ name: candidate.source, reason: "技能文件缺失" });
                continue;
            }
            const validation = validateFrontmatter(skillFile.toString("utf8"));
            if (!validation.ok) {
                skipped.push({ name: candidate.source, reason: "技能格式不符合要求：" + validation.error });
                continue;
            }
            const name = validation.skill.name;
            if (batchNames.has(name)) {
                skipped.push({ name, reason: "本次选择中有重名" });
                continue;
            }
            const sameName = allExisting.filter((entry) => entry.name === name);
            const sameScope = sameName.filter((entry) => entryScopeKey(entry) === targetScopeKey);
            if (sameScope.length > 0) {
                skipped.push({ name, reason: '同名技能已存在于目标作用域（' + (sameScope[0].enabled ? "已启用" : "已停用") + "：" + sameScope[0].file + "）" });
                continue;
            }
            if (sameName.length > 0) {
                const where = [...new Set(sameName.map((entry) => entry.projectRoot ?? "全局用户根"))].join("、");
                warnings.push({ name, reason: "同名技能已存在于其他作用域，二者互不影响：" + where });
            }
            if (sameName.length === 0 && liveSkills.some((live) => live.name === name)) {
                warnings.push({ name, reason: "同名技能由注册表提供方提供（非文件技能），注册表会按根优先级裁决" });
            }
            const target = candidate.kind === "bundle" ? join(targetRoot, name) : join(targetRoot, candidate.files[0].relative);
            const targetKey = process.platform === "win32" ? target.toLowerCase() : target;
            if (plannedTargets.has(targetKey)) {
                skipped.push({ name, reason: '本次选择的落盘路径相同："' + target + '"' });
                continue;
            }
            if (await pathExists(target)) {
                skipped.push({ name, reason: "目标路径已存在：" + target });
                continue;
            }
            plannedTargets.add(targetKey);
            batchNames.add(name);
            accepted.push({
                name,
                kind: candidate.kind,
                target,
                writes: candidate.files.map((file) => ({ relative: file.relative, data: bytesByPath.get(file.path) }))
            });
        }
        if (accepted.length === 0) {
            throw new Error(skipped.length === 0 ? "没有可添加的技能" : "没有可添加的技能：" + describeSkips(skipped));
        }
        // ── 落盘：每个技能在自己的暂存目录里写好再改名就位；逐条成功/失败 ─────
        const stagingBase = join(targetRoot, ".dsh-skill-staging-" + process.pid + "-" + Math.random().toString(36).slice(2, 8));
        const written = [];
        for (let index = 0; index < accepted.length; index++) {
            const skill = accepted[index];
            const staging = join(stagingBase, String(index));
            try {
                for (const write of skill.writes) {
                    const filePath = join(staging, write.relative);
                    await mkdir(dirname(filePath), { recursive: true });
                    await writeFile(filePath, write.relative.toLowerCase().endsWith(".md") ? normalizeSkillText(write.data) : write.data);
                }
                if (skill.kind === "bundle") {
                    await rename(staging, skill.target);
                }
                else {
                    await rename(join(staging, skill.writes[0].relative), skill.target);
                    await rm(staging, { recursive: true, force: true }).catch(() => { });
                }
                written.push({ name: skill.name, kind: skill.kind, target: skill.target });
            }
            catch (error) {
                await rm(staging, { recursive: true, force: true }).catch(() => { });
                skipped.push({ name: skill.name, reason: "写入失败（已回滚该技能）：" + (error instanceof Error ? error.message : String(error)) });
            }
        }
        await rm(stagingBase, { recursive: true, force: true }).catch(() => { });
        // ── DSH 做最终裁判：未被注册表接收的单独回滚，其余保留 ────────────────
        const missing = await this.waitForDiscovery(written.map((item) => item.name), sessionId, targetProject ?? cwd);
        const added = [];
        for (const item of written) {
            if (missing.has(item.name)) {
                await rm(item.target, { recursive: true, force: true }).catch(() => { });
                skipped.push({ name: item.name, reason: "DSH 未接受（frontmatter 校验未通过或不可发现），已回滚" });
                continue;
            }
            added.push({ name: item.name, kind: item.kind });
        }
        if (added.length === 0)
            throw new Error("没有技能被 DSH 接受，已全部回滚：" + describeSkips(skipped));
        return { added, skipped, warnings, scope: targetProject === undefined ? { kind: "global" } : await this.scopeForTarget(targetRoot, targetProject) };
    }
    /**
     * 轮询注册表直到这批技能全部出现；返回**未被发现的名字集合**。
     * 注册表不可用时不阻塞：返回空集合（视为已接收）。
     */
    async waitForDiscovery(names, sessionId, probeCwd) {
        const { registry, scope } = this.viewFor(sessionId);
        const pending = new Set(names);
        for (let attempt = 0; attempt < 12; attempt++) {
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
            try {
                for (const name of [...pending]) {
                    if ((await registry.get(name, { cwd: probeCwd, scope })) !== undefined)
                        pending.delete(name);
                }
                if (pending.size === 0)
                    return pending;
            }
            catch {
                // 注册表不可用：视为已接收（没有可核对的依据）
                return new Set();
            }
        }
        return pending;
    }
}
export function apply(ctx) {
    ensureGlobalShim(ctx.logger);
    new SkillsViewerGateway(ctx);
    // 单工具禁用（Issue #44）：控制器按 agent 作用域施加限制，网关只负责读写配置。
    // 配置要异步读盘，所以先给网关一个转接器，控制器就位后它自动开始回话。
    const filterRef = { current: undefined };
    const toolFilterAdapter = {
        denyOf: () => filterRef.current?.deny,
        setDeny: (deny) => filterRef.current?.setDeny(deny),
        activeCount: () => filterRef.current?.activeCount() ?? 0
    };
    new McpManagerGateway(ctx, toolFilterAdapter);
    ctx.effect(() => {
        let cancelled = false;
        Promise.resolve()
            .then(() => loadToolFilter(resolveDshHome()))
            .then((deny) => {
            if (cancelled)
                return;
            filterRef.current = attachToolFilter(ctx, deny);
            ctx.logger?.debug?.("dsh-skill-mcp-panel: 单工具禁用生效 " + deny.length + " 条");
        })
            .catch(() => {
            // 读不到配置就不启用过滤：宁可什么都不禁用，也不要报错挡住插件加载。
        });
        return () => {
            cancelled = true;
            filterRef.current?.dispose();
            filterRef.current = undefined;
        };
    }, "dsh-skill-mcp-panel: 单工具禁用");
    ctx.effect(() => ctx.typert.register(PANEL_MANIFEST), "dsh-skill-mcp-panel: typert manifest");
    ctx.skills.registerProvider((control) => new NestedSkillProvider(NESTED_SKILL_RANK, control.signal, control.invalidate));
}
