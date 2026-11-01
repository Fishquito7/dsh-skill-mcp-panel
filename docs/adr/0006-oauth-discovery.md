# OAuth 发现改为 origin / PRM 逐级回退，并校验 issuer 与 resource

2026-10-30。修复带路径的远程 MCP 端点（例如 `https://ardot.tencent.com/mcp`）无法 OAuth 登录的问题，并修订 ADR-0005 中「两个 well-known 路径依次试」的发现顺序；真机回归又补齐了 RFC 8707 `resource`。

## 背景与根因

旧实现把 `/.well-known/oauth-authorization-server` 直接拼在**完整 server URL** 后面。对 Ardot 实测：

| 请求 | 结果 |
|---|---|
| `https://ardot.tencent.com/mcp/.well-known/oauth-authorization-server` | `404 text/html` |
| `https://ardot.tencent.com/.well-known/oauth-authorization-server` | `200 application/json` |

Ardot 的授权服务器元数据在 **origin 根**，不在 `/mcp` 之下；`/mcp` 返回的 `401` 里 `WWW-Authenticate` 指向的 PRM 也在根：`resource_metadata="https://ardot.tencent.com/.well-known/oauth-protected-resource/mcp"`。所以问题不在 Ardot 的 OAuth 接入，而在客户端的 URL 拼接假设。

修复发现并跑通动态注册后，现场回归又暴露了第二个问题：Ardot 的授权信息接口 `/oauth/authorize` 对不带 `resource` 的请求返回 `400 {"error":"invalid_target"}`。PRM 里声明的 `resource` 是 `https://ardot.tencent.com/mcp`；补上该参数后，同一接口改为 `401 Unauthenticated`（未登录时）或正常返回授权信息。

`normalizeServerUrl()` 只负责补协议、去尾斜杠，并不知道哪一段是 MCP 端点路径。对任意 `https://host/<path>`，把 well-known 追加在 `<path>` 后都不是 RFC 8414 的默认位置。

## 决策

### 1. 候选按「标准位置优先、旧行为兜底」排序

对一个 server URL `origin + path`，依次尝试：

1. `origin/.well-known/oauth-authorization-server`（RFC 8414 §3.1，插入在 host 与 path 之间）
2. `origin/.well-known/openid-configuration`（OIDC Discovery，追加在 issuer 后）
3. `origin/.well-known/oauth-protected-resource`（RFC 9728 PRM，根）
4. `origin/.well-known/oauth-protected-resource<path>`（RFC 9728 PRM，路径变体）
5. `<serverUrl>/.well-known/oauth-authorization-server`（旧行为，兼容端点下暴露的部署）
6. `<serverUrl>/.well-known/openid-configuration`（旧行为 OIDC）

命中即返回；候选去重，所以没有路径的 URL 只发 3 个请求。

### 2. 命中 PRM 后做二次发现

PRM 响应没有 `token_endpoint` 但有 `authorization_servers[]` 时，对每个 issuer 再尝试：

1. `origin/.well-known/oauth-authorization-server<path>`（RFC 8414 插入式）
2. `<issuer>/.well-known/openid-configuration`（OIDC 追加式）
3. `origin/.well-known/openid-configuration<path>`（OIDC 插入式）
4. `<issuer>/.well-known/oauth-authorization-server`（兼容追加式）

issuer 支持相对值（按 PRM URL 解析）；只允许 `http:` / `https:`，避免 `file:` 等 scheme 被当作发现目标。命中 PRM 时，PRM 本身在 attempts 里标记为「是 PRM」而不是失败。

### 3. issuer 校验只比较 origin

元数据带 `issuer` 时，必须能解析为合法 URL，且 origin 与发现 URL 的 origin 一致。**不比较 path**。

这是一个有意的放宽：RFC 8414 §6.2 要求 issuer 与客户端使用的前缀精确匹配；但很多部署把 issuer 配成带路径、元数据仍暴露在根。放宽到 origin 可以挡住「元数据 issuer 指向别的域」的混用，又避免误杀这类部署。Ardot 的 issuer 是 `https://ardot.tencent.com`，不受影响。

严格匹配的改法已经预留：给 `validateAuthorizationServerMetadata()` 增加可选 `expectedIssuer`，PRM 二次发现时传入 `authorization_servers` 里的 issuer 做精确比较（约 10 行 + 1 条测试）。

