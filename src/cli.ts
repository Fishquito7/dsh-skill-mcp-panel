#!/usr/bin/env node
/**
 * dsh-skill —— dsh-skill-viewer 插件的热管理命令行。
 *
 * 直接操作 DSH 技能文件系统提供方读取的技能文件；运行中的网关通过文件
 * 监听器热感知变化（无需重启）。
 *
 * 实体模型（0.3.0）：一个技能只存在于一个位置（全局或工作区）的文件夹——
 *   - 全局：    ~/.dsh/skills
 *   - 工作区：  <workspaceProjectRoot>/.dsh/skills
 *
 *   dsh-skill list                     列出技能（标注全局 / 工作区）
 *   dsh-skill enable <name>            重新启用已停用的技能
 *   dsh-skill disable <name>           热停用技能（改名 *.disabled）
 *   dsh-skill delete <name> [--yes]    永久删除技能
 *   dsh-skill add <path>               添加技能（.md 文件或含顶层 SKILL.md 的目录束）
 *   dsh-skill scope <name>             迁移单个技能：--global | --workspace <path>
 *   dsh-skill migrate <name...>        批量迁移：--from --to [--copy] [--all]
 *   dsh-skill update [--yes]           检查并更新插件（默认 --profile web）
 *   --cwd <path>                       项目根锚点（默认当前目录）
 *   --project                          添加到项目根而非 ~/.dsh/skills
 *   --workspace <path>                 add/scope 的目标工作区
 *   --profile <name>                   update 目标配置（默认 web）
 *   --copy                             复制而非移动
 */
