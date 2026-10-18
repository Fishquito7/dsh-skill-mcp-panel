/**
 * dsh-skill-mcp-panel —— 远程 MCP 服务器的 OAuth 2.0 登录（Issue #45）。
 *
 * 背景：宿主自带的 `@deepseek-ai/dsh-mcp-client` **只认静态 headers**，没有 OAuth
 * 字段（`transport` / `serverName` / `command` `args` `env` `cwd` / `url` `headers` /
 * `toolCallTimeoutMs` / `maxInstructionBytes` / `failOnStartupError` / `reconnect.*`，
 * 就这些）。所以「支持 OAuth」只能由面板自己把令牌拿到手，再落到那行配置的
 * `Authorization` header 上——本文件负责前半段（拿令牌），落盘与热加载由调用方做。
 *
 * 支持的路径（按 RFC 顺序，能用哪步用哪步）：
 *   1. 发现：`<url>/.well-known/oauth-authorization-server`（失败再退
 *      `/.well-known/openid-configuration`；再失败就用传入的端点兜底）；
 *   2. 注册客户端：有 `registration_endpoint` 就走动态注册（RFC 7591），
 *      否则用调用方提供的 client_id（很多服务器允许公共客户端 + PKCE）；
 *   3. 授权码 + PKCE：把用户送进浏览器，回调落到**本进程监听的 127.0.0.1 端口**上
 *      （免去用户手抄 code，也不依赖任何外部回调服务）；
 *   4. 换令牌：`grant_type=authorization_code`，记下 `expires_at`；
 *   5. 刷新：`grant_type=refresh_token`，过期前由调用方触发。
 *
 * 令牌存在 `<dshHome>/skills/.system/skill-viewer/oauth.json`（按服务器名索引）。
 * 写进 profile patch 的是**字面量** Bearer 头——也就是说令牌会出现在
 * cordis.patch.yml 里，和用户今天手写 header 的方式等价；文件名与目录都在
 * 发现服务会跳过的隐藏区，但仍属明文，`README` 里明确写清。
 */
