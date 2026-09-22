/**
 * dsh-skill-mcp-panel —— 工作区 MCP 的凭证解析。
 *
 * 工作区声明只记键名，明文一律来自 DSH 官方凭证 seam（`ctx.credentials`，
 * 由 dsh-base 组合的 @deepseek-ai/dsh-credentials-local 提供）。解析优先级完全
 * 由官方 provider 决定：启动环境 > 存储文件（~/.dsh/.credentials.yaml）>
 * 项目 .env > $DSH_HOME/.env。
 *
 * 为什么必须显式解析而不是让子进程继承环境：官方 mcp-client 起子进程用的是
 * `scrubbedParentEnv()`，它会丢掉匹配 /KEY|PASSWORD|SECRET|TOKEN/i 的名字和
 * 所有 `DSH_*`——钥匙形状的环境变量本来就传不进去，只能在这里取出来再并进
 * `config.env`。
 */
import { mcpServerInputSchema } from "./model.js";
import { headerRefName, isReferenceName } from "./ref-name.js";
import { importFromHarness } from "./harness-resolve.js";
/** 官方凭证包的 specifier；解析交给 harness-resolve。 */
const CREDENTIALS_SPEC = "@deepseek-ai/dsh-credentials";
/**
 * 解析官方凭证包。npm 只装技能、没装 DSH 的场合会缺失——这不是错误，调用方
 * 退化为"所有引用都未配置"。传入宿主上下文时使用确定性的宿主锚点解析。
 */
export async function loadCredentialSeam(ctx) {
    const mod = await importFromHarness(CREDENTIALS_SPEC, ctx);
    if (mod === undefined)
        return undefined;
    if (typeof mod?.credentialRef !== "function")
        return undefined;
    return { credentialRef: (value) => mod.credentialRef(value) };
}
/**
 * 把一条工作区声明解析成含明文的 MCP 配置。
 *
 * 缺值的引用**不阻断**挂载：仅记录在 `missing` 里，由 UI/日志呈现；服务器照常
 * 启动（`failOnStartupError:false` 时连接失败只是降级为未连接行）。
 */
export async function resolveWorkspaceServer(server, provider, seam) {
    const missing = [];
    const invalid = [];
    const env = {};
    const headers = {};
    const take = async (refName, label, into, key) => {
        if (!isReferenceName(refName)) {
            invalid.push(label + ' "' + key + '" 的凭证引用名 "' + refName + '" 不合法');
            return;
        }
        if (provider === undefined || typeof provider.resolve !== "function") {
            missing.push(refName);
            return;
        }
        try {
            const branded = seam === undefined ? refName : seam.credentialRef(refName);
            const resolved = await provider.resolve(branded);
            const value = resolved?.value;
            if (typeof value !== "string" || value === "") {
                missing.push(refName);
                return;
            }
            into[key] = value;
        }
        catch (error) {
            invalid.push(label + ' "' + key + '" 解析失败：' + (error instanceof Error ? error.message : String(error)));
        }
    };
    for (const key of server.envKeys ?? [])
        await take(key, "env", env, key);
    for (const [header, ref] of Object.entries(server.headerRefs ?? {}))
        await take(ref, "header", headers, header);
    const common = {
        serverName: server.serverName,
        toolCallTimeoutMs: server.toolCallTimeoutMs,
        failOnStartupError: server.failOnStartupError,
        reconnect: server.reconnect
    };
    const candidate = server.transport === "stdio"
        ? { ...common, transport: "stdio", command: server.command, args: server.args ?? [], cwd: server.cwd ?? "", env }
        : { ...common, transport: "streamable-http", url: server.url, headers };
    try {
        return { input: mcpServerInputSchema.parse(candidate), missing, invalid };
    }
    catch (error) {
        return {
            missing,
            invalid,
            error: "工作区 MCP 声明无效（" + server.serverName + "）：" + (error instanceof Error ? error.message : String(error))
        };
    }
}
/** 由 header 名列表派生 `headerRefs` 映射（UI/CLI 只让用户填 header 名的场合）。 */
export function deriveHeaderRefs(serverName, headerNames) {
    const refs = {};
    for (const header of headerNames) {
        const name = header.trim();
        if (name === "")
            continue;
        refs[name] = headerRefName(serverName, name);
    }
    return refs;
}
