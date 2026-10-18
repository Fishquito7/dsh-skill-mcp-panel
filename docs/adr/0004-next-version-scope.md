# 下一版范围、执行顺序与被阻塞的原因

2026-10-15 用户拍板：**暂不发布**，先把前端重构掉，所有 UI 相关改动等设计稿；功能主线是「MCP 单工具禁用」与「面板内建 OAuth」。

## 背景

2026-10-13 ~ 10-15 连着来了一批 issue（#42、#43、#44、#45、#46、#27），仓库里已经躺着两批未发布的修复：

- **v2.1.6**（已提交在 `release/v2.1.6`，`dc4ec9b`）：修 #43——文件夹选择器丢掉被选文件夹自己的名字、依赖 `.md` 被当技能校验、成功路径 staging 目录泄漏。
- **v2.1.7**（工作区未提交）：添加技能的冲突判定收窄到目标作用域（ADR-0002）。

npm 上的 `latest` 仍是 **2.1.5**，也就是说 #43 报的阻断性故障在公开版本里还在。

## 决策（用户 2026-10-15）

1. **暂不发布**：2.1.6 与 2.1.7 都停在本地，与后面的功能一起发。
2. **前端重构先行**：用户先重做前端并会提供一版设计稿；UI 相关改动（#46 的提示条、#42 的来源分组、#27 的入口开关、#44 与 #45 的界面）等设计稿，避免在即将被重写的 `src/client.ts` 上重复劳动。
3. **#46 按 ADR-0003 的 A1 修**（形状保持 + 可见化）。
4. **#44 先做「MCP 单工具禁用」**（而不是先做「按预设管控 MCP 服务器 / 技能根」）。
5. **#45 做面板内建完整 OAuth**（而不是只给 stdio 代理的替代写法）。
6. **#42 做「按来源（插件）分组」+ 隐藏没有技能的工作区**；**#27 做入口位置开关**（侧栏 / 设置页）。
7. **关闭 #41**（`/ecc-tools analyze`，无有效内容），并给仓库加 issue 模板与标签。

## 勘测事实（2026-10-15 实测，宿主 0.2.0-rc.2，避免重查）

- **`@deepseek-ai/dsh-mcp-client` 没有 OAuth、也没有工具过滤**。配置全字段：`transport`、`serverName`、`command`/`args`/`env`/`cwd`、`url`/`headers`、`toolCallTimeoutMs`、`maxInstructionBytes`、`failOnStartupError`、`reconnect.{enabled,initialDelayMs,maxDelayMs,maxAttempts}`。在编译产物里搜 `oauth` 零命中 ⇒ 面板内建 OAuth 必须自己拿令牌，再把结果写成 `headers`（我们已支持 `${NAME}` → `!!js`）或别的持久化形态。
- **`ctx.tools.restrict({ allow, deny })` 存在**（`dsh-tools`）：要求 **scoped ctx**（`scopeOf(ctx) !== undefined`），否则报「a context-global restriction would mask every agent」；被限制的全局工具会从模型可见的 schema 里消失 —— **真的省上下文**，不只是拒绝调用。约束：不能点名保留名 `run_code`；未知名字会报错并列出可限制的名字清单；`tools.guard()` 只能拒绝调用、**不减少上下文**，因此不适合本需求。
- **scope 传递链**：`createScope(ctx, key)` = `ctx.extend({ [kScope]: key })`，而 cordis 的 `extend()` 用 `Object.create()` 做原型继承 ⇒ 挂在**预设**里的子插件会继承预设的 scope tag。**推断**：预设内的子插件可以调 `restrict()`，从而做到「按预设整组禁用工具」；这一步需要一次原型验证（预设内挂一个 `restrict({deny:[...]})` 的探针插件，看模型 schema 是否真的少掉那些工具体）。
- **预设就是一份 cordis 插件列表**：`@deepseek-ai/dsh-agent-preset`（`config.plugins` 是子插件行数组）+ `dsh-agent-preset-registry`（`default` 指定默认预设）。官方 Web 编辑器保存预设的方式是**往 profile patch 写 `preset-<id>` 覆盖行、覆盖整份 `config.plugins`**；registry 另有一个 `read` Remote，能把某条声明的子列表渲染成 entry-list YAML 供界面展示。若走这条路，代价是：被覆盖过的预设会被钉在 profile patch 里，DSH 升级自带预设后旧副本仍在（官方编辑器同款代价）。
- **技能注册表没有「按名字排除/隐藏」的 API**：provider 只能上报，rank 只决定同层重复项谁遮蔽谁（project-dsh 100 < project-agents 200 < custom 300 < user-dsh 400 < user-agents 500，近层遮蔽远层）。所以「按预设控制技能」只能从 **provider / 根**入手（`skill-filesystem` 的 `includeDefaultRoots`、`customSkillDirs`），要按名字粒度就得靠「每个预设一个技能根」这类组织方式。
- 原生 DSH 的技能发现仍是单层 `readdir`（只认 `<root>/<name>/SKILL.md` 与 `<root>/<name>.md`），这也是本插件嵌套提供方存在的原因。

## Considered Options

- **先发 2.1.6（只修 #43）再继续**：抢时间止血，但用户选择与后面的功能合并发，减少一次发布与一次 issue 回复。
- **#44 先做「按预设管控服务器/技能根」**：风险最低（纯声明式、官方编辑器同款机制），但用户选的是单工具禁用——省上下文更彻底。
- **#45 只给 stdio 代理写法**：今天就能用，但用户要的是面板内建。
- **在前端重构前先修 #46**：库层（`patch-editor` + gateway + CLI）与前端无关，可以先做；带 UI 的可见化部分等设计稿。

## Consequences

- 未发布的两个版本会继续叠在工作区；必须在 HANDOFF 里钉住「当前分支 / 未提交内容 / 本机 profile 装的是哪一版」，否则下一个窗口会误判状态。
- 内建 OAuth 需要先落一份设计：令牌存哪（`dsh-credentials` 凭证存储 vs 面板自己的配置文件）、回跳怎么走（Electron 里的本地回调 / 手动粘 code / 设备码）、刷新与失败怎么回报到界面。
- 单工具禁用需要一个「挂在预设里的过滤插件」（本包新增一个子入口导出），其配置由面板写入预设的 `config.plugins` —— 与前端设计稿强相关，等设计稿。
- #46 的库层修复在前端重构期间可以独立推进并加测试，不必等设计稿。
