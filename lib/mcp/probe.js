/**
 * dsh-skill-mcp-panel —— MCP 临时连接探针。
 *
 * 不写 patch、不注册 DSH 工具；Web“测试连接”与 `dsh-panel mcp test` 共用。
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { parse as parseYaml } from "yaml";
import { resolveDshHome, scrubbedParentEnv } from "../host-paths.js";
import { isJsExprValue } from "../patch-editor.js";
import { CREDENTIAL_REF_RE, mcpServerInputSchema } from "./model.js";
const PROBE_TIMEOUT_MS = 15000;
const SUSPECT_TEMPLATE_RE = /\$\{[^}]*\}?/g;
const EXACT_CREDENTIAL_RE = /^\$\{credential:([A-Za-z_][A-Za-z0-9_]*)\}$/;
/**
 * 求值 !!js 表达式：与宿主 cordis 配置层的语义一致（with (ctx) { return eval(expr) }），
 * 区别只是测试连接跑在本进程、没有 loader 上下文。ctx 传空对象，表达式能拿到的
 * 全部来自全局（process.env 等）。
 */
function evaluateJsExpr(expression) {
    return new Function("ctx", "expr", "with (ctx) { return eval(expr) }")({}, expression);
}
/** 把单个配置值解析成字符串：先求值 !!js 表达式，失败给出可读原因。 */
function resolveScalar(value, label) {
    if (isJsExprValue(value)) {
        let resolved;
        try {
            resolved = evaluateJsExpr(value.__jsExpr);
        }
        catch (error) {
            throw new Error(label + " 的 !!js 表达式求值失败：" + (error instanceof Error ? error.message : String(error)));
        }
        if (resolved === undefined || resolved === null)
            return undefined;
        return typeof resolved === "string" ? resolved : String(resolved);
    }
    return typeof value === "string" ? value : "";
}
function parseDotEnv(text) {
    const out = {};
    for (const rawLine of text.split(/\r?\n/)) {
        const trimmed = rawLine.trim();
        if (trimmed === "" || trimmed.startsWith("#"))
            continue;
        const line = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
        const eq = line.indexOf("=");
        if (eq <= 0)
            continue;
        const key = line.slice(0, eq).trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
            continue;
        let val = line.slice(eq + 1).trim();
        if (val.length >= 2 && ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))) {
            val = val.slice(1, -1);
        }
        else {
            const comment = val.indexOf(" #");
            if (comment >= 0)
                val = val.slice(0, comment).trim();
        }
        if (val !== "")
            out[key] = val;
    }
    return out;
}
async function readCredentialsFileRefs(dshHome) {
    try {
        const raw = await readFile(join(dshHome, ".credentials.yaml"), "utf8");
        const parsed = parseYaml(raw);
        if (parsed !== null && typeof parsed === "object" && parsed.refs !== null && typeof parsed.refs === "object") {
            const out = {};
            for (const [k, v] of Object.entries(parsed.refs)) {
                if (typeof v === "string" && v !== "")
                    out[k] = v;
            }
            return out;
        }
    }
    catch {
        // missing or unreadable credentials file falls through to env/.env
    }
    return {};
}
async function readDotEnvCached(filePath) {
    try {
        return parseDotEnv(await readFile(filePath, "utf8"));
    }
    catch {
        return {};
    }
}
function createCredentialLookup(options, secrets) {
    const dshHome = resolveDshHome(options.dshHome);
    const cwd = options.cwd ?? process.cwd();
    const cache = new Map();
    let diskRefsPromise;
    let cwdEnvPromise;
    let homeEnvPromise;
    const lookupUncached = async (ref) => {
        if (typeof options.resolveCredential === "function") {
            const fromHost = await options.resolveCredential(ref);
            if (typeof fromHost === "string" && fromHost !== "")
                return fromHost;
        }
        diskRefsPromise ??= readCredentialsFileRefs(dshHome);
        const refs = await diskRefsPromise;
        if (typeof refs[ref] === "string" && refs[ref] !== "")
            return refs[ref];
        const fromEnv = process.env[ref];
        if (typeof fromEnv === "string" && fromEnv !== "")
            return fromEnv;
        cwdEnvPromise ??= readDotEnvCached(join(cwd, ".env"));
        const cwdEnv = await cwdEnvPromise;
        if (typeof cwdEnv[ref] === "string" && cwdEnv[ref] !== "")
            return cwdEnv[ref];
        homeEnvPromise ??= readDotEnvCached(join(dshHome, ".env"));
        const homeEnv = await homeEnvPromise;
        if (typeof homeEnv[ref] === "string" && homeEnv[ref] !== "")
            return homeEnv[ref];
        return undefined;
    };
    return (ref) => {
        let entry = cache.get(ref);
        if (entry === undefined) {
            entry = lookupUncached(ref).then((value) => {
                if (typeof value === "string" && value.length >= 4) {
                    secrets.add(value);
                    secrets.add(encodeURIComponent(value));
                }
                return value;
            });
            cache.set(ref, entry);
        }
        return entry;
    };
}
async function expandTemplateText(text, label, expandTemplates, getCredential) {
    if (!expandTemplates) {
        const token = new RegExp(CREDENTIAL_REF_RE.source).exec(text);
        if (token !== null) {
            throw new Error('检测到凭据模板 "' + token[0] + '"（' + label + "），但未启用 expandTemplates（请在高级设置中开启「展开凭据模板」或在 YAML 中添加 expandTemplates: true）");
        }
        return text;
    }
    for (const hit of text.matchAll(SUSPECT_TEMPLATE_RE)) {
        if (!EXACT_CREDENTIAL_RE.test(hit[0])) {
            throw new Error('模板语法无效（' + label + '）："' + hit[0] + '"，请使用 ${credential:REF}');
        }
    }
    let out = "";
    let cursor = 0;
    for (const token of text.matchAll(new RegExp(CREDENTIAL_REF_RE.source, "g"))) {
        const ref = token[1];
        const value = await getCredential(ref);
        if (value === undefined || value === "") {
            throw new Error('凭据引用 "${credential:' + ref + '}"（' + label + "）未配置或值为空（请在凭据管理、.env 或环境变量 " + ref + " 中设置）");
        }
        const idx = token.index ?? 0;
        out += text.slice(cursor, idx) + value;
        cursor = idx + token[0].length;
    }
    return out + text.slice(cursor);
}
function redactText(text, secrets) {
    if (secrets.size === 0)
        return text;
    let clean = text;
    const sorted = [...secrets].sort((a, b) => b.length - a.length);
    for (const secret of sorted) {
        if (secret !== "")
            clean = clean.split(secret).join("[REDACTED]");
    }
    return clean;
}
/** 必需值：先求值 !!js，再按 expandTemplates 解析 ${credential:REF}。 */
async function resolveRequired(value, label, expandTemplates, getCredential) {
    const resolved = resolveScalar(value, label);
    if (resolved === undefined)
        throw new Error(label + " 的 !!js 表达式没有求值结果：" + (isJsExprValue(value) ? value.__jsExpr : ""));
    return expandTemplateText(resolved, label, expandTemplates, getCredential);
}
/** 环境变量/请求头：表达式求值为空时省略这个键，同时解析 ${credential:REF}。 */
async function stringMap(value, label, expandTemplates, getCredential) {
    const out = {};
    for (const [key, item] of Object.entries(value ?? {})) {
        if (item === null || item === undefined)
            continue;
        const resolved = resolveScalar(item, label + " " + key);
        if (resolved === undefined)
            continue;
        out[key] = await expandTemplateText(resolved, label + " " + key, expandTemplates, getCredential);
    }
    return out;
}
async function createTransport(input, getCredential) {
    const expandTemplates = input.expandTemplates === true;
    if (input.transport === "stdio") {
        const args = [];
        for (const item of input.args)
            args.push(await resolveRequired(item, "参数", expandTemplates, getCredential));
        return new StdioClientTransport({
            command: await resolveRequired(input.command, "命令", expandTemplates, getCredential),
            args,
            env: {
                ...scrubbedParentEnv(),
                ...(await stringMap(input.env, "环境变量", expandTemplates, getCredential))
            },
            cwd: input.cwd === "" || input.cwd === undefined ? undefined : await resolveRequired(input.cwd, "工作目录", expandTemplates, getCredential)
        });
    }
    return new StreamableHTTPClientTransport(new URL(await resolveRequired(input.url, "服务器地址", expandTemplates, getCredential)), {
        requestInit: { headers: await stringMap(input.headers, "请求头", expandTemplates, getCredential) }
    });
}
export async function probeMcpServer(raw, timeoutOrOptions = PROBE_TIMEOUT_MS) {
    const options = typeof timeoutOrOptions === "number" ? { timeoutMs: timeoutOrOptions } : (timeoutOrOptions ?? {});
    const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
    let input;
    try {
        input = mcpServerInputSchema.parse(raw);
    }
    catch (error) {
        return { ok: false, tools: [], error: "配置无效：" + (error instanceof Error ? error.message : String(error)) };
    }
    const secrets = new Set();
    const getCredential = createCredentialLookup(options, secrets);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const client = new Client({ name: "dsh-skill-mcp-panel", version: "2.0.0" });
    let transport;
    try {
        transport = await createTransport(input, getCredential);
        await raceWithAbort(client.connect(transport), controller.signal);
        const tools = [];
        let cursor;
        do {
            const page = await client.listTools(cursor === undefined ? undefined : { cursor }, { signal: controller.signal });
            for (const tool of page.tools) {
                tools.push({
                    name: typeof tool.name === "string" ? tool.name : String(tool.name),
                    ...(typeof tool.description === "string" ? { description: tool.description } : {})
                });
            }
            cursor = page.nextCursor;
        } while (cursor !== undefined && cursor !== "");
        return { ok: true, tools };
    }
    catch (error) {
        const rawReason = controller.signal.aborted ? "连接测试超时（" + timeoutMs + "ms）" : error instanceof Error ? error.message : String(error);
        return { ok: false, tools: [], error: redactText(rawReason, secrets) };
    }
    finally {
        clearTimeout(timer);
        await Promise.allSettled([client.close().catch(() => { }), transport?.close().catch(() => { })]);
    }
}
async function raceWithAbort(promise, signal) {
    if (signal.aborted)
        return Promise.reject(new Error("aborted"));
    return new Promise((resolvePromise, rejectPromise) => {
        const onAbort = () => rejectPromise(new Error("aborted"));
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then((value) => {
            signal.removeEventListener("abort", onAbort);
            resolvePromise(value);
        }, (error) => {
            signal.removeEventListener("abort", onAbort);
            rejectPromise(error);
        });
    });
}
