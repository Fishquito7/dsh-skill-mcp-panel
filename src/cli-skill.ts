#!/usr/bin/env node
/**
 * dsh-panel skill —— dsh-skill-mcp-panel 插件的技能热管理命令行。
 *
 * 直接操作 DSH 技能文件系统提供方读取的技能文件；运行中的网关通过文件
 * 监听器热感知变化（无需重启）。
 *
 * 实体模型（0.3.0）：一个技能只存在于一个位置（全局或工作区）的文件夹——
 *   - 全局：    ~/.dsh/skills
 *   - 工作区：  <workspaceProjectRoot>/.dsh/skills
 *
 *   dsh-panel skill list                     列出技能（标注全局 / 工作区）
 *   dsh-panel skill enable <name>            重新启用已停用的技能
 *   dsh-panel skill disable <name>           热停用技能（改名 *.disabled）
 *   dsh-panel skill delete <name> [--yes]    永久删除技能
 *   dsh-panel skill add <path>               添加技能（.md 文件、目录束或 .zip 压缩包）
 *   dsh-panel skill scope <name>             迁移单个技能：--global | --workspace <path>
 *   dsh-panel skill migrate <name...>        批量迁移：--from --to [--copy] [--all]
 *   dsh-panel skill update [--yes] [--profile <name>]  检查并更新插件（默认升级全部 profile）
 *   --cwd <path>                       项目根锚点（默认当前目录）
 *   --project                          添加到项目根而非 ~/.dsh/skills
 *   --workspace <path>                 add/scope 的目标工作区
 *   --profile <name>                   可选：确认该 profile 存在（update 用它限定单个 profile）
 *   --copy                             复制而非移动
 */
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
import { classifySkillImport, describeSkips, expandTopLevelZips } from "./skill-import.js";
import {
  batchMigrateEntries,
  migrateEntry,
  normalizeWorkspace,
  workspaceSkillRoot,
  workspaceTitleMap
} from "./scope.js";
import { INSTALL_SPEC, PACKAGE_NAME, REPO_SLUG, compareVersions, fetchUpdateCheck } from "./version.js";
import {
  ProfileError,
  electronBlockedMessage,
  listProfiles,
  readProfile,
  requireProfile,
  type ProfileInfo
} from "./profiles.js";

