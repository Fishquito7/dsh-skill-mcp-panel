#!/usr/bin/env node
/**
 * dsh-skill - hot skill management CLI for the dsh-skill-viewer plugin.
 *
 * Works directly on the skill files the DSH skill-filesystem provider reads;
 * the running gateway picks changes up through its file watcher (no restart).
 *
 *   dsh-skill list                     list skills (project + user roots)
 *   dsh-skill enable <name>            re-enable a disabled skill
 *   dsh-skill disable <name>           hot-disable a skill (rename to *.disabled)
 *   dsh-skill delete <name> [--yes]    delete a skill permanently
 *   dsh-skill add <path>               add a skill (.md file, or a bundle dir
 *                                      whose top level contains SKILL.md)
 *   dsh-skill scope <name>             change scope: --global | --workspace <path>...
 *   --cwd <path>                       project root anchor (default: current dir)
 *   --project                          add into the project root instead of ~/.dsh/skills
 *   --workspace <path>                 add/scope the skill to a workspace
 *                                      (repeatable; stored once, junction-linked)
 */
import { copyFile, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import {
  DISABLED_SUFFIX,
  buildRoots,
  collectSkillEntries,
  pathExists,
  validateFrontmatter,
  winnerEntry
} from "../lib/skill-files.js";
import {
  deleteScopedSkill,
  ensureJunction,
  loadBindings,
  normalizeWorkspaces,
  saveBindings,
  scopeSkill,
  scopedEnabled,
  setScopedEnabled,
  storeRoot,
  storeSkillDir
} from "../lib/scope.js";

function usage() {
  console.log([
    "用法:",
    "  dsh-skill list [--cwd <path>]                         列出技能（项目 + 用户根，按生效优先级）",
    "  dsh-skill enable <name> [--cwd <path>]                启用已停用的技能",
    "  dsh-skill disable <name> [--cwd <path>]               停用技能（改名 *.disabled，热生效）",
    "  dsh-skill delete <name> [--yes] [--cwd <path>]        删除技能（目录型删整个目录）",
    "  dsh-skill add <path> [--cwd <path>] [--project] [--workspace <path>...]",
    "                                                        添加技能：单个 .md 文件或含顶层 SKILL.md 的目录束",
    "  dsh-skill scope <name> [--global | --workspace <path>...]",
    "                                                        设置技能作用域：全局（默认）或限定工作区",
    "",
    "说明: 停用 = 把 SKILL.md 改名 SKILL.md.disabled；网关的监听器会热感知，",
    "无需重启。add 默认写入 ~/.dsh/skills（--project 写入项目 .dsh/skills）。",
    "限定工作区（--workspace）时技能只存一份（~/.dsh/skills/.system/skill-viewer），",
    "在每个工作区的 .dsh/skills 下建立联接点，仅这些工作区的会话可见；",
    "工作区删除后联接点随之消失、绑定自动清理，技能本身不会丢失。",
    "随部署附带的技能（bundled）不在本工具管理范围内。"
  ].join("\n"));
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolvePromise) => {
    rl.question(question, (value) => {
      rl.close();
      resolvePromise(value.trim().toLowerCase());
    });
  });
  return answer === "y" || answer === "yes";
}

/** Resolve the user roots the same way the host plugin does. */
function userHomes() {
  const dshHome = resolve(process.env.DSH_HOME && process.env.DSH_HOME.trim() ? process.env.DSH_HOME : join(homedir(), ".dsh"));
  const agentsHome = resolve(process.env.DSH_AGENTS_HOME && process.env.DSH_AGENTS_HOME.trim() ? process.env.DSH_AGENTS_HOME : join(homedir(), ".agents"));
  return { dshHome, agentsHome };
}

/**
 * Recursively list regular files under a directory as { full, relative } with
 * forward-slash relative paths. Symlinked files are followed; symlinked
 * directories are skipped so a cycle can never be traversed.
 */
async function walkFiles(dir, rel = "", out = []) {
  const items = await readdir(dir, { withFileTypes: true });
  for (const item of items) {
    const full = join(dir, item.name);
    const childRel = rel === "" ? item.name : rel + "/" + item.name;
    if (item.isDirectory()) {
      await walkFiles(full, childRel, out);
    } else if (item.isFile()) {
      out.push({ full, relative: childRel });
    } else if (item.isSymbolicLink()) {
      const target = await stat(full).catch(() => undefined);
      if (target?.isFile()) out.push({ full, relative: childRel });
    }
  }
  return out;
}

