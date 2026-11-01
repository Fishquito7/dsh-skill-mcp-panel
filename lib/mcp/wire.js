/**
 * dsh-skill-mcp-panel —— mcpManager Typert wire manifest。
 */
import { z } from "zod";
import { strictCodec } from "../codec.js";
import { mcpServerInputSchema } from "./model.js";
/**
 * 网关边界用的宽松 payload schema：只要求能拿到一个 JSON 值，字段校验全部交给
 * handler（save/removeServer/setEnabled/test 各自 parse 一次严格 schema）。
 *
 * 背景：边界 codec 内嵌 mcpServerInputSchema 时，名称不合法会在边界上就被拒，
 * 宿主只回 `gateway/input-invalid: typert gateway: mcpManager/save: wire field
 * "payload" failed boundary validation` —— zod 的字段说明到不了前端。
 * 校验下沉后抛出的是 `describeSchemaError` 生成的中文错误，用户能看懂。
 */
const boundaryPayloadSchema = z.unknown();
const fiberPhaseSchema = z.enum(["pending", "loading", "active", "failed", "unloading"]).nullable();
const reconnectViewSchema = z.object({
    enabled: z.boolean(),
    initialDelayMs: z.number(),
    maxDelayMs: z.number(),
    maxAttempts: z.number()
});
export const mcpServerViewSchema = z.object({
    serverName: z.string(),
    transport: z.enum(["stdio", "streamable-http", "unknown"]),
    enabled: z.boolean(),
    /** `disabled` 是 !!js 表达式：开关由宿主求值，界面应禁用开关并说明原因。 */
    disabledExpr: z.boolean().default(false),
    entryId: z.string().optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    envKeys: z.array(z.string()),
    cwd: z.string().optional(),
    url: z.string().optional(),
    headerKeys: z.array(z.string()),
    toolCallTimeoutMs: z.number(),
    failOnStartupError: z.boolean(),
    reconnect: reconnectViewSchema,
    managed: z.boolean().default(true),
    /**
     * 历史字段。面板现在接管每一条 mcp-client 行，不再把块外行标成只读。
     * 保留可选字段，避免旧客户端解析失败。
     */
    orphan: z.boolean().optional(),
    fiberPhase: fiberPhaseSchema,
    toolCount: z.number().int().nonnegative()
});
export const mcpListResultSchema = z.object({
    servers: z.array(mcpServerViewSchema),
    /** 历史字段。全部 MCP 行都在 servers 里，这里始终是空数组。 */
    externalServers: z.array(mcpServerViewSchema),
    patch: z.object({
        path: z.string(),
        ok: z.boolean(),
        error: z.string().nullable(),
        /**
         * 受管块内**不属于面板**的条目：面板永不改写它们，但必须让用户看见
         * （否则就回到「面板动过却不显示」的静默改写，见 ADR-0003）。
         */
        foreign: z.array(z.object({
            id: z.string().optional(),
            name: z.string().optional(),
            managed: z.boolean()
        }))
    })
});
/** 把受管块里的外来顶层行搬到块外（#46 后续）：返回搬走的条数。 */
export const mcpEvacuateResultSchema = z.object({
    moved: z.number().int().nonnegative()
});
export const mcpSavePayloadSchema = z.object({
    input: mcpServerInputSchema,
    previousServerName: z.string().optional(),
    /** 被编辑行的 entryId：serverName 重复时用它唯一定位（手写行可能没有 id）。 */
    previousEntryId: z.string().optional(),
    enabled: z.boolean().default(true)
});
export const mcpSaveResultSchema = z.object({
    server: mcpServerViewSchema,
    reconciled: z.boolean()
});
/** 读出一条 MCP 行的原文（字节与 cordis.patch.yml 中该 entry 一致）。 */
export const mcpRawReadPayloadSchema = z.object({
    serverName: z.string(),
    /** 精确指定某一行（serverName 重复或手写行没有 id 时用）。 */
    entryId: z.string().optional()
});
export const mcpRawReadResultSchema = z.object({
    serverName: z.string(),
    entryId: z.string().optional(),
    text: z.string()
});
/** 用原文替换同一条 MCP 行。text 是这一条的 YAML（含缩进与 `- `）。 */
export const mcpRawWritePayloadSchema = z.object({
    serverName: z.string(),
    entryId: z.string().optional(),
    text: z.string()
});
export const mcpRemovePayloadSchema = z.object({
    serverName: z.string(),
    entryId: z.string().optional()
});
export const mcpRemoveResultSchema = z.object({
    ok: z.boolean()
});
export const mcpSetEnabledPayloadSchema = z.object({
    serverName: z.string(),
    entryId: z.string().optional(),
    enabled: z.boolean()
});
export const mcpTestPayloadSchema = z.union([
    mcpServerInputSchema,
    z.object({ serverName: z.string() })
]);
const mcpToolSchema = z.object({
    name: z.string(),
    description: z.string().optional()
});
export const mcpTestResultSchema = z.object({
    ok: z.boolean(),
    tools: z.array(mcpToolSchema),
    error: z.string().optional()
});
/** 单工具禁用（Issue #44）：按服务器列出工具、读写禁用列表。 */
export const mcpToolsPayloadSchema = z.object({ serverName: z.string() });
export const mcpToolsResultSchema = z.object({
    serverName: z.string(),
    tools: z.array(z.object({
        name: z.string(),
        description: z.string().optional()
    })),
    disabled: z.array(z.string()),
    connected: z.boolean()
});
export const mcpToolFilterPayloadSchema = z.object({ deny: z.array(z.string()) });
export const mcpToolFilterResultSchema = z.object({
    deny: z.array(z.string()),
    applied: z.number().int().nonnegative()
});
/** MCP OAuth 登录（Issue #45 的面板入口）：开始 / 轮询 / 状态 / 断开。 */
export const mcpOAuthStartPayloadSchema = z.object({
    serverName: z.string(),
    scope: z.string().optional(),
    clientId: z.string().optional(),
    timeoutSeconds: z.number().optional()
});
export const mcpOAuthStartResultSchema = z.object({
    flowId: z.string(),
    authUrl: z.string(),
    redirectUri: z.string(),
    expiresInSeconds: z.number()
});
export const mcpOAuthPollPayloadSchema = z.object({ flowId: z.string() });
export const mcpOAuthPollResultSchema = z.object({
    status: z.enum(["pending", "done", "failed"]),
    serverName: z.string(),
    error: z.string().optional(),
    expiresAt: z.number().nullable().optional(),
    header: z.string().optional()
});
export const mcpOAuthServerPayloadSchema = z.object({ serverName: z.string() });
export const mcpOAuthStatusResultSchema = z.object({
    connected: z.boolean(),
    headerReady: z.boolean(),
    expiresAt: z.number().nullable(),
    expired: z.boolean()
});
export const mcpOAuthDisconnectResultSchema = z.object({
    disconnected: z.boolean(),
    serverName: z.string()
});
export const MCP_MANIFEST = {
    package: "dsh-skill-mcp-panel",
    face: "host",
    schemas: [],
    invocations: [
        {
            id: "dsh-skill-mcp-panel#mcpManager/list",
            service: "mcpManager",
            namespace: "mcpManager",
            method: "list",
            invocation: { kind: "direct" },
            parameters: [],
            result: strictCodec("dsh-skill-mcp-panel#McpListResult", mcpListResultSchema)
        },
        {
            id: "dsh-skill-mcp-panel#mcpManager/save",
            service: "mcpManager",
            namespace: "mcpManager",
            method: "save",
            invocation: { kind: "direct" },
            parameters: [
                { name: "payload", wire: "payload", source: "json", codec: strictCodec("dsh-skill-mcp-panel#McpSavePayload", boundaryPayloadSchema) }
            ],
            result: strictCodec("dsh-skill-mcp-panel#McpSaveResult", mcpSaveResultSchema)
        },
        {
            id: "dsh-skill-mcp-panel#mcpManager/removeServer",
            service: "mcpManager",
            namespace: "mcpManager",
            method: "removeServer",
            invocation: { kind: "direct" },
            parameters: [
                { name: "payload", wire: "payload", source: "json", codec: strictCodec("dsh-skill-mcp-panel#McpRemovePayload", boundaryPayloadSchema) }
            ],
            result: strictCodec("dsh-skill-mcp-panel#McpRemoveResult", mcpRemoveResultSchema)
        },
        {
            id: "dsh-skill-mcp-panel#mcpManager/setEnabled",
            service: "mcpManager",
            namespace: "mcpManager",
            method: "setEnabled",
            invocation: { kind: "direct" },
            parameters: [
                { name: "payload", wire: "payload", source: "json", codec: strictCodec("dsh-skill-mcp-panel#McpSetEnabledPayload", boundaryPayloadSchema) }
            ],
            result: strictCodec("dsh-skill-mcp-panel#McpSaveResult", mcpSaveResultSchema)
        },
        {
            id: "dsh-skill-mcp-panel#mcpManager/readRaw",
            service: "mcpManager",
            namespace: "mcpManager",
            method: "readRaw",
            invocation: { kind: "direct" },
            parameters: [
                { name: "payload", wire: "payload", source: "json", codec: strictCodec("dsh-skill-mcp-panel#McpRawReadPayload", boundaryPayloadSchema) }
            ],
            result: strictCodec("dsh-skill-mcp-panel#McpRawReadResult", mcpRawReadResultSchema)
        },
        {
            id: "dsh-skill-mcp-panel#mcpManager/writeRaw",
            service: "mcpManager",
            namespace: "mcpManager",
            method: "writeRaw",
            invocation: { kind: "direct" },
            parameters: [
                { name: "payload", wire: "payload", source: "json", codec: strictCodec("dsh-skill-mcp-panel#McpRawWritePayload", boundaryPayloadSchema) }
            ],
            result: strictCodec("dsh-skill-mcp-panel#McpSaveResult", mcpSaveResultSchema)
        },
        {
            id: "dsh-skill-mcp-panel#mcpManager/test",
            service: "mcpManager",
            namespace: "mcpManager",
            method: "test",
            invocation: { kind: "direct" },
            parameters: [
                { name: "payload", wire: "payload", source: "json", codec: strictCodec("dsh-skill-mcp-panel#McpTestPayload", boundaryPayloadSchema) }
            ],
            result: strictCodec("dsh-skill-mcp-panel#McpTestResult", mcpTestResultSchema)
        },
        {
            id: "dsh-skill-mcp-panel#mcpManager/reload",
            service: "mcpManager",
            namespace: "mcpManager",
            method: "reload",
            invocation: { kind: "direct" },
            parameters: [],
            result: strictCodec("dsh-skill-mcp-panel#McpListResult", mcpListResultSchema)
        },
        {
            id: "dsh-skill-mcp-panel#mcpManager/listTools",
            service: "mcpManager",
            namespace: "mcpManager",
            method: "listTools",
            invocation: { kind: "direct" },
            parameters: [
                { name: "payload", wire: "payload", source: "json", codec: strictCodec("dsh-skill-mcp-panel#McpToolsPayload", boundaryPayloadSchema) }
            ],
            result: strictCodec("dsh-skill-mcp-panel#McpToolsResult", mcpToolsResultSchema)
        },
        {
            id: "dsh-skill-mcp-panel#mcpManager/getToolFilter",
            service: "mcpManager",
            namespace: "mcpManager",
            method: "getToolFilter",
            invocation: { kind: "direct" },
            parameters: [],
            result: strictCodec("dsh-skill-mcp-panel#McpToolFilterResult", mcpToolFilterResultSchema)
        },
        {
            id: "dsh-skill-mcp-panel#mcpManager/setToolFilter",
            service: "mcpManager",
            namespace: "mcpManager",
            method: "setToolFilter",
            invocation: { kind: "direct" },
            parameters: [
                { name: "payload", wire: "payload", source: "json", codec: strictCodec("dsh-skill-mcp-panel#McpToolFilterPayload", boundaryPayloadSchema) }
            ],
            result: strictCodec("dsh-skill-mcp-panel#McpToolFilterResult", mcpToolFilterResultSchema)
        },
        {
            id: "dsh-skill-mcp-panel#mcpManager/evacuateForeign",
            service: "mcpManager",
            namespace: "mcpManager",
            method: "evacuateForeign",
            invocation: { kind: "direct" },
            parameters: [],
            result: strictCodec("dsh-skill-mcp-panel#McpEvacuateResult", mcpEvacuateResultSchema)
        },
        {
            id: "dsh-skill-mcp-panel#mcpManager/oauthStart",
            service: "mcpManager",
            namespace: "mcpManager",
            method: "oauthStart",
            invocation: { kind: "direct" },
            parameters: [
                { name: "payload", wire: "payload", source: "json", codec: strictCodec("dsh-skill-mcp-panel#McpOAuthStartPayload", boundaryPayloadSchema) }
            ],
            result: strictCodec("dsh-skill-mcp-panel#McpOAuthStartResult", mcpOAuthStartResultSchema)
        },
        {
            id: "dsh-skill-mcp-panel#mcpManager/oauthPoll",
            service: "mcpManager",
            namespace: "mcpManager",
            method: "oauthPoll",
            invocation: { kind: "direct" },
            parameters: [
                { name: "payload", wire: "payload", source: "json", codec: strictCodec("dsh-skill-mcp-panel#McpOAuthPollPayload", boundaryPayloadSchema) }
            ],
            result: strictCodec("dsh-skill-mcp-panel#McpOAuthPollResult", mcpOAuthPollResultSchema)
        },
        {
            id: "dsh-skill-mcp-panel#mcpManager/oauthStatus",
            service: "mcpManager",
            namespace: "mcpManager",
            method: "oauthStatus",
            invocation: { kind: "direct" },
            parameters: [
                { name: "payload", wire: "payload", source: "json", codec: strictCodec("dsh-skill-mcp-panel#McpOAuthServerPayload", boundaryPayloadSchema) }
            ],
            result: strictCodec("dsh-skill-mcp-panel#McpOAuthStatusResult", mcpOAuthStatusResultSchema)
        },
        {
            id: "dsh-skill-mcp-panel#mcpManager/oauthDisconnect",
            service: "mcpManager",
            namespace: "mcpManager",
            method: "oauthDisconnect",
            invocation: { kind: "direct" },
            parameters: [
                { name: "payload", wire: "payload", source: "json", codec: strictCodec("dsh-skill-mcp-panel#McpOAuthServerPayload", boundaryPayloadSchema) }
            ],
            result: strictCodec("dsh-skill-mcp-panel#McpOAuthDisconnectResult", mcpOAuthDisconnectResultSchema)
        }
    ],
    model: { services: [], events: [], objects: [] }
};
