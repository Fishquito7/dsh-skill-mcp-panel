/**
 * dsh-skill-mcp-panel —— MCP 服务器配置模型。
 *
 * v1 仅全局生效：模型不包含 scope。env/headers 的 null 是编辑语义：
 * string = 覆盖该 key，null = 删除该 key，不出现 = 保留旧值。
 */
import { z } from "zod";
import { MANAGED_ROW_ID_PREFIX, MCP_PLUGIN_NAME, isJsExprValue } from "../patch-editor.js";
export const SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;
export const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60000;
export const DEFAULT_RECONNECT = {
    enabled: true,
    initialDelayMs: 500,
    maxDelayMs: 30000,
    maxAttempts: 10
};
/** 进阶写法前缀：值以 "!!js " 开头即原样透传成 JS 表达式（不解析、不重写）。 */
export const JS_EXPR_PREFIX = "!!js";
const jsExprSchema = z.object({ __jsExpr: z.string() });
const wireScalarSchema = z.union([z.string(), jsExprSchema]);
/**
 * 面板 / CLI 的统一写法：值里写 `${NAME}` 就是「读环境变量 NAME」。
 *
 * DSH 的 cordis 配置层没有 ${VAR} 字符串插值，唯一的机制是 YAML 的 !!js 表达式，
 * 所以这里把直觉写法格式化成 `!!js` + 反引号模板（`${process.env.NAME}`）再落盘。
 * 正则字面量与 src/client.ts 的 MCP_ENV_REF_RE 必须一致：浏览器束只能 require
 * 外壳种子词，无法 import 宿主模块（由 test-mcp-naming.mjs 交叉校验）。
 */
export const ENV_REF_RE = /\$\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}/g;
/** 反向：`!!js` 模板里的 ${process.env.NAME} 收回成 ${NAME}，页面看到的还是直觉写法。 */
const ENV_REF_FROM_EXPRESSION_RE = /\$\{process\.env\.([A-Za-z_][A-Za-z0-9_]*)\}/g;
/** 把 ${NAME} 改写成 ${process.env.NAME}；其它 ${...} 原样保留（用户可写任意 JS）。 */
export function envRefsToExpression(text) {
    return text.replace(ENV_REF_RE, (_match, name) => "${process.env." + name + "}");
}
/**
 * `!!js` 表达式收回展示写法：只有「单层反引号模板且带 ${...}」才收，
 * 复杂表达式（含嵌套反引号、不含引用的模板）仍旧显示 `!!js 原文`。
 */
