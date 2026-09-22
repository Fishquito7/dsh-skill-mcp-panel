/**
 * dsh-skill-mcp-panel —— mcpManager Typert wire manifest。
 *
 * 两条作用域：
 *   - 全局（`list`/`save`/`removeServer`/`setEnabled`）→ profile 的 cordis.patch.yml 受管块；
 *   - 工作区（`workspace*`）→ `<projectRoot>/.dsh/mcp.json`，**文件里只记键名**：
 *     保存时值与全局同形地随 payload 送达，由宿主写进官方凭证存储。
 */
import { z } from "zod";
import { strictCodec } from "../codec.js";
import { mcpServerInputSchema } from "./model.js";
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
    fiberPhase: fiberPhaseSchema,
    toolCount: z.number().int().nonnegative()
});
export const mcpListResultSchema = z.object({
    servers: z.array(mcpServerViewSchema),
    externalServers: z.array(mcpServerViewSchema),
    patch: z.object({
        path: z.string(),
        ok: z.boolean(),
        error: z.string().nullable()
    })
});
export const mcpSavePayloadSchema = z.object({
    input: mcpServerInputSchema,
    previousServerName: z.string().optional(),
    enabled: z.boolean().default(true)
});
export const mcpSaveResultSchema = z.object({
    server: mcpServerViewSchema,
    reconciled: z.boolean()
});
export const mcpRemovePayloadSchema = z.object({
    serverName: z.string()
});
export const mcpRemoveResultSchema = z.object({
    ok: z.boolean()
});
export const mcpSetEnabledPayloadSchema = z.object({
    serverName: z.string(),
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
// ── 工作区作用域 ──────────────────────────────────────────────────────────
/**
 * 工作区服务器的视图。只有键名/引用名，没有任何位置能承载密钥值——这与全局
 * 视图只回 `envKeys`/`headerKeys` 是同一条约定。
 */
export const workspaceServerViewSchema = z.object({
    serverName: z.string(),
    transport: z.enum(["stdio", "streamable-http"]),
    enabled: z.boolean(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    url: z.string().optional(),
    envKeys: z.array(z.string()),
    /** header 名清单：与全局视图的 `headerKeys` 同名，让两种作用域共用一个表单。 */
    headerKeys: z.array(z.string()),
    toolCallTimeoutMs: z.number(),
    failOnStartupError: z.boolean(),
    reconnect: reconnectViewSchema
});
export const workspaceViewSchema = z.object({
    /** 归一化后的项目根（声明文件即 `<path>/.dsh/mcp.json`）。 */
    path: z.string(),
    label: z.string(),
    ok: z.boolean(),
    error: z.string().nullable(),
    servers: z.array(workspaceServerViewSchema),
    /** 与全局作用域同名、因而被运行时忽略的 serverName。 */
    conflicts: z.array(z.string())
});
export const mcpWorkspaceViewResultSchema = z.object({ workspace: workspaceViewSchema });
export const mcpWorkspaceListPayloadSchema = z.object({
    scope: z.string()
});
/**
 * 工作区保存：输入形状与全局 `save` **完全一致**（`env`/`headers` 的值内联在
 * payload 里），由宿主负责拆分——值写进官方凭证存储，只把键名落进工作区文件。
 * 这样两种作用域的编辑体验同形，而工作区文件仍然不含任何值。
 */
export const mcpWorkspaceSavePayloadSchema = z.object({
    scope: z.string(),
    input: mcpServerInputSchema,
    previousServerName: z.string().optional(),
    enabled: z.boolean().default(true)
});
export const mcpWorkspaceRemovePayloadSchema = z.object({
    scope: z.string(),
    serverName: z.string()
});
export const mcpWorkspaceSetEnabledPayloadSchema = z.object({
    scope: z.string(),
    serverName: z.string(),
    enabled: z.boolean()
});
export const mcpWorkspaceTestPayloadSchema = z.object({
    scope: z.string(),
    serverName: z.string()
});
const WORKSPACE_VIEW_RESULT = () => strictCodec("dsh-skill-mcp-panel#McpWorkspaceViewResult", mcpWorkspaceViewResultSchema);
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
                { name: "payload", wire: "payload", source: "json", codec: strictCodec("dsh-skill-mcp-panel#McpSavePayload", mcpSavePayloadSchema) }
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
                { name: "payload", wire: "payload", source: "json", codec: strictCodec("dsh-skill-mcp-panel#McpRemovePayload", mcpRemovePayloadSchema) }
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
                { name: "payload", wire: "payload", source: "json", codec: strictCodec("dsh-skill-mcp-panel#McpSetEnabledPayload", mcpSetEnabledPayloadSchema) }
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
                { name: "payload", wire: "payload", source: "json", codec: strictCodec("dsh-skill-mcp-panel#McpTestPayload", mcpTestPayloadSchema) }
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
            id: "dsh-skill-mcp-panel#mcpManager/workspaceList",
            service: "mcpManager",
            namespace: "mcpManager",
            method: "workspaceList",
            invocation: { kind: "direct" },
            parameters: [
                { name: "payload", wire: "payload", source: "json", codec: strictCodec("dsh-skill-mcp-panel#McpWorkspaceListPayload", mcpWorkspaceListPayloadSchema) }
            ],
            result: WORKSPACE_VIEW_RESULT()
        },
        {
            id: "dsh-skill-mcp-panel#mcpManager/workspaceSave",
            service: "mcpManager",
            namespace: "mcpManager",
            method: "workspaceSave",
            invocation: { kind: "direct" },
            parameters: [
                { name: "payload", wire: "payload", source: "json", codec: strictCodec("dsh-skill-mcp-panel#McpWorkspaceSavePayload", mcpWorkspaceSavePayloadSchema) }
            ],
            result: WORKSPACE_VIEW_RESULT()
        },
        {
            id: "dsh-skill-mcp-panel#mcpManager/workspaceRemoveServer",
            service: "mcpManager",
            namespace: "mcpManager",
            method: "workspaceRemoveServer",
            invocation: { kind: "direct" },
            parameters: [
                { name: "payload", wire: "payload", source: "json", codec: strictCodec("dsh-skill-mcp-panel#McpWorkspaceRemovePayload", mcpWorkspaceRemovePayloadSchema) }
            ],
            result: WORKSPACE_VIEW_RESULT()
        },
        {
            id: "dsh-skill-mcp-panel#mcpManager/workspaceSetEnabled",
            service: "mcpManager",
            namespace: "mcpManager",
            method: "workspaceSetEnabled",
            invocation: { kind: "direct" },
            parameters: [
                { name: "payload", wire: "payload", source: "json", codec: strictCodec("dsh-skill-mcp-panel#McpWorkspaceSetEnabledPayload", mcpWorkspaceSetEnabledPayloadSchema) }
            ],
            result: WORKSPACE_VIEW_RESULT()
        },
        {
            id: "dsh-skill-mcp-panel#mcpManager/workspaceTest",
            service: "mcpManager",
            namespace: "mcpManager",
            method: "workspaceTest",
            invocation: { kind: "direct" },
            parameters: [
                { name: "payload", wire: "payload", source: "json", codec: strictCodec("dsh-skill-mcp-panel#McpWorkspaceTestPayload", mcpWorkspaceTestPayloadSchema) }
            ],
            result: strictCodec("dsh-skill-mcp-panel#McpTestResult", mcpTestResultSchema)
        }
    ],
    model: { services: [], events: [], objects: [] }
};
