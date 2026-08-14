import { z } from "zod";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import { homedir } from "node:os";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import {
  DISABLED_SUFFIX,
  buildRoots,
  collectSkillEntries,
  findProjectRoot,
  parseFrontmatter,
  pathExists,
  validateFrontmatter,
  winnerEntry
} from "./skill-files.js";
import {
  deleteScopedSkill,
  ensureJunction,
  loadBindings,
  normalizeWorkspaces,
  pruneStaleWorkspaces,
  scopeSkill,
  scopedContent,
  scopedEnabled,
  setScopedEnabled,
  storeRoot,
  storeSkillDir,
  workspaceLink
} from "./scope.js";

/**
 * dsh-skill-viewer - host half.
 *
 * A Typert Remote service ("skillsViewer") exposing the current session's
 * skill catalog (enabled + hot-disabled) and hot management operations:
 * enable/disable (rename to/from *.disabled), delete, and add (import a
 * skill bundle or flat markdown file into the user skills root).
 *
 * Since the workspace-scope extension, skills may also be scoped to one or
 * more workspaces: the file lives once in the managed store
 * (~/.dsh/skills/.system/skill-viewer) and each bound workspace's project
 * root carries a junction, so the skill is discoverable only for sessions
 * inside those workspaces. Workspace deletion removes the junction with the
 * workspace and stale bindings are pruned automatically; the stored skill
 * itself is never lost.
 *
 * The skill-filesystem provider's file watcher picks every change up within
 * ~200ms, so none of these operations require a gateway restart.
 */
export const name = "skills-viewer";
export const inject = ["typert", "skills", "sessions", "agents"];

// ── wire schemas (zod v4) ────────────────────────────────────────────────────

const sessionIdSchema = z.string().optional();

const scopeWorkspaceSchema = z.object({
  path: z.string(),
  label: z.string(),
  exists: z.boolean()
});