### 4. 授权与 token 请求带 RFC 8707 resource

`buildAuthorizationUrl()` 末尾增加可选 `resource` 参数，`exchangeCode()` / `refreshTokens()` 也接受可选的 resource 并写入表单。面板的两个实际调用点（Web 网关 `oauthStart` 与 CLI `dsh-panel mcp oauth`）都传入 `normalizeServerUrl(config.url)`，也就是用户配置的 MCP 端点（Ardot 为 `https://ardot.tencent.com/mcp`）。

`exchangeCode()` / `refreshTokens()` 的第 6/5 个参数保留旧语义：传函数仍视为 `fetchImpl`，传字符串才视为 resource。这样已有测试和外部调用不需要改签名。

### 5. 超时、总预算与失败诊断

- 单候选 `timeoutMs` 默认 8000ms，`AbortSignal.timeout(min(单请求, 剩余预算))`。
- 总预算 `budgetMs` 默认 20000ms，串行候选不会无限拖。
- attempts 记录每个 URL 的 `status` 与 `reason`（HTTP 404 / 请求超时 / 缺少 token_endpoint / issuer 不一致 / 是 PRM 等）。
- `gateway` 与 CLI 共用 `discoveryFailureMessage()`：保留原句前缀「这个地址没有暴露 OAuth 发现文档（/.well-known/oauth-authorization-server），无法自动登录」，后附最多 10 条已尝试 URL。
- `discoverMetadata()` 签名不变；新增 `discoverMetadataDetailed()` 返回 `{ metadata?, attempts }`，`discoveryCandidates()` / `authorizationServerCandidates()` 可单独测试。

## Considered Options

- **只修 URL 拼接，按 `/mcp` 等已知后缀裁剪路径**：能救 Ardot，但对 `/sse`、`/v1/mcp`、自定义路径仍是猜；且会把合法路径截错。否决。
- **PRM 优先于 RFC 8414**：更贴 MCP 规范，但 Ardot 会先命中 PRM 再查 AS，至少 2 次请求；且 PRM 不是所有 OAuth 服务器都提供。保留为候选 3/4，而不是第一位。
- **issuer 精确匹配**：更贴 RFC 8414 §6.2，但会破坏 issuer 带路径、元数据在根的部署。先放宽到 origin，严格模式留作可选项。
- **不校验 issuer**：旧行为，配置错误的服务器也能「登录成功」。这是安全缺口，否决。
- **只改 `discoverMetadata`，不返回 attempts**：实现最小，但用户仍然只能看到笼统的「没有暴露发现文档」，无法区分 404、超时、PRM 配置错误。否决。

## Consequences

- Ardot 从「2 次 404 后放弃」变成「第 1 个候选 200 命中」，请求数 1。
- 旧版部署仍可用：端点下暴露 AS 的服务器在候选 5 命中（5 次请求）；全 404 时最多 6 次请求，受 20s 总预算约束。
- issuer 指向其他 origin 的元数据现在会被拒绝。这是有意的安全修复，但对配置错误的服务器是行为变更；错误信息会明确写「issuer 与发现地址不一致」。
- 失败错误变长（含 URL 清单），日志与 UI 需要能换行展示；`discoveryFailureMessage()` 已限制最多 10 条。
- Ardot 的授权页从 `400 invalid_target` 变为正常显示 `mcp:use` 同意页；完整 token 交换仍需用户在浏览器里点「同意授权」，无法在无人值守下伪造。
- 真机完整流程已通过：同意后 token 交换成功，MCP `initialize` 协商到 `2025-06-18`（`ardot-remote@1.1.5`），`tools/list` 返回 26 个工具。
- 新增 1 条测试（总计 18 条 OAuth 测试）；`lib/` 需随源码一起重建并提交。
- 无新增运行时依赖。
- PRM 的 `authorization_servers` 会驱动跨 origin 的 GET；实现只限制 `http:` / `https:`，未做私网地址过滤。桌面场景下目标由用户配置的 MCP 服务器决定，后续如需可再加 allowlist。

## References

- RFC 8414 §3.1 / §6.2：Authorization Server Metadata
- RFC 9728 §3：Protected Resource Metadata
- RFC 7591：Dynamic Client Registration
- RFC 8707：Resource Indicators for OAuth 2.0
- ADR-0005：OAuth 令牌落在 Authorization 头（发现顺序部分由本文修订）
