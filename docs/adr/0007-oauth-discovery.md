# OAuth 发现改为「路径 PRM 优先」，并严格校验 issuer 与 resource

2026-10-30 初稿；2026-11-02 修订（评审后修复候选人顺序、issuer 严格度、PRM `resource` 与文档不一致）。修复带路径的远程 MCP 端点（例如 `https://ardot.tencent.com/mcp`）无法 OAuth 登录的问题，并修订 ADR-0005 中「两个 well-known 路径依次试」的发现顺序；真机回归又补齐了 RFC 8707 `resource`。

## 背景与根因

旧实现把 `/.well-known/oauth-authorization-server` 直接拼在**完整 server URL** 后面。对 Ardot 实测：

| 请求 | 结果 |
|---|---|
| `https://ardot.tencent.com/mcp/.well-known/oauth-authorization-server` | `404 text/html` |
| `https://ardot.tencent.com/.well-known/oauth-authorization-server` | `200 application/json` |

Ardot 的授权服务器元数据在 **origin 根**，不在 `/mcp` 之下；`/mcp` 返回的 `401` 里 `WWW-Authenticate` 指向的 PRM 是路径形态：`resource_metadata="https://ardot.tencent.com/.well-known/oauth-protected-resource/mcp"`。所以问题不在 Ardot 的 OAuth 接入，而在客户端的 URL 拼接假设。

修复发现并跑通动态注册后，现场回归又暴露了第二个问题：Ardot 的授权信息接口 `/oauth/authorize` 对不带 `resource` 的请求返回 `400 {"error":"invalid_target"}`。PRM 里声明的 `resource` 是 `https://ardot.tencent.com/mcp`；补上该参数后，同一接口改为 `401 Unauthenticated`（未登录时）或正常返回授权信息。

`normalizeServerUrl()` 只负责补协议、去尾斜杠，并不知道哪一段是 MCP 端点路径。对任意 `https://host/<path>`，把 well-known 追加在 `<path>` 后都不是 RFC 8414 的默认位置。

## 决策

### 1. 候选顺序：路径形态 PRM → origin 根 PRM → RFC 8414 / OIDC → 旧行为

对一个 server URL `origin + path`（先经 `normalizeServerUrl()` 规范化），依次尝试：

| # | 候选 | 依据 |
|---|---|---|
| 1 | `origin/.well-known/oauth-protected-resource<path>` | RFC 9728 §3.1 路径形态 |
| 2 | `origin/.well-known/oauth-protected-resource` | RFC 9728 origin 根 |
| 3 | `origin/.well-known/oauth-authorization-server<path>` | RFC 8414 §3.1 插入式 |
| 4 | `origin/.well-known/oauth-authorization-server` | RFC 8414 origin 根 |
| 5 | `origin/.well-known/openid-configuration<path>` | OIDC Discovery 插入式 |
| 6 | `origin/.well-known/openid-configuration` | OIDC Discovery origin 根 |
| 7 | `<serverUrl>/.well-known/oauth-authorization-server` | 旧行为：AS 直接暴露在端点路径下 |
| 8 | `<serverUrl>/.well-known/openid-configuration` | 旧行为 OIDC |

命中即返回；候选去重。带路径的端点共 **8 条候选**。`path` 为空（配置只给 origin，或 path 为 `/`）时，插入式与根形态重合：

| # | 候选 |
|---|---|
| 1 | `origin/.well-known/oauth-protected-resource` |
| 2 | `origin/.well-known/oauth-authorization-server` |
| 3 | `origin/.well-known/openid-configuration` |

即 **3 条候选**、最多 3 次请求——第 1/2、3/4、5/6 条分别合并，7/8 条也落在同一位置。

**为什么 PRM 先于 AS**：RFC 9728 §3.1 的 PRM 是「这个受保护资源对应哪个授权服务器」的权威声明。origin 根 AS / 根 PRM 对任何带路径的端点都会被接受，共享 origin（多产品、网关、CDN）上就可能把客户端绑到**另一个产品**的授权服务器，这是混用（mix-up）/ 劫持风险。先查路径形态 PRM，才能让带路径端点只信任与自己路径对应的元数据。为此 origin 根 AS 只是**兜底**，仍保留（兼容只在根暴露 AS 的部署，例如 Ardot）；根 PRM 同样保留（兼容只发布根 PRM 的部署）。

**query / hash**：配置 URL 里的 query / hash 不参与候选拼接（先剥掉），否则会拼出 `https://host/mcp?tenant=a/.well-known/...` 这种把 well-known 塞进 query 的伪路径。`serverUrl` 的 query 仍是资源标识的一部分（见 §4）。

