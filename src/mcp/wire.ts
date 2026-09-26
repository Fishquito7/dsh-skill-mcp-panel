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
    }
  ],
  model: { services: [], events: [], objects: [] }
};
