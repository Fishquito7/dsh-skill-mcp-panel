/**
 * dsh-skill-mcp-panel —— DSH 官方 `@deepseek-ai/dsh-mcp-manager` 条目的纯数据转换。
 *
 * DSH 0.2.2 起桌面 / Web profile 默认由 manager 统一挂载 MCP：服务器写在它那一行的
 * `config.servers` 映射里，键就是 serverName。与 dsh-mcp-client 行的差别：
 *   - 值只能是普通字符串，密钥用 `${credential:REF}` 模板，不接受 !!js；
 *   - 启停是条目里的 `enabled: false`，不是行上的 `disabled`；
 *   - 没有 failOnStartupError（manager 固定按 false 挂载实例）。
 */
import { parseDocument, stringify } from "yaml";
import { MCP_PLUGIN_NAME, isJsExprValue } from "../patch-editor.js";
import { DEFAULT_RECONNECT, DEFAULT_TOOL_CALL_TIMEOUT_MS, SERVER_NAME_RE, expressionToDisplay, mergeSecretPatch, patchRowToView } from "./model.js";
export const MANAGER_PLUGIN_NAME = "@deepseek-ai/dsh-mcp-manager";
export const MANAGER_SOURCE = "manager";
/** 表单会写回的键；其余（enabled、startupTimeoutMs、closeTimeoutMs…）编辑时原样保留。 */
const MODELED_KEYS = new Set(["transport", "command", "args", "env", "cwd", "url", "headers", "toolCallTimeoutMs", "reconnect"]);
/** manager 运行状态（McpManagedServerStatus.state）→ 卡片圆点用的阶段；未列出的按「无状态」。 */
const PHASE_OF_STATE = {
    connected: "active",
    connecting: "loading",
    reconnecting: "loading",
    "waiting-credentials": "loading",
    failed: "failed"
};
function asRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
export function managerEntryEnabled(entry) {
    return entry.enabled !== false;
}
/** manager 条目 → 卡片 view（复用 mcp-client 行的脱敏 view，再换上来源与启停语义）。 */
export function managerEntryToView(name, entry) {
    const view = patchRowToView({ name: MCP_PLUGIN_NAME, config: { ...entry, serverName: name, failOnStartupError: false } });
    if (view === undefined)
        return undefined;
    return { ...view, source: MANAGER_SOURCE, enabled: managerEntryEnabled(entry), entryId: undefined };
}
export function phaseOfManagerStatus(status) {
    return typeof status?.state === "string" ? PHASE_OF_STATE[status.state] ?? null : null;
}
/**
 * 表单值 → manager 能接受的普通字符串。
 * 表单会把含 `${...}` 的值自动包成 !!js 反引号模板（mcp-client 行的写法），这里还原成原文；
 * 用户手写的 `!!js` 表达式 manager 无法求值，直接拒绝。
 */
function plainScalar(value, label) {
    if (!isJsExprValue(value))
        return typeof value === "string" ? value : "";
    const text = expressionToDisplay(value.__jsExpr);
    if (text !== value.__jsExpr)
        return text;
    throw new Error(label + "：dsh-mcp-manager 不支持 !!js 表达式，密钥请写成 ${credential:名称}");
}
function plainMap(map, label) {
    const out = {};
    for (const [key, value] of Object.entries(map))
        out[key] = plainScalar(value, label + "." + key);
    return out;
}
function isEmptyValue(value) {
    if (value === "")
        return true;
    if (Array.isArray(value))
        return value.length === 0;
    const record = asRecord(value);
    return record !== undefined && Object.keys(record).length === 0;
}
/** 空字符串 / 空数组 / 空映射不写进文件：manager 的默认值就是它们。 */
function compact(entry) {
    return Object.fromEntries(Object.entries(entry).filter(([, value]) => !isEmptyValue(value)));
}
function transportFields(input, previous) {
    if (input.transport === "streamable-http") {
        const headers = plainMap(mergeSecretPatch(asRecord(previous.headers), input.headers), "headers");
        return compact({ transport: input.transport, url: plainScalar(input.url, "url"), headers });
    }
    const env = plainMap(mergeSecretPatch(asRecord(previous.env), input.env), "env");
    const args = input.args.map((arg, index) => plainScalar(arg, "args[" + index + "]"));
    return compact({ transport: input.transport, command: plainScalar(input.command, "command"), args, env, cwd: plainScalar(input.cwd, "cwd") });
}
function isDefaultReconnect(reconnect) {
    return reconnect.enabled === DEFAULT_RECONNECT.enabled
        && reconnect.initialDelayMs === DEFAULT_RECONNECT.initialDelayMs
        && reconnect.maxDelayMs === DEFAULT_RECONNECT.maxDelayMs
        && reconnect.maxAttempts === DEFAULT_RECONNECT.maxAttempts;
}
/** 超时 / 重连：原条目写过、或者改成了非默认值才落盘，避免一次表单保存给文件灌满默认值。 */
function tuningFields(input, previous) {
    const out = {};
    if ("toolCallTimeoutMs" in previous || input.toolCallTimeoutMs !== DEFAULT_TOOL_CALL_TIMEOUT_MS)
        out.toolCallTimeoutMs = input.toolCallTimeoutMs;
    if ("reconnect" in previous || !isDefaultReconnect(input.reconnect))
        out.reconnect = { ...input.reconnect };
    return out;
}
/**
 * 表单输入 + 旧条目 → 新条目。
 * env/headers 沿用面板的编辑语义（null 删键、缺省保留）；切换 transport 时旧传输的字段一并丢掉，
 * 否则 manager 的跨字段校验会拒绝（stdio 不许带 url/headers，http 不许带 command/env…）。
 */
export function inputToManagerEntry(input, previous = {}) {
    const kept = Object.fromEntries(Object.entries(previous).filter(([key]) => !MODELED_KEYS.has(key)));
    return { ...transportFields(input, previous), ...tuningFields(input, previous), ...kept };
}
/** 原文编辑的文本：只含这一台服务器的 `名字: 配置` 映射。 */
export function managerEntryText(name, entry) {
    return stringify({ [name]: entry }, { indent: 2, lineWidth: 0 });
}
/** 解析原文编辑提交的文本；字段合法性交给 manager 在写入时校验。 */
export function parseManagerEntryText(text) {
    const doc = parseDocument(text, { logLevel: "silent" });
    const problem = doc.errors[0] ?? doc.warnings[0];
    if (problem !== undefined)
        throw new Error("原文解析失败：" + String(problem.message ?? problem));
    const value = asRecord(doc.toJS());
    const names = value === undefined ? [] : Object.keys(value);
    if (value === undefined || names.length !== 1)
        throw new Error("原文必须是恰好一个「服务器名: 配置」映射");
    const name = names[0];
    if (!SERVER_NAME_RE.test(name))
        throw new Error("服务器名只能包含 1-32 位字母、数字、下划线或连字符");
    const entry = asRecord(value[name]);
    if (entry === undefined)
        throw new Error('服务器 "' + name + '" 的配置必须是映射');
    return { name, entry };
}
/** manager.probe() 的结果 → 面板「测试连接」的结果形状。 */
export function probeResultOf(result) {
    if (result?.ok === true) {
        const names = Array.isArray(result.toolNames) ? result.toolNames : [];
        return { ok: true, tools: names.filter((name) => typeof name === "string").map((name) => ({ name })) };
    }
    const stage = typeof result?.stage === "string" ? result.stage + "：" : "";
    return { ok: false, tools: [], error: stage + String(result?.message ?? "测试失败") };
}