### 2. 命中 PRM 后做二次发现

PRM 响应没有 `token_endpoint` 但有 `authorization_servers[]` 时，对每个 issuer 再尝试：

1. `origin/.well-known/oauth-authorization-server<path>`（RFC 8414 插入式）
2. `<issuer>/.well-known/openid-configuration`（OIDC 追加式）
3. `origin/.well-known/openid-configuration<path>`（OIDC 插入式）
4. `<issuer>/.well-known/oauth-authorization-server`（兼容追加式）

issuer 支持相对值（按 PRM URL 解析）；只允许 `http:` / `https:`，避免 `file:` 等 scheme 被当作发现目标。issuer 自带的 query / hash 同样不进入候选拼接。

PRM 本身在 `attempts` 里用 `kind: "prm"` 标记（不再是 `reason: "是 PRM（authorization_servers）"`）；`reason` 只留给真正的失败（二次发现也没找到可用 AS 时记 `PRM 未找到可用的授权服务器元数据`）。备注（resource 采用 / 忽略、issuer 缺失等）写在 `note` 里。

### 3. issuer 校验：PRM 驱动严格，直连只限同源

- **PRM 驱动**（`authorization_servers[]` 提供的 `expectedIssuer`）：AS 元数据必须有非空字符串 `issuer`，且与声明值在「只忽略结尾斜杠」后完全相等；path、query、大小写（host 由 URL 规范化除外）不同都拒绝。错误为 `缺少 issuer（期望 …）` / `issuer 不匹配（期望 …，实际 …）`。这是 RFC 8414 §6.2 / RFC 9728 §3.3 的混用防护：PRM 说 AS 是 A，文档就不能自称 B。
- **直连发现**（候选 3–8，没有 `expectedIssuer`）：元数据带 `issuer` 时，必须能解析且与发现 URL 同 origin（**不比较 path**）；**不带 `issuer` 仍接受**（真机 Ardot 就是这样），并在 attempts 的 `note` 里记「元数据未声明 issuer，按发现地址接受」。

直连的 origin-only 是已知的放宽：RFC 8414 §6.2 要求 issuer 与客户端使用的前缀精确匹配，但很多部署把 issuer 配成带路径、元数据仍暴露在根。更严格的「issuer 与发现 URL 前缀」规则需要另行设计，避免误杀这类部署；PRM 驱动这条路径已经不再放宽。

### 4. 授权与 token 请求带 RFC 8707 resource

- **`DiscoveryResult.resource`**：PRM 声明了 `resource`，且它是字符串、绝对 `http(s)` URI、与配置的 MCP 端点**同 origin** 时，原样（去首尾空白、拒绝 fragment）带回。跨 origin、非字符串、非法 URI 一律忽略，并在该 PRM 的 attempt `note` 里写明原因（例如 `忽略 PRM 的 resource（与 MCP 端点不同源）：…`）。
- 调用方（Web 网关 `oauthStart` 与 CLI `dsh-panel mcp oauth`）用 `result.resource ?? serverUrl`；`serverUrl` 即 `normalizeServerUrl(config.url)`。PRM 没有可用声明时，resource 就是配置的 MCP 端点（Ardot 为 `https://ardot.tencent.com/mcp`）。
- `resource` 只在**由 PRM 驱动的二次发现**里采用；PRM 没声明、或声明被忽略时，`DiscoveryResult.resource` 为 `undefined`，由调用方兜底。
- 配置 URL 的 query / hash：发现候选会剥掉（见 §1）。query 保留在兜底 resource 里（RFC 8707 允许 query）；fragment 不允许出现在 resource 里，PRM 声明的 resource 带 fragment 会被忽略。
- `buildAuthorizationUrl()` 末尾仍是可选 `resource` 参数，`exchangeCode()` / `refreshTokens()` 也接受可选 resource 并写入表单。`exchangeCode()` / `refreshTokens()` 的第 6/5 个参数保留旧语义：传函数仍视为 `fetchImpl`，传字符串才视为 resource。三个函数的签名都不变。

### 5. 超时、总预算与失败诊断

- 单候选 `timeoutMs` 默认 8000ms，`AbortSignal.timeout(min(单请求, 剩余预算))`。
- 总预算 `budgetMs` 默认 20000ms，串行候选不会无限拖。
- `attempts` 记录每个 URL 的 `status`、失败 `reason`（HTTP 404 / 请求超时 / 缺少 token_endpoint / issuer 不匹配 / PRM 未找到可用 AS 等）、成功路径的 `kind` / `note`。
- `gateway` 与 CLI 共用 `discoveryFailureMessage()`：保留原句前缀「这个地址没有暴露 OAuth 发现文档（/.well-known/oauth-authorization-server），无法自动登录」，后附最多 10 条**失败** URL（成功路径的 note 不会出现在这里）。
- `discoverMetadata()` 签名不变；`discoverMetadataDetailed()` 的返回从 `{ metadata?, attempts }` 变为 `{ metadata?, attempts, resource? }`（只增可选字段）；`discoveryCandidates()` / `authorizationServerCandidates()` / `normalizeResource()` 可单独测试。

