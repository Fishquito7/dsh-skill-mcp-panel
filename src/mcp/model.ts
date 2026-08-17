/**
 * dsh-skill-mcp-panel —— MCP 服务器配置模型。
 *
 * v1 仅全局生效：模型不包含 scope。env/headers 的 null 是编辑语义：
 * string = 覆盖该 key，null = 删除该 key，不出现 = 保留旧值。
 */
import { z } from "zod";
import { MANAGED_ROW_ID_PREFIX, MCP_PLUGIN_NAME } from "../patch-editor.js";
import type { PatchRow } from "../patch-editor.js";

export const SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;
export const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60000;
export const DEFAULT_RECONNECT = {
  enabled: true,
  initialDelayMs: 500,
  maxDelayMs: 30000,
  maxAttempts: 10
} as const;

const serverNameSchema = z.string().regex(SERVER_NAME_RE, "serverName 只能包含 1-32 位字母、数字、下划线或连字符");
const secretMapSchema = z.record(z.string(), z.string().nullable()).optional();
const reconnectSchema = z.object({
  enabled: z.boolean().default(DEFAULT_RECONNECT.enabled),
  initialDelayMs: z.number().int().min(1).default(DEFAULT_RECONNECT.initialDelayMs),
  maxDelayMs: z.number().int().min(1).default(DEFAULT_RECONNECT.maxDelayMs),
  maxAttempts: z.number().int().min(1).default(DEFAULT_RECONNECT.maxAttempts)
}).default({ ...DEFAULT_RECONNECT });

export const stdioServerSchema = z.object({
  serverName: serverNameSchema,
  transport: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: secretMapSchema,
  cwd: z.string().default(""),
  toolCallTimeoutMs: z.number().int().min(1).default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
  failOnStartupError: z.boolean().default(false),
  reconnect: reconnectSchema
});

export const httpServerSchema = z.object({
  serverName: serverNameSchema,
  transport: z.literal("streamable-http"),
  url: z.string().url(),
  headers: secretMapSchema,
  toolCallTimeoutMs: z.number().int().min(1).default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
  failOnStartupError: z.boolean().default(false),
  reconnect: reconnectSchema
});

export const mcpServerInputSchema = z.discriminatedUnion("transport", [stdioServerSchema, httpServerSchema]);

export type McpServerInput = z.infer<typeof mcpServerInputSchema>;
export type McpTransport = McpServerInput["transport"];
export interface ReconnectConfig {
  enabled: boolean;
  initialDelayMs: number;
  maxDelayMs: number;
  maxAttempts: number;
}
export type SecretPatch = Record<string, string | null> | undefined;

/** 面板行 id ↔ serverName。 */
export function rowIdForServerName(serverName: string): string {
  return MANAGED_ROW_ID_PREFIX + serverName;
}

export function serverNameFromRowId(id: string | undefined): string | undefined {
  if (typeof id !== "string" || !id.startsWith(MANAGED_ROW_ID_PREFIX)) return undefined;
  const name = id.slice(MANAGED_ROW_ID_PREFIX.length);
  return SERVER_NAME_RE.test(name) ? name : undefined;
}

/** null = 删除，string = 覆盖；缺省 key 保留旧值。 */
export function mergeSecretPatch(previous: Record<string, string> | undefined, patch: SecretPatch): Record<string, string> {
  const merged: Record<string, string> = { ...(previous ?? {}) };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}

function normalizeReconnect(input: McpServerInput): ReconnectConfig {
  return {
    enabled: input.reconnect.enabled,
    initialDelayMs: input.reconnect.initialDelayMs,
    maxDelayMs: input.reconnect.maxDelayMs,
    maxAttempts: input.reconnect.maxAttempts
  };
}

/** 面板输入 → 官方 @deepseek-ai/dsh-mcp-client 配置。 */
export function toOfficialConfig(input: McpServerInput): Record<string, unknown> {
  const common = {
    serverName: input.serverName,
    toolCallTimeoutMs: input.toolCallTimeoutMs,
    failOnStartupError: input.failOnStartupError,
    reconnect: normalizeReconnect(input)
  };
  if (input.transport === "stdio") {
    return {
      ...common,
      transport: "stdio",
      command: input.command,
      args: input.args,
      env: mergeSecretPatch({}, input.env),
      cwd: input.cwd
    };
  }
  return {
    ...common,
    transport: "streamable-http",
    url: input.url,
    headers: mergeSecretPatch({}, input.headers)
  };
}

/** 面板输入 → cordis.patch.yml 行。 */
export function toPatchRow(input: McpServerInput, enabled = true): PatchRow {
  return {
    id: rowIdForServerName(input.serverName),
    name: MCP_PLUGIN_NAME,
    ...(enabled ? {} : { disabled: true }),
    config: toOfficialConfig(input)
  };
}

/** 读取 patch 行中的 config（宽松，坏行返回 undefined）。 */
export function configFromPatchRow(row: PatchRow | undefined): Record<string, unknown> | undefined {
  if (row === undefined || row.name !== MCP_PLUGIN_NAME) return undefined;
  if (row.config === null || typeof row.config !== "object" || Array.isArray(row.config)) return undefined;
  return row.config as Record<string, unknown>;
}

export interface McpServerView {
  serverName: string;
  transport: McpTransport | "unknown";
  enabled: boolean;
  entryId: string | undefined;
  // stdio
  command?: string;
  args?: string[];
  envKeys: string[];
  cwd?: string;
  // http
  url?: string;
  headerKeys: string[];
  toolCallTimeoutMs: number;
  failOnStartupError: boolean;
  reconnect: ReconnectConfig;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function secretKeys(value: unknown): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>).filter((key) => typeof (value as Record<string, unknown>)[key] === "string");
}

