# 受管块内的外来行按原形状保留

> 后续（#67 / ADR-0006）：面板对**每一条** `@deepseek-ai/dsh-mcp-client` 行启停、编辑、删除，不再用 `panel-mcp-*` 或受管块当权限边界。本 ADR 仍然约束「非 MCP 的外来行不得被改写语义」。

面板重写整个 `cordis.patch.yml` 受管块时，块内**不属于面板**的条目必须原样保留其形状（顶层条目仍作顶层条目、`insert` 成员仍在 insert 列表里），面板只重建自己的那部分；这些行同时在 MCP 页面上可见。

## 背景

Issue #46（宿主 0.2.0-rc.2 + 面板 2.1.5，Windows）：

- 读取路径 `flattenPatchRows` 把 begin/end 之间的**所有**条目都收成「受管行」——只要求 `id` 或 `name` 是字符串，没有归属判定；
- 写入路径 `generateManagedBlock` 无论原形状如何，**一律**序列化成 `[{ insert: rows }]`。

于是块内一条 `- id: ui-theme` 的顶层行（语义：按 id 定向覆盖官方条目，例如改字号）经过**任意一次面板保存**（哪怕只是新增/启停一个 MCP 服务器）就变成 `insert:` 的成员（语义：再插一行），同一个 loader id 出现两行。

后果不是面板自己的功能坏了，而是**这台机器上 dsh-market 的所有插件更新全部回滚**：试算 `composeLayers` 按 id 计数，`count >= 2` 直接判 `duplicate loader entry id "ui-theme" (2 rows)`，且报错归因到 `@deepseek-ai/dsh-web-app / user-patch`，用户完全无法从这条信息联想到面板。真实案例时间线（用户备份文件）：04:04:50 顶层行 → 04:39:53 已被折叠进 `insert:` → 次日 01:47–01:49 七次更新尝试全部回滚。

最小复现（不碰任何真实 profile，只用本插件的 `lib/patch-editor.js`）：

```js
const rows = extractManagedRows(INPUT);            // 读出的行：[ui-theme, panel-mcp-camoufox]
replaceManagedBlock(INPUT, rows);                  // 写回后 ui-theme 缩进进 insert 数组
```

第二个缺陷是「不可见」：`patchRowToView` 要求 `config.serverName` 合法（`{ fontSize: 14 }` 的行返回 `undefined`），`listMcpPatchRows` 又按 `name === MCP_PLUGIN_NAME` 过滤，所以面板会重写这一行却从不显示它。

## 事实

- `cordis.patch.yml` 是 profile 的 patch 层，文档注释写明：顶层数组的条目是 **id-targeted config overrides、disables、insert lists**；官方 Web 编辑器也往同一层写顶层覆盖行（本机可见 `ui-chat`、`ui-settings`、`permission`、`ui-theme`、`agent-default-model`）。所以「顶层 = 覆盖 / `insert` = 追加」是这条路层的公共契约，不是我们的内部约定。
- 面板自己的归属判据早就存在且一致：`gateway.isManagedRow`、`findRowByServerName`、`MANAGED_ROW_ID_PREFIX`（`panel-mcp-`）——只有写回路径没用它。
- 受影响的调用点：宿主 `save` / `removeServer` / `setEnabled`，CLI `dsh-panel mcp add|remove|enable`，都是「读整池 → 重建 → 写整池」。

## 决策

1. **归属判定**：受管行 = `id` 以 `panel-mcp-` 开头的行（与 `MANAGED_ROW_ID_PREFIX` 一致）。块内其余条目一律是**外来行**。
2. **形状保持**：外来顶层条目按原顺序原样作顶层条目输出，外来 `insert` 成员仍留在 `insert` 列表里，与受管行共用一个 insert 列表（两者都是追加语义）。面板只重建自己的行。
3. **可见化**：读取结果要能报出块内外来行，面板在 MCP 页提示「受管块内还有 N 条不属于面板的行，面板不会改动它们」。不再有静默改写。
4. 受管行必须始终带 `panel-mcp-` 前缀 id；没有此前缀的行会被当成外来行，从而**不再被面板管理**（这是判据收窄的必然代价，由面板自己生成的行走 `rowIdForServerName`，永远满足）。

## Considered Options

- **A1 形状保持（采用）**：最小语义改动，不动用户文件布局就能让 `insert`/覆盖两种语义各自存活。
- **A2 A1 + 把外来顶层行搬到标记之外**：文件更干净（用户自己就是这么规避的），但会在用户没预期的时候重排文件，且未来别处再写进标记还是同一类问题。
- **B 拒绝写入并报错**：最保守，但用户会直接**不能保存 MCP 配置**，把一个静默错误换成一个阻断错误。
- **C 维持现状**：块内外来行被静默改写成另一种语义，且连带整条 dsh-market 更新链——不可接受。

## Consequences

- `extractManagedRows` 的返回值从 `PatchRow[]` 变成结构化结果（受管行 + 外来行）；`lib/patch-editor.js` 是包内导出，CLI（`src/cli-mcp.ts`）与宿主（`src/mcp/gateway.ts`）必须同步改。
- 回归测试固化最小复现：块内一条外来顶层行，读 → 写往返后断言它**仍是顶层行**、`insert` 数组里只有 `panel-mcp-*`；另加「块内外来 insert 成员仍留在 insert 内」与「外来行在结果里被报告」。
- README 里「标记之外逐字节保留」的承诺扩展为「标记之内的外来行语义不被改写」，并把这一条写进更新日志。
- 顺序差异：外来顶层条目与 insert 列表的相对位置可能变化（顶层条目统一排在 insert 前）。两类条目的语义互不依赖，接受；若将来发现顺序敏感，再退回逐段原位重建。
- **外来部分逐字节保留，面板自己那一段会被规范化**：实测拿本机真实 profile 的 `cordis.patch.yml` 做往返——块外内容逐字节一致、外来行逐字节一致，只有「块内 BEGIN/END 之间的一个多余空行」被吃掉（那是我们自己的段落），且第二次往返起完全稳定（幂等）。
