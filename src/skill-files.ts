/**
 * dsh-skill-viewer —— 技能文件约定的统一来源（宿主与 CLI 共用）。
 *
 * 技能在磁盘上如何存放，以本模块为准，被以下两处共用：
 *   - src/index.ts  （宿主半区：目录合并、热启用/停用、删除、添加）
 *   - src/cli.ts    （管理命令行）
 *
 * 约定（必须与 @deepseek-ai/dsh-skill-filesystem 的发现行为一致）：
 *   - 目录束：  <root>/<name>/SKILL.md   （技能名取自 frontmatter）
 *   - 单文件：  <root>/<name>.md          （技能名取自 frontmatter）
 *   - 停用 = 改名为 "*.disabled"，此后提供方不再列出该技能。
 *   - frontmatter：位于 "---" 行之间的 YAML 块，含 name + description。
 *
 * 本模块只依赖 node:fs / node:path / node:os 以及 `yaml` 包
 * （与 dsh-skill-filesystem 解析 frontmatter 用的是同一个解析器）。
 */
import { access, readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

/** 热停用技能文件的后缀标记。 */
export const DISABLED_SUFFIX = ".disabled";

/** 公开的技能命名规则（kebab-case，小写字母与数字）。 */
export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * 把 CRLF / CR 归一为 LF。Windows 上很常见 CRLF 的 SKILL.md：截取 frontmatter
 * 时尾部会残留孤立 \r，yaml 解析器会报「Unexpected scalar at node end」。
 */
export function normalizeNewlines(raw) {
  return String(raw).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** 判断文件系统路径是否存在。 */
export async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** 项目锚点：向上找最近的含 .git 的祖先目录；找不到就退回 cwd 本身。 */
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
 * 面向列表/扫描的宽松 frontmatter 读取（name + description + body）。
 * 文件看起来不像技能时返回 undefined。
 */
export function parseFrontmatter(raw) {
  const text = normalizeNewlines(raw).trimStart();
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
 * 面向新技能的严格 frontmatter 校验，与 dsh-skill-filesystem 的接收规则
 * 完全一致（同一个 YAML 解析器、同一套字段策略），保证会被 DSH 拒绝的
 * 内容永远不会被写入：
 *   - name：必填，kebab-case 命名规则
 *   - description：必填，非空字符串
 *   - whenToUse：出现时必须是字符串
 *   - disable-model-invocation / user-invocable：布尔式取值
 *   - 旧版 invocation 字段会被拒绝
 *   - metadata：出现时必须是对象
 * @returns { ok: true, skill } 或 { ok: false, error }（带可读原因）。
 */
export function validateFrontmatter(raw: string): { ok: true; skill: { name: string; description: string; whenToUse?: string; body: string } } | { ok: false; error: string } {
  const text = normalizeNewlines(raw).trimStart();
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
 * 管理根目录：项目根（锚定到 cwd 的 git 根）+ 用户根。
 * 顺序即发现优先级（越靠前越先命中），与提供方的分级一致：
 * 项目 .dsh > 项目 .agents > 用户 .dsh > 用户 .agents。
 *
 * 解析后指向同一目录的根（例如在主目录下运行、项目锚点回退到 cwd 本身）
 * 会被去重，保留第一个（优先级更高的）标签。
 */
export async function buildRoots(cwd, options: any = {}) {
  const roots: any[] = [];
  const seen = new Set();
  const push = (path, source, projectRoot) => {
    const normalized = resolve(path);
    const key = process.platform === "win32" ? normalized.toLowerCase() : normalized;
    if (seen.has(key)) return;
    seen.add(key);
    roots.push({ path, source, projectRoot });
  };
  if (cwd !== undefined) {
    const project = await findProjectRoot(cwd);
    push(join(project, ".dsh", "skills"), "project-dsh", project);
    push(join(project, ".agents", "skills"), "project-agents", project);
  }
  if (options.dshHome !== undefined) push(join(options.dshHome, "skills"), "user-dsh", undefined);
  if (options.agentsHome !== undefined) push(join(options.agentsHome, "skills"), "user-agents", undefined);
  return roots;
}

/**
 * 收集给定根目录下的全部技能条目（启用 + 停用、目录束 + 单文件）。
 * 未知/不合规的条目退回按目录名/文件名取名，仍会列出（停用条目必须保持
 * 可管理）。符号链接目录（指向工作区的联接点）会被跟随，与提供方的发现
 * 行为一致。
 */
export async function collectSkillEntries(roots) {
  const entries: any[] = [];
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
          entries.push({ name: parsed?.name ?? item.name, description: parsed?.description ?? "", whenToUse: parsed?.whenToUse, enabled: true, kind: "bundle", file: md, dirBundle: true, source: root.source, projectRoot: root.projectRoot });
        } else if (await pathExists(disabled)) {
          const parsed = parseFrontmatter(await readFile(disabled, "utf8").catch(() => ""));
          entries.push({ name: parsed?.name ?? item.name, description: parsed?.description ?? "", whenToUse: parsed?.whenToUse, enabled: false, kind: "bundle", file: disabled, dirBundle: true, source: root.source, projectRoot: root.projectRoot });
        }
      } else if (item.isFile()) {
        if (item.name.endsWith(".md" + DISABLED_SUFFIX)) {
          const file = join(root.path, item.name);
          const parsed = parseFrontmatter(await readFile(file, "utf8").catch(() => ""));
          entries.push({ name: parsed?.name ?? item.name.slice(0, -(".md" + DISABLED_SUFFIX).length), description: parsed?.description ?? "", whenToUse: parsed?.whenToUse, enabled: false, kind: "flat", file, dirBundle: false, source: root.source, projectRoot: root.projectRoot });
        } else if (item.name.endsWith(".md")) {
          const file = join(root.path, item.name);
          const parsed = parseFrontmatter(await readFile(file, "utf8"));
          entries.push({ name: parsed?.name ?? item.name.slice(0, -3), description: parsed?.description ?? "", whenToUse: parsed?.whenToUse, enabled: true, kind: "flat", file, dirBundle: false, source: root.source, projectRoot: root.projectRoot });
        }
      }
    }
  }
  return entries;
}

/**
 * 某技能名的胜出条目：按根目录顺序取第一个（与网关注册表的优先级一致）。
 */
export function winnerEntry(entries, name) {
  const matches = entries.filter((entry) => entry.name === name);
  if (matches.length === 0) return undefined;
  matches.sort((a, b) => sourceRank(a.source) - sourceRank(b.source));
  return matches[0];
}

/** 根来源的稳定数字分级（越小优先级越高）。 */
export function sourceRank(source) {
  switch (source) {
    case "project-dsh": return 1;
    case "project-agents": return 2;
    case "user-dsh": return 3;
    case "user-agents": return 4;
    default: return 9;
  }
}