/** patch 行 → 脱敏 view。密钥值不返回。 */
export function patchRowToView(row: PatchRow): McpServerView | undefined {
  const config = configFromPatchRow(row);
  if (config === undefined) return undefined;
  const serverName = asString(config.serverName);
  if (!SERVER_NAME_RE.test(serverName)) return undefined;
  const transport = config.transport === "streamable-http" ? "streamable-http" : config.transport === "stdio" ? "stdio" : "unknown";
  const reconnectRaw = config.reconnect !== null && typeof config.reconnect === "object" && !Array.isArray(config.reconnect) ? config.reconnect as Record<string, unknown> : {};
  return {
    serverName,
    transport,
    enabled: row.disabled !== true,
    entryId: row.id,
    command: transport === "stdio" ? asString(config.command) : undefined,
    args: transport === "stdio" ? asStringArray(config.args) : undefined,
    envKeys: transport === "stdio" ? secretKeys(config.env) : [],
    cwd: transport === "stdio" ? asString(config.cwd) : undefined,
    url: transport === "streamable-http" ? asString(config.url) : undefined,
    headerKeys: transport === "streamable-http" ? secretKeys(config.headers) : [],
    toolCallTimeoutMs: asNumber(config.toolCallTimeoutMs, DEFAULT_TOOL_CALL_TIMEOUT_MS),
    failOnStartupError: asBoolean(config.failOnStartupError, false),
    reconnect: {
      enabled: asBoolean(reconnectRaw.enabled, DEFAULT_RECONNECT.enabled),
      initialDelayMs: asNumber(reconnectRaw.initialDelayMs, DEFAULT_RECONNECT.initialDelayMs),
      maxDelayMs: asNumber(reconnectRaw.maxDelayMs, DEFAULT_RECONNECT.maxDelayMs),
      maxAttempts: asNumber(reconnectRaw.maxAttempts, DEFAULT_RECONNECT.maxAttempts)
    }
  };
}

/** 在受管 + 外部行之间检测重复 serverName。返回重复名单。 */
export function duplicateServerNames(managedRows: PatchRow[], externalRows: PatchRow[]): string[] {
  const names = new Map<string, string[]>();
  const add = (rows: PatchRow[], owner: string) => {
    for (const row of rows) {
      const name = asString(row.config?.serverName);
      if (!SERVER_NAME_RE.test(name)) continue;
      const list = names.get(name) ?? [];
      list.push(owner);
      names.set(name, list);
    }
  };
  add(managedRows, "managed");
  add(externalRows, "external");
  return [...names.entries()].filter(([, owners]) => owners.length > 1).map(([name]) => name);
}


/** 从 patch 行读取完整输入（含 secret 值，仅供本机 test/编辑使用，不跨 RPC）。 */
export function inputFromPatchRow(row: PatchRow): McpServerInput {
  const config = configFromPatchRow(row) ?? {};
  const serverName = asString(config.serverName, serverNameFromRowId(row.id) ?? "");
  const common = {
    serverName,
    toolCallTimeoutMs: asNumber(config.toolCallTimeoutMs, DEFAULT_TOOL_CALL_TIMEOUT_MS),
    failOnStartupError: asBoolean(config.failOnStartupError, false),
    reconnect: {
      enabled: asBoolean((config.reconnect as any)?.enabled, DEFAULT_RECONNECT.enabled),
      initialDelayMs: asNumber((config.reconnect as any)?.initialDelayMs, DEFAULT_RECONNECT.initialDelayMs),
      maxDelayMs: asNumber((config.reconnect as any)?.maxDelayMs, DEFAULT_RECONNECT.maxDelayMs),
      maxAttempts: asNumber((config.reconnect as any)?.maxAttempts, DEFAULT_RECONNECT.maxAttempts)
    }
  };
  if (config.transport === "streamable-http") {
    return mcpServerInputSchema.parse({
      ...common,
      transport: "streamable-http",
      url: asString(config.url),
      headers: config.headers as Record<string, string> | undefined
    });
  }
  return mcpServerInputSchema.parse({
    ...common,
    transport: "stdio",
    command: asString(config.command),
    args: asStringArray(config.args),
    env: config.env as Record<string, string> | undefined,
    cwd: asString(config.cwd)
  });
}

/** 把编辑输入合并到旧 patch 行上（保留输入中未出现的 secret key）。 */
export function applyServerEdit(previous: PatchRow | undefined, input: McpServerInput, enabled = true): PatchRow {
  if (previous === undefined) return toPatchRow(input, enabled);
  const oldConfig = configFromPatchRow(previous) ?? {};
  const oldEnv = oldConfig.env !== null && typeof oldConfig.env === "object" && !Array.isArray(oldConfig.env) ? oldConfig.env as Record<string, string> : undefined;
  const oldHeaders = oldConfig.headers !== null && typeof oldConfig.headers === "object" && !Array.isArray(oldConfig.headers) ? oldConfig.headers as Record<string, string> : undefined;
  const next = { ...input } as McpServerInput & { env?: Record<string, string | null>; headers?: Record<string, string | null> };
  if (next.transport === "stdio") next.env = mergeSecretPatch(oldEnv, next.env);
  if (next.transport === "streamable-http") next.headers = mergeSecretPatch(oldHeaders, next.headers);
  const normalized = mcpServerInputSchema.parse(next);
  return toPatchRow(normalized, enabled);
}
