<div align="center">

# dsh-skill-mcp-panel

**在 DSH Web 侧边栏管理「技能」与「MCP」服务器，并附统一终端命令 `dsh-panel`**

[![npm version](https://img.shields.io/npm/v/dsh-skill-mcp-panel?color=cb3837&logo=npm&label=npm)](https://www.npmjs.com/package/dsh-skill-mcp-panel)
[![npm downloads](https://img.shields.io/npm/dm/dsh-skill-mcp-panel?color=cb3837&label=downloads)](https://www.npmjs.com/package/dsh-skill-mcp-panel)
[![GitHub release](https://img.shields.io/github/v/release/Fishquito7/dsh-skill-mcp-panel?color=2ea043&label=release)](https://github.com/Fishquito7/dsh-skill-mcp-panel/releases)
[![DSH](https://img.shields.io/badge/DSH-0.1.6--alpha.2%20~%200.2.0--rc.2-4c6ef5)](https://github.com/Fishquito7/dsh-skill-mcp-panel)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[简体中文](README.md) · [English](README.en.md)

</div>

---

DSH 插件：把**技能**与 **MCP 服务器**的管理搬进 DSH Web 的主页侧边栏——点左栏的「技能」/「MCP」，中央主区直接切到整页面板（不是弹窗，也不是设置页里的 tab），改完即生效。随包附带统一终端命令 `dsh-panel`：面板能做的事命令行都能做，另外多一个跨 profile 升级。

- 🗂️ **技能管理** —— 列表预览、搜索、工作区分栏与分组筛选、卡片展开查看全文、热启停 / 删除，支持 `.md` / `.zip` / 技能文件夹的添加与批量迁移
- 🔌 **MCP 服务器管理** —— 可视化维护 profile `cordis.patch.yml` 中的 MCP 受管块，Stdio / HTTP 两种调用方式，支持测试连接，保存后由 DSH HMR 热加载
- 🧩 **整页面板** —— 与宿主内置「插件」页同一套槽位机制，点左栏即在中央主区切页，页面左上角另有「← 返回会话」
- ⌨️ **`dsh-panel` 命令行** —— `dsh-panel skill …` 与 `dsh-panel mcp …` 覆盖两个面板的全部能力
- 📦 **装上就能用** —— npm 与 Release tarball 安装的都是预构建产物

> **profile 提示**：`mcp` 子命令**必须**显式写 `--profile <name>`，且名字必须已存在——打错会被拒绝，不会新建 profile。`skill` 不按 profile 分家（技能按用户根 / 工作区存放），不需要该参数。不带 `--profile` 的 `dsh-panel update` 升级全部已安装本插件的 profile（`desktop` 由桌面应用独占，自动跳过）。

**目录**：[界面预览](#界面预览) · [安装](#安装) · [功能](#功能) · [命令行](#命令行) · [工作原理](#工作原理) · [开发](#开发) · [卸载](#卸载) · [更新日志](#更新日志) · [链接](#链接) · [License](#license)

## 界面预览

> 面板入口在主页左侧栏「插件」下方（v2.1.0 起由设置页迁移到侧边栏），点「技能」/「MCP」即在中央主区打开；两个页面左上角都有「← 返回会话」，可直接回到进面板前那个会话。

<p align="center">
  <img src="https://raw.githubusercontent.com/Fishquito7/dsh-skill-mcp-panel/main/docs/images/sidebar-entry.png" width="260" alt="DSH 主页侧边栏：插件 / Skill/MCP">
  <br><sub>入口 · 主页侧边栏中的「Skill/MCP」（v2.1.5 起两个面板合并为一行，标签固定用英文写法）</sub>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Fishquito7/dsh-skill-mcp-panel/main/docs/images/skills-panel.png" width="1000" alt="技能面板：搜索、全部启停、显示插件技能开关与技能卡片">
  <br><sub>技能面板 · 搜索 / 全部启停 / 显示插件技能开关 / 卡片展开查看全文</sub>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Fishquito7/dsh-skill-mcp-panel/main/docs/images/skill-groups.png" width="1000" alt="分组编辑器：新建分组、选择工作区并批量勾选成员">
  <br><sub>技能分组 · 新建 / 重命名 / 批量勾选成员</sub>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Fishquito7/dsh-skill-mcp-panel/main/docs/images/skill-migrate.png" width="1000" alt="批量迁移技能：源工作区、多选目标工作区、复制或移动">
  <br><sub>批量迁移 · 源工作区 / 多选目标 / 复制或移动</sub>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Fishquito7/dsh-skill-mcp-panel/main/docs/images/mcp-panel.png" width="1000" alt="MCP 面板：注册机制说明、服务器卡片、工具数量、启停、测试连接与删除">
  <br><sub>MCP 面板 · 注册机制说明 / 服务器卡片 / 工具数 / 启停 / 测试连接</sub>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Fishquito7/dsh-skill-mcp-panel/main/docs/images/mcp-add-server.png" width="1000" alt="添加 MCP 服务器：STDIO 与 HTTP 两种调用方式">
  <br><sub>添加 MCP 服务器 · STDIO / HTTP 两种调用方式</sub>
</p>

## 安装

1. 安装本包，二选一（桌面端用户请在内置插件安装器中输入'...add'后面的内容）：

   **方式一：GitHub Release tarball**（推荐，恒定指向最新版）

   ```bash
   dsh plugin --profile web add https://github.com/Fishquito7/dsh-skill-mcp-panel/releases/latest/download/dsh-skill-mcp-panel.tgz
   ```

   这是**无版本号的稳定链接**：每次发版都同时上传别名 `dsh-skill-mcp-panel.tgz`（恒定指向最新版）与带版本号的
   `dsh-skill-mcp-panel-<版本>.tgz`，所以这条命令不随版本改。需要锁定具体版本时，把 `latest/download/dsh-skill-mcp-panel.tgz`
   换成 `download/v<版本>/dsh-skill-mcp-panel-<版本>.tgz` 即可。

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



   重启后刷新页面：左侧栏「插件」下面就是合并后的「Skill/MCP」一行——点它把中央主区切成面板，面板内部再用页签切换「技能」与「MCP」。

## 功能

> 面板与宿主自带的「插件」页一样，是**侧边栏全局面板**：左栏只有一行「Skill/MCP」（v2.1.5 起两个面板合并，侧栏那一格还给会话），点它直接把中央主区切过去（不是设置页那种弹窗），页签在面板内部切换，并记住你上次离开时停在哪一页。左上角有「← 返回会话」箭头，点它立刻回到进面板之前那个会话；点会话列表里的任意会话或「插件」也能切走。

### 技能面板

- **技能卡片列表**：预览已注册安装的 skill，点击卡片可展开查看完整内容
- **插件技能开关**（v2.1.5）：插件随包自带的 skill（内置 office、badge 等）默认照常显示，「全部启停」右侧可一键隐藏——只看自己管理的文件技能，隐藏数量会在空列表里说明
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
- **环境变量取值**（v2.1.5）：值里直接写 `${NAME}` 就是读环境变量，面板 / CLI 保存时自动格式化成 `cordis.patch.yml` 里的 `!!js` 表达式（DSH 配置层唯一的插值机制，宿主装载时求值）。例如请求头填 `Bearer ${MCP_TOKEN}`，落盘就是 ``Authorization: !!js '`Bearer ${process.env.MCP_TOKEN}`'``，读回来仍显示 `Bearer ${MCP_TOKEN}`；`!!js` 前缀保留为进阶写法（原样透传任意 JS 表达式），手写的 `!!js` 也不会再被写坏成字面量
- **MCP 注册机制说明**（v2.1.5）：MCP 页标题右侧的「注册机制」按钮可展开一小段说明——entry 长什么样、受管块在哪、工具如何命名、环境变量与 `!!js` 的关系
- 命令 / 参数 / 环境变量 / 工作目录 / 地址 / 请求头为空时用灰字给出示例，照抄改路径即可
- `cordis.patch.yml` 面板块外的用户内容逐字节保留。

### 主页面板与返回会话（v2.1.0，v2.1.5 合并为单入口）

- **管理面板从设置页迁移到主页侧边栏**：与宿主自带的「插件」页同一套槽位机制（`sidebar.panellist` 列表槽位 + `main` 键控槽位），点击左栏「技能」/「MCP」直接在中央主区切页，设置页不再有这两个 tab；面板自带整页外壳（滚动与页边距）。需要宿主提供上述两个槽位，本机 DSH 0.1.6-alpha.2 已实测。
- **「← 返回会话」箭头**：两个页面左上角各一个，点它立刻回到进面板之前那个会话（调宿主 `ctx.layout.selectPanel(null)`，不改变当前会话）。
- **技能 / MCP 合并成一行 + 页签**（v2.1.5）：侧栏只占一行「Skill/MCP」，面板内部用页签切换两个页面；页签选择记在浏览器 localStorage（键 `dsh-skill-mcp-panel:last-tab`），下次点开侧栏这一行就停在上次离开的那一页。

### DSH 版本兼容

本插件对宿主有**三处**版本敏感的依赖，彼此无关，同一份构建同时满足全部三条：

| 宿主版本 | ① 插件树加载（TypertCodec） | ② 技能页图标（primitives 导出名） | ③ 侧栏面板槽位 |
| --- | :---: | :---: | :---: |
| `0.1.5-rc.x` | ✅ 读 `schema` | ✅ 旧名 | ⚠️ 未验证 |
| `0.1.6-alpha.1` | ✅ 读 `schema` | ✅ 旧名 | ⚠️ 未验证 |
| `0.1.6-alpha.2` ~ `0.1.7-alpha.0` | ✅ 读 `create` | ✅ 旧名 | ✅ |
| `0.1.7-alpha.1` ~ `0.1.8` | ✅ 读 `create` | ✅ 新名 | ✅ |
| `0.2.0-rc.x` | ✅ 读 `create` | ✅ 新名 | ✅ |

- **① TypertCodec `create()` 契约**：自 `0.1.6-alpha.2` 起 strict codec 改为持 `schema` 工厂 `create()`；仍写 `schema:` 的插件在注册阶段直接抛错，**整个插件树加载失败、网关起不来**（Issue #20）。本插件的每个 codec 同时携带 `schema` 与 `create`，两代宿主都只做 `typeof` 检查、都不拒绝多余属性，因此一份构建通吃，无需版本探测。守卫：`test-codec.mjs`。
- **② 技能页图标导出名**：`0.1.7-alpha.1` 把图标的像素后缀换成描边档位（`IconSkillOutline16` → `IconSkillOutlineRegular`，尺寸改由 `size` prop 传），**两代命名没有交集**。技能半区 6 处引用改走 `primitiveIcon(cur, legacy)`「新名优先、旧名回退」；若直接换成新名，`0.1.6` 及更早的用户会反向打不开。守卫：`test-host-icons.mjs`。
- **③ 侧栏面板槽位**：v2.1.0 起面板挂在宿主 `sidebar.panellist`（list 槽位）+ `main`（键控槽位）上，需要宿主提供这两个槽位。`0.1.6-alpha.2` 实测通过，`0.1.7` 系列槽位名未变。`0.1.5-rc.x` / `0.1.6-alpha.1` **未验证**；即使槽位缺失，插件树与 CLI 仍然可用，只是左栏不会出现「技能」「MCP」两行。
- **④ peerDependencies 硬闸门**（v2.1.2）：本包声明 `"@deepseek-ai/dsh": ">=0.1.5-rc.0 <0.3.0-0"`。DSH 的 `evaluatePluginCompatibility` 会在**安装时**与**profile 启动时**校验它，不满足就拒绝加载并打印精确豁免命令——把「静默崩」换成「明着拦」。没有这个字段时该校验直接放行，这正是 0.1.7-rc.1 那次断裂能静默发生的原因。
  - 上界写成 `<0.3.0-0` 而不是 `<0.3.0`：该校验带 `includePrerelease`，`<0.3.0` 会把 `0.3.0-rc.1` 也放进来。
  - v2.1.3 把上界从 `<0.2.0-0` 抬到 `<0.3.0-0`：桌面端自动升级到 `0.2.0-rc.2` 后，旧区间会被判成不兼容，**宿主在 profile 启动时直接禁用整行**（`dsh: disabling profile plugin row "skill-mcp-panel": ...`），面板从侧栏整体消失。0.2.0 的 ①②③ 三处契约均未变（图标导出名、`sidebar.panellist`+`main` 槽位、TypertCodec 仍读 `create()`），且已用 0.2.0 自带的 `evaluatePluginCompatibility` 与 registry 校验器实测通过。
  - 下限 `0.1.5-rc.0` 是「插件树还能加载」的边界，比上表「面板已实测」的范围更宽——区间内不等于面板已验证。
  - 在区间外的宿主上确需使用时，用宿主自己的精确版本豁免：

    ```bash
    dsh plugin --profile web allow-version dsh-skill-mcp-panel@2.1.5 --dsh-version <宿主版本> --accept-risk
    ```
  - 守卫：`test-cli-profiles.mjs`（直接调用宿主真实的 `evaluatePluginCompatibility` 验证区间两端）。

### 面板行为调整（v2.0.5）

- 作用域选择器固定为折叠式下拉（最多显示 11 项，其余滚动）；分组栏改为换行布局。
- 技能列表不再依赖「是否打开了会话」：没有会话时服务端回退全局注册表。

## 命令行

统一父命令为 `dsh-panel`。

> **全局 shim**：宿主启动时会在 npm 全局 bin 目录写入 `dsh-panel`。Windows 下写三份——`dsh-panel.cmd`（CMD）、`dsh-panel.ps1`（PowerShell）、以及**无扩展名**的 `dsh-panel` sh 脚本（Git Bash / MSYS2 / Cygwin 靠它，v2.1.5 之前缺这一份，bash 里会报 `command not found`）；macOS / Linux 写一份可执行的 `dsh-panel`。三份都指向「最后启动的那个 profile」装的插件副本。

`mcp` 子命令**必须**用 `--profile <name>` 指定目标 profile，名字必须已存在（判据是
`$DSH_HOME/profiles/<name>/package.json`）。打错名字会以退出码 2 被拒绝，**不会**像 `dsh plugin`
那样顺手新建一个 profile。`skill` 子命令**不需要** `--profile`——技能按用户根 / 工作区存放，不按
profile 分家。`dsh-panel update` 不带 `--profile` 时升级全部已安装本插件的 profile。

### profile 概览

```bash
dsh-panel profiles        # 每个 profile 的已装版本 / bundles 挂载情况 / 安装 spec
```

输出的第一行是**当前 dsh-panel 入口**的路径与版本。这条信息是必要的：`dsh-panel` 是全局单例 shim，
由最后启动的那个 profile 写入（`src/global-shim.ts`），因此它与表中任何一行都没有必然关系。

### 技能子命令

```bash
dsh-panel skill --help

dsh-panel skill list                                  # 列出技能（含工作区：全局 / 工作区）
dsh-panel skill add <path>                            # 添加到全局（.md 文件、目录束或 .zip 压缩包）
dsh-panel skill add <path> --workspace D:\项目A        # 直接添加到指定工作区
dsh-panel skill scope <name> --global                 # 迁移单个技能到全局
dsh-panel skill scope <name> --workspace D:\项目A      # 迁移到指定工作区（--copy 复制）
dsh-panel skill migrate <name...|--all> --from <全局|路径> --to <全局|路径> [--copy] [--yes]
dsh-panel skill disable <name>                        # 停用
dsh-panel skill enable <name>                         # 启用
dsh-panel skill delete <name>                         # 删除（需确认）
```

技能文件**全局共享**（`~/.dsh/skills` 与 `<工作区>/.dsh/skills`），不按 profile 分家，所以
`skill` 子命令不需要 `--profile`。可选地加上它，会顺便确认该 profile 存在，并在它没把本插件
挂进 `dsh.profile.bundles` 时提醒你「这个 profile 看不到面板」。

### MCP 子命令

```bash
dsh-panel mcp list --profile web
dsh-panel mcp add --name <serverName> --stdio --command <cmd> [--args <arg> ...] [--env KEY=VALUE ...] [--cwd <path>] --profile web
dsh-panel mcp add --name <serverName> --http --url <url> [--header KEY=VALUE ...] --profile web
dsh-panel mcp enable|disable <serverName> --profile web
dsh-panel mcp remove <serverName> [--yes] --profile web
dsh-panel mcp test <serverName> --profile web
```

环境变量取值直接写 `${NAME}`（保存时格式化成 `cordis.patch.yml` 的 `!!js` 表达式，由 DSH 装载时求值）；以 `!!js` 开头的值按进阶写法原样透传：

```bash
dsh-panel mcp add --name github --stdio --command npx --args -y --args @modelcontextprotocol/server-github \
  --env 'GITHUB_TOKEN=${GITHUB_TOKEN}' --profile web

dsh-panel mcp add --name web --http --url https://example.com/mcp \
  --header 'Authorization=Bearer ${MCP_TOKEN}' --profile web

# 进阶：整段 JS 表达式原样写进 !!js 标签
dsh-panel mcp add --name web2 --http --url https://example.com/mcp \
  --header 'Authorization=!!js `Bearer ${process.env.MCP_TOKEN}`' --profile web
```

```bash
dsh-panel mcp add --name github --stdio --command npx --args -y --args @modelcontextprotocol/server-github \
  --env 'GITHUB_TOKEN=!!js process.env.GITHUB_TOKEN' --profile web

dsh-panel mcp add --name web --http --url https://example.com/mcp \
  --header 'Authorization=!!js `Bearer ${process.env.MCP_TOKEN}`' --profile web
```

MCP 配置写入目标 profile 的 `cordis.patch.yml` 受管块；网关在线时自动热加载。面板块由
`# >>> dsh-skill-mcp-panel:mcp:begin` / `# <<< ...end` 标记，请勿手改块内内容。

### 更新插件

```bash
dsh-panel update                          # 升级全部已安装本插件的 profile
dsh-panel update --yes                    # 同上，不询问
dsh-panel update --profile web            # 只更新 web
dsh-panel mcp update                      # 等价于 dsh-panel update
```

- 对比基准是**每个 profile 自己 `node_modules` 里已装的版本**，不是正在执行的那份 CLI 的版本。
- 更新**保持该 profile 原本的安装渠道**：tarball 装的仍走 tarball（换成对应版本的版本化 URL），npm 装的仍走 npm 并钉到该版本，
  Git（或来源未知）装的仍用 `github:Fishquito7/dsh-skill-mcp-panel#v<版本>`。
- 已经是最新的 profile 会被跳过，不会被重装。
- `desktop` 由 DSH 桌面应用独占，宿主的 `dsh plugin --profile desktop` 会直接报错；自动枚举时跳过并说明，
  显式 `--profile desktop` 时以退出码 2 报错。
- 更新完成后：客户端 bundle 热更新（刷新页面即可），服务端改动需要重启对应 profile 的网关。

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

## 更新日志

只列**会改变使用方式**的版本要点；完整改动见 [Releases](https://github.com/Fishquito7/dsh-skill-mcp-panel/releases)。

- **v2.1.5** —— 侧栏「技能」「MCP」合并成一行「Skill/MCP」（换用新的合并入口图标）+ 面板内页签（记住上次停留）；新增「显示插件技能」开关；MCP 环境变量支持 `${NAME}` 直觉写法（面板/CLI 自动格式化成 `!!js`，读回来仍是 `${NAME}`，不再被写坏成字面量）、MCP 页新增「注册机制」说明按钮，并为空字段补灰字示例；Windows 补上无扩展名的 bash shim；`dsh-panel update` 保持各 profile 原本的安装渠道（tarball / npm / Git），README 安装指引改用无版本号的稳定 tarball 链接
- **v2.1.3** —— 适配 DSH `0.2.0`（peer 上界抬到 `<0.3.0-0`，否则宿主会在 profile 启动时禁用整行）；MCP 表单里非法的服务器名不再只报一句网关「天书」
- **v2.1.2** —— `mcp` 子命令必须显式 `--profile`，错名一律拒绝且不会新建 profile；`dsh-panel update` 不带 `--profile` 时升级全部 profile；新增 `dsh-panel profiles`
- **v2.1.1** —— 适配 DSH `0.1.7` 重命名的图标导出，技能页不再一片空白
- **v2.1.0** —— 面板从设置页迁移到主页侧边栏，每个面板带「← 返回会话」
- **v2.0.0** —— MCP 面板上线

## 链接

- npm 包：[dsh-skill-mcp-panel](https://www.npmjs.com/package/dsh-skill-mcp-panel)
- 版本发布：[Releases](https://github.com/Fishquito7/dsh-skill-mcp-panel/releases)
- 问题反馈：[Issues](https://github.com/Fishquito7/dsh-skill-mcp-panel/issues)
- 英文文档：[README.en.md](README.en.md)

## License

MIT
