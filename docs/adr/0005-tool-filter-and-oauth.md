# 单工具禁用走 agent 作用域；OAuth 令牌落在 Authorization 头

2026-10-15。两条决策 + 支撑它们的实测结论（宿主 0.2.0-rc.2）。

## 一、`ctx.tools.restrict()` 的正确施加入口是 **agent 作用域**

Issue #44 要「禁用 MCP 里低频的工具」以减少每次会话注入的上下文。可用机制只有
`ctx.tools.restrict({ allow, deny })`：被限制的工具会从**模型可见的 schema** 里消失
（`tools.guard()` 只能拒绝调用，不省上下文，不满足需求）。

原型实测（`issue-recon/44/`）三条：

1. `restrict()` 只接受 **scoped ctx**；从 unscoped 的全局 ctx 调用会被拒绝
   （"a context-global restriction would mask every agent"）。
2. 想从外部直接 `agent.ctx.tools.restrict(...)` 也不行：服务访问受宿主 inject 门禁约束
   （"cannot get property \"tools\" without inject"）。
3. **可行路径**：在 `agent/created` 时往该 agent 的作用域下挂一个微型插件
   （声明 `inject: ["tools"]`），由它在自己的作用域上注册限制。实测结果：
   该 agent 的可见 schema 少掉被禁用的工具，其他 agent 与全局视角不受影响，
   插件纤维是 agent 作用域的子节点 → agent 销毁时限制自动解绑。

于是**不需要改预设**（不需要把 `config.plugins` 整份复制进 profile patch，也就没有
「DSH 升级自带预设后旧副本被钉住」的代价）。配置存
`<dshHome>/skills/.system/skill-viewer/tool-filter.json`，按**完整公开工具名**
（`mcp__<serverName>__<原始名>`）记录；名字对不上就不生效——宁可不生效也不猜。

## 二、OAuth 由面板自己拿令牌，落到 `Authorization` 头

Issue #45 问 OAuth。宿主侧事实：`@deepseek-ai/dsh-mcp-client` **没有** OAuth 字段
（配置只有 `transport` / `serverName` / `command` `args` `env` `cwd` / `url` `headers` /
`toolCallTimeoutMs` / `maxInstructionBytes` / `failOnStartupError` / `reconnect.*`），
所以只能由面板把令牌拿到手再写进 `headers`。

实现（`src/oauth.ts`）：发现文档（RFC 8414，两个 well-known 路径依次试）→ 动态客户端
注册（RFC 7591，服务器没提供端点就复用上次的 client_id 或让用户 `--client-id` 指定）
→ 授权码 + PKCE(S256) → **本进程监听 127.0.0.1 的随机端口**收回调（用户不用手抄 code，
也不需要任何外部回调服务）→ 换令牌 → 记录 `expires_at` 与 refresh_token。

令牌存 `<dshHome>/skills/.system/skill-viewer/oauth.json`；写进 profile patch 的是**字面量**
`Authorization: Bearer <token>`。这与用户今天手写 header 的方式等价——**明文**，
README 里写清楚；想要不入盘就改用 `${ENV}` 写法自己管。

## Considered Options

- **单工具禁用：改预设覆盖行**（把过滤插件塞进 `config.plugins`）：需要在 profile patch 里
  整份复制预设的子插件列表，`!!js` 表达式与注释会有丢失风险，且把自带预设钉在旧版本上。
  被原型否定——agent 作用域足够。
- **单工具禁用：`tools.guard()`**：实现最简单，但工具仍在 schema 里，省不了上下文。
- **OAuth：只写文档推荐 stdio 代理**（`npx mcp-remote`）：今天就能用，但用户要的是面板内建。
- **OAuth：令牌走 `!!js` 表达式读环境/文件**：更「安全」，但表达式求值时机由宿主决定，
  且刷新后要让宿主重新求值——不如直接重写 header 可控。

## Consequences

- 「禁用」是按 agent 施加的：**新会话生效**，已经开着的 agent 在配置变更时会被卸载重挂
  （`setDeny()` 会 disposes + reapply）。
- 工具名对不上（改名、服务器没连上）时不生效但**不报错**，只按已知名字过滤；
  `tools/change` 后会补一次。
- OAuth 只覆盖 `streamable-http`；stdio 服务器的凭据仍由本地进程自己管。
- 令牌明文落在 profile patch 与 `oauth.json`：面板要明确提示，并支持 `--disconnect` 一键清除。
- 面板前端的「工具级开关」与「OAuth 连接按钮」是这一层的消费方，界面细节随前端重构落地。