import { copyFile, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import {
  DISABLED_SUFFIX,
  buildRoots,
  collectSkillEntries,
  pathExists,
  validateFrontmatter,
  winnerEntry
} from "./skill-files.js";
import {
  batchMigrateEntries,
  migrateEntry,
  normalizeWorkspace,
  workspaceSkillRoot,
  workspaceTitleMap
} from "./scope.js";
import { compareVersions, currentVersion, fetchLatestVersion } from "./version.js";

function usage() {
  console.log([
    "用法:",
    "  dsh-skill list [--cwd <path>]                         列出技能（标注全局 / 工作区）",
    "  dsh-skill enable <name> [--cwd <path>]                启用已停用的技能",
    "  dsh-skill disable <name> [--cwd <path>]               停用技能（改名 *.disabled，热生效）",
    "  dsh-skill delete <name> [--yes] [--cwd <path>]        删除技能（目录型删整个目录）",
    "  dsh-skill add <path> [--cwd <path>] [--project | --workspace <path>]",
    "                                                        添加技能：单个 .md 文件或含顶层 SKILL.md 的目录束",
    "  dsh-skill scope <name> [--global | --workspace <path>] [--copy]",
    "                                                        迁移单个技能到全局或指定工作区（默认移动，--copy 复制）",
    "  dsh-skill migrate <name...|--all> --from <global|路径> --to <global|路径> [--copy] [--yes]",
    "                                                        批量迁移：把源工作区的技能复制/移动到目标工作区",
    "  dsh-skill update [--yes] [--profile <name>]          检查最新版本，有更新则自动安装（默认 web 配置）",
    "",
    "说明: 技能实体直接存放在其工作区的技能文件夹内——全局在 ~/.dsh/skills，",
    "限定工作区在该工作区的 .dsh/skills。停用 = 把 SKILL.md 改名 SKILL.md.disabled；",
    "网关的监听器会热感知，无需重启。迁移默认是移动（源删除），--copy 保留源。",
    "CLI 只扫描当前目录锚定的项目根与用户根；管理其他工作区的技能请加 --cwd <工作区路径>。",
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

/** 以与宿主插件相同的方式解析用户根目录。 */
function userHomes() {
  const dshHome = resolve(process.env.DSH_HOME && process.env.DSH_HOME.trim() ? process.env.DSH_HOME : join(homedir(), ".dsh"));
  const agentsHome = resolve(process.env.DSH_AGENTS_HOME && process.env.DSH_AGENTS_HOME.trim() ? process.env.DSH_AGENTS_HOME : join(homedir(), ".agents"));
  return { dshHome, agentsHome };
}

/**
 * 递归列出目录下的普通文件，返回 { full, relative }（相对路径用正斜杠）。
 * 符号链接文件会被跟随；符号链接目录会被跳过，因此永远不会陷入循环。
 */
async function walkFiles(dir: any, rel = "", out: any[] = []) {
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
 * 从本地路径添加技能，与 Web 端添加流程一致：
 *   目录束 = 顶层含 SKILL.md 的目录
 *   单文件 = 单个 markdown 文件
 *
 * 所有校验都发生在任何写入之前（frontmatter、跨根重名、目标冲突、
 * 不安全布局）。复制本身先在目标根内暂存、最后改名就位，因此中途任何
 * 失败都会干净回滚。目标即对应位置的技能文件夹：--workspace → 该工作区的
 * .dsh/skills，--project → cwd 项目的 .dsh/skills，默认 → 全局。
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

  // 2) 目标位置的技能文件夹。
  const homes = userHomes();
  const titles = await workspaceTitleMap(homes.dshHome);
  let destRoot;
  if (flags.workspace !== undefined) {
    destRoot = workspaceSkillRoot(await normalizeWorkspace(flags.workspace));
  } else if (flags.project) {
    destRoot = roots.find((root) => root.source === "project-dsh")?.path;
    if (destRoot === undefined) throw new Error("找不到目标技能根（--project 需要当前目录锚定一个项目根）");
  } else {
    destRoot = join(homes.dshHome, "skills");
  }
  const target = kind === "bundle" ? join(destRoot, name) : join(destRoot, basename(source));

  // 3) 重名与布局防护。
  const existing = winnerEntry(entries, name);
  if (existing !== undefined) throw new Error('同名技能 "' + name + '" 已存在（' + existing.source + "，" + (existing.enabled ? "已启用" : "已停用") + "）");
  if (await pathExists(target)) throw new Error("目标路径已存在：" + target);
  if (resolve(source) === resolve(target)) throw new Error("源路径与目标相同，无需添加：" + sourceArg);
  const normForCompare = (p) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));
  const sourceNorm = normForCompare(source);
  const destNorm = normForCompare(destRoot);
  const sep = process.platform === "win32" ? "\\" : "/";
  if (destNorm === sourceNorm || destNorm.startsWith(sourceNorm.endsWith(sep) ? sourceNorm : sourceNorm + sep)) throw new Error("源路径不能是目标技能根本身或其上级目录：" + sourceArg);

  // 4) 暂存复制 + 原子改名；任何失败都回滚。
  await mkdir(destRoot, { recursive: true });
  const staging = join(destRoot, ".dsh-skill-staging-" + process.pid + "-" + Math.random().toString(36).slice(2, 8));
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
  return { name, kind, target };
}

/** 列表输出用的人类可读位置标签（全局 / 工作区）。 */
function scopeLabel(entry, titles) {
  if (entry.projectRoot !== undefined) {
    const key = process.platform === "win32" ? entry.projectRoot.toLowerCase() : entry.projectRoot;
    const title = titles.get(key);
    if (title !== undefined) return "工作区: " + title;
    return "工作区: " + (basename(entry.projectRoot) || entry.projectRoot);
  }
  return "全局";
}

/** 执行更新命令（透传输出），返回退出码。 */
function runUpdate(profile: string, version: string): Promise<number> {
  return new Promise<number>((resolve) => {
    const child = spawn("dsh", ["plugin", "--profile", profile, "add", "github:Fishquito7/dsh-skill-viewer#v" + version], {
      stdio: "inherit",
      shell: process.platform === "win32"
    });
    child.on("error", () => resolve(127));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const args = process.argv.slice(2);
  const flags: any = { cwd: process.cwd(), yes: false, project: false, workspace: undefined, global: false, copy: false, from: undefined, to: undefined, all: false, profile: "web" };
  const positional: any[] = [];
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
      flags.workspace = args[i];
    } else if (args[i] === "--from") {
      i += 1;
      if (i >= args.length) {
        console.error("--from 需要一个路径参数（或 global）");
        process.exit(2);
      }
      flags.from = args[i];
    } else if (args[i] === "--to") {
      i += 1;
      if (i >= args.length) {
        console.error("--to 需要一个路径参数（或 global）");
        process.exit(2);
      }
      flags.to = args[i];
    } else if (args[i] === "--profile") {
      i += 1;
      if (i >= args.length) {
        console.error("--profile 需要一个配置名参数");
        process.exit(2);
      }
      flags.profile = args[i];
    } else if (args[i] === "--yes") flags.yes = true;
    else if (args[i] === "--project") flags.project = true;
    else if (args[i] === "--global") flags.global = true;
    else if (args[i] === "--copy") flags.copy = true;
    else if (args[i] === "--all") flags.all = true;
    else if (args[i] === "--help" || args[i] === "-h") {
      usage();
      return;
    } else positional.push(args[i]);
  }
  const command = positional[0];
  const name = positional[1];
  const names = positional.slice(1);
  if (command === undefined) {
    usage();
    process.exit(2);
  }

  const homes = userHomes();
  const titles = await workspaceTitleMap(homes.dshHome);
  const roots = await buildRoots(flags.cwd, homes);
  const entries = await collectSkillEntries(roots);

  if (command === "list") {
    if (entries.length === 0) {
      console.log("未找到技能。（搜索范围：项目 .dsh/skills、.agents/skills 与用户 ~/.dsh/skills、~/.agents/skills）");
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source));
    for (const entry of entries) {
      const state = entry.enabled ? "启用" : "停用";
      const detail = entry.description.length > 70 ? entry.description.slice(0, 70) + "…" : entry.description;
      console.log([state, entry.name, "[" + entry.source + "]", scopeLabel(entry, titles), detail].filter(Boolean).join("	"));
    }
    return;
  }

  if (command === "add") {
    if (name === undefined) {
      console.error("add 需要一个路径参数（单个 .md 文件或包含顶层 SKILL.md 的目录束）");
      process.exit(2);
    }
    if (flags.workspace !== undefined && flags.project) {
      console.error("--workspace 与 --project 不能同时使用");
      process.exit(2);
    }
    const added = await addSkill(name, flags, roots, entries);
    const where = flags.workspace !== undefined ? "工作区 " + (await normalizeWorkspace(flags.workspace)) : flags.project ? "项目根" : "全局";
    console.log('已添加技能 "' + added.name + '"（' + (added.kind === "bundle" ? "目录束" : "单文件") + " → " + added.target + "，工作区：" + where + "，网关监听器将热感知）");
    return;
  }

  if (command === "scope") {
    if (name === undefined) {
      console.error("scope 需要一个技能名参数");
      process.exit(2);
    }
    if (flags.global && flags.workspace !== undefined) {
      console.error("--global 与 --workspace 不能同时使用");
      process.exit(2);
    }
    if (!flags.global && flags.workspace === undefined) {
      console.error("scope 需要 --global 或 --workspace <path>");
      process.exit(2);
    }
    const entry = winnerEntry(entries, name);
    if (entry === undefined) {
      console.error('技能 "' + name + '" 未找到（项目与用户技能根中均不存在）。若该技能位于其他工作区，请加 --cwd <工作区路径> 锚定后重试');
      process.exit(1);
    }
    const targetRoot = flags.global ? join(homes.dshHome, "skills") : workspaceSkillRoot(await normalizeWorkspace(flags.workspace));
    await migrateEntry(entry, targetRoot, flags.copy ? "copy" : "move");
    console.log('已' + (flags.copy ? "复制" : "迁移") + '技能 "' + name + '" → ' + (flags.global ? "全局（~/.dsh/skills）" : "工作区 " + targetRoot) + "，网关监听器将热感知");
    return;
  }

  if (command === "migrate") {
    if (names.length === 0 && !flags.all) {
      console.error("migrate 需要至少一个技能名，或使用 --all");
      process.exit(2);
    }
    if (flags.from === undefined || flags.to === undefined) {
      console.error("migrate 需要 --from <global|路径> 与 --to <global|路径>");
      process.exit(2);
    }
    const fromGlobal = flags.from.toLowerCase() === "global";
    const toGlobal = flags.to.toLowerCase() === "global";
    const fromProject = fromGlobal ? null : await normalizeWorkspace(flags.from);
    const toProject = toGlobal ? null : await normalizeWorkspace(flags.to);
    const fromRoots = fromGlobal
      ? [{ path: join(homes.dshHome, "skills"), source: "user-dsh" }, { path: join(homes.agentsHome, "skills"), source: "user-agents" }]
      : [{ path: workspaceSkillRoot(fromProject), source: "project-dsh", projectRoot: fromProject }];
    const targetRoot = toGlobal ? join(homes.dshHome, "skills") : workspaceSkillRoot(toProject);
    if (fromRoots.some((root) => resolve(root.path) === resolve(targetRoot))) {
      console.error("源工作区与目标工作区相同");
      process.exit(2);
    }
    const byName = new Map();
    for (const entry of await collectSkillEntries(fromRoots)) if (!byName.has(entry.name)) byName.set(entry.name, entry);
    const chosen: any[] = [];
    if (flags.all) {
      for (const entry of byName.values()) chosen.push(entry);
    } else {
      for (const wanted of names) {
        const entry = byName.get(wanted);
        if (entry === undefined) {
          console.error('技能 "' + wanted + '" 不在源工作区中，已跳过');
          continue;
        }
        chosen.push(entry);
      }
    }
    if (chosen.length === 0) {
      console.log("没有可迁移的技能。");
      return;
    }
    if (!flags.copy && !flags.yes) {
      const ok = await confirm("将移动 " + chosen.length + " 个技能到 " + (toGlobal ? "全局" : targetRoot) + "？（移动会删除源） (y/N): ");
      if (!ok) {
        console.log("已取消");
        return;
      }
    }
    const results = await batchMigrateEntries(chosen, targetRoot, flags.copy ? "copy" : "move");
    let failed = 0;
    for (const result of results) {
      if (result.ok) console.log("✓ " + result.name);
      else {
        failed += 1;
        console.log("✗ " + result.name + "：" + (result.error ?? "未知错误"));
      }
    }
    console.log("完成：" + (results.length - failed) + " 成功，" + failed + " 失败。");
    if (failed > 0) process.exit(1);
    return;
  }

  if (command === "update") {
    const current = currentVersion();
    const latest = await fetchLatestVersion();
    if (latest === undefined) {
      console.error("无法获取最新版本（网络不可达或 GitHub 受限），请稍后重试。");
      process.exitCode = 1;
      return;
    }
    if (compareVersions(latest, current) <= 0) {
      console.log("当前已是最新版本 v" + current);
      return;
    }
    console.log("当前版本 v" + current + "，最新版本 v" + latest);
    if (!flags.yes) {
      const ok = await confirm("是否更新到 v" + latest + "？将运行 dsh plugin --profile " + flags.profile + " add github:Fishquito7/dsh-skill-viewer#v" + latest + " (y/N): ");
      if (!ok) {
        console.log("已取消");
        return;
      }
    }
    const exit = await runUpdate(flags.profile, latest);
    if (exit === 0) console.log("更新完成：v" + latest + "（若宿主端有改动，请重启网关生效）");
    process.exitCode = exit;
    return;
  }

  if (name === undefined) {
    console.error(command + " 需要一个技能名参数");
    process.exit(2);
  }
  // 同名技能可能存在于多个作用域：唯一时直接操作；不唯一时必须用
  // --global / --project / --workspace 显式指定，绝不 silently 操作胜出副本。
  const matches = entries.filter((candidate) => candidate.name === name);
  let entry;
  if (matches.length === 0) {
    console.error('技能 "' + name + '" 未找到（项目与用户技能根中均不存在）。若该技能位于其他工作区，请加 --cwd <工作区路径> 锚定后重试');
    process.exit(1);
  } else if (matches.length === 1) {
    entry = matches[0];
  } else {
    let scoped;
    if (flags.global) scoped = matches.find((candidate) => candidate.projectRoot === undefined);
    else if (flags.workspace !== undefined) {
      const want = resolve(await normalizeWorkspace(flags.workspace));
      scoped = matches.find((candidate) => candidate.projectRoot !== undefined && resolve(candidate.projectRoot) === want);
    } else if (flags.project) {
      const project = roots.find((root) => root.source === "project-dsh")?.projectRoot;
      scoped = matches.find((candidate) => candidate.projectRoot !== undefined && project !== undefined && resolve(candidate.projectRoot) === resolve(project));
    }
    if (scoped === undefined) {
      console.error('技能 "' + name + '" 存在于多个作用域（' + matches.map((candidate) => scopeLabel(candidate, titles)).join("、") + '），请加 --global / --project / --workspace <路径> 指定要操作哪一份');
      process.exit(1);
    }
    entry = scoped;
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
