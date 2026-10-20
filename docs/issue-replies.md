# 发布后要回给 issue 的文案（草案，等用户点头再发）

> 用户 2026-10-15 说「完成了以后先不发布」，所以 GitHub 侧**一个字都没动**。下面按 issue 编号备好，发版时逐条贴（每条都带上「实际怎么修的」和版本号）。

## #48 dsh0.2.1rc2 无法使用本插件，需更新

> 修好了，v2.3.0。你贴的两条报错是同一个根因：宿主 0.2.1-rc.2 自带 `@deepseek-ai/dsh-typert-protocol@0.2.1-rc.2`，而面板之前声明 `^0.1.0-rc.6`，profile 里于是装着一份**旧协议**。宿主网关解析 `mcpManager/list` 时定义「见过但不在册」，就报 `strict definition was withdrawn and SRC fallback is forbidden`；技能页那句「暂时无法读取技能」是同一件事的另一半。
>
> 现在把协议依赖钉到 `^0.2.1-rc.1`（必须排除 0.1.x，否则 pnpm 会沿用锁文件里的旧版本），并显式声明它的 peer `@deepseek-ai/cordis`——0.2.1 的协议包 peer 依赖 cordis `~4.0.5`，profile 里没有它时连导入都会失败；另外把只用到两个纯函数的 `dsh-home-paths` / `dsh-subprocess` 内联，剪掉它们的 peer 链。装完 profile 里是 `cordis 4.0.5 + dsh-typert-protocol 0.2.1-rc.2`，与宿主同代。顺手在 MCP 卡片上加了 OAuth 登录按钮（见 #45）。更新到 2.3.0 后重启 DSH Desktop 即可。
>
> 多谢这条 issue——报错原文直接指向协议层，省了很多时间。

## #46 受管块折叠外部行

> 修好了，v2.2.0 起生效。你的最小复现完全成立，根因和你定位的一致：写回路径 `extractManagedRows` 收块内**所有**条目、`generateManagedBlock` 又一律序列化成 `{insert: [...]}`，于是块内那条 `ui-theme` 顶层行被折叠成 insert，同一个 loader id 出现两行，`dsh-market` 的试算按 id 计数直接判重复、把整批更新回滚。
>
> 现在按「形状保持」修：受管行的判据收窄到 `id` 以 `panel-mcp-` 开头（和面板的行级操作同一判据），块内其余条目**逐字节原样保留**——顶层 `- id:` 仍是 id 定向覆盖、外来 `insert` 条目整条不动，面板只重建自己那一段；跨度按「下一个条目的行首」铺满整块，所以块内注释也保得住。顺带修掉一个你还没遇到的**数据丢失**：块内只剩外来行时，旧实现会把整块删掉。
>
> 另外采纳了你的「附带发现」——面板以前会重写这一行却不显示它：现在 MCP 页会把「受管块内还有 N 条不属于面板的行（…），面板不会改动它们」标出来。
>
> 测试固化了你的最小复现（读→写往返后外来顶层行仍是顶层、insert 里只有 `panel-mcp-*`、往返幂等），另加混合 insert 与「只剩外来行」两条。感谢这份 issue——根因、复现、影响面都写得很完整，照着你给的路径一次就复现了。

## #43 选文件夹必然报「缺少顶层 SKILL.md」

> 修好了（v2.1.6 起在代码里，v2.2.0 一起发布）。两个根因都按你的定位改了：文件夹选择器顶层传空前缀（`readHandleDir(dir, "", items)`）导致 `SKILL.md` 只剩一段路径、被两段式门禁恒判失败；顶层的依赖 `.md` 又被当成独立技能逐个校验。现在三个入口统一走一个分类器——选中范围内直接有 `SKILL.md` 就整体是一个技能包（`references/`、`scripts/`、顶层平铺的依赖 `.md` 都是载荷），否则递归发现并拍平到技能根第一层。
>
> 你附带的 staging 泄漏也修了：成功路径现在也会清掉 `.dsh-skill-staging-*`（原来只有 catch 分支清理）。

## #44 插件功能完善建议

> 两条建议都做了。②「MCP 服务支持禁用部分工具」在 v2.2.0 落地：工具级禁用不是「调用时才拒绝」，而是把工具从模型可见的工具表里**摘掉**，所以每次会话注入的 schema 真的变少。实现上走宿主的 `ctx.tools.restrict()`（按 agent 作用域施加，配置对所有会话生效；宿主自带 mcp-client 没有工具过滤字段，所以由面板来做）。
>
> ①「按预设独立管控」这一半我按另一种更省的路径满足了同一诉求——见 ADR-0005：实测证明 agent 作用域足够，不需要改写预设的插件列表（那会把自带预设钉在旧版本上）。如果你确实需要「A 预禁用 x、B 预禁用 y」这种差异化，回一句我按预设维度再做一层。

## #45 MCP 管理，支持 OAuth2.0 登录吗？

> 支持了。宿主自带的 mcp-client 只认静态 headers、没有 OAuth 字段（把它的配置字段逐个列过），所以由面板自己走完整流程：发现授权服务器（RFC 8414）→ 动态注册客户端（RFC 7591）→ 授权码 + PKCE → 回调落在本机 `127.0.0.1` 的临时端口（不用手抄 code）→ 换令牌并写进那一行的 `Authorization` 头，网关热加载。
>
> 入口有两处：面板里 HTTP 服务器的卡片上有「OAuth 登录 / 重新登录」「断开登录」按钮（点登录会打开授权页，后台轮询到完成为止）；CLI 仍是 `dsh-panel mcp oauth <服务器名> --profile <profile>`（`--disconnect` 断开并清本地令牌）。
> 注意：令牌以**明文**落在 profile 配置里（和手写 header 等价），不想入盘就继续用 `${ENV}` 的写法自己管。

