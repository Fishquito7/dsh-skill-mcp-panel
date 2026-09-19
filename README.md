<div align="center">

# dsh-skill-mcp-panel

**在 DSH Web 侧边栏管理「技能」与「MCP」服务器，并附统一终端命令 `dsh-panel`**

[![npm version](https://img.shields.io/npm/v/dsh-skill-mcp-panel?color=cb3837&logo=npm&label=npm)](https://www.npmjs.com/package/dsh-skill-mcp-panel)
[![npm downloads](https://img.shields.io/npm/dm/dsh-skill-mcp-panel?color=cb3837&label=downloads)](https://www.npmjs.com/package/dsh-skill-mcp-panel)
[![GitHub release](https://img.shields.io/github/v/release/Fishquito7/dsh-skill-mcp-panel?color=2ea043&label=release)](https://github.com/Fishquito7/dsh-skill-mcp-panel/releases)
[![DSH](https://img.shields.io/badge/DSH-0.1.5--rc.2%20%7C%200.1.6--alpha.2%2B-4c6ef5)](https://github.com/Fishquito7/dsh-skill-mcp-panel)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[简体中文](README.md) · [English](README.en.md)

</div>

---

DSH 插件，在 Web 主页左侧栏「插件」下方提供「技能」与「MCP」两个管理面板（点击即在中央主区打开，不是弹窗），并随包提供统一终端命令 `dsh-panel`（`skill` / `mcp` 两个子命令族）。

- 🗂️ **技能面板** —— 列表预览、搜索、工作区分栏与分组筛选、卡片展开查看全文、热启停 / 删除，支持 `.md` / `.zip` / 技能文件夹的添加与批量迁移
- 🔌 **MCP 面板**（v2.0.0）—— 可视化维护 profile `cordis.patch.yml` 中的 MCP 受管块，Stdio / HTTP 两种调用方式，支持测试连接，保存后由 DSH HMR 热加载
- 🧩 **主页侧边栏面板**（v2.1.0）—— 与宿主内置「插件」页同一套槽位机制，点左栏即在中央主区切页，页面左上角另有「← 返回会话」
- ⌨️ **统一 CLI** —— `dsh-panel skill …` 与 `dsh-panel mcp …` 覆盖两个面板的全部能力
- 📦 **无需本地构建** —— npm 与 Release tarball 安装的都是预构建产物

> **profile 提示**：本项目提供的参考命令默认指定 profile 为 `--profile web`，需要更改 profile 的请自行注意。

**目录**：[界面预览](#界面预览) · [安装](#安装) · [功能](#功能) · [命令行](#命令行) · [工作原理](#工作原理) · [开发](#开发) · [卸载](#卸载) · [链接](#链接) · [License](#license)

## 界面预览

> 面板入口在主页左侧栏「插件」下方（v2.1.0 起由设置页迁移到侧边栏），点「技能」/「MCP」即在中央主区打开；两个页面左上角都有「← 返回会话」，可直接回到进面板前那个会话。

<p align="center">
  <img src="https://raw.githubusercontent.com/Fishquito7/dsh-skill-mcp-panel/main/docs/images/sidebar-entry.png" width="260" alt="DSH 主页侧边栏：插件 / 技能 / MCP">
  <br><sub>入口 · 主页侧边栏中的「技能」与「MCP」</sub>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Fishquito7/dsh-skill-mcp-panel/main/docs/images/skills-panel.png" width="835" alt="技能面板：搜索、工作区选择器与技能卡片展开">
  <br><sub>技能面板 · 搜索 / 工作区选择器（折叠下拉）/ 卡片展开查看全文</sub>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Fishquito7/dsh-skill-mcp-panel/main/docs/images/skill-groups.png" width="520" alt="分组编辑器：新建分组、选择工作区并批量勾选成员">
  <br><sub>技能分组 · 新建 / 重命名 / 批量勾选成员</sub>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Fishquito7/dsh-skill-mcp-panel/main/docs/images/skill-migrate.png" width="540" alt="批量迁移技能：源工作区、多选目标工作区、复制或移动">
  <br><sub>批量迁移 · 源工作区 / 多选目标 / 复制或移动</sub>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Fishquito7/dsh-skill-mcp-panel/main/docs/images/mcp-panel.png" width="560" alt="MCP 面板：服务器卡片、工具数量、启停、测试连接与删除">
  <br><sub>MCP 面板 · 服务器卡片 / 工具数 / 启停 / 测试连接</sub>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Fishquito7/dsh-skill-mcp-panel/main/docs/images/mcp-add-server.png" width="520" alt="添加 MCP 服务器：STDIO 与 HTTP 两种调用方式">
  <br><sub>添加 MCP 服务器 · STDIO / HTTP 两种调用方式</sub>
</p>

## 安装

1. 安装本包（bundle 层自动挂载，无需编辑配置文件），二选一：

   **方式一：GitHub Release tarball**

   ```bash
   dsh plugin --profile web add https://github.com/Fishquito7/dsh-skill-mcp-panel/releases/download/v2.1.0/dsh-skill-mcp-panel-2.1.0.tgz
   ```

   **方式二：npm（预构建，插件市场同款通道）**

   ```bash
   dsh plugin --profile web add dsh-skill-mcp-panel
   ```

   > 两种方式都安装预构建产物，无需本地构建。也可以从 Git 安装（Git 来源的依赖默认禁止运行 prepare 构建脚本；若报
   > `git-hosted plugins build on install...`，把 pnpm 在上面打印的 key 加到 profile 目录 `pnpm-workspace.yaml`
   > 的 `allowBuilds` 下再重跑）：
   >
   > ```bash
   > dsh plugin --profile web add github:Fishquito7/dsh-skill-mcp-panel
   > ```

2. 重启网关

   ```bash
   dsh-restart
   ```

   重启后刷新页面：左侧栏从「插件」往下依次是「技能」「MCP」，点击哪一个，中央主区就切换成哪一个面板。

## 功能

> 两个面板与宿主自带的「插件」页一样，是**侧边栏全局面板**：点击左栏的「技能」/「MCP」直接把中央主区切过去（不是设置页那种弹窗）。两个页面左上角各有一个「← 返回会话」箭头，点它立刻回到进面板之前那个会话；点会话列表里的任意会话或「插件」也能切走。

### 技能面板

- **技能卡片列表**：预览已注册安装的 skill，点击卡片可展开查看完整内容
- **skill 状态**：启用、停用状态标签，与内置插件列表同款样式
- **skill 管理**：开关热启用/停用、删除；按名称搜索；进入页面自动刷新
- **skill 添加**（0.7.0 统一入口）：点「+」直接选文件（`.md` / `.zip`），或把文件、压缩包、技能文件夹直接拖进页面——自动识别目录束 / 单文件 / 压缩包结构，不合规内容会被拒绝并提示原因
- **工作区分栏**（0.3.0）：技能实体直接存放在其所属位置里——全局在 `~/.dsh/skills`，限定工作区在该工作区的 `.dsh/skills`。页面「技能列表」下方有一条工作区选择器（折叠式下拉，全局 + 各工作区，最多显示 11 项、其余滚动），选中即只显示该工作区下的技能。
- **批量迁移**：「+」号左侧的迁移按钮：源工作区、目标工作区（**可多选**）与技能都在对话框内手动选择，批量**复制**或**移动**（默认不勾选任何技能；逐个迁移、失败不影响其余；移动模式限单个目标）。源工作区有分组时，可在技能列表上方按分组筛选（0.7.0）。
- **技能分组**（0.5.0）：工作区选择器下方新增分组横栏（全部 + 分组名，放不下时换行），点击只显示该分组下的技能。「分组」按钮（迁移按钮左侧）打开分组编辑器：新建 / 重命名 / 删除分组、选择工作区、命名并批量勾选成员。分组只写入插件自己的显示配置（`~/.dsh/skills/.system/skill-viewer/groups.json`），不修改技能目录。
- **作用域化管理**（0.6.4）：同名技能同时存在于全局与某工作区时，删除、启停、查看内容均按（名称 + 作用域）精确操作——页面各行独立展开、独立操作，绝不影响其它作用域里的副本；找不到指定作用域的条目会直接报错，不会回退误操作。命令行同名技能也需用 `--global` / `--project` / `--workspace` 显式指定。

### MCP 面板（v2.0.0）

- 主页侧边栏「技能」下方新增「MCP」面板，管理 profile `cordis.patch.yml` 中的 MCP 服务器受管块；
- 支持 **Stdio**（本地命令）与 **HTTP**（streamable-http）两种调用方式；
- 支持新增、编辑、启停、删除、测试连接；保存后由 DSH HMR 热加载，无需重启网关；
- `env` / `headers` 密钥在 RPC 与页面中脱敏，编辑时缺省 key 保留旧值；
- `cordis.patch.yml` 面板块外的用户内容逐字节保留。

### 主页面板与返回会话（v2.1.0）

- **管理面板从设置页迁移到主页侧边栏**：与宿主自带的「插件」页同一套槽位机制（`sidebar.panellist` 列表槽位 + `main` 键控槽位），点击左栏「技能」/「MCP」直接在中央主区切页，设置页不再有这两个 tab；面板自带整页外壳（滚动与页边距）。需要宿主提供上述两个槽位，本机 DSH 0.1.6-alpha.2 已实测。
- **「← 返回会话」箭头**：两个页面左上角各一个，点它立刻回到进面板之前那个会话（调宿主 `ctx.layout.selectPanel(null)`，不改变当前会话）。

### DSH 版本兼容（v2.0.5）

- 适配 DSH 自 `0.1.6-alpha.2` 起的 TypertCodec `create()` 工厂契约——该改动会让仍写 `schema:` 的插件在注册阶段直接抛错、整个插件树加载失败（网关起不来）。同一份构建**同时兼容** `0.1.5-rc.2` 及更早（读 `schema`）与 `0.1.6-alpha.2` 及以后（读 `create`），无需按版本探测或分开维护分支。
- 作用域选择器固定为折叠式下拉（最多显示 11 项，其余滚动）；分组栏改为换行布局。
- 技能列表不再依赖「是否打开了会话」：没有会话时服务端回退全局注册表。

## 命令行

统一父命令为 `dsh-panel`。

### 技能子命令

```bash
dsh-panel skill --help

dsh-panel skill list                                  # 列出技能（含工作区：全局 / 工作区）
dsh-panel skill add <path>                            # 添加到全局（.md 文件、目录束或 .zip 压缩包）
dsh-panel skill add <path> --workspace D:\项目A        # 直接添加到指定工作区
dsh-panel skill scope <name> --global                 # 迁移单个技能到全局
dsh-panel skill scope <name> --workspace D:\项目A      # 迁移单个技能到指定工作区（--copy 复制）
dsh-panel skill migrate <name...|--all> --from <全局|路径> --to <全局|路径> [--copy] [--yes]   # 批量迁移（复制/移动）
dsh-panel skill update [--profile <name>]             # 检查并更新插件（默认 web 配置）
dsh-panel skill disable <name>                        # 停用
dsh-panel skill enable <name>                         # 启用
dsh-panel skill delete <name>                         # 删除（需确认）
```

### MCP 子命令

```bash
dsh-panel mcp list [--profile <name>]
dsh-panel mcp add --name <serverName> --stdio --command <cmd> [--args <arg> ...] [--env KEY=VALUE ...] [--cwd <path>] [--profile <name>]
dsh-panel mcp add --name <serverName> --http --url <url> [--header KEY=VALUE ...] [--profile <name>]
dsh-panel mcp enable|disable <serverName> [--profile <name>]
dsh-panel mcp remove <serverName> [--yes] [--profile <name>]
dsh-panel mcp test <serverName> [--profile <name>]
dsh-panel mcp update [--yes] [--profile <name>]
dsh-panel update [--yes] [--profile <name>]      # 更新整个 dsh-skill-mcp-panel
```

MCP 配置写入目标 profile 的 `cordis.patch.yml` 受管块；网关在线时自动热加载。面板块由
`# >>> dsh-skill-mcp-panel:mcp:begin` / `# <<< ...end` 标记，请勿手改块内内容。

CLI 只扫描当前目录锚定的项目根与用户根；管理其他工作区的技能请加 `--cwd <工作区路径>`。
同名技能存在于多个作用域时，`enable`/`disable`/`delete` 需加 `--global`/`--project`/`--workspace` 指定操作哪一份。

## 工作原理

### 技能部分

页面和 `dsh-panel skill` 命令的每次操作，最终都是对磁盘上技能文件（`SKILL.md`）的改动，DSH 自带的文件监听器立刻发现变化——所以启用/停用、增删、迁移都热生效，无需重启网关。

- 技能实体直接存放在其工作区的技能文件夹：全局 = `~/.dsh/skills`，工作区 = `<工作区>/.dsh/skills`，没有隐藏存储或联接点——卸载插件后技能仍是普通文件，照常被 DSH 发现
- 停用 = 把 `SKILL.md` 改名为 `SKILL.md.disabled`，启用 = 改回来
- 改变所属位置 = 真实地把文件复制/移动到目标位置的文件夹（先校验、失败回滚）
- 随部署附带的技能（bundled）为只读，不可停用或删除

### MCP 部分

负责把 MCP 服务器配置写进 profile 的 `cordis.patch.yml` 受管块；真正连接和注册工具的是 DSH 官方插件 @deepseek-ai/dsh-mcp-client，由 DSH 的 HMR 自动加载。

## 开发

源码为 TypeScript，位于 `src/`；编译产物 `lib/*.js` 随仓库一起提交（保证 Git 直装可用）。
改完源码后运行 `pnpm build`：`tsc` 编译到 `lib/` 并剥离浏览器束的多余模块标记。
发布时 `npm pack` 会通过 prepack 自动重新构建，无需手工编译。

## 卸载

```bash
dsh plugin --profile web remove dsh-skill-mcp-panel
```

## 链接

- npm 包：[dsh-skill-mcp-panel](https://www.npmjs.com/package/dsh-skill-mcp-panel)
- 版本发布：[Releases](https://github.com/Fishquito7/dsh-skill-mcp-panel/releases)
- 问题反馈：[Issues](https://github.com/Fishquito7/dsh-skill-mcp-panel/issues)
- 英文文档：[README.en.md](README.en.md)

## License

MIT