import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { groupsRoot } from "./groups.js";
/** OAuth 令牌与客户端信息的持久化文件。 */
export function oauthFile(dshHome) {
    return join(groupsRoot(dshHome), "oauth.json");
}
/** 读取全部 OAuth 记录；文件缺失或损坏按空对象处理。 */
export async function loadOAuthStore(dshHome) {
    try {
        const parsed = JSON.parse(await readFile(oauthFile(dshHome), "utf8"));
        if (parsed !== null && typeof parsed === "object" && parsed.servers !== null && typeof parsed.servers === "object") {
            return parsed.servers;
        }
    }
    catch {
        // 文件缺失或损坏：按空处理
    }
    return {};
}
/** 写入一个服务器的 OAuth 记录（原子写）。 */
export async function saveOAuthRecord(dshHome, serverName, record) {
    const store = await loadOAuthStore(dshHome);
    store[serverName] = record;
    const path = oauthFile(dshHome);
    await mkdir(dirname(path), { recursive: true });
    const body = JSON.stringify({ version: 1, servers: store }, null, 2) + "\n";
    const temp = path + ".tmp-" + process.pid + "-" + Math.random().toString(36).slice(2, 8);
    await writeFile(temp, body, "utf8");
    try {
        await rename(temp, path);
    }
    catch (error) {
        if (error === null || typeof error !== "object" || !["EPERM", "EEXIST", "EACCES"].includes(error.code ?? ""))
            throw error;
        await writeFile(path, body, "utf8");
    }
}
/** 删掉一个服务器的 OAuth 记录（断开连接）。 */
export async function removeOAuthRecord(dshHome, serverName) {
    const store = await loadOAuthStore(dshHome);
    if (store[serverName] === undefined)
        return;
    delete store[serverName];
    const path = oauthFile(dshHome);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ version: 1, servers: store }, null, 2) + "\n", "utf8");
}
/* ── 发现与注册 ─────────────────────────────────────────────────────────── */
/** 规范化服务器 URL：去掉结尾斜杠、补上协议。 */
export function normalizeServerUrl(url) {
    let value = String(url ?? "").trim();
    if (value === "")
        throw new Error("缺少服务器 URL");
    if (!/^https?:\/\//i.test(value))
        value = "https://" + value;
    return value.replace(/\/+$/, "");
}
/** 依次尝试两个标准发现路径；都失败返回 undefined。 */
export async function discoverMetadata(serverUrl, fetchImpl = fetch) {
    const base = normalizeServerUrl(serverUrl);
    for (const suffix of ["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"]) {
        try {
            const response = await fetchImpl(base + suffix, { headers: { accept: "application/json" } });
            if (response === null || typeof response !== "object" || response.ok !== true)
                continue;
            const body = await response.json();
            if (body !== null && typeof body === "object" && typeof body.token_endpoint === "string")
                return body;
        }
        catch {
            // 试下一个路径
        }
    }
    return undefined;
}
/** PKCE 的 verifier / challenge（S256）。 */
export function createPkce() {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    return { verifier, challenge };
}
/** 动态客户端注册（RFC 7591）；服务器没提供端点时返回 undefined。 */
export async function registerClient(metadata, redirectUri, fetchImpl = fetch) {
    const endpoint = metadata?.registration_endpoint;
    if (typeof endpoint !== "string" || endpoint === "")
        return undefined;
    const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
            client_name: "DSH Skill/MCP 面板",
            redirect_uris: [redirectUri],
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            token_endpoint_auth_method: "none"
        })
    });
    if (response?.ok !== true)
        throw new Error("动态客户端注册失败（HTTP " + String(response?.status ?? "?") + "）");
    const body = await response.json();
    if (body === null || typeof body !== "object" || typeof body.client_id !== "string")
        throw new Error("动态客户端注册返回里没有 client_id");
    return body;
}
/** 拼授权 URL。 */
export function buildAuthorizationUrl(metadata, clientId, redirectUri, challenge, state, scope) {
    const endpoint = metadata?.authorization_endpoint;
    if (typeof endpoint !== "string" || endpoint === "")
        throw new Error("授权端点缺失（发现文档里没有 authorization_endpoint）");
    const url = new URL(endpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    const effectiveScope = scope ?? (Array.isArray(metadata?.scopes_supported) ? metadata.scopes_supported.join(" ") : undefined);
    if (typeof effectiveScope === "string" && effectiveScope !== "")
        url.searchParams.set("scope", effectiveScope);
    return url.toString();
}
/* ── 本地回调服务器 ─────────────────────────────────────────────────────── */
/**
 * 起一个只监听 127.0.0.1 的一次性回调服务器。
 * 授权成功后回调带 `?code=&state=`，校验 state 后把 code 交给调用方。
 */
export async function startLoopbackServer(expectedState, timeoutMs = 300000) {
    return new Promise((resolveOuter, rejectOuter) => {
        let settle;
        const outcome = new Promise((resolve, reject) => {
            settle = (value) => (value instanceof Error ? reject(value) : resolve(value));
        });
        // 回调可能**早于**调用方来取结果（比如用户手快、或 state 不匹配当场失败）：
        // 先挂一个空的 catch，避免「先失败、后取用」被判成未处理的拒绝而炸掉宿主进程。
        outcome.catch(() => { });
        const server = createServer((request, response) => {
            const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
            if (requestUrl.pathname !== "/callback") {
                response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
                response.end("not found");
                return;
            }
            const code = requestUrl.searchParams.get("code") ?? "";
            const state = requestUrl.searchParams.get("state") ?? "";
            const error = requestUrl.searchParams.get("error");
            response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
            if (error !== null) {
                response.end("<meta charset=utf-8><p>授权被拒绝：" + error + "。可以关闭这个页面，回到 DSH 面板。</p>");
                settle(new Error("授权被拒绝：" + error));
                return;
            }
            if (state !== expectedState) {
                response.end("<meta charset=utf-8><p>state 不匹配，已忽略这次回调。</p>");
                settle(new Error("回调 state 不匹配"));
                return;
            }
            response.end("<meta charset=utf-8><p>授权成功，可以关闭这个页面，回到 DSH 面板。</p>");
            settle({ code });
        });
        const timer = setTimeout(() => settle(new Error("等待授权回调超时（" + Math.round(timeoutMs / 1000) + " 秒）")), timeoutMs);
        server
            .listen(0, "127.0.0.1", () => {
            const address = server.address();
            const port = typeof address?.port === "number" ? address.port : 0;
            resolveOuter({
                port,
                redirectUri: "http://127.0.0.1:" + port + "/callback",
                waitForCode: () => outcome,
                close: () => {
                    clearTimeout(timer);
                    return new Promise((done) => server.close(() => done()));
                }
            });
        })
            .on("error", (error) => rejectOuter(error));
    });
}
/* ── 令牌交换与刷新 ─────────────────────────────────────────────────────── */
/** 把令牌响应整理成我们自己的记录形状（含绝对过期时间）。 */
export function normalizeTokenResponse(body, previous) {
    if (body === null || typeof body !== "object" || typeof body.access_token !== "string")
        throw new Error("令牌响应里没有 access_token");
    const expiresIn = typeof body.expires_in === "number" ? body.expires_in : undefined;
    return {
        accessToken: body.access_token,
        refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : previous?.refreshToken,
        tokenType: typeof body.token_type === "string" ? body.token_type : "Bearer",
        scope: typeof body.scope === "string" ? body.scope : previous?.scope,
        expiresAt: expiresIn === undefined ? undefined : Date.now() + expiresIn * 1000
    };
}
/** 授权码换令牌。 */
export async function exchangeCode(metadata, clientId, code, verifier, redirectUri, fetchImpl = fetch) {
    const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: verifier
    });
    const response = await fetchImpl(metadata.token_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: body.toString()
    });
    if (response?.ok !== true)
        throw new Error("换令牌失败（HTTP " + String(response?.status ?? "?") + "）：" + String(await safeText(response)));
    return normalizeTokenResponse(await response.json());
}
/** 刷新令牌。 */
export async function refreshTokens(metadata, clientId, refreshToken, fetchImpl = fetch) {
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId });
    const response = await fetchImpl(metadata.token_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: body.toString()
    });
    if (response?.ok !== true)
        throw new Error("刷新令牌失败（HTTP " + String(response?.status ?? "?") + "）：" + String(await safeText(response)));
    return normalizeTokenResponse(await response.json(), { refreshToken });
}
async function safeText(response) {
    try {
        const text = await response.text();
        return text.length > 200 ? text.slice(0, 200) + "…" : text;
    }
    catch {
        return "";
    }
}
/** 令牌是否已经/即将过期（默认提前 60 秒视为过期）。 */
export function isExpired(record, skewMs = 60000) {
    if (record === null || typeof record !== "object")
        return true;
    if (typeof record.expiresAt !== "number")
        return false;
    return Date.now() + skewMs >= record.expiresAt;
}
/** 授权头值：`Bearer <token>`（token_type 为空时按 Bearer 处理）。 */
export function authorizationHeader(record) {
    const type = typeof record?.tokenType === "string" && record.tokenType !== "" ? record.tokenType : "Bearer";
    return type + " " + String(record?.accessToken ?? "");
}