function usage() {
  console.log([
    "用法:",
    "  dsh-panel skill list [--cwd <path>]                         列出技能（标注全局 / 工作区）",
    "  dsh-panel skill enable <name> [--cwd <path>]                启用已停用的技能",
    "  dsh-panel skill disable <name> [--cwd <path>]               停用技能（改名 *.disabled，热生效）",
    "  dsh-panel skill delete <name> [--yes] [--cwd <path>]        删除技能（目录型删整个目录）",
    "  dsh-panel skill add <path> [--cwd <path>] [--project | --workspace <path>]",
    "                                                        添加技能：.md / .zip 文件、技能文件夹，或含多个技能的文件夹（自动识别、可批量）",
    "  dsh-panel skill scope <name> [--global | --workspace <path>] [--copy]",
    "                                                        迁移单个技能到全局或指定工作区（默认移动，--copy 复制）",
    "  dsh-panel skill migrate <name...|--all> --from <global|路径> --to <global|路径> [--copy] [--yes]",
    "                                                        批量迁移：把源工作区的技能复制/移动到目标工作区",
    "  dsh-panel skill update [--yes] [--profile <name>]           检查最新版本并更新插件",
    "                                                        不带 --profile = 升级全部已安装的 profile",
    "",
    "公共参数:",
    "  --profile <name>                    可选。技能子命令用它确认 profile 存在；update 用它限定单个 profile",
    "                                      给了就必须已存在（打错会被拒绝，绝不会新建 profile）",
    "",
    "说明: 技能实体直接存放在其工作区的技能文件夹内——全局在 ~/.dsh/skills，",
    "限定工作区在该工作区的 .dsh/skills。停用 = 把 SKILL.md 改名 SKILL.md.disabled；",
    "网关的监听器会热感知，无需重启。迁移默认是移动（源删除），--copy 保留源。",
    "CLI 只扫描当前目录锚定的项目根与用户根；管理其他工作区的技能请加 --cwd <工作区路径>。",
    "技能数据不区分 profile —— 所有 profile 看到同一份 ~/.dsh/skills，所以这里不需要 --profile；",
    "带上它只是顺便确认该 profile 存在、以及它是否真的把本插件挂进了 bundles。",
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

/** 归一技能 md 文本：去 BOM、CRLF 归一为 LF（yaml 解析对孤立 \r 敏感）。 */
async function readNormalizedMd(fullPath) {
  return Buffer.from((await readFile(fullPath, "utf8")).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf8");
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
 * 从本地路径添加技能，与面板「添加」共用同一条模型（skill-import 分类器）：
 *   - 选择范围内**直接**有 SKILL.md ⇒ 整个选择就是一个技能包；
 *   - 否则按列表扫描 / 嵌套提供方同样的规则遍历（含 SKILL.md 的目录即技能包
 *     且不下钻，不含则继续下钻），找到的技能一律**拍平到目标根第一层**；
 *   - 目标技能文件夹：--workspace → 该工作区的 .dsh/skills，
 *     --project → cwd 项目的 .dsh/skills，默认 → 全局 ~/.dsh/skills；
 *   - 合法项逐个落盘（先暂存再改名就位），不合法 / 重名 / 冲突的逐条跳过并回报。
 */
async function collectSourceEntries(source, info) {
  if (info.isDirectory()) {
    const prefix = basename(source);
    const walked = await walkFiles(source);
    return walked.map((file) => ({ path: prefix + "/" + file.relative, full: file.full }));
  }
  const name = basename(source);
  if (!name.toLowerCase().endsWith(".zip")) return [{ path: name, full: source }];
  const data = await readFile(source);
  return expandTopLevelZips([{ path: name, data }]).map((entry) => ({ path: entry.path, data: entry.data }));
}

/** 读一个源文件的文本（zip 内容已在内存里，其余从磁盘读）。 */
async function readSourceText(entry) {
  return entry.data !== undefined ? entry.data.toString("utf8") : await readFile(entry.full, "utf8");
}

/** 归一 md 文本：去 BOM、CRLF 归一为 LF。 */
function normalizeMdText(data) {
  return Buffer.from(data.toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf8");
}

async function addSkill(sourceArg, flags, roots, entries) {
  const source = resolve(sourceArg);
  const info = await stat(source).catch(() => undefined);
  if (info === undefined) throw new Error("路径不存在：" + sourceArg);
  if (!info.isDirectory() && !info.isFile()) throw new Error("只支持 .md / .zip 文件或技能文件夹：" + sourceArg);

  const sourceEntries = await collectSourceEntries(source, info);
  if (sourceEntries.length === 0) throw new Error("选择范围内没有可用的文件：" + sourceArg);
  const byPath = new Map<string, any>(sourceEntries.map((entry) => [entry.path, entry] as [string, any]));
  const plan = classifySkillImport(sourceEntries);

  // 目标位置的技能文件夹。
  const homes = userHomes();
  let destRoot;
  if (flags.workspace !== undefined) {
    destRoot = workspaceSkillRoot(await normalizeWorkspace(flags.workspace));
  } else if (flags.project) {
    destRoot = roots.find((root) => root.source === "project-dsh")?.path;
    if (destRoot === undefined) throw new Error("找不到目标技能根（--project 需要当前目录锚定一个项目根）");
  } else {
    destRoot = join(homes.dshHome, "skills");
  }

  // 源路径不能是目标技能根本身或其上级（否则会把自己搬进自己里面）。
  const normForCompare = (p) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));
  const sourceNorm = normForCompare(source);
  const destNorm = normForCompare(destRoot);
  const sep = process.platform === "win32" ? "\\" : "/";
  if (destNorm === sourceNorm || destNorm.startsWith(sourceNorm.endsWith(sep) ? sourceNorm : sourceNorm + sep)) throw new Error("源路径不能是目标技能根本身或其上级目录：" + sourceArg);

  // 逐条校验与冲突过滤：不合法的跳过，不影响其余。
  const skipped = [...plan.skipped];
  const accepted: any[] = [];
  const batchNames = new Set();
  const plannedTargets = new Set();
  for (const candidate of plan.candidates) {
    const skillFile = byPath.get(candidate.skillFile);
    if (skillFile === undefined) {
      skipped.push({ name: candidate.source, reason: "技能文件缺失" });
      continue;
    }
    const validation = validateFrontmatter(await readSourceText(skillFile));
    if (!validation.ok) {
      skipped.push({ name: candidate.source, reason: "技能格式不符合要求：" + validation.error });
      continue;
    }
    const name = validation.skill.name;
    if (batchNames.has(name)) {
      skipped.push({ name, reason: "本次选择中有重名" });
      continue;
    }
    const existing = winnerEntry(entries, name);
    if (existing !== undefined) {
      skipped.push({ name, reason: '同名技能 "' + name + '" 已存在（' + existing.source + "，" + (existing.enabled ? "已启用" : "已停用") + "）" });
      continue;
    }
    const target = candidate.kind === "bundle" ? join(destRoot, name) : join(destRoot, candidate.files[0].relative);
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
    accepted.push({ name, kind: candidate.kind, target, files: candidate.files.map((file) => ({ relative: file.relative, entry: byPath.get(file.path) })) });
  }
  if (accepted.length === 0) throw new Error(skipped.length === 0 ? "没有可添加的技能" : "没有可添加的技能：" + describeSkips(skipped));

  // 逐个暂存 + 原子改名；单个失败只影响该条。
  await mkdir(destRoot, { recursive: true });
  const stagingBase = join(destRoot, ".dsh-skill-staging-" + process.pid + "-" + Math.random().toString(36).slice(2, 8));
  const added: any[] = [];
  for (let index = 0; index < accepted.length; index++) {
    const skill = accepted[index];
    const staging = join(stagingBase, String(index));
    try {
      for (const file of skill.files) {
        const dest = join(staging, file.relative);
        await mkdir(dirname(dest), { recursive: true });
        if (file.entry.data !== undefined) await writeFile(dest, file.relative.toLowerCase().endsWith(".md") ? normalizeMdText(file.entry.data) : file.entry.data);
        else if (file.relative.toLowerCase().endsWith(".md")) await writeFile(dest, await readNormalizedMd(file.entry.full));
        else await copyFile(file.entry.full, dest);
      }
      if (skill.kind === "bundle") {
        await rename(staging, skill.target);
      } else {
        await rename(join(staging, skill.files[0].relative), skill.target);
        await rm(staging, { recursive: true, force: true }).catch(() => {});
      }
      added.push({ name: skill.name, kind: skill.kind, target: skill.target });
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
      skipped.push({ name: skill.name, reason: "写入失败（已回滚该技能）：" + (error instanceof Error ? error.message : String(error)) });
    }
  }
  await rm(stagingBase, { recursive: true, force: true }).catch(() => {});
  if (added.length === 0) throw new Error("没有可添加的技能：" + describeSkips(skipped));
  return { added, skipped };
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

/**
 * 按该 profile **原本的安装渠道**构造更新目标。
 *
 * 旧实现一律用 `github:<repo>#v<version>` 重装，等于把 tarball / npm 装来的 profile
 * 悄悄换成 Git 通道——而选这两个渠道的人往往正是因为本机 Git 通道不可用（网络受限，
 * 或 Git 来源被 pnpm 的构建脚本闸门挡住）。保持原渠道后，update 才不会在这些人身上失败。
 *
 *   https://…（Release tarball） → 该版本的版本化 tarball URL
 *   裸包名 / 包名@范围           → `<包名>@<版本>`（精确版本，绕开发布年龄门）
 *   github: / 其它 / 未声明      → `github:<repo>#v<版本>`（原行为）
 *
 * 导出供 test-cli-profiles.mjs 直接做渠道矩阵回归。
 */
export function installTargetForDeclaredSpec(spec: string | null | undefined, version: string): string {
  const value = typeof spec === "string" ? spec.trim() : "";
  if (/^https?:\/\//i.test(value)) {
    return "https://github.com/" + REPO_SLUG + "/releases/download/v" + version + "/" + PACKAGE_NAME + "-" + version + ".tgz";
  }
  if (value === PACKAGE_NAME || value.startsWith(PACKAGE_NAME + "@")) return PACKAGE_NAME + "@" + version;
  return INSTALL_SPEC + "#v" + version;
}

/** 执行一次 `dsh plugin --profile <p> add <spec>`（透传输出），返回退出码。 */
function runPluginAdd(profile: string, spec: string): Promise<number> {
  return new Promise<number>((resolve) => {
    const child = spawn("dsh", ["plugin", "--profile", profile, "add", spec], {
      stdio: "inherit",
      shell: process.platform === "win32"
    });
    child.on("error", () => resolve(127));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/**
 * update 子命令。
 *
 * 不带 --profile 时升级**全部**已安装本插件的 profile；带 --profile 时只处理那一个。
 *
 * 对比基准一律是「该 profile 自己 node_modules 里已装的版本」，不是正在执行
 * 这份 CLI 的版本——后者只是全局 shim 指向的某一个 profile 的副本，拿它比较
 * 会把「那份副本已经是最新」误判成「目标 profile 也是最新」，从而静默跳过更新。
 *
 * desktop profile 由 Electron 应用独占（dsh plugin 会拒绝它）：显式指定时直接
 * 报错退出，自动枚举时记为跳过，不影响其它 profile。
 */
async function runUpdateCommand(flags: any): Promise<number> {
  const requested: string | undefined = flags.profile;
  const targets: ProfileInfo[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];

  if (requested !== undefined) {
    let info: ProfileInfo;
    try {
      info = requireProfile(requested);
    } catch (error) {
      if (error instanceof ProfileError) {
        console.error(error.message);
        return 2;
      }
      throw error;
    }
    if (info.electronOwned) {
      console.error(electronBlockedMessage(info.name));
      return 2;
    }
    targets.push(info);
  } else {
    const all = listProfiles();
    if (all.length === 0) {
      console.error("没有可更新的 profile：$DSH_HOME/profiles 下还没有已初始化的 profile。");
      return 2;
    }
    for (const info of all) {
      if (info.electronOwned) {
        skipped.push({ name: info.name, reason: "Electron 应用独占，dsh plugin 拒绝管理" });
        continue;
      }
      if (info.installedVersion === null && info.spec === null) {
        skipped.push({ name: info.name, reason: "未安装本插件" });
        continue;
      }
      targets.push(info);
    }
    if (targets.length === 0) {
      console.error("没有可更新的 profile。");
      for (const item of skipped) console.error("  跳过 " + item.name + "：" + item.reason);
      return 1;
    }
  }

  const info = await fetchUpdateCheck();
  const latest = info.latest;
  if (latest === null) {
    if (info.rateLimited) console.error("无法获取最新版本：GitHub API 已限流（403/429），请稍后重试，或设置 GITHUB_TOKEN / GH_TOKEN。");
    else console.error("无法获取最新版本：" + (info.error ?? "网络不可达") + "，请稍后重试。");
    return 1;
  }

  console.log("最新版本 v" + latest + "（对比基准为每个 profile 自己已装的版本）");
  const plan = targets.map((target) => ({
    profile: target,
    from: target.installedVersion,
    needed: target.installedVersion === null || compareVersions(latest, target.installedVersion) > 0,
    target: installTargetForDeclaredSpec(target.spec, latest)
  }));
  for (const item of plan) {
    const state = !item.needed
      ? "已是最新"
      : item.from === null
        ? "未安装 → 将安装 v" + latest
        : "v" + item.from + " → v" + latest;
    console.log("  " + item.profile.name + "\t" + state + "\t" + item.target + (item.profile.mountsPanel ? "" : "\t（bundles 里没有本插件，装完也不会加载）"));
  }
  for (const item of skipped) console.log("  跳过 " + item.name + "\t" + item.reason);

  const pending = plan.filter((item) => item.needed);
  if (pending.length === 0) {
    console.log("全部已是最新版本。");
    return 0;
  }
  if (!flags.yes) {
    const ok = await confirm("是否更新以上 " + pending.length + " 个 profile？每个都会按该 profile 原本的安装渠道重装，目标见上表 (y/N): ");
    if (!ok) {
      console.log("已取消");
      return 0;
    }
  }

  const results: Array<{ name: string; ok: boolean; code: number; after: string | null }> = [];
  for (const item of pending) {
    console.log("\n--- " + item.profile.name + " ---");
    const code = await runPluginAdd(item.profile.name, item.target);
    results.push({
      name: item.profile.name,
      ok: code === 0,
      code,
      after: readProfile(item.profile.name)?.installedVersion ?? null
    });
  }

  let failed = 0;
  console.log("\n更新汇总:");
  for (const result of results) {
    if (!result.ok) failed += 1;
    console.log("  " + result.name + "\t" + (result.ok ? "✓ 现在 v" + (result.after ?? latest) : "✗ 退出码 " + result.code + "（仍是 " + (result.after ?? "未安装") + "）"));
  }
  if (failed === 0) console.log("更新完成。客户端 bundle 热更新（刷新页面即可）；服务端改动需重启对应 profile 的网关。");
  return failed === 0 ? 0 : 1;
}

export async function runSkillCli(args: string[]): Promise<number> {
  const flags: any = { cwd: process.cwd(), yes: false, project: false, workspace: undefined, global: false, copy: false, from: undefined, to: undefined, all: false, profile: undefined };
  const positional: any[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--cwd") {
      i += 1;
      if (i >= args.length) {
        console.error("--cwd 需要一个路径参数");
        return 2;
      }
      flags.cwd = args[i];
    } else if (args[i] === "--workspace") {
      i += 1;
      if (i >= args.length) {
        console.error("--workspace 需要一个路径参数");
        return 2;
      }
      flags.workspace = args[i];
    } else if (args[i] === "--from") {
      i += 1;
      if (i >= args.length) {
        console.error("--from 需要一个路径参数（或 global）");
        return 2;
      }
      flags.from = args[i];
    } else if (args[i] === "--to") {
      i += 1;
      if (i >= args.length) {
        console.error("--to 需要一个路径参数（或 global）");
        return 2;
      }
      flags.to = args[i];
    } else if (args[i] === "--profile") {
      i += 1;
      if (i >= args.length) {
        console.error("--profile 需要一个配置名参数");
        return 2;
      }
      flags.profile = args[i];
    } else if (args[i] === "--yes") flags.yes = true;
    else if (args[i] === "--project") flags.project = true;
    else if (args[i] === "--global") flags.global = true;
    else if (args[i] === "--copy") flags.copy = true;
    else if (args[i] === "--all") flags.all = true;
    else if (args[i] === "--help" || args[i] === "-h") {
      usage();
      return 0;
    } else positional.push(args[i]);
  }
  const command = positional[0];
  const name = positional[1];
  const names = positional.slice(1);
  if (command === undefined) {
    usage();
    return 2;
  }

  // update 不需要技能根，先处理掉：省一次目录扫描，也避免扫描失败干扰更新。
  if (command === "update") {
    return runUpdateCommand(flags);
  }

  // --profile 对技能子命令是可选的：技能文件不按 profile 分家，所有 profile 看到同一份
  // ~/.dsh/skills。但一旦给了就必须是真的——打错的 profile 名不能静默忽略。
  if (flags.profile !== undefined) {
    let profile: ProfileInfo;
    try {
      profile = requireProfile(flags.profile);
    } catch (error) {
      if (error instanceof ProfileError) {
        console.error(error.message);
        return 2;
      }
      throw error;
    }
    if (!profile.mountsPanel) {
      console.error('注意：profile "' + profile.name + '" 的 dsh.profile.bundles 里没有 ' + PACKAGE_NAME + "，该 profile 不会加载本面板（技能文件本身仍是全局共享的）。");
    }
  }

  const homes = userHomes();
  const titles = await workspaceTitleMap(homes.dshHome);
  const roots = await buildRoots(flags.cwd, homes);
  const entries = await collectSkillEntries(roots);

  if (command === "list") {
    if (entries.length === 0) {
      console.log("未找到技能。（搜索范围：项目 .dsh/skills、.agents/skills 与用户 ~/.dsh/skills、~/.agents/skills）");
      return 0;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source));
    for (const entry of entries) {
      const state = entry.enabled ? "启用" : "停用";
      const detail = entry.description.length > 70 ? entry.description.slice(0, 70) + "…" : entry.description;
      console.log([state, entry.name, "[" + entry.source + "]", scopeLabel(entry, titles), detail].filter(Boolean).join("	"));
    }
    return 0;
  }

  if (command === "add") {
    if (name === undefined) {
      console.error("add 需要一个路径参数（.md / .zip 文件、技能文件夹，或含多个技能的文件夹）");
      return 2;
    }
    if (flags.workspace !== undefined && flags.project) {
      console.error("--workspace 与 --project 不能同时使用");
      return 2;
    }
    const result = await addSkill(name, flags, roots, entries);
    const where = flags.workspace !== undefined ? "工作区 " + (await normalizeWorkspace(flags.workspace)) : flags.project ? "项目根" : "全局";
    for (const item of result.added) {
      console.log('已添加技能 "' + item.name + '"（' + (item.kind === "bundle" ? "目录束" : "单文件") + " → " + item.target + "，工作区：" + where + "，网关监听器将热感知）");
    }
    for (const item of result.skipped) console.log('已跳过 "' + item.name + '"：' + item.reason);
    return 0;
  }

  if (command === "scope") {
    if (name === undefined) {
      console.error("scope 需要一个技能名参数");
      return 2;
    }
    if (flags.global && flags.workspace !== undefined) {
      console.error("--global 与 --workspace 不能同时使用");
      return 2;
    }
    if (!flags.global && flags.workspace === undefined) {
      console.error("scope 需要 --global 或 --workspace <path>");
      return 2;
    }
    const entry = winnerEntry(entries, name);
    if (entry === undefined) {
      console.error('技能 "' + name + '" 未找到（项目与用户技能根中均不存在）。若该技能位于其他工作区，请加 --cwd <工作区路径> 锚定后重试');
      return 1;
    }
    const targetRoot = flags.global ? join(homes.dshHome, "skills") : workspaceSkillRoot(await normalizeWorkspace(flags.workspace));
    await migrateEntry(entry, targetRoot, flags.copy ? "copy" : "move");
    console.log('已' + (flags.copy ? "复制" : "迁移") + '技能 "' + name + '" → ' + (flags.global ? "全局（~/.dsh/skills）" : "工作区 " + targetRoot) + "，网关监听器将热感知");
    return 0;
  }

  if (command === "migrate") {
    if (names.length === 0 && !flags.all) {
      console.error("migrate 需要至少一个技能名，或使用 --all");
      return 2;
    }
    if (flags.from === undefined || flags.to === undefined) {
      console.error("migrate 需要 --from <global|路径> 与 --to <global|路径>");
      return 2;
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
      return 2;
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
      return 0;
    }
    if (!flags.copy && !flags.yes) {
      const ok = await confirm("将移动 " + chosen.length + " 个技能到 " + (toGlobal ? "全局" : targetRoot) + "？（移动会删除源） (y/N): ");
      if (!ok) {
        console.log("已取消");
        return 0;
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
    if (failed > 0) return 1;
    return 0;
  }

  if (name === undefined) {
    console.error(command + " 需要一个技能名参数");
    return 2;
  }
  // 同名技能可能存在于多个作用域：唯一时直接操作；不唯一时必须用
  // --global / --project / --workspace 显式指定，绝不 silently 操作胜出副本。
  const matches = entries.filter((candidate) => candidate.name === name);
  let entry;
  if (matches.length === 0) {
    console.error('技能 "' + name + '" 未找到（项目与用户技能根中均不存在）。若该技能位于其他工作区，请加 --cwd <工作区路径> 锚定后重试');
    return 1;
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
      return 1;
    }
    entry = scoped;
  }
  if (command === "enable") {
    if (entry.enabled) {
      console.log('技能 "' + name + '" 已是启用状态');
      return 0;
    }
    const target = entry.file.slice(0, -DISABLED_SUFFIX.length);
    await rename(entry.file, target);
    console.log('已启用技能 "' + name + '"（网关监听器将热感知，无需重启）');
    return 0;
  }
  if (command === "disable") {
    if (!entry.enabled) {
      console.log('技能 "' + name + '" 已是停用状态');
      return 0;
    }
    const target = entry.file + DISABLED_SUFFIX;
    if (await pathExists(target)) {
      console.error("目标文件已存在：" + target);
      return 1;
    }
    await rename(entry.file, target);
    console.log('已停用技能 "' + name + '"（网关监听器将热感知，无需重启）');
    return 0;
  }
  if (command === "delete") {
    if (!flags.yes) {
      const ok = await confirm('确认删除技能 "' + name + '"？此操作不可恢复 (y/N): ');
      if (!ok) {
        console.log("已取消");
        return 0;
      }
    }
    if (entry.dirBundle) await rm(dirname(entry.file), { recursive: true, force: true });
    else await rm(entry.file, { force: true });
    console.log('已删除技能 "' + name + '"');
    return 0;
  }
  console.error('未知命令 "' + command + '"');
  usage();
  return 2;
}

const directPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const modulePath = fileURLToPath(import.meta.url);
if (directPath !== undefined && (directPath === modulePath || resolve(directPath) === resolve(modulePath))) {
  runSkillCli(process.argv.slice(2)).then((code) => {
    if (code !== 0) process.exitCode = code;
  }).catch((error) => {
    console.error("dsh-panel skill: " + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}