## #42 Feature request - Group skills by plugin origin

> Shipped in v2.2.0. The group pane now has a `分组 / 来源` switch: the origin axis groups by `provider` and puts plugin-shipped skills in their own “plugin-provided” group, so you can see at a glance which plugin a skill came from. Workspaces with no skills are no longer listed in the workspace rail (which also addresses your “if a workspace does not have any plugin maybe is better to hide it”).
> The dropdown you were looking at lists workspaces, not plugins — the new origin axis is the answer to that.

## #27 Feature Request（入口放设置页还是侧栏）

> 试过之后**决定不做这个开关**，跟你说一声并说明理由：面板现在是三栏（工作区 / 分组 / 内容）+ 批量选择 + 设置浮层，元素已经不少；把它整份塞进设置页需要两套前端（设置页的容器与侧栏的槽位约束完全不同），维护成本不划算。所以 v2.2.0 起仍只在主页侧栏提供一个入口——从主页进入只需要一次交互，从设置页进要两次到三次，这也是你当初看到的那种取舍。
>
> 如果你要的其实是「不想让它在主界面常驻」，更省的做法是给侧栏那个入口加一个折叠/隐藏，而不是换位置；需要的话回一句。

## #41 Run ECC Tools analysis

> 这个 issue 里没有可执行的内容（只有一条 `/ecc-tools analyze` 命令文本），仓库这边也没有对应的工具链，先关闭。若你是在找某个具体分析，重新开一个带复现步骤的 issue 就很乐意处理。

## #51 最新版新加的 MCP 单工具禁用 功能无法正常使用

> 修好了，v2.3.1。`remote[method] is not a function` 跟服务器连不连得上没关系，是**客户端清单漏了方法**：浏览器束里另有一份 Remote 方法表，客户端 `remote.mcpManager` 上只有表里挂过的方法——宿主只安装贡献项里列出的方法，没列的压根不存在。2.2.0 加单工具禁用（`listTools` / `getToolFilter` / `setToolFilter`）时只补了宿主侧清单，漏了浏览器束那份，所以「工具」按钮必抛错；卡片上的 **OAuth 登录 / 断开** 按钮是同一个病根，这次一并修好。
> 升级：`dsh-panel update` 或重装 tarball，然后**重启 DSH Desktop**。另外加了 `test-client-contribution.mjs` 做两份清单的双向全量比对，这类「加功能漏补客户端」以后测试里就能拦住。

## #59 禁用MCP中的任一一个工具后，新建会话时dsh会卡死（附「显示插件技能」不记忆）

> 这条里的两个问题在 **v2.3.5 都修了**，已发布。
>
> **1. 卡死**：和 #62 是同一个 bug。宿主 `@deepseek-ai/dsh-scope` 的 `ScopedLayers.effect()` 在限制生效后**和撤销（undo）时**都会同步广播 `tools/change`；我们的插件既监听这个事件、又在回调里 `undo()` / `restrict()`，于是自己触发自己，同步无限递归。递归到栈上限抛出的 `RangeError` 又被空 `catch` 吞掉，所以不崩溃、只是主线程持续 100% 打转。用宿主真实的 `dsh-scope` 复现：旧代码一次事件放大成 **887 次 `restrict` / 1774 次 `view` / 递归 458 层**；修复后 **1 次 `restrict` / 2 次 `view` / 深度 2**。修法是控制器统一监听 + 重入守卫 + 只在禁用集合真的变化时重施，并把静默的 `catch` 接到 logger。
> **2. 「显示插件技能」复选框不记忆**：也修了，勾选状态记在浏览器 localStorage（`dsh-skill-mcp-panel:show-plugin-skills`），重新打开面板保持上次选择。
> 升级：`dsh plugin --profile web add .../releases/latest/download/dsh-skill-mcp-panel.tgz` 或 `npm i -g dsh-skill-mcp-panel@2.3.5`，装完重启。和本地 FastMCP 无关，禁任何工具都会触发。

## #62 tool-filter 的 applyNow 监听 tools/change 又调用 restrict()，形成无限递归

> 感谢这份非常完整的定位，分析是对的——根因、调用环、以及「RangeError 被吞所以只烧 CPU 不崩」都说中了。**已在 v2.3.5 修复并发布。**
> 补充两点现场事实：① 宿主 `ScopedLayers.effect()` 确实在施加限制之后（`if (notify) this.onChange()`）和 undo 执行时（yield 出去的清理函数里）都同步通知；`restrict()` 走默认 `notify: true`，而宿主自己的 `guard()` 传了 `notify: false`，所以 guard 没这个问题。② 用宿主真实的 `dsh-scope` 复现：旧代码一次 `tools/change` → **887 次 restrict / 1774 次 view / 递归 458 层**；修复后 → **1 次 restrict / 2 次 view / 深度 2**。
> 修复没有只加重入标志，还加了建议的第二层：控制器单点监听 `tools/change` + 重入守卫；每个插件实例的 `sync()` 也有自己的守卫；记录上次真正施加的集合签名，集合没变只多一次 `view()`、不 undo 不 restrict；`applyTo` 用 `mounting` 挡住挂载中重入；静默 `catch` 全部接 logger。
> 升级到 2.3.5 即可，不用再手工改 `tool-filter.js`。

