<div align="center">

# dsh-skill-mcp-panel

**在 DSH Web 侧边栏管理「技能」与「MCP」服务器，并附统一终端命令 `dsh-panel`**

[![npm version](https://img.shields.io/npm/v/dsh-skill-mcp-panel?color=cb3837&logo=npm&label=npm)](https://www.npmjs.com/package/dsh-skill-mcp-panel)
[![npm downloads](https://img.shields.io/npm/dm/dsh-skill-mcp-panel?color=cb3837&label=downloads)](https://www.npmjs.com/package/dsh-skill-mcp-panel)
[![GitHub release](https://img.shields.io/github/v/release/Fishquito7/dsh-skill-mcp-panel?color=2ea043&label=release)](https://github.com/Fishquito7/dsh-skill-mcp-panel/releases)
[![DSH](https://img.shields.io/badge/DSH-0.2.x-4c6ef5)](https://github.com/Fishquito7/dsh-skill-mcp-panel)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[简体中文](README.md) · [English](README.en.md)

</div>

---

DSH 插件：把**技能**与 **MCP 服务器**的管理搬进 DSH Web 的主页侧边栏——点左栏的「Skill / MCP」，中央主区直接切到整页面板（不是弹窗，也不是设置页里的 tab），改完即生效。随包附带统一终端命令 `dsh-panel`：面板能做的事命令行都能做，另外多一个跨 profile 升级。

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
  <img src="https://raw.githubusercontent.com/Fishquito7/dsh-skill-mcp-panel/main/docs/images/sidebar-entry.png" width="260" alt="DSH 主页侧边栏：插件 / Skill / MCP">
  <br><sub>入口 · 主页侧边栏中的「Skill / MCP」（v2.1.5 起两个面板合并为一行，标签固定用英文写法）</sub>
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



   重启后刷新页面：左侧栏「插件」下面就是合并后的「Skill / MCP」一行——点它把中央主区切成面板，面板内部再用页签切换「技能」与「MCP」。

## 功能

面板和宿主自带的「插件」页是同一套机制：左栏一行「Skill / MCP」，点它把中央主区切过去——不是设置页的 tab，也不是弹窗。面板内用页签切换「技能」与「MCP」，并记住你上次停在哪一页；左上角「← 返回会话」随时退回进面板前的会话。

### 技能面板

- **列表与卡片** —— 按名称搜索，点开卡片看全文；按工作区（全局 / 各工作区）分栏，可按分组或按来源筛选
- **启停与删除** —— 开关热生效（改的是磁盘上的 `SKILL.md`），删除可撤销；插件自带的技能可一键隐藏
- **添加** —— 点「+」或直接把文件 / 压缩包 / 技能文件夹拖进页面：`.md`、`.zip`、整个文件夹都认，含多个技能的文件夹一次导入；不合法、**目标作用域内**重名的逐条跳过并说明原因
- **迁移** —— 批量复制或移动到多个工作区，单条失败不影响其余
- **分组** —— 新建 / 重命名 / 删除、批量勾选成员；只写插件自己的显示配置，不动技能目录

### MCP 面板

- **服务器管理** —— 支持 **Stdio** 与 **HTTP** 两种方式：新增、编辑、启停、删除、测试连接；保存后由 DSH HMR 热加载，不用重启网关。只改面板自己的受管块，`cordis.patch.yml` 其它内容（含块内别人的条目）逐字节保留
- **密钥** —— `env` / `headers` 在页面与 RPC 里脱敏，编辑时留空即保留旧值；值里写 `${NAME}` 就是读该环境变量
- **单工具禁用** —— 按工具名关掉其中一部分，被禁的工具会从模型看到的工具表里**消失**（不是调用时才拒绝），上下文立刻省下来
- **OAuth 登录** —— 远程 `streamable-http` 服务器支持时一键登录（自动发现授权服务器、动态注册客户端、授权码 + PKCE），令牌写回该行配置并热加载；可随时断开

### DSH 版本兼容

只支持 **DSH `0.2.x`**（peer 声明 `>=0.2.0-rc.1 <0.3.0-0`）。DSH 会在安装时和 profile 启动时校验这条声明，不满足就拒绝加载并打印精确豁免命令——不会静默崩。上界写成 `<0.3.0-0` 是因为该校验带 `includePrerelease`，`<0.3.0` 会把 `0.3.0-rc.1` 也放进来。

确需在老宿主上使用，用宿主打印的精确版本豁免：

```bash
dsh plugin --profile web allow-version dsh-skill-mcp-panel@2.3.1 --dsh-version <宿主版本> --accept-risk
```

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
`add` 不在此列：目标作用域内没有同名就照常添加，跨作用域同名只打印一条提示（v2.1.7）。

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

- **v2.3.1** —— 修 **#51：单工具禁用面板点不开**（报 `remote[method] is not a function`）。原因很直给：浏览器束里另有一份 Remote 方法清单，客户端只认清单里挂过的方法，而 2.2.0 加 `listTools` / `getToolFilter` / `setToolFilter` 与 OAuth 三连时只补了宿主侧清单、漏了浏览器束那份，于是点「工具」按钮必然抛错；卡片上的 **OAuth 登录 / 断开** 按钮也是同一个病因，这次一并修好。新增 `test-client-contribution.mjs` 守两份清单双向全量比对，杜绝再漏
- **v2.3.0** —— **只支持 DSH `0.2.x`**（peer 改为 `>=0.2.0-rc.1 <0.3.0-0`，0.1.x 的历史兼容分支全部删除：图标不再回退像素后缀旧名、strict codec 去掉 `schema` 字段）；适配 DSH `0.2.1`：协议依赖钉到 `@deepseek-ai/dsh-typert-protocol@^0.2.1-rc.1` 并显式带上它的 peer `@deepseek-ai/cordis`（此前 `^0.1.0-rc.6` 会在 profile 里装出旧协议，宿主 0.2.1 判「strict definition withdrawn」→ 技能页与 MCP 页全挂；peer 缺 `cordis` 时连导入都会失败，见 Issue #48）；`dsh-home-paths` / `dsh-subprocess` 里我们只用到的两个纯函数已内联，不再拖它们的 peer 链；MCP 卡片新增 **OAuth 登录 / 重新登录 / 断开** 按钮（`--disconnect` 同款能力搬进面板，轮询式，不再只能用 CLI）
- **v2.2.0** —— 前端按新设计稿重构（三栏：工作区 / 分组 / 内容；批量选择 + 迁移；删除可撤销）；修 **#46 受管块改写外来行**（会连带把 dsh-market 的更新全部回滚，见 ADR-0003）；MCP 新增**单工具禁用**（真省上下文，见 ADR-0005）与 **OAuth 登录**（`dsh-panel mcp oauth`）；技能页新增**按来源分组**与工作区栏（#42：工作区全列出、放不下就滚动）；`dsh-panel skill add` 的同名判定收窄到目标作用域（ADR-0002）

- **v2.1.7** —— 「添加技能」的冲突判定收窄到**目标作用域内**：以前只要这台机器上任何地方（别的 profile、别的工作区、全局根）存在同名技能就拒绝添加，现在只有目标作用域里已有同名才跳过；跨作用域同名照常落盘并回报一条提示（`dsh-panel skill add` 同步）。理由见 ADR-0002：DSH 的重名由注册表按根优先级裁决，工作区发现根按会话 cwd 解析，别的工作区根本不在本会话的发现链上，且面板的行级操作本就按（名称 + 作用域）定位

- **v2.1.6** —— 修好「添加技能」：文件夹选择器不再丢掉被选中文件夹自己的名字（此前直接选中任何合法技能包都会被误报「缺少顶层 SKILL.md」）；三个入口（单文件 / 文件夹·zip / 拖放）统一按同一套规则识别——选中范围内直接有 `SKILL.md` 就是一个**技能包**（顶层平铺的依赖 `.md` 与 `references/`、`scripts/` 都是载荷，不再被当成技能逐个校验），否则递归发现其中的技能并**拍平到技能根第一层**，于是「含多个技能的文件夹」也能一次导入（`.zip` 同理）；不合法 / 重名 / 冲突的逐条跳过并回报，一个都没成功才整体报错。`dsh-panel skill add` 与面板行为一致
- **v2.1.5** —— 侧栏「技能」「MCP」合并成一行「Skill / MCP」（换用新的合并入口图标）+ 面板内页签（记住上次停留）；新增「显示插件技能」开关；MCP 环境变量支持 `${NAME}` 直觉写法（面板/CLI 自动格式化成 `!!js`，读回来仍是 `${NAME}`，不再被写坏成字面量）、MCP 页新增「注册机制」说明按钮，并为空字段补灰字示例；Windows 补上无扩展名的 bash shim；`dsh-panel update` 保持各 profile 原本的安装渠道（tarball / npm / Git），README 安装指引改用无版本号的稳定 tarball 链接
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