export function expressionToDisplay(expression) {
    const template = /^`([^`]*)`$/.exec(expression);
    if (template === null || !template[1].includes("${"))
        return expression;
    return template[1].replace(ENV_REF_FROM_EXPRESSION_RE, (_match, name) => "${" + name + "}");
}
/**
 * 文本形式 → wire 值，三种写法都认：
 *   1. `${NAME}` / `Bearer ${NAME}` —— 直觉写法，自动包成 !!js 模板字面量；
 *   2. 已经写好的反引号模板 —— 同样补 process.env，不动其余内容；
 *   3. `!!js <表达式>` —— 进阶逃生口，原样透传（不解析、不重写）。
 */
export function parseWireScalar(text) {
    const raw = String(text);
    const trimmed = raw.trim();
    if (trimmed === JS_EXPR_PREFIX || trimmed.startsWith(JS_EXPR_PREFIX + " ")) {
        const expression = trimmed.slice(JS_EXPR_PREFIX.length).trim();
        return expression === "" ? raw : { __jsExpr: expression };
    }
    if (!trimmed.includes("${"))
        return raw;
    if (trimmed.length > 1 && trimmed.startsWith("`") && trimmed.endsWith("`"))
        return { __jsExpr: envRefsToExpression(trimmed) };
    return { __jsExpr: "`" + envRefsToExpression(raw) + "`" };
}
/** wire 值 → 文本形式（页面回填、CLI 输出都用它）。 */
export function formatWireScalar(value) {
    if (isJsExprValue(value)) {
        const display = expressionToDisplay(value.__jsExpr);
        return display === value.__jsExpr ? JS_EXPR_PREFIX + " " + value.__jsExpr : display;
    }
    return typeof value === "string" ? value : "";
}
/** 配置里的值 → wire 值（非法形状回退，坏行不炸整页）。 */
function asWireScalar(value, fallback = "") {
    if (typeof value === "string" || isJsExprValue(value))
        return value;
    return fallback;
}
/** 地址：普通字符串必须是合法 URL；!!js 表达式由宿主求值后自行负责。 */
const urlSchema = z.union([z.string().url("服务器地址必须是合法 URL"), jsExprSchema]);
/** 命令：普通字符串不能为空；!!js 表达式里写什么由用户决定。 */
const commandSchema = z.union([z.string().min(1, "命令不能为空"), jsExprSchema]);
/** 密钥表：值可以是字符串或 !!js 表达式，null 是编辑语义（删除该键）。 */
const secretMapSchema = z.record(z.string(), wireScalarSchema.nullable()).optional();
const serverNameSchema = z.string().regex(SERVER_NAME_RE, "serverName 只能包含 1-32 位字母、数字、下划线或连字符");
const reconnectSchema = z.object({
    enabled: z.boolean().default(DEFAULT_RECONNECT.enabled),
    initialDelayMs: z.number().int().min(1).default(DEFAULT_RECONNECT.initialDelayMs),
    maxDelayMs: z.number().int().min(1).default(DEFAULT_RECONNECT.maxDelayMs),
    maxAttempts: z.number().int().min(1).default(DEFAULT_RECONNECT.maxAttempts)
}).default({ ...DEFAULT_RECONNECT });
export const stdioServerSchema = z.object({
    serverName: serverNameSchema,
    transport: z.literal("stdio"),
    command: commandSchema,
    args: z.array(wireScalarSchema).default([]),
    env: secretMapSchema,
    cwd: wireScalarSchema.default(""),
    toolCallTimeoutMs: z.number().int().min(1).default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
    failOnStartupError: z.boolean().default(false),
    reconnect: reconnectSchema
});
export const httpServerSchema = z.object({
    serverName: serverNameSchema,
    transport: z.literal("streamable-http"),
    url: urlSchema,
    headers: secretMapSchema,
    toolCallTimeoutMs: z.number().int().min(1).default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
    failOnStartupError: z.boolean().default(false),
    reconnect: reconnectSchema
});
export const mcpServerInputSchema = z.discriminatedUnion("transport", [stdioServerSchema, httpServerSchema]);
/**
 * 把 zod 的校验失败压成一行「字段：原因」。
 *
 * 网关边界（`codec.create().parse`）失败时宿主只回一句泛化的
 * `wire field "payload" failed boundary validation`，zod 的字段说明到不了前端，
 * 用户看到的就是天书（典型：名称里带空格）。所以字段校验放在 handler 里做，
 * 用这个函数生成可读错误，前端原样展示。
 */
export function describeSchemaError(error) {
    const issues = error?.issues;
    if (!Array.isArray(issues) || issues.length === 0)
        return String(error?.message ?? error);
    return issues
        .map((issue) => {
        const path = Array.isArray(issue?.path) && issue.path.length > 0 ? issue.path.join(".") : "payload";
        return path + "：" + String(issue?.message ?? "无效");
    })
        .join("；");
}
/** 面板行 id ↔ serverName。 */
export function rowIdForServerName(serverName) {
    return MANAGED_ROW_ID_PREFIX + serverName;
}
export function serverNameFromRowId(id) {
    if (typeof id !== "string" || !id.startsWith(MANAGED_ROW_ID_PREFIX))
        return undefined;
    const name = id.slice(MANAGED_ROW_ID_PREFIX.length);
    return SERVER_NAME_RE.test(name) ? name : undefined;
}
/** null = 删除，string = 覆盖；缺省 key 保留旧值。 */
export function mergeSecretPatch(previous, patch) {
    const merged = { ...(previous ?? {}) };
    for (const [key, value] of Object.entries(patch ?? {})) {
        if (value === null)
            delete merged[key];
        else
            merged[key] = value;
    }
    return merged;
}
function normalizeReconnect(input) {
    return {
        enabled: input.reconnect.enabled,
        initialDelayMs: input.reconnect.initialDelayMs,
        maxDelayMs: input.reconnect.maxDelayMs,
        maxAttempts: input.reconnect.maxAttempts
    };
}
/** 面板输入 → 官方 @deepseek-ai/dsh-mcp-client 配置。 */
export function toOfficialConfig(input) {
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
export function toPatchRow(input, enabled = true) {
    return {
        id: rowIdForServerName(input.serverName),
        name: MCP_PLUGIN_NAME,
        ...(enabled ? {} : { disabled: true }),
        config: toOfficialConfig(input)
    };
}
/** 读取 patch 行中的 config（宽松，坏行返回 undefined）。 */
export function configFromPatchRow(row) {
    if (row === undefined || row.name !== MCP_PLUGIN_NAME)
        return undefined;
    if (row.config === null || typeof row.config !== "object" || Array.isArray(row.config))
        return undefined;
    return row.config;
}
function asString(value, fallback = "") {
    return typeof value === "string" ? value : fallback;
}
function asStringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string" || isJsExprValue(item)) : [];
}
function asNumber(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function asBoolean(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
}
function secretKeys(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        return [];
    return Object.keys(value).filter((key) => typeof value[key] === "string" || isJsExprValue(value[key]));
}
/** patch 行 → 脱敏 view。密钥值不返回。 */
export function patchRowToView(row) {
    const config = configFromPatchRow(row);
    if (config === undefined)
        return undefined;
    const serverName = asString(config.serverName);
    if (!SERVER_NAME_RE.test(serverName))
        return undefined;
    const transport = config.transport === "streamable-http" ? "streamable-http" : config.transport === "stdio" ? "stdio" : "unknown";
    const reconnectRaw = config.reconnect !== null && typeof config.reconnect === "object" && !Array.isArray(config.reconnect) ? config.reconnect : {};
    return {
        serverName,
        transport,
        enabled: row.disabled !== true,
        entryId: row.id,
        command: transport === "stdio" ? formatWireScalar(config.command) : undefined,
        args: transport === "stdio" ? asStringArray(config.args).map((item) => formatWireScalar(item)) : undefined,
        envKeys: transport === "stdio" ? secretKeys(config.env) : [],
        cwd: transport === "stdio" ? formatWireScalar(config.cwd) : undefined,
        url: transport === "streamable-http" ? formatWireScalar(config.url) : undefined,
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
export function duplicateServerNames(managedRows, externalRows) {
    const names = new Map();
    const add = (rows, owner) => {
        for (const row of rows) {
            const name = asString(row.config?.serverName);
            if (!SERVER_NAME_RE.test(name))
                continue;
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
export function inputFromPatchRow(row) {
    const config = configFromPatchRow(row) ?? {};
    const serverName = asString(config.serverName, serverNameFromRowId(row.id) ?? "");
    const common = {
        serverName,
        toolCallTimeoutMs: asNumber(config.toolCallTimeoutMs, DEFAULT_TOOL_CALL_TIMEOUT_MS),
        failOnStartupError: asBoolean(config.failOnStartupError, false),
        reconnect: {
            enabled: asBoolean(config.reconnect?.enabled, DEFAULT_RECONNECT.enabled),
            initialDelayMs: asNumber(config.reconnect?.initialDelayMs, DEFAULT_RECONNECT.initialDelayMs),
            maxDelayMs: asNumber(config.reconnect?.maxDelayMs, DEFAULT_RECONNECT.maxDelayMs),
            maxAttempts: asNumber(config.reconnect?.maxAttempts, DEFAULT_RECONNECT.maxAttempts)
        }
    };
    if (config.transport === "streamable-http") {
        return mcpServerInputSchema.parse({
            ...common,
            transport: "streamable-http",
            url: asWireScalar(config.url),
            headers: config.headers
        });
    }
    return mcpServerInputSchema.parse({
        ...common,
        transport: "stdio",
        command: asWireScalar(config.command),
        args: asStringArray(config.args).map((item) => asWireScalar(item)),
        env: config.env,
        cwd: asWireScalar(config.cwd)
    });
}
/** 把编辑输入合并到旧 patch 行上（保留输入中未出现的 secret key）。 */
export function applyServerEdit(previous, input, enabled = true) {
    if (previous === undefined)
        return toPatchRow(input, enabled);
    const oldConfig = configFromPatchRow(previous) ?? {};
    const oldEnv = oldConfig.env !== null && typeof oldConfig.env === "object" && !Array.isArray(oldConfig.env) ? oldConfig.env : undefined;
    const oldHeaders = oldConfig.headers !== null && typeof oldConfig.headers === "object" && !Array.isArray(oldConfig.headers) ? oldConfig.headers : undefined;
    const next = { ...input };
    if (next.transport === "stdio")
        next.env = mergeSecretPatch(oldEnv, next.env);
    if (next.transport === "streamable-http")
        next.headers = mergeSecretPatch(oldHeaders, next.headers);
    const normalized = mcpServerInputSchema.parse(next);
    return toPatchRow(normalized, enabled);
}