const scopeSchema = z.object({
  kind: z.enum(["global", "workspaces"]),
  workspaces: z.array(scopeWorkspaceSchema).optional()
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
  scope: scopeSchema.optional()
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

const setScopeResultSchema = z.object({ name: z.string(), scope: scopeSchema });

const deleteSkillResultSchema = z.object({ name: z.string() });

const addFileSchema = z.object({ path: z.string(), base64: z.string() });
const addPayloadSchema = z.object({
  kind: z.enum(["bundle", "flat"]),
  files: z.array(addFileSchema).min(1),
  workspaces: z.array(z.string()).nullable().optional()
});
const addResultSchema = z.object({ name: z.string(), kind: z.enum(["bundle", "flat"]), scope: scopeSchema });

/** Typed wire descriptors registered with the API gateway. */
const MANIFEST = {
  package: "dsh-skill-viewer",
  face: "host",
  schemas: [],
  invocations: [
    {
      id: "dsh-skill-viewer#skillsViewer/list",
      service: "skillsViewer",
      namespace: "skillsViewer",
      method: "list",
      invocation: { kind: "direct" },
      parameters: [
        { name: "sessionId", wire: "sessionId", source: "json", acceptsUndefined: true, codec: { mode: "strict", typeSymbol: "dsh-skill-viewer#sessionId", schema: sessionIdSchema } }
      ],
      result: { mode: "strict", typeSymbol: "dsh-skill-viewer#SkillListResult", schema: listResultSchema }
    },
    {
      id: "dsh-skill-viewer#skillsViewer/workspaces",
      service: "skillsViewer",
      namespace: "skillsViewer",
      method: "workspaces",
      invocation: { kind: "direct" },
      parameters: [],
      result: { mode: "strict", typeSymbol: "dsh-skill-viewer#WorkspacesResult", schema: workspacesResultSchema }
    },
    {
      id: "dsh-skill-viewer#skillsViewer/content",
      service: "skillsViewer",
      namespace: "skillsViewer",
      method: "content",
      invocation: { kind: "direct" },
      parameters: [
        { name: "name", wire: "name", source: "json", codec: { mode: "strict", typeSymbol: "dsh-skill-viewer#SkillName", schema: z.string() } },
        { name: "sessionId", wire: "sessionId", source: "json", acceptsUndefined: true, codec: { mode: "strict", typeSymbol: "dsh-skill-viewer#sessionId", schema: sessionIdSchema } }
      ],
      result: { mode: "strict", typeSymbol: "dsh-skill-viewer#SkillContent", schema: skillContentSchema }
    },
    {
      id: "dsh-skill-viewer#skillsViewer/setEnabled",
      service: "skillsViewer",
      namespace: "skillsViewer",
      method: "setEnabled",
      invocation: { kind: "direct" },
      parameters: [
        { name: "name", wire: "name", source: "json", codec: { mode: "strict", typeSymbol: "dsh-skill-viewer#SkillName", schema: z.string() } },
        { name: "sessionId", wire: "sessionId", source: "json", acceptsUndefined: true, codec: { mode: "strict", typeSymbol: "dsh-skill-viewer#sessionId", schema: sessionIdSchema } },
        { name: "enabled", wire: "enabled", source: "json", codec: { mode: "strict", typeSymbol: "dsh-skill-viewer#EnabledFlag", schema: z.boolean() } }
      ],
      result: { mode: "strict", typeSymbol: "dsh-skill-viewer#SetEnabledResult", schema: setEnabledResultSchema }
    },
    {
      id: "dsh-skill-viewer#skillsViewer/setScope",
      service: "skillsViewer",
      namespace: "skillsViewer",
      method: "setScope",
      invocation: { kind: "direct" },
      parameters: [
        { name: "name", wire: "name", source: "json", codec: { mode: "strict", typeSymbol: "dsh-skill-viewer#SkillName", schema: z.string() } },
        { name: "sessionId", wire: "sessionId", source: "json", acceptsUndefined: true, codec: { mode: "strict", typeSymbol: "dsh-skill-viewer#sessionId", schema: sessionIdSchema } },
        { name: "workspaces", wire: "workspaces", source: "json", codec: { mode: "strict", typeSymbol: "dsh-skill-viewer#WorkspaceList", schema: z.array(z.string()).nullable() } }
      ],
      result: { mode: "strict", typeSymbol: "dsh-skill-viewer#SetScopeResult", schema: setScopeResultSchema }
    },
    {
      id: "dsh-skill-viewer#skillsViewer/deleteSkill",
      service: "skillsViewer",
      namespace: "skillsViewer",
      method: "deleteSkill",
      invocation: { kind: "direct" },
      parameters: [
        { name: "name", wire: "name", source: "json", codec: { mode: "strict", typeSymbol: "dsh-skill-viewer#SkillName", schema: z.string() } },
        { name: "sessionId", wire: "sessionId", source: "json", acceptsUndefined: true, codec: { mode: "strict", typeSymbol: "dsh-skill-viewer#sessionId", schema: sessionIdSchema } }
      ],
      result: { mode: "strict", typeSymbol: "dsh-skill-viewer#DeleteSkillResult", schema: deleteSkillResultSchema }
    },
    {
      id: "dsh-skill-viewer#skillsViewer/addSkill",
      service: "skillsViewer",
      namespace: "skillsViewer",
      method: "addSkill",
      invocation: { kind: "direct" },
      parameters: [
        { name: "sessionId", wire: "sessionId", source: "json", acceptsUndefined: true, codec: { mode: "strict", typeSymbol: "dsh-skill-viewer#sessionId", schema: sessionIdSchema } },
        { name: "payload", wire: "payload", source: "json", codec: { mode: "strict", typeSymbol: "dsh-skill-viewer#AddPayload", schema: addPayloadSchema } }
      ],
      result: { mode: "strict", typeSymbol: "dsh-skill-viewer#AddResult", schema: addResultSchema }
    }
  ],
  model: { services: [], events: [], objects: [] }
};

/** Guard rails for browser-uploaded bundles. */
const MAX_ADD_FILES = 200;
const MAX_ADD_TOTAL_BYTES = 8 * 1024 * 1024;

/**
 * The remote service instance. Constructing it registers the "skillsViewer"
 * cordis service; the manifest above lets the API gateway dispatch endpoints.
 */
class SkillsViewerGateway extends TypertRemoteService {
  constructor(ctx) {
    super(ctx, "skillsViewer");
  }

  // ── catalog resolution (mirrors the host api-proxy skill.list) ─────────────

  registryFor(sessionId) {
    const live = sessionId === undefined ? undefined : this.ctx.agents.get(sessionId);
    if (live !== undefined) {
      const scoped = this.ctx.get("agentPresets")?.serviceFor(live, "skills");
      if (scoped !== undefined) return scoped;
    }
    return this.ctx.skills;
  }

  viewFor(sessionId) {
    const registry = this.registryFor(sessionId);
    const session = sessionId === undefined ? undefined : this.ctx.sessions.get(sessionId);
    const scope = sessionId === undefined ? undefined : this.ctx.agents.get(sessionId);
    return { registry, cwd: session?.header?.cwd, scope };
  }

  /** The management roots for one session view (project + user). */
  async rootsFor(sessionId) {
    const { cwd } = this.viewFor(sessionId);
    return buildRoots(cwd, {
      dshHome: resolveDshHome(),
      agentsHome: resolvePath(process.env.DSH_AGENTS_HOME?.trim() ? process.env.DSH_AGENTS_HOME : join(homedir(), ".agents"))
    });
  }

  /** All file-level entries (enabled + disabled) for one session view. */
  async fileEntries(sessionId) {
    return collectSkillEntries(await this.rootsFor(sessionId));
  }

  /** The managed bindings map, pruned of stale workspaces, plus the dsh home. */
  async managedState() {
    const dshHome = resolveDshHome();
    const bindings = await loadBindings(dshHome);
    await pruneStaleWorkspaces(dshHome, bindings);
    return { dshHome, bindings };
  }

  /** The scope wire shape for one managed binding. */
  async scopeFor(dshHome, binding) {
    const name = binding?.name ?? "";
    const workspaces = Array.isArray(binding?.workspaces) ? binding.workspaces : undefined;
    if (workspaces === undefined) return { kind: "global" };
    if (workspaces.length === 0) return { kind: "workspaces", workspaces: [] };
    const rows = [];
    for (const workspace of workspaces) {
      rows.push({
        path: workspace,
        label: basename(workspace) || workspace,
        exists: (name !== "" && (await pathExists(workspaceLink(workspace, name)))) || await pathExists(workspace)
      });
    }
    return { kind: "workspaces", workspaces: rows };
  }

  /** Whether a skill row is scope-manageable (lives in the user root or store). */
  isScopable(binding, source) {
    return binding !== undefined || source === "user-dsh";
  }

  /** The scope field for a skill row, or an empty object when not manageable. */
  async scopeField(dshHome, binding, name, source) {
    if (!this.isScopable(binding, source)) return {};
    return { scope: (await this.scopeFor(dshHome, binding === undefined ? undefined : { ...binding, name })) ?? { kind: "global" } };
  }

  // ── remote methods ─────────────────────────────────────────────────────────

  /** The merged catalog: live registry skills + managed scoped skills. */
  async list(sessionId) {
    const { registry, cwd, scope } = this.viewFor(sessionId);
    const { dshHome, bindings } = await this.managedState();
    const listed = await registry.list({ cwd, scope });
    const skills = [];
    for (const skill of listed) {
      const binding = bindings[skill.name];
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
        ...(await this.scopeField(dshHome, binding, skill.name, source))
      });
    }
    const seen = new Set(skills.map((skill) => skill.name));
    for (const entry of await this.fileEntries(sessionId)) {
      if (entry.enabled || seen.has(entry.name)) continue;
      seen.add(entry.name);
      const binding = bindings[entry.name];
      skills.push({
        name: entry.name,
        description: entry.description,
        provider: "filesystem",
        source: entry.source,
        enabled: false,
        modelInvocable: false,
        userInvocable: false,
        ...(await this.scopeField(dshHome, binding, entry.name, entry.source))
      });
    }
    // Scoped skills bound only to OTHER workspaces stay manageable here:
    // overlay them from the store so the user can see, toggle, re-scope or
    // delete them from any session.
    for (const [name, binding] of Object.entries(bindings)) {
      if (seen.has(name)) continue;
      if (binding === undefined || binding.workspaces === undefined) continue;
      const raw = await scopedContent(dshHome, name);
      const parsed = raw === undefined ? undefined : parseFrontmatter(raw);
      skills.push({
        name,
        description: parsed?.description ?? "",
        ...(parsed?.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse }),
        provider: "filesystem",
        source: "user-dsh",
        enabled: await scopedEnabled(dshHome, name),
        modelInvocable: false,
        userInvocable: false,
        scope: await this.scopeFor(dshHome, { ...binding, name })
      });
    }
    return { skills };
  }

  /** Distinct project roots of all known workspaces (for the scope picker). */
  async workspaces() {
    const map = new Map();
    const keyOf = (path) => process.platform === "win32" ? path.toLowerCase() : path;
    const add = async (path, label, sessions) => {
      if (typeof path !== "string" || path === "") return;
      let project;
      try {
        project = await findProjectRoot(resolvePath(path));
      } catch {
        return;
      }
      const key = keyOf(project);
      if (map.has(key)) return;
      map.set(key, { path: project, label: label || basename(project) || project, sessions: sessions ?? 0 });
    };
    // Primary source: the durable workspace registry (every historical
    // workspace, not just sessions currently loaded in memory).
    try {
      const registry = this.ctx.get("workspaceRegistry");
      if (registry !== undefined && typeof registry.list === "function") {
        for (const workspace of registry.list()) {
          try {
            // status() is ASYNC: comparing the promise directly would skip
            // every workspace.
            if ((await workspace.status()) !== "ok") continue;
          } catch {
            // status probe unavailable: keep the record
          }
          await add(workspace.path, workspace.title, Array.isArray(workspace.sessionIds) ? workspace.sessionIds.length : 0);
        }
      }
    } catch {
      // registry unavailable: fall back to live sessions below
    }
    // Supplement: live sessions whose cwd is not yet a registered workspace.
    try {
      for (const session of this.ctx.sessions.list()) {
        const cwd = session.header?.cwd;
        if (cwd === undefined || cwd === "") continue;
        await add(resolvePath(cwd), undefined, 1);
      }
    } catch {
      // session listing unavailable: empty picker
    }
    return { workspaces: [...map.values()].sort((a, b) => a.label.localeCompare(b.label) || a.path.localeCompare(b.path)) };
  }

  /** Locate a skill: live in the registry, managed scoped, disabled on disk, or missing. */
  async locate(name, sessionId) {
    const { registry, cwd, scope } = this.viewFor(sessionId);
    const skill = await registry.get(name, { cwd, scope });
    if (skill !== undefined) return { kind: "live", skill };
    const { dshHome, bindings } = await this.managedState();
    const binding = bindings[name];
    if (binding !== undefined && binding.workspaces !== undefined) return { kind: "scoped", dshHome, binding };
    const entry = winnerEntry(await this.fileEntries(sessionId), name);
    if (entry !== undefined && !entry.enabled) return { kind: "disabled", entry };
    return { kind: "missing" };
  }

  /** Full body: the registry definition, the scoped store, or the disabled file. */
  async content(name, sessionId) {
    const located = await this.locate(name, sessionId);
    if (located.kind === "missing") return null;
    if (located.kind === "scoped") {
      const raw = await scopedContent(located.dshHome, name);
      const parsed = raw === undefined ? undefined : parseFrontmatter(raw);
      return {
        name,
        description: parsed?.description ?? "",
        content: raw ?? "",
        provider: "filesystem",
        path: join(storeSkillDir(located.dshHome, name), "SKILL.md"),
        ...(parsed?.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse })
      };
    }
    if (located.kind === "disabled") {
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
    if (skill.source === "bundled") throw new Error('技能 "' + skill.name + '" 随部署附带，不可修改');
    if (typeof skill.path !== "string" || skill.path.length === 0) throw new Error('技能 "' + skill.name + '" 没有可修改的文件');
  }

  /** Hot enable/disable: rename the skill file to/from *.disabled. */
  async setEnabled(name, sessionId, enabled) {
    const { dshHome, bindings } = await this.managedState();
    const binding = bindings[name];
    if (binding !== undefined && binding.workspaces !== undefined) {
      const changed = await setScopedEnabled(dshHome, name, enabled);
      return { name, enabled: changed ? enabled : !enabled };
    }
    const located = await this.locate(name, sessionId);
    if (located.kind === "missing") throw new Error('技能 "' + name + '" 不存在');
    if (located.kind === "live") {
      const skill = located.skill;
      this.assertEditable(skill);
      if (enabled) return { name, enabled: true };
      const target = skill.path + DISABLED_SUFFIX;
      if (await pathExists(target)) throw new Error("目标文件已存在：" + target);
      await rename(skill.path, target);
      return { name, enabled: false };
    }
    if (!enabled) return { name, enabled: false };
    const target = located.entry.file.slice(0, -DISABLED_SUFFIX.length);
    await rename(located.entry.file, target);
    return { name, enabled: true };
  }

  /**
   * Change a managed skill's scope: global (`null`) or a workspace list.
   * Workspaces must exist; each resolves to its nearest git-root project dir.
   */
  async setScope(name, sessionId, workspaces) {
    const { dshHome, bindings } = await this.managedState();
    const binding = bindings[name];
    let globalLocator;
    if (binding === undefined) {
      // The skill is global (or external): it must live in the user skills
      // root to be scoped. Bundled/runtime/project-local skills are refused.
      const entry = winnerEntry(await this.fileEntries(sessionId), name);
      if (entry === undefined || entry.source !== "user-dsh") throw new Error('技能 "' + name + '" 不在用户技能目录中，无法设置作用域');
      globalLocator = entry;
    }
    await scopeSkill(dshHome, name, workspaces, globalLocator);
    const after = await loadBindings(dshHome);
    const next = after[name];
    return { name, scope: await this.scopeFor(dshHome, next === undefined ? undefined : { ...next, name }) ?? { kind: "global" } };
  }

  /** Delete a skill permanently (scoped: store + junctions + binding). */
  async deleteSkill(name, sessionId) {
    const { dshHome, bindings } = await this.managedState();
    const binding = bindings[name];
    if (binding !== undefined && binding.workspaces !== undefined) {
      await deleteScopedSkill(dshHome, name);
      return { name };
    }
    const located = await this.locate(name, sessionId);
    if (located.kind === "missing") throw new Error('技能 "' + name + '" 不存在');
    if (located.kind === "live") {
      const skill = located.skill;
      this.assertEditable(skill);
      if (basename(skill.path) === "SKILL.md") await rm(dirname(skill.path), { recursive: true, force: true });
      else await rm(skill.path, { force: true });
      return { name };
    }
    const entry = located.entry;
    if (entry.dirBundle) await rm(dirname(entry.file), { recursive: true, force: true });
    else await rm(entry.file, { force: true });
    return { name };
  }

  /**
   * Import a new skill. Without `workspaces` the skill lands in the global
   * user root (default, unchanged behavior). With one or more workspace paths
   * it lands in the managed store and each workspace's project root receives
   * a junction; DSH then discovers it only for those workspaces.
   */
  async addSkill(sessionId, payload) {
    const { kind, files, workspaces: rawWorkspaces } = payload;
    if (files.length > MAX_ADD_FILES) throw new Error("文件数量过多（最多 " + MAX_ADD_FILES + " 个）");
    const decoded = files.map((file) => {
      const data = Buffer.from(file.base64, "base64");
      if (data.length === 0 && file.base64.length > 0) throw new Error("文件内容解码失败：" + file.path);
      return { path: file.path.replaceAll("\\", "/"), data };
    });
    if (decoded.reduce((sum, file) => sum + file.data.length, 0) > MAX_ADD_TOTAL_BYTES) throw new Error("技能总大小超过 8MB 上限");

    // Reject unsafe relative paths up front.
    for (const file of decoded) {
      if (file.path.startsWith("/") || file.path.split("/").some((segment) => segment === ".." || segment === ".")) throw new Error("非法文件路径：" + file.path);
    }

    const dshHome = resolveDshHome();
    const userRoot = join(dshHome, "skills");
    const scoped = rawWorkspaces !== undefined && rawWorkspaces !== null && rawWorkspaces.length > 0;
    const workspaces = scoped ? await normalizeWorkspaces(rawWorkspaces) : null;
    if (scoped && workspaces.length === 0) throw new Error("至少需要指定一个存在的工作区");

    // Determine the canonical skill name and the files to write.
    let name;
    let writes;
    if (kind === "bundle") {
      const tops = new Set(decoded.map((file) => file.path.split("/")[0]));
      if (tops.size !== 1 || decoded.some((file) => file.path.split("/").length < 2)) throw new Error("技能文件夹结构不正确：所有文件应位于同一个文件夹内");
      const top = [...tops][0];
      const skillFile = decoded.find((file) => file.path === top + "/SKILL.md");
      if (skillFile === undefined) throw new Error("技能文件夹缺少顶层的 SKILL.md 文件");
      const validation = validateFrontmatter(skillFile.data.toString("utf8"));
      if (!validation.ok) throw new Error("技能格式不符合要求：" + validation.error);
      name = validation.skill.name;
      writes = decoded.map((file) => ({ relative: file.path.slice(top.length + 1), data: file.data }));
    } else {
      if (decoded.length !== 1) throw new Error("单个技能文件一次只能添加一个");
      const file = decoded[0];
      const flatName = file.path.split("/").filter(Boolean).pop() ?? "";
      if (!flatName.toLowerCase().endsWith(".md")) throw new Error("技能文件必须是 .md 文件");
      const validation = validateFrontmatter(file.data.toString("utf8"));
      if (!validation.ok) throw new Error("技能格式不符合要求：" + validation.error);
      name = validation.skill.name;
      writes = [{ relative: flatName, data: file.data }];
    }

    // Refuse duplicates: the name may not exist enabled, disabled, or scoped.
    const { bindings } = await this.managedState();
    if (bindings[name] !== undefined) throw new Error('同名技能 "' + name + '" 已存在（工作区限定）');
    const existing = winnerEntry(await this.fileEntries(sessionId), name);
    if (existing !== undefined) throw new Error('同名技能 "' + name + '" 已存在（' + (existing.enabled ? "已启用" : "已停用") + "）");
    const { registry, cwd, scope } = this.viewFor(sessionId);
    if ((await registry.list({ cwd, scope })).some((skill) => skill.name === name)) throw new Error('同名技能 "' + name + '" 已存在');

    if (!scoped) {
      // Global: the original flow — write into the user skills root.
      const target = kind === "bundle" ? join(userRoot, name) : join(userRoot, writes[0].relative);
      try {
        for (const write of writes) {
          const filePath = kind === "bundle" ? join(target, write.relative) : target;
          await mkdir(dirname(filePath), { recursive: true });
          await writeFile(filePath, write.data);
        }
      } catch (error) {
        await rm(target, { recursive: true, force: true }).catch(() => {});
        throw new Error("写入技能文件失败：" + (error instanceof Error ? error.message : String(error)));
      }
      const accepted = await this.waitForDiscovery(name, sessionId);
      if (!accepted) {
        await rm(target, { recursive: true, force: true }).catch(() => {});
        throw new Error("DSH 未接受该技能（格式校验未通过），已回滚。请检查 frontmatter 后重试");
      }
      return { name, kind, scope: { kind: "global" } };
    }

    // Scoped: store once, link into each workspace, record the binding.
    // Flat uploads become a bundle layout (<name>/SKILL.md) in the store
    // because that is the only layout the provider discovers through a
    // junction; the original file name is kept for un-scoping later.
    const storeDir = storeSkillDir(dshHome, name);
    const scopedWrites = scoped && kind === "flat" ? [{ relative: "SKILL.md", data: writes[0].data }] : writes;
    const created = [];
    try {
      await mkdir(storeRoot(dshHome), { recursive: true });
      for (const write of scopedWrites) {
        const filePath = join(storeDir, write.relative);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, write.data);
      }
      for (const workspace of workspaces) {
        await ensureJunction(storeDir, workspaceLink(workspace, name));
        created.push(workspace);
      }
    } catch (error) {
      for (const workspace of created) await (async () => {
        try {
          await rm(workspaceLink(workspace, name), { recursive: true, force: true });
        } catch {}
      })();
      await rm(storeDir, { recursive: true, force: true }).catch(() => {});
      throw new Error("写入技能文件失败（已回滚）：" + (error instanceof Error ? error.message : String(error)));
    }

    // Persist the binding; roll the layout back if the manifest cannot save.
    const afterBindings = await loadBindings(dshHome);
    afterBindings[name] = {
      kind: kind === "bundle" ? "bundle" : "flat",
      workspaces,
      ...(kind === "flat" && writes.length === 1 ? { fileName: writes[0].relative } : {})
    };
    try {
      const manifestDir = storeRoot(dshHome);
      const tmp = join(manifestDir, "bindings.json.tmp-" + process.pid);
      await mkdir(manifestDir, { recursive: true });
      await writeFile(tmp, JSON.stringify({ version: 1, skills: afterBindings }, void 0, 2) + "\n", "utf8");
      await rename(tmp, join(manifestDir, "bindings.json"));
    } catch (error) {
      for (const workspace of created) await (async () => {
        try {
          await rm(workspaceLink(workspace, name), { recursive: true, force: true });
        } catch {}
      })();
      await rm(storeDir, { recursive: true, force: true }).catch(() => {});
      throw new Error("保存绑定失败（已回滚）：" + (error instanceof Error ? error.message : String(error)));
    }

    // Let DSH itself be the final judge against the first bound workspace.
    const discovery = await this.waitForScopedDiscovery(name, workspaces[0], sessionId);
    if (!discovery.ok) {
      await deleteScopedSkill(dshHome, name);
      const detail = discovery.linkOk
        ? "联接点已创建，但 DSH 的技能发现器未列出该技能（通常是 frontmatter 被 DSH 的 YAML 解析器拒绝；该工作区当前可见的技能：" + (discovery.names.join("、") || "无") + "）"
        : "工作区联接点丢失：" + workspaceLink(workspaces[0], name);
      throw new Error('DSH 未能在工作区 "' + workspaces[0] + '" 中发现该技能，已回滚。' + detail + "。请检查 SKILL.md 的 frontmatter 后重试");
    }
    return { name, kind, scope: { kind: "workspaces", workspaces: workspaces.map((path) => ({ path, label: basename(path) || path, exists: true })) } };
  }

  async waitForDiscovery(name, sessionId) {
    const { registry, cwd, scope } = this.viewFor(sessionId);
    for (let attempt = 0; attempt < 4; attempt++) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 350));
      try {
        if ((await registry.get(name, { cwd, scope })) !== undefined) return true;
      } catch {
        // registry unavailable: treat as accepted (nothing to verify against)
        return true;
      }
    }
    return false;
  }

  async waitForScopedDiscovery(name, workspace, sessionId) {
    // Use the SAME view sessions read: in the web profile the host-level
    // skill-filesystem row is disabled and the filesystem provider registers
    // into the agent preset's SCOPE LAYER of the shared registry — reachable
    // only when the session's agent is passed as `scope` (which is exactly
    // what the UI's own list() does; a scope-less host query sees no provider).
    const { registry, scope } = this.viewFor(sessionId);
    // The provider may need a beat to attach its watcher to a freshly created
    // workspace `.dsh/skills` root, so poll a generous window before giving up.
    for (let attempt = 0; attempt < 12; attempt++) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
      try {
        if ((await registry.get(name, { cwd: workspace, scope })) !== undefined) return { ok: true };
      } catch {
        // registry unavailable: treat as accepted (nothing to verify against)
        return { ok: true };
      }
    }
    // Diagnose the miss so the user gets an actionable message instead of a
    // generic rollback: is the junction still there, and what DOES the
    // registry list for that workspace right now?
    let names = [];
    try {
      names = (await registry.list({ cwd: workspace, scope })).map((skill) => skill.name);
    } catch {
      // diagnostic only
    }
    const linkOk = await pathExists(workspaceLink(workspace, name));
    return { ok: false, names, linkOk };
  }
}

export function apply(ctx) {
  new SkillsViewerGateway(ctx);
  ctx.effect(() => ctx.typert.register(MANIFEST), "skills-viewer: typert manifest");
}