/**
 * Add a skill from a local path, mirroring the Web UI add flow:
 *   bundle = a directory whose top level contains SKILL.md
 *   flat   = a single markdown file
 *
 * Every validation step runs BEFORE anything is written (frontmatter,
 * duplicate name across all roots, destination conflicts, unsafe layouts).
 * The copy itself is staged inside the destination root and renamed into
 * place at the end, so any failure mid-write rolls back cleanly.
 *
 * With `workspaces` the skill is stored once in the managed store and
 * junction-linked into each workspace's project `.dsh/skills` directory.
 */
async function addSkill(sourceArg, flags, roots, entries) {
  const source = resolve(sourceArg);
  const info = await stat(source).catch(() => undefined);
  if (info === undefined) throw new Error("路径不存在：" + sourceArg);
  if (!info.isDirectory() && !info.isFile()) throw new Error("只支持 .md 文件或包含顶层 SKILL.md 的目录束：" + sourceArg);

  // 1) Kind + frontmatter validation + canonical name (nothing written yet).
  let kind;
  let name;
  if (info.isDirectory()) {
    const skillMd = join(source, "SKILL.md");
    if (!(await pathExists(skillMd))) throw new Error("目录束缺少顶层的 SKILL.md 文件：" + sourceArg);
    const validation = validateFrontmatter(await readFile(skillMd, "utf8"));
    if (!validation.ok) throw new Error("技能格式不符合要求：" + validation.error);
    kind = "bundle";
    name = validation.skill.name;
  } else {
    if (!sourceArg.toLowerCase().endsWith(".md")) throw new Error("单个技能文件必须是 .md 文件：" + sourceArg);
    if (basename(source).toLowerCase() === "skill.md") throw new Error("单文件不能直接叫 SKILL.md，请把它放进一个文件夹里作为目录束添加");
    const validation = validateFrontmatter(await readFile(source, "utf8"));
    if (!validation.ok) throw new Error("技能格式不符合要求：" + validation.error);
    kind = "flat";
    name = validation.skill.name;
  }

  // 2) Destination root: project root, scoped store, or the user root.
  const homes = userHomes();
  const scoped = flags.workspaces !== undefined && flags.workspaces.length > 0;
  let destRoot;
  if (scoped) {
    destRoot = storeSkillDir(homes.dshHome, name);
  } else if (flags.project) {
    destRoot = roots.find((root) => root.source === "project-dsh")?.path;
    if (destRoot === undefined) throw new Error("找不到目标技能根（--project 需要当前目录锚定一个项目根）");
  } else {
    destRoot = join(homes.dshHome, "skills");
  }
  // Scoped skills always live in the store dir (store/<name>/SKILL.md) with a
  // junction at each workspace's .dsh/skills/<name>; the original flat file
  // name is kept in the binding so un-scoping can restore it.
  const target = scoped
    ? (kind === "bundle" ? destRoot : join(destRoot, "SKILL.md"))
    : kind === "bundle" ? join(destRoot, name) : join(destRoot, basename(source));

  // 3) Duplicate + layout guards.
  const existing = winnerEntry(entries, name);
  if (existing !== undefined) throw new Error('同名技能 "' + name + '" 已存在（' + existing.source + "，" + (existing.enabled ? "已启用" : "已停用") + "）");
  const bindings = await loadBindings(homes.dshHome);
  if (bindings[name] !== undefined) throw new Error('同名技能 "' + name + '" 已存在（工作区限定）');
  if (await pathExists(target)) throw new Error("目标路径已存在：" + target);
  const resolvedRoot = resolve(destRoot);
  if (resolve(source) === resolve(target)) throw new Error("源路径与目标相同，无需添加：" + sourceArg);
  if (resolvedRoot.startsWith(resolve(source))) throw new Error("源路径不能是目标技能根本身或其上级目录：" + sourceArg);

  // 4) Staged copy + atomic rename; roll back on any failure.
  // For scoped adds the store dir (store/<name>) is the destination of the
  // bundle staging, so the staging directory lives OUTSIDE it; for flat adds
  // the staged file is renamed to store/<name>/SKILL.md.
  const stagingBase = kind === "bundle" ? dirname(target) : destRoot;
  await mkdir(stagingBase, { recursive: true });
  const staging = join(stagingBase, ".dsh-skill-staging-" + process.pid + "-" + Math.random().toString(36).slice(2, 8));
  try {
    if (kind === "bundle") {
      for (const file of await walkFiles(source)) {
        const dest = join(staging, file.relative);
        await mkdir(dirname(dest), { recursive: true });
        await copyFile(file.full, dest);
      }
      await rename(staging, target);
    } else {
      await mkdir(staging, { recursive: true });
      const stagedFile = join(staging, basename(source));
      await copyFile(source, stagedFile);
      await rename(stagedFile, target);
      await rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    throw new Error("写入技能文件失败（已回滚）：" + (error instanceof Error ? error.message : String(error)));
  }

  // 5) Workspace links + binding for scoped adds.
  // The junction must point at the store DIRECTORY (store/<name>) — the same
  // layout the provider discovers for both bundle and flat skills.
  const created = [];
  if (scoped) {
    const workspaces = await normalizeWorkspaces(flags.workspaces);
    if (workspaces.length === 0) throw new Error("至少需要指定一个存在的工作区");
    const junctionTarget = destRoot;
    try {
      for (const workspace of workspaces) {
        await ensureJunction(junctionTarget, join(workspace, ".dsh", "skills", name));
        created.push(workspace);
      }
      bindings[name] = {
        kind: kind === "bundle" ? "bundle" : "flat",
        workspaces,
        ...(kind === "flat" ? { fileName: basename(source) } : {})
      };
      await saveBindings(homes.dshHome, bindings);
    } catch (error) {
      for (const workspace of created) await rm(join(workspace, ".dsh", "skills", name), { recursive: true, force: true }).catch(() => {});
      await rm(target, { recursive: true, force: true }).catch(() => {});
      delete bindings[name];
      throw new Error("绑定工作区失败（已回滚）：" + (error instanceof Error ? error.message : String(error)));
    }
    return { name, kind, target, scoped: true, workspaces: created };
  }
  return { name, kind, target, scoped: false };
}

/** Human-readable scope suffix for list output. */
function scopeTag(entry, bindings) {
  const binding = bindings[entry.name];
  if (binding !== undefined && binding.workspaces !== undefined) {
    const n = binding.workspaces.length;
    if (n === 0) return " [0 个工作区]";
    return " [" + n + " 个工作区]";
  }
  if (entry.source === "project-dsh" || entry.source === "project-agents") return " [项目]";
  return " [全局]";
}

async function main() {
  const args = process.argv.slice(2);
  const flags = { cwd: process.cwd(), yes: false, project: false, workspaces: [] };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--cwd") {
      i += 1;
      if (i >= args.length) {
        console.error("--cwd 需要一个路径参数");
        process.exit(2);
      }
      flags.cwd = args[i];
    } else if (args[i] === "--workspace") {
      i += 1;
      if (i >= args.length) {
        console.error("--workspace 需要一个路径参数");
        process.exit(2);
      }
      flags.workspaces.push(args[i]);
    } else if (args[i] === "--yes") flags.yes = true;
    else if (args[i] === "--project") flags.project = true;
    else if (args[i] === "--global") flags.global = true;
    else if (args[i] === "--help" || args[i] === "-h") {
      usage();
      return;
    } else positional.push(args[i]);
  }
  const command = positional[0];
  const name = positional[1];
  if (command === undefined) {
    usage();
    process.exit(2);
  }

  const homes = userHomes();
  const roots = await buildRoots(flags.cwd, homes);
  const entries = await collectSkillEntries(roots);
  const bindings = await loadBindings(homes.dshHome);

  if (command === "list") {
    const all = [...entries];
    for (const [managedName, binding] of Object.entries(bindings)) {
      if (all.some((entry) => entry.name === managedName)) continue;
      if (binding === undefined || binding.workspaces === undefined) continue;
      all.push({
        name: managedName,
        description: "",
        enabled: await scopedEnabled(homes.dshHome, managedName),
        kind: "bundle",
        file: join(storeSkillDir(homes.dshHome, managedName), "SKILL.md"),
        dirBundle: true,
        source: "user-dsh"
      });
    }
    if (all.length === 0) {
      console.log("未找到技能。（搜索范围：项目 .dsh/skills、.agents/skills 与用户 ~/.dsh/skills、~/.agents/skills）");
      return;
    }
    all.sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source));
    for (const entry of all) {
      const state = entry.enabled ? "启用" : "停用";
      const detail = entry.description.length > 70 ? entry.description.slice(0, 70) + "…" : entry.description;
      console.log([state, entry.name, "[" + entry.source + "]" + scopeTag(entry, bindings), detail].filter(Boolean).join("\t"));
    }
    return;
  }

  if (command === "add") {
    if (name === undefined) {
      console.error("add 需要一个路径参数（单个 .md 文件或包含顶层 SKILL.md 的目录束）");
      process.exit(2);
    }
    const added = await addSkill(name, flags, roots, entries);
    if (added.scoped) {
      console.log('已添加技能 "' + added.name + '"（限定工作区：' + added.workspaces.join("、") + " → " + added.target + "，网关监听器将热感知）");
    } else {
      console.log('已添加技能 "' + added.name + '"（' + (added.kind === "bundle" ? "目录束" : "单文件") + " → " + added.target + "，网关监听器将热感知）");
    }
    return;
  }

  if (command === "scope") {
    if (name === undefined) {
      console.error("scope 需要一个技能名参数");
      process.exit(2);
    }
    if (flags.global && flags.workspaces.length > 0) {
      console.error("--global 与 --workspace 不能同时使用");
      process.exit(2);
    }
    const workspaces = flags.global ? null : flags.workspaces.length > 0 ? flags.workspaces : null;
    if (!flags.global && flags.workspaces.length === 0) {
      console.error("scope 需要 --global 或至少一个 --workspace <path>");
      process.exit(2);
    }
    const binding = bindings[name];
    let globalLocator;
    if (binding === undefined) {
      const entry = winnerEntry(entries, name);
      if (entry === undefined || entry.source !== "user-dsh") throw new Error('技能 "' + name + '" 不在用户技能目录中，无法设置作用域');
      globalLocator = entry;
    }
    await scopeSkill(homes.dshHome, name, workspaces, globalLocator);
    if (workspaces === null) {
      console.log('技能 "' + name + '" 已恢复为全局使用');
    } else {
      const resolved = await normalizeWorkspaces(workspaces);
      console.log('技能 "' + name + '" 已限定到 ' + resolved.length + ' 个工作区：' + resolved.join("、"));
    }
    return;
  }

  if (name === undefined) {
    console.error(command + " 需要一个技能名参数");
    process.exit(2);
  }
  const managed = bindings[name];
  if (managed !== undefined && managed.workspaces !== undefined && (command === "enable" || command === "disable" || command === "delete")) {
    if (command === "enable") {
      await setScopedEnabled(homes.dshHome, name, true);
      console.log('已启用技能 "' + name + '"（网关监听器将热感知，无需重启）');
      return;
    }
    if (command === "disable") {
      await setScopedEnabled(homes.dshHome, name, false);
      console.log('已停用技能 "' + name + '"（网关监听器将热感知，无需重启）');
      return;
    }
    if (command === "delete") {
      if (!flags.yes) {
        const ok = await confirm('确认删除技能 "' + name + '"？此操作不可恢复 (y/N): ');
        if (!ok) {
          console.log("已取消");
          return;
        }
      }
      await deleteScopedSkill(homes.dshHome, name);
      console.log('已删除技能 "' + name + '"（含工作区联接点）');
      return;
    }
  }
  const entry = winnerEntry(entries, name);
  if (entry === undefined) {
    console.error('技能 "' + name + '" 未找到（项目与用户技能根中均不存在）');
    process.exit(1);
  }
  if (command === "enable") {
    if (entry.enabled) {
      console.log('技能 "' + name + '" 已是启用状态');
      return;
    }
    const target = entry.file.slice(0, -DISABLED_SUFFIX.length);
    await rename(entry.file, target);
    console.log('已启用技能 "' + name + '"（网关监听器将热感知，无需重启）');
    return;
  }
  if (command === "disable") {
    if (!entry.enabled) {
      console.log('技能 "' + name + '" 已是停用状态');
      return;
    }
    const target = entry.file + DISABLED_SUFFIX;
    if (await pathExists(target)) {
      console.error("目标文件已存在：" + target);
      process.exit(1);
    }
    await rename(entry.file, target);
    console.log('已停用技能 "' + name + '"（网关监听器将热感知，无需重启）');
    return;
  }
  if (command === "delete") {
    if (!flags.yes) {
      const ok = await confirm('确认删除技能 "' + name + '"？此操作不可恢复 (y/N): ');
      if (!ok) {
        console.log("已取消");
        return;
      }
    }
    if (entry.dirBundle) await rm(dirname(entry.file), { recursive: true, force: true });
    else await rm(entry.file, { force: true });
    console.log('已删除技能 "' + name + '"');
    return;
  }
  console.error('未知命令 "' + command + '"');
  usage();
  process.exit(2);
}

main().catch((error) => {
  console.error("dsh-skill: " + (error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
