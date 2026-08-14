/**
 * dsh-skill-viewer - shared skill-file conventions.
 *
 * The single source of truth for how skills live on disk, shared by:
 *   - lib/index.js (host half: catalog merge, hot enable/disable, delete, add)
 *   - bin/dsh-skill.js (management CLI)
 *
 * Conventions (must match what @deepseek-ai/dsh-skill-filesystem discovers):
 *   - directory bundle:  <root>/<name>/SKILL.md   (name comes from frontmatter)
 *   - flat skill:        <root>/<name>.md          (name comes from frontmatter)
 *   - disabled = renamed to "*.disabled"; the provider then no longer lists it.
 *   - frontmatter: YAML block between "---" lines with name + description.
 *
 * This module depends only on node:fs / node:path / node:os and the `yaml`
 * package (the same parser dsh-skill-filesystem uses for frontmatter).
 */
import { access, readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

/** Suffix marking a hot-disabled skill file. */
export const DISABLED_SUFFIX = ".disabled";

/** The public skill-name grammar (kebab-case, lowercase alphanumerics). */
export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Whether a filesystem path exists. */
export async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** The project anchor: nearest ancestor containing .git, else the cwd itself. */
export async function findProjectRoot(cwd) {
  let current = resolve(cwd);
  while (true) {
    if (await pathExists(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(cwd);
    current = parent;
  }
}

/**
 * Lenient frontmatter read for listing/scanning (name + description + body).
 * Returns undefined when the file is not a plausible skill.
 */
export function parseFrontmatter(raw) {
  const text = raw.trimStart();
  if (!text.startsWith("---")) return undefined;
  const firstEnd = text.indexOf("\n");
  if (firstEnd === -1) return undefined;
  const closing = text.indexOf("\n---", firstEnd + 1);
  const fmEnd = closing === -1 ? text.length : closing;
  const fm = text.slice(3, fmEnd);
  let body = "";
  if (closing !== -1) {
    const at = text.indexOf("\n", closing + 3);
    if (at !== -1) body = text.slice(at + 1);
  }
  const pick = (key) => {
    const m = new RegExp("^" + key + ":\\s*(.+)$", "m").exec(fm);
    if (m === null) return undefined;
    const value = m[1].trim();
    return value.replace(/^["']|["']$/g, "");
  };
  const name = pick("name");
  if (name === undefined || !SKILL_NAME_RE.test(name)) return undefined;
  return { name, description: pick("description") ?? "", whenToUse: pick("whenToUse"), body: body.trim() };
}

/**
 * Strict frontmatter validation for NEW skills, mirroring the acceptance
 * rules of dsh-skill-filesystem exactly (same YAML parser and same field
 * policy) so that content DSH would reject never gets written:
 *   - name: required, kebab-case grammar
 *   - description: required, non-empty string
 *   - whenToUse: string when present
 *   - disable-model-invocation / user-invocable: boolean-ish values
 *   - legacy invocation keys are rejected
 *   - metadata: object when present
 * @returns { ok: true, skill } or { ok: false, error } with a readable reason.
 */
export function validateFrontmatter(raw) {
  const text = raw.trimStart();
  if (!text.startsWith("---")) return { ok: false, error: "缺少 YAML frontmatter（文件必须以 --- 开头）" };
  const firstEnd = text.indexOf("\n");
  if (firstEnd === -1) return { ok: false, error: "frontmatter 未闭合" };
  const closing = text.indexOf("\n---", firstEnd + 1);
  if (closing === -1) return { ok: false, error: "frontmatter 未闭合（缺少结尾的 ---）" };
  const fm = text.slice(firstEnd + 1, closing);
  let data;
  try {
    data = parseYaml(fm);
  } catch (error) {
    return { ok: false, error: "frontmatter 不是合法的 YAML：" + (error instanceof Error ? error.message : String(error)) };
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) return { ok: false, error: "frontmatter 必须是键值对（YAML 映射）" };
  for (const key of ["disableModelInvocation", "modelInvocable", "userInvocable"]) {
    if (key in data) return { ok: false, error: '不支持旧字段 "' + key + '"，请改用 disable-model-invocation / user-invocable' };
  }
  const name = data.name;
  if (typeof name !== "string" || name.length === 0) return { ok: false, error: "frontmatter 缺少 name（必须是非空字符串）" };
  if (!SKILL_NAME_RE.test(name)) return { ok: false, error: '技能名 "' + name + '" 不符合命名规则（仅小写字母、数字与连字符，如 my-skill）' };
  const description = data.description;
  if (typeof description !== "string" || description.trim().length === 0) return { ok: false, error: "frontmatter 缺少 description（必须是非空字符串）" };
  const whenToUse = data.whenToUse;
  if (whenToUse !== undefined && typeof whenToUse !== "string") return { ok: false, error: "whenToUse 必须是字符串" };
  for (const key of ["disable-model-invocation", "user-invocable"]) {
    const value = data[key];
    if (value !== undefined) {
      const lower = String(value).toLowerCase();
      if (!["true", "false", "yes", "no", "on", "off", "1", "0"].includes(lower)) return { ok: false, error: key + " 必须是布尔值" };
    }
  }
  if (data.metadata !== undefined && (typeof data.metadata !== "object" || data.metadata === null || Array.isArray(data.metadata))) return { ok: false, error: "metadata 必须是对象" };
  return { ok: true, skill: { name, description, whenToUse: typeof whenToUse === "string" ? whenToUse : undefined, body: "" } };
}

/**
 * The management roots: project roots (anchored at the git root of cwd) and
 * user roots. Order = discovery precedence (lower index wins), matching the
 * provider ranks: project .dsh > project .agents > user .dsh > user .agents.
 *
 * Roots that resolve to the same directory (e.g. running from the home dir,
 * where the project anchor falls back to the cwd itself) are de-duplicated;
 * the first (higher-precedence) label wins.
 */
export async function buildRoots(cwd, options = {}) {
  const roots = [];
  const seen = new Set();
  const push = (path, source) => {
    const normalized = resolve(path);
    const key = process.platform === "win32" ? normalized.toLowerCase() : normalized;
    if (seen.has(key)) return;
    seen.add(key);
    roots.push({ path, source });
  };
  if (cwd !== undefined) {
    const project = await findProjectRoot(cwd);
    push(join(project, ".dsh", "skills"), "project-dsh");
    push(join(project, ".agents", "skills"), "project-agents");
  }
  if (options.dshHome !== undefined) push(join(options.dshHome, "skills"), "user-dsh");
  if (options.agentsHome !== undefined) push(join(options.agentsHome, "skills"), "user-agents");
  return roots;
}

/**
 * Collect every skill entry (enabled + disabled, bundles + flat files) under
 * the given roots. Unknown/invalid entries fall back to a name derived from
 * the directory/file name and are still reported (disabled ones must stay
 * manageable). Symlinked directories (workspace junctions pointing into the
 * managed store) are followed, matching the provider's discovery behavior.
 */
export async function collectSkillEntries(roots) {
  const entries = [];
  for (const root of roots) {
    let items;
    try {
      items = await readdir(root.path, { withFileTypes: true });
    } catch {
      continue; // absent root
    }
    for (const item of items) {
      const isDir = item.isDirectory() || (item.isSymbolicLink() && (await stat(join(root.path, item.name)).catch(() => undefined))?.isDirectory() === true);
      if (isDir) {
        const md = join(root.path, item.name, "SKILL.md");
        const disabled = md + DISABLED_SUFFIX;
        if (await pathExists(md)) {
          const parsed = parseFrontmatter(await readFile(md, "utf8").catch(() => ""));
          entries.push({ name: parsed?.name ?? item.name, description: parsed?.description ?? "", whenToUse: parsed?.whenToUse, enabled: true, kind: "bundle", file: md, dirBundle: true, source: root.source });
        } else if (await pathExists(disabled)) {
          const parsed = parseFrontmatter(await readFile(disabled, "utf8").catch(() => ""));
          entries.push({ name: parsed?.name ?? item.name, description: parsed?.description ?? "", whenToUse: parsed?.whenToUse, enabled: false, kind: "bundle", file: disabled, dirBundle: true, source: root.source });
        }
      } else if (item.isFile()) {
        if (item.name.endsWith(".md" + DISABLED_SUFFIX)) {
          const file = join(root.path, item.name);
          const parsed = parseFrontmatter(await readFile(file, "utf8").catch(() => ""));
          entries.push({ name: parsed?.name ?? item.name.slice(0, -(".md" + DISABLED_SUFFIX).length), description: parsed?.description ?? "", whenToUse: parsed?.whenToUse, enabled: false, kind: "flat", file, dirBundle: false, source: root.source });
        } else if (item.name.endsWith(".md")) {
          const file = join(root.path, item.name);
          const parsed = parseFrontmatter(await readFile(file, "utf8"));
          entries.push({ name: parsed?.name ?? item.name.slice(0, -3), description: parsed?.description ?? "", whenToUse: parsed?.whenToUse, enabled: true, kind: "flat", file, dirBundle: false, source: root.source });
        }
      }
    }
  }
  return entries;
}

/**
 * The winning entry for a skill name: the first one in root order (the same
 * precedence the gateway's registry applies).
 */
export function winnerEntry(entries, name) {
  const matches = entries.filter((entry) => entry.name === name);
  if (matches.length === 0) return undefined;
  matches.sort((a, b) => sourceRank(a.source) - sourceRank(b.source));
  return matches[0];
}

/** Stable numeric rank for one root source (lower = higher precedence). */
export function sourceRank(source) {
  switch (source) {
    case "project-dsh": return 1;
    case "project-agents": return 2;
    case "user-dsh": return 3;
    case "user-agents": return 4;
    default: return 9;
  }
}
