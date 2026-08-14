# dsh-skill-viewer

([English](README.en.md)|简体中文)


DSH 插件，可直接在 web 界面快速管理 skill 状态，同时在终端加入快捷的skill管理命令。命令行命令请见下文

注意：本项目提供的参考命令默认指定profile为默认的--profile web，需要更改profile的请自行注意。

<img width="602" height="599" alt="image" src="https://github.com/user-attachments/assets/6ccb50e5-05ce-4264-97e3-4372d096be3e" />

## 功能

- skill 卡片列表：预览已注册安装的 skill，点击卡片可展开查看完整内容
- skill 状态：启用、停用状态标签，与内置插件列表同款样式
- skill 管理：开关热启用/停用、删除；按名称搜索；进入页面自动刷新
- skill 添加：选择单文件（`.md`）或目录束（含顶层 `SKILL.md` 的文件夹），不合规内容会被拒绝并提示原因
- **工作区作用域**（0.2.6）：添加技能时可指定一个或多个工作区（默认全局）。
  限定工作区的技能只在这些工作区的会话中可见，不会全局暴露；技能本体只存一份
  （`~/.dsh/skills/.system/skill-viewer/<name>/`），每个绑定工作区的
  `.dsh/skills/` 下是一个联接点。工作区被删除后联接点随之消失、绑定自动清理，
  技能本身不会丢失（在页面中会提示"0 个工作区"）。卡片上的"作用域"按钮可随时
  把技能在"全局 ↔ 限定工作区"之间切换。

## 安装

1. 安装本包（bundle 层自动挂载，无需编辑配置文件）

   ```bash
   dsh plugin --profile web add github:Fishquito7/dsh-skill-viewer
   ```

   > pnpm v11 安全限制：Git 来源的依赖默认禁止运行 prepare 构建脚本。若报
   > “git-hosted plugins build on install...”，把 pnpm 在上面打印的 key 加到
   > profile 目录的 `pnpm-workspace.yaml` 的 `allowBuilds` 下再重跑即可；
   > **或者直接用发行版 tarball 安装（不走 Git，无此限制）：**
   >
   > ```bash
   > dsh plugin --profile web add https://github.com/Fishquito7/dsh-skill-viewer/releases/download/v0.2.4/dsh-skill-viewer-0.2.4.tgz
   > ```

2. 重启网关

   ```bash
   dsh-restart
   ```

   重启后刷新页面：设置 → “插件”下方即可看到“技能”。

## 命令行

随包附带 `dsh-skill` 命令，可直接在终端管理技能（同样热生效，网关关闭时也能用）：

```bash
dsh-skill list                 # 列出技能（含启停状态与作用域）
dsh-skill add <path>           # 添加技能（单个 .md 文件或含顶层 SKILL.md 的目录束）
dsh-skill add <path> --workspace D:\项目A --workspace D:\项目B   # 限定到指定工作区
dsh-skill scope <name> --global                    # 改为全局
dsh-skill scope <name> --workspace D:\项目A        # 限定到指定工作区（可重复）
dsh-skill disable <name>       # 停用
dsh-skill enable <name>        # 启用
dsh-skill delete <name>        # 删除（需确认）
```

## 工作原理

插件并不自己解析技能，只是技能文件的“管理界面”：页面和 `dsh-skill` 命令的每次操作，最终都是对磁盘上技能文件（`SKILL.md`）的改动，DSH 自带的文件监听器立刻发现变化——所以启用/停用、增删都热生效，无需重启网关。

- 停用 = 把 `SKILL.md` 改名为 `SKILL.md.disabled`，启用 = 改回来
- 停用后技能从 `/skill` 触发词与模型目录中消失；页面里仍置灰展示，可随时重新启用
- 随部署附带的技能（bundled）为只读，不可停用或删除

## 卸载

```bash
dsh plugin --profile web remove dsh-skill-viewer
```

## License

MIT