### 6. 未实现：401 `WWW-Authenticate: resource_metadata` 提示

Ardot 的 `401` 响应里已经带了「PRM 在哪个 URL」的提示，但本实现**仍不消费**它：候选列表是静态的，发现流程不会先对 MCP 端点本身发一次探测请求，也就不会解析 `WWW-Authenticate` 去补一条动态候选。原因是这会引入候选列表之外的一次网络请求，离线测试只能用假 `fetch` 覆盖，真机价值与复杂度暂不成比例；若后续要做，应在**第一次候选之前**探测一次端点，并把 `resource_metadata` 解析成候选插到最前面。

## Considered Options

- **只修 URL 拼接，按 `/mcp` 等已知后缀裁剪路径**：能救 Ardot，但对 `/sse`、`/v1/mcp`、自定义路径仍是猜；且会把合法路径截错。否决。
- **RFC 8414 / OIDC 优先，PRM 只作兜底**（PR #72 初版）：共享 origin 上根 AS 会先命中，带路径端点可能绑定到别的产品；评审确认有混用 / 劫持风险。否决，改为路径 PRM 优先。
- **PRM 优先会让 Ardot 多一次请求**：确实从 1 次变 2 次（PRM + AS），但换来共享 origin 上的正确绑定；且根 AS 仍在候选 4 兜底。接受。
- **issuer 一律精确匹配**：更贴 RFC 8414 §6.2，但会破坏 issuer 带路径、元数据在根的部署。改为「PRM 驱动精确匹配，直连保持同源」。
- **不校验 issuer**：旧行为，配置错误的服务器也能「登录成功」。这是安全缺口，否决。
- **只改 `discoverMetadata`，不返回 attempts**：实现最小，但用户仍然只能看到笼统的「没有暴露发现文档」，无法区分 404、超时、PRM 配置错误。否决。

## Consequences

- Ardot 从「第 1 个候选（根 AS）200 命中、1 次请求」变成「路径 PRM → 根 AS」，2 次请求；换来带路径端点在共享 origin 上不会绑错 AS。
- 旧版部署仍可用：端点下暴露 AS 的服务器在第 7 个候选命中（7 次请求）；全 404 时带路径端点最多 8 次请求，只有 origin 的端点最多 3 次，均受 20s 总预算约束。
- issuer 指向其他 origin 的直连元数据仍被拒绝；PRM 驱动的元数据现在要求 issuer 与 `authorization_servers[]` 声明精确相等（只忽略结尾斜杠），配置错误的 PRM 会得到明确的 `issuer 不匹配（期望 …，实际 …）`。
- PRM 的 `resource` 与配置端点不同源时会被忽略，不再有机会把 token 绑到别的资源；同源时优先使用 PRM 的值，修复代理 / 尾斜杠 / 规范化差异导致的 `invalid_target`。
- 失败错误变长（含 URL 清单），日志与 UI 需要能换行展示；`discoveryFailureMessage()` 只列失败项，最多 10 条。
- Ardot 的授权页从 `400 invalid_target` 变为正常显示 `mcp:use` 同意页；完整 token 交换仍需用户在浏览器里点「同意授权」，无法在无人值守下伪造。
- 真机完整流程已通过：同意后 token 交换成功，MCP `initialize` 协商到 `2025-06-18`（`ardot-remote@1.1.5`），`tools/list` 返回 26 个工具。
- PR #72 新增 10 条 OAuth 测试（总计 18 条）；本次评审修复再补 9 条（总计 27 条）。`lib/` 需随源码一起重建并提交。
- 无新增运行时依赖。
- PRM 的 `authorization_servers` 会驱动跨 origin 的 GET；实现只限制 `http:` / `https:`，未做私网地址过滤。桌面场景下目标由用户配置的 MCP 服务器决定，后续如需可再加 allowlist。

## References

- RFC 8414 §3.1 / §6.2：Authorization Server Metadata
- RFC 9728 §3.1 / §3.3：Protected Resource Metadata
- RFC 7591：Dynamic Client Registration
- RFC 8707：Resource Indicators for OAuth 2.0
- ADR-0005：OAuth 令牌落在 Authorization 头（发现顺序部分由本文修订）
