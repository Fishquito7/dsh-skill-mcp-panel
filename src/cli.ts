#!/usr/bin/env node
/**
 * dsh-panel —— dsh-skill-mcp-panel 的统一命令行。
 *
 *   dsh-panel skill ...      技能管理（原 dsh-skill 全部能力）
 *   dsh-panel mcp ...        MCP 服务器管理（list / add / remove / enable / disable / test / update）
 *   dsh-panel update         检查并更新整个 dsh-skill-mcp-panel 插件（默认升级全部 profile）
 *   dsh-panel profiles       列出所有 profile 的安装状态与版本
 *
 * 关于 profile：技能与 MCP 都是按 profile 存的，所以子命令都要显式 --profile；
 * 名字必须已存在，错名一律拒绝（dsh plugin 会拿错名新建 profile，本工具不允许）。
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { runSkillCli } from "./cli-skill.js";
import { runMcpCli } from "./cli-mcp.js";
import { PACKAGE_NAME, currentVersion } from "./version.js";
import { listProfiles } from "./profiles.js";

function usage() {
  console.log([
    "用法:",
    "  dsh-panel skill <command> [args]    技能管理（list / enable / disable / delete / add / scope / migrate / update）",
    "  dsh-panel mcp <command> [args]      MCP 服务器管理（list / add / remove / enable / disable / test / update）",
    "  dsh-panel update [--yes] [--profile <name>]",
    "                                      检查并更新 dsh-skill-mcp-panel",
    "                                      不带 --profile = 升级全部已安装本插件的 profile",
    "  dsh-panel profiles                  列出所有 profile 的安装状态、版本与安装 spec",
    "  dsh-panel --version                 显示当前入口的版本",
    "",
    "技能命令帮助：dsh-panel skill --help",
    "MCP 命令帮助：dsh-panel mcp --help"
  ].join("\n"));
}

/**
 * profiles 子命令：把「profile × 插件」的真实状态摊开。
 *
 * 必须同时打印当前入口路径——dsh-panel 是全局单例 shim，指向最后启动的那个
 * profile 的副本，和下面这张表里的任何一行都没有必然关系。
 */
function printProfiles(): number {
  console.log("当前 dsh-panel 入口：" + fileURLToPath(import.meta.url) + "（v" + currentVersion() + "）");
  console.log("该入口由最后启动的 profile 写入全局 shim 决定，与下表各行无关。");
  const all = listProfiles();
  if (all.length === 0) {
    console.log("没有已初始化的 profile（$DSH_HOME/profiles 下没有带 package.json 的目录）。");
    return 0;
  }
  console.log("");
  console.log(["profile", "已装版本", "bundles", "安装 spec"].join("\t"));
  for (const info of all) {
    console.log([
      info.name + (info.electronOwned ? "（Electron 独占）" : ""),
      info.installedVersion ?? "-",
      info.mountsPanel ? "已挂载" : "未挂载",
      info.spec ?? "-"
    ].join("\t"));
  }
  return 0;
}

export async function runPanelCli(args: string[]): Promise<number> {
  const command = args[0];
  const rest = args.slice(1);

  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    usage();
    return command === undefined ? 2 : 0;
  }
  if (command === "--version" || command === "-V") {
    console.log("dsh-panel v" + currentVersion());
    return 0;
  }
  if (command === "profiles") {
    return printProfiles();
  }
  if (command === "skill") {
    return runSkillCli(rest);
  }
  if (command === "update") {
    // 顶层 update 与 skill update 等价：更新的是同一个融合包。
    return runSkillCli(["update", ...rest]);
  }
  if (command === "mcp") {
    return runMcpCli(rest);
  }
  console.error('未知命令 "' + command + '"');
  usage();
  return 2;
}

const directPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const modulePath = fileURLToPath(import.meta.url);
if (directPath !== undefined && (directPath === modulePath || resolve(directPath) === resolve(modulePath))) {
  runPanelCli(process.argv.slice(2)).then((code) => {
    if (code !== 0) process.exitCode = code;
  }).catch((error) => {
    console.error("dsh-panel: " + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}
