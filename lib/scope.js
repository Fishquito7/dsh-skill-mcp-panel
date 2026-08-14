/**
 * dsh-skill-viewer — workspace-scoped skill layout engine.
 *
 * Single source of truth for how a skill can be scoped to one or more
 * workspaces while still living in the global user skills root:
 *
 *   - global (default):   <dshHome>/skills/<name>/SKILL.md   (unchanged)
 *   - scoped:             <dshHome>/skills/.system/skill-viewer/<name>/SKILL.md
 *                         + one junction per workspace:
 *                           <workspaceProjectRoot>/.dsh/skills/<name> -> store dir
 *
 * Why this works with @deepseek-ai/dsh-skill-filesystem:
 *   - the user-dsh root skips its `.system` child, so the store is invisible
 *     to discovery (and its watcher ignores events below `.system`);
 *   - project roots are discovered per session cwd, so a junction inside a
 *     workspace's `.dsh/skills` makes the skill visible ONLY for sessions
 *     whose project root is that workspace;
 *   - discovery follows directory symlinks/junctions (the filesystem service
 *     classifies entries by `stat`, which resolves the reparse point), so the
 *     single stored copy is read through every link.
 *
 * Bindings live in <store>/bindings.json:
 *   { "version": 1, "skills": { "<name>": {
 *       "kind": "bundle" | "flat",        // original layout in the user root
 *       "fileName": string | undefined,   // original flat file name (for restore)
 *       "workspaces": string[]            // project-root paths; scoped only
 *   } } }
 *
 * Global skills carry no binding entry at all — the default state.
 * This module is dependency-free (node:fs / node:path / node:os only).
 */
