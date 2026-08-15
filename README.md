# dsh-skill-viewer

[English](README.en.md) | 简体中文


DSH 插件，可直接在 web 界面快速管理 skill 状态，同时在终端加入快捷的skill管理命令。命令行命令请见下文

注意：本项目提供的参考命令默认指定profile为默认的--profile web，需要更改profile的请自行注意。

<img width="602" height="599" alt="image" src="https://github.com/user-attachments/assets/63ca0431-c920-4ae3-94c7-2839d78a7896" />



## 功能

- skill 卡片列表：预览已注册安装的 skill，点击卡片可展开查看完整内容
- skill 状态：启用、停用状态标签，与内置插件列表同款样式
- skill 管理：开关热启用/停用、删除；按名称搜索；进入页面自动刷新
- skill 添加：选择单文件（`.md`）或目录束（含顶层 `SKILL.md` 的文件夹），不合规内容会被拒绝并提示原因
- **工作区分栏**（0.3.0）：技能实体直接存放在其所属位置里——全局在
  `~/.dsh/skills`，限定工作区在该工作区的 `.dsh/skills`。页面“技能列表”下方
  有一条工作区横栏（全局 + 各工作区，可横向滚动），点击即只显示该工作区下的技能。
- **批量迁移**：“+”号左侧的迁移按钮：源工作区、目标工作区（**可多选**）与技能都在
  对话框内手动选择，批量**复制**或**移动**（默认不勾选任何技能；逐个迁移、失败不影响
  其余；移动模式限单个目标）。
- **技能分组**（0.5.0）：工作区横栏下方新增分组横栏（全部 + 分组名，可横向滚动），
  点击只显示该分组下的技能。“分组”按钮（迁移按钮左侧）打开分组编辑器：新建/重命名/
  删除分组、选择工作区、命名并批量勾选成员。分组只写入插件自己的显示配置
  （`~/.dsh/skills/.system/skill-viewer/groups.json`），不修改技能目录。

## 安装

1. 安装本包（bundle 层自动挂载，无需编辑配置文件）

   ```bash
   dsh plugin --profile web add https://github.com/Fishquito7/dsh-skill-viewer/releases/download/v0.6.3/dsh-skill-viewer-0.6.3.tgz
   ```

   > 首选发行版 tarball：不走 Git，不受 pnpm v11 的构建脚本限制。
   > 也可以从 Git 安装（Git 来源的依赖默认禁止运行 prepare 构建脚本；若报
   > “git-hosted plugins build on install...”，把 pnpm 在上面打印的 key 加到
   > profile 目录 `pnpm-workspace.yaml` 的 `allowBuilds` 下再重跑）：
   >
   > ```bash
   > dsh plugin --profile web add github:Fishquito7/dsh-skill-viewer
   > ```

2. 重启网关

   ```bash
   dsh-restart
   ```

   重启后刷新页面：设置 → “插件”下方即可看到“技能”。

## 命令行

随包附带 `dsh-skill` 命令，可直接在终端管理技能（同样热生效，网关关闭时也能用）：

```bash
dsh-skill list                                  # 列出技能（含工作区：全局 / 工作区）
dsh-skill add <path>                            # 添加到全局（单个 .md 或含顶层 SKILL.md 的目录束）
dsh-skill add <path> --workspace D:\项目A       # 直接添加到指定工作区
dsh-skill scope <name> --global                  # 迁移单个技能到全局
dsh-skill scope <name> --workspace D:\项目A      # 迁移单个技能到指定工作区（--copy 复制）
dsh-skill migrate <name...|--all> --from <全局|路径> --to <全局|路径> [--copy] [--yes]
dsh-skill update [--profile <name>]  # 检查并更新插件（默认 web 配置）
                                                 # 批量迁移（复制/移动）
dsh-skill disable <name>       # 停用
dsh-skill enable <name>        # 启用
dsh-skill delete <name>        # 删除（需确认）
```

CLI 只扫描当前目录锚定的项目根与用户根；管理其他工作区的技能请加 `--cwd <工作区路径>`。

## 工作原理

插件并不自己解析技能，只是技能文件的“管理界面”：页面和 `dsh-skill` 命令的每次操作，最终都是对磁盘上技能文件（`SKILL.md`）的改动，DSH 自带的文件监听器立刻发现变化——所以启用/停用、增删、迁移都热生效，无需重启网关。

- 技能实体直接存放在其工作区的技能文件夹：全局 = `~/.dsh/skills`，工作区 = `<工作区>/.dsh/skills`，没有隐藏存储或联接点——卸载插件后技能仍是普通文件，照常被 DSH 发现
- 停用 = 把 `SKILL.md` 改名为 `SKILL.md.disabled`，启用 = 改回来
- 改变所属位置 = 真实地把文件复制/移动到目标位置的文件夹（先校验、失败回滚）
- 随部署附带的技能（bundled）为只读，不可停用或删除

## 开发

源码为 TypeScript，位于 `src/`；编译产物 `lib/*.js` 随仓库一起提交（保证 Git 直装可用）。
改完源码后运行 `pnpm build`：`tsc` 编译到 `lib/` 并剥离浏览器束的多余模块标记。
发布时 `npm pack` 会通过 prepack 自动重新构建，无需手工编译。

## 卸载

```bash
dsh plugin --profile web remove dsh-skill-viewer
```

## License

MIT
