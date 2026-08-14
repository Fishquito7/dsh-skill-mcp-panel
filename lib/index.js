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
  pathExists,
  validateFrontmatter,
  winnerEntry
} from "./skill-files.js";

/**
 * dsh-skill-viewer - host half.
 *
 * A Typert Remote service ("skillsViewer") exposing the current session's
 * skill catalog (enabled + hot-disabled) and hot management operations:
 * enable/disable (rename to/from *.disabled), delete, and add (import a
 * skill bundle or flat markdown file into the user skills root).
 *
 * The skill-filesystem provider's file watcher picks every change up within
 * ~200ms, so none of these operations require a gateway restart.
 */
export const name = "skills-viewer";
export const inject = ["typert", "skills", "sessions", "agents"];

// ── wire schemas (zod v4) ────────────────────────────────────────────────────

const sessionIdSchema = z.string().optional();

const skillSummarySchema = z.object({
  name: z.string(),
  description: z.string(),
  whenToUse: z.string().optional(),
  provider: z.string(),
  source: z.string(),
  enabled: z.boolean(),
  modelInvocable: z.boolean(),
  userInvocable: z.boolean()
});

const listResultSchema = z.object({ skills: z.array(skillSummarySchema) });

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

const addFileSchema = z.object({ path: z.string(), base64: z.string() });
const addPayloadSchema = z.object({ kind: z.enum(["bundle", "flat"]), files: z.array(addFileSchema).min(1) });
const addResultSchema = z.object({ name: z.string(), kind: z.enum(["bundle", "flat"]) });

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

  // ── remote methods ─────────────────────────────────────────────────────────

  /** The merged catalog: live registry skills + hot-disabled file entries. */
  async list(sessionId) {
    const { registry, cwd, scope } = this.viewFor(sessionId);
    const listed = await registry.list({ cwd, scope });
    const skills = listed.map((skill) => ({
      name: skill.name,
      description: skill.description,
      ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
      provider: skill.provider,
      source: skill.source ?? (skill.provider === "runtime" ? "runtime" : ""),
      enabled: true,
      modelInvocable: skill.invocation.modelInvocable,
      userInvocable: skill.invocation.userInvocable
    }));
    const seen = new Set(skills.map((skill) => skill.name));
    for (const entry of await this.fileEntries(sessionId)) {
      if (entry.enabled || seen.has(entry.name)) continue;
      seen.add(entry.name);
      skills.push({
        name: entry.name,
        description: entry.description,
        provider: "filesystem",
        source: entry.source,
        enabled: false,
        modelInvocable: false,
        userInvocable: false
      });
    }
    return { skills };
  }

  /** Locate a skill: live in the registry, disabled on disk, or missing. */
  async locate(name, sessionId) {
    const { registry, cwd, scope } = this.viewFor(sessionId);
    const skill = await registry.get(name, { cwd, scope });
    if (skill !== undefined) return { kind: "live", skill };
    const entry = winnerEntry(await this.fileEntries(sessionId), name);
    if (entry !== undefined && !entry.enabled) return { kind: "disabled", entry };
    return { kind: "missing" };
  }

  /** Full body: the registry definition, or the disabled file when present. */
  async content(name, sessionId) {
    const located = await this.locate(name, sessionId);
    if (located.kind === "missing") return null;
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

  /** Delete a skill permanently (directory bundles remove the whole dir). */
  async deleteSkill(name, sessionId) {
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
   * Import a new skill into the user skills root:
   *   bundle = a directory tree whose top level contains exactly one SKILL.md
   *   flat   = a single markdown file
   * The frontmatter is validated before writing; afterwards the registry is
   * polled to confirm DSH accepted the skill — otherwise the files are rolled
   * back and the rejection is reported.
   */
  async addSkill(sessionId, payload) {
    const { kind, files } = payload;
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

    // Refuse duplicates: the name may not exist enabled or disabled.
    const existing = winnerEntry(await this.fileEntries(sessionId), name);
    if (existing !== undefined) throw new Error('同名技能 "' + name + '" 已存在（' + (existing.enabled ? "已启用" : "已停用") + "）");
    const { registry, cwd, scope } = this.viewFor(sessionId);
    if ((await registry.list({ cwd, scope })).some((skill) => skill.name === name)) throw new Error('同名技能 "' + name + '" 已存在');

    // Write the files (the gateway's watcher will discover them).
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

    // Let DSH itself be the final judge: poll the registry until the skill
    // shows up (the watcher needs a moment to invalidate caches). Roll back
    // when it never does.
    const accepted = await this.waitForDiscovery(name, sessionId);
    if (!accepted) {
      await rm(target, { recursive: true, force: true }).catch(() => {});
      throw new Error("DSH 未接受该技能（格式校验未通过），已回滚。请检查 frontmatter 后重试");
    }
    return { name, kind };
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
}

export function apply(ctx) {
  new SkillsViewerGateway(ctx);
  ctx.effect(() => ctx.typert.register(MANIFEST), "skills-viewer: typert manifest");
}