import { access, cp, lstat, mkdir, readFile, readlink, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { findProjectRoot } from "./skill-files.js";

/** Binding payload version this engine writes. */
export const BINDINGS_VERSION = 1;

/** File name of the bindings manifest inside the managed store. */
export const BINDINGS_FILENAME = "bindings.json";

/** Marker suffix for a hot-disabled skill file (mirrors the provider convention). */
export const DISABLED_SUFFIX = ".disabled";

/** The managed store root: <dshHome>/skills/.system/skill-viewer. */
export function storeRoot(dshHome) {
  return join(dshHome, "skills", ".system", "skill-viewer");
}

/** The bindings manifest path. */
export function bindingsFile(dshHome) {
  return join(storeRoot(dshHome), BINDINGS_FILENAME);
}

/** The stored bundle directory for one scoped skill. */
export function storeSkillDir(dshHome, name) {
  return join(storeRoot(dshHome), name);
}

/** The bundle directory for one global skill in the user root. */
export function userBundleDir(dshHome, name) {
  return join(dshHome, "skills", name);
}

/** The junction a scoped skill gets inside one workspace's project root. */
export function workspaceLink(workspace, name) {
  return join(workspace, ".dsh", "skills", name);
}

/** True when any filesystem entry exists at the path (follows links). */
export async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** True when the path itself is a symlink/junction (lstat semantics). */
export async function isJunction(path) {
  try {
    const info = await lstat(path);
    return info.isSymbolicLink();
  } catch {
    return false;
  }
}

/** Whether a directory path exists and is a directory (follows links). */
export async function isDirectory(path) {
  try {
    const info = await stat(path);
    return info.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Normalize a list of raw workspace paths into distinct project-root paths.
 * Every path must exist; each resolves to its nearest `.git` ancestor (or
 * itself when there is none) because that is where the skill provider looks
 * for `<projectRoot>/.dsh/skills`. Case-insensitive dedupe on Windows.
 * @param paths - raw workspace paths from the UI/CLI.
 * @returns distinct absolute project-root paths, in input order.
 */
export async function normalizeWorkspaces(paths) {
  const seen = new Set();
  const result = [];
  for (const raw of paths) {
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const absolute = resolve(raw.trim());
    if (!(await isDirectory(absolute))) throw new Error('工作区不存在或不是目录："' + raw + '"');
    const project = await findProjectRoot(absolute);
    const key = process.platform === "win32" ? project.toLowerCase() : project;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(project);
  }
  return result;
}

/** Read the bindings manifest; a missing or malformed file is empty state. */
export async function loadBindings(dshHome) {
  try {
    const parsed = JSON.parse(await readFile(bindingsFile(dshHome), "utf8"));
    if (parsed !== null && typeof parsed === "object" && parsed.skills !== null && typeof parsed.skills === "object") return parsed.skills;
  } catch {
    // absent or malformed manifest: treat as empty
  }
  return {};
}

/** Atomically write the bindings manifest (temp file + rename). */
export async function saveBindings(dshHome, skills) {
  await mkdir(storeRoot(dshHome), { recursive: true });
  const target = bindingsFile(dshHome);
  const tmp = `${target}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify({ version: BINDINGS_VERSION, skills }, void 0, 2) + "\n", "utf8");
  await rename(tmp, target);
}

/**
 * Create (or re-point) a junction at `link` towards the directory `target`.
 * Replaces an existing junction whose target differs; a real directory or
 * file at the link path is an error and is never removed.
 * @returns true when the link was created or re-pointed.
 */
export async function ensureJunction(target, link) {
  await mkdir(dirname(link), { recursive: true });
  if (await isJunction(link)) {
    const current = resolve(dirname(link), await readlink(link));
    if (current === resolve(target)) return false;
    await rm(link, { recursive: true, force: true });
  } else if (await pathExists(link)) {
    throw new Error("目标路径已存在且不是联接点：" + link);
  }
  await symlink(target, link, "junction");
  return true;
}

/**
 * Remove a junction at `link`. Real directories are never touched.
 * @returns true when a junction was removed.
 */
export async function removeJunction(link) {
  if (!(await isJunction(link))) return false;
  await rm(link, { recursive: true, force: true });
  return true;
}

/**
 * Move a file or directory with Windows watcher-handle tolerance: try a plain
 * rename first; when the OS reports a sharing violation (the skill provider's
 * watcher may still hold the directory briefly), retry a few times and then
 * fall back to copy + delete.
 * @returns true when the source is gone and the target exists.
 */
export async function movePathRetry(source, target) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await rename(source, target);
      return true;
    } catch (error) {
      if (!isBusyError(error)) throw error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 300 * (attempt + 1)));
    }
  }
  // Copy + delete fallback: deletion of the source also retries.
  await cp(source, target, { recursive: true });
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rm(source, { recursive: true, force: true });
      return true;
    } catch (error) {
      if (!isBusyError(error)) throw error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 300 * (attempt + 1)));
    }
  }
  return false;
}

/** Windows sharing-violation / permission codes that may clear after a beat. */
function isBusyError(error) {
  return error !== null && typeof error === "object" && ["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"].includes(error.code);
}

/**
 * Drop bindings whose workspace no longer carries the skill junction (the
 * workspace was deleted, or its link was removed out-of-band). The stored
 * skill itself is never deleted: a skill with zero remaining workspaces stays
 * in the store and is reported as "无有效工作区" until re-bound or deleted.
 * @param dshHome - harness home.
 * @param skills - current bindings map (mutated in place).
 * @returns names whose workspace list changed.
 */
export async function pruneStaleWorkspaces(dshHome, skills) {
  const changed = [];
  for (const [name, binding] of Object.entries(skills)) {
    const workspaces = Array.isArray(binding?.workspaces) ? binding.workspaces : [];
    if (workspaces.length === 0) continue;
    const kept = [];
    for (const workspace of workspaces) {
      if (!(await isDirectory(workspace))) continue;
      if (!(await isJunction(workspaceLink(workspace, name)))) continue;
      kept.push(workspace);
    }
    if (kept.length !== workspaces.length) {
      binding.workspaces = kept;
      changed.push(name);
    }
  }
  if (changed.length > 0) await saveBindings(dshHome, skills);
  return changed;
}

/**
 * Move one skill between the global user root and the scoped store,
 * creating or removing workspace junctions as needed.
 *
 * @param dshHome - harness home.
 * @param name - skill name (frontmatter name).
 * @param workspaces - `null` for global; otherwise a raw path list whose
 *   entries must exist (each resolves to its project root).
 * @param globalLocator - when the skill is currently global and managed by
 *   the caller's scan, `{ file, dirBundle, enabled }`; otherwise the engine
 *   reads the binding map.
 * @returns the updated binding map entry for the skill (undefined when global).
 */
export async function scopeSkill(dshHome, name, workspaces, globalLocator) {
  const skills = await loadBindings(dshHome);
  const binding = skills[name];
  const storeDir = storeSkillDir(dshHome, name);
  const storeSkillFile = join(storeDir, "SKILL.md");
  const storeDisabledFile = storeSkillFile + DISABLED_SUFFIX;

  if (workspaces === null) {
    // → global. A skill that is already global is a no-op.
    if (binding === undefined) return undefined;
    const disabled = await pathExists(storeDisabledFile);
    // Remove workspace junctions FIRST: DSH's skill watcher follows the
    // junctions into the store and holds directory handles that block
    // renaming the store on Windows; unlinking the junctions lets the
    // watcher release them. Recreated on any later failure.
    const previousLinks = binding.workspaces ?? [];
    for (const workspace of previousLinks) await removeJunction(workspaceLink(workspace, name));
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 400));
    let moved = false;
    try {
      if (binding.kind === "bundle" || binding.fileName === undefined) {
        const target = userBundleDir(dshHome, name);
        if (await pathExists(target)) throw new Error('目标路径已存在："' + target + '"');
        await mkdir(dirname(target), { recursive: true });
        moved = await movePathRetry(storeDir, target);
      } else {
        const fileName = disabled ? binding.fileName + DISABLED_SUFFIX : binding.fileName;
        const target = join(dshHome, "skills", fileName);
        if (await pathExists(target)) throw new Error('目标路径已存在："' + target + '"');
        await mkdir(dirname(target), { recursive: true });
        moved = await movePathRetry(disabled ? storeDisabledFile : storeSkillFile, target);
        if (moved) await rm(storeDir, { recursive: true, force: true }).catch(() => {});
      }
    } catch (error) {
      for (const workspace of previousLinks) await ensureJunction(storeDir, workspaceLink(workspace, name)).catch(() => {});
      throw error;
    }
    if (!moved) {
      for (const workspace of previousLinks) await ensureJunction(storeDir, workspaceLink(workspace, name)).catch(() => {});
      throw new Error('技能 "' + name + '" 无法移回全局目录（文件可能被占用），已恢复原状。请稍后重试');
    }
    delete skills[name];
    await saveBindings(dshHome, skills);
    return undefined;
  }

  // → scoped to one or more workspaces.
  const wanted = await normalizeWorkspaces(workspaces);
  if (wanted.length === 0) throw new Error("至少需要指定一个工作区，或选择“全局”");

  if (binding === undefined) {
    // Currently global: the caller supplies the file locator in the user root.
    if (globalLocator === undefined) throw new Error('技能 "' + name + '" 不在可管理的用户技能目录中');
    const entry = globalLocator;
    if (entry.file === undefined || typeof entry.file !== "string") throw new Error('技能 "' + name + '" 没有可移动的文件');
    const disabled = entry.file.endsWith(DISABLED_SUFFIX);
    const baseName = disabled ? entry.file.slice(0, -DISABLED_SUFFIX.length) : entry.file;
    const fileName = basename(baseName); // SKILL.md for bundles, <file>.md for flat
    await mkdir(storeRoot(dshHome), { recursive: true });
    if (entry.dirBundle) {
      // Move the whole bundle directory into the store.
      await rename(dirname(entry.file), storeDir);
    } else {
      await mkdir(storeDir, { recursive: true });
      await rename(entry.file, disabled ? storeDisabledFile : storeSkillFile);
    }
    const nextBinding = {
      kind: entry.dirBundle ? "bundle" : "flat",
      workspaces: wanted,
      ...(!entry.dirBundle ? { fileName } : {})
    };
    const created = [];
    const moveBack = entry.dirBundle
      ? { from: storeDir, to: dirname(entry.file) }
      : { from: disabled ? storeDisabledFile : storeSkillFile, to: entry.file, thenRemove: storeDir };
    const undoMove = async () => {
      try {
        if (!(await pathExists(moveBack.from))) return;
        if (moveBack.thenRemove !== undefined) {
          await mkdir(dirname(moveBack.to), { recursive: true });
          await rename(moveBack.from, moveBack.to);
          await rm(moveBack.thenRemove, { recursive: true, force: true });
        } else {
          await rename(moveBack.from, moveBack.to);
        }
      } catch {
        // best-effort rollback
      }
    };
    try {
      for (const workspace of wanted) {
        await ensureJunction(storeDir, workspaceLink(workspace, name));
        created.push(workspace);
      }
    } catch (error) {
      for (const workspace of created) await removeJunction(workspaceLink(workspace, name)).catch(() => {});
      await undoMove();
      throw error;
    }
    skills[name] = nextBinding;
    try {
      await saveBindings(dshHome, skills);
    } catch (error) {
      for (const workspace of created) await removeJunction(workspaceLink(workspace, name)).catch(() => {});
      await undoMove();
      delete skills[name];
      throw error;
    }
    return nextBinding;
  }

  // Already scoped: adjust the workspace set.
  const previous = binding.workspaces ?? [];
  const removed = previous.filter((workspace) => !wanted.includes(workspace));
  const added = wanted.filter((workspace) => !previous.includes(workspace));
  for (const workspace of removed) await removeJunction(workspaceLink(workspace, name));
  const created = [];
  try {
    for (const workspace of added) {
      await ensureJunction(storeDir, workspaceLink(workspace, name));
      created.push(workspace);
    }
  } catch (error) {
    for (const workspace of created) await removeJunction(workspaceLink(workspace, name));
    throw error;
  }
  binding.workspaces = wanted;
  await saveBindings(dshHome, skills);
  return binding;
}

/** Best-effort undo for a failed scoping transition (unused helper kept out of the API). */
async function rollbackLayout() {}

/**
 * Delete a scoped skill completely: junctions, stored files, and its binding.
 * Never touches anything outside the managed store. Junctions are removed
 * first and the store deletion retries, tolerating the provider watcher's
 * transient directory handles.
 */
export async function deleteScopedSkill(dshHome, name) {
  const skills = await loadBindings(dshHome);
  const binding = skills[name];
  if (binding === undefined) return false;
  for (const workspace of binding.workspaces ?? []) await removeJunction(workspaceLink(workspace, name));
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 400));
  const dir = storeSkillDir(dshHome, name);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rm(dir, { recursive: true, force: true });
      break;
    } catch (error) {
      if (!isBusyError(error) || attempt === 4) throw error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 300 * (attempt + 1)));
    }
  }
  delete skills[name];
  await saveBindings(dshHome, skills);
  return true;
}

/** Whether the stored scoped skill is currently enabled (SKILL.md present). */
export async function scopedEnabled(dshHome, name) {
  return await pathExists(join(storeSkillDir(dshHome, name), "SKILL.md"));
}

/** Hot enable/disable a scoped skill inside the store (rename convention). */
export async function setScopedEnabled(dshHome, name, enabled) {
  const dir = storeSkillDir(dshHome, name);
  const file = join(dir, "SKILL.md");
  const disabled = file + DISABLED_SUFFIX;
  if (enabled) {
    if (!(await pathExists(disabled))) return false;
    await rename(disabled, file);
  } else {
    if (!(await pathExists(file))) return false;
    await rename(file, disabled);
  }
  return true;
}

/** Raw content of a scoped skill (enabled or disabled copy). */
export async function scopedContent(dshHome, name) {
  const dir = storeSkillDir(dshHome, name);
  const file = join(dir, "SKILL.md");
  const disabled = file + DISABLED_SUFFIX;
  for (const candidate of [file, disabled]) {
    try {
      return await readFile(candidate, "utf8");
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}
