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
 *   1. 发现：origin 根 RFC 8414 / OIDC，PRM 二次发现，带路径的旧位置兜底
 *      （详见 docs/adr/0007-oauth-discovery.md）；
 *   2. 注册客户端：有 `registration_endpoint` 就走动态注册（RFC 7591），
 *      否则用调用方提供的 client_id（很多服务器允许公共客户端 + PKCE）；
 *   3. 授权码 + PKCE + RFC 8707 resource：把用户送进浏览器，回调落到**本进程
 *      监听的 127.0.0.1 端口**上（免去用户手抄 code，也不依赖外部回调服务）；
 *   4. 换令牌：`grant_type=authorization_code`（同样带 resource），记下 `expires_at`；
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
export async function loadOAuthStore(dshHome): Promise<Record<string, any>> {
  try {
    const parsed: any = JSON.parse(await readFile(oauthFile(dshHome), "utf8"));
    if (parsed !== null && typeof parsed === "object" && parsed.servers !== null && typeof parsed.servers === "object") {
      return parsed.servers;
    }
  } catch {
    // 文件缺失或损坏：按空处理
  }
  return {};
}

/** 写入一个服务器的 OAuth 记录（原子写）。 */
export async function saveOAuthRecord(dshHome, serverName: string, record: any): Promise<void> {
  const store = await loadOAuthStore(dshHome);
  store[serverName] = record;
  const path = oauthFile(dshHome);
  await mkdir(dirname(path), { recursive: true });
  const body = JSON.stringify({ version: 1, servers: store }, null, 2) + "\n";
  const temp = path + ".tmp-" + process.pid + "-" + Math.random().toString(36).slice(2, 8);
  await writeFile(temp, body, "utf8");
  try {
    await rename(temp, path);
  } catch (error) {
    if (error === null || typeof error !== "object" || !["EPERM", "EEXIST", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    await writeFile(path, body, "utf8");
  }
}

/** 删掉一个服务器的 OAuth 记录（断开连接）。 */
export async function removeOAuthRecord(dshHome, serverName: string): Promise<void> {
  const store = await loadOAuthStore(dshHome);
  if (store[serverName] === undefined) return;
  delete store[serverName];
  const path = oauthFile(dshHome);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ version: 1, servers: store }, null, 2) + "\n", "utf8");
}

/* ── 发现与注册 ─────────────────────────────────────────────────────────── */

/** 规范化服务器 URL：去掉结尾斜杠、补上协议。 */
export function normalizeServerUrl(url: string): string {
  let value = String(url ?? "").trim();
  if (value === "") throw new Error("缺少服务器 URL");
  if (!/^https?:\/\//i.test(value)) value = "https://" + value;
  return value.replace(/\/+$/, "");
}

const WELL_KNOWN_AS = "/.well-known/oauth-authorization-server";
const WELL_KNOWN_OIDC = "/.well-known/openid-configuration";
const WELL_KNOWN_PRM = "/.well-known/oauth-protected-resource";
const DISCOVERY_TIMEOUT_MS = 8000;
const DISCOVERY_BUDGET_MS = 20000;

export interface DiscoveryAttempt {
  url: string;
  status?: number;
  /** 失败原因（中文）。成功路径上保持 undefined，不要把「这是 PRM」之类的信息误记成失败。 */
  reason?: string;
  /** 这个 URL 的文档类型：PRM（受保护资源元数据）或 AS / OIDC 元数据。 */
  kind?: "prm" | "as";
  /** 成功路径上的诊断备注（resource 被采用 / 忽略、issuer 缺失等），不进入失败文案。 */
  note?: string;
}

export interface DiscoveryResult {
  metadata?: any;
  attempts: DiscoveryAttempt[];
  /** PRM 声明且通过同源校验的 RFC 8707 resource；没有可用声明时为 undefined。 */
  resource?: string;
}

export interface DiscoveryOptions {
  timeoutMs?: number;
  budgetMs?: number;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isHttpUrl(url: URL): boolean {
  return url.protocol === "https:" || url.protocol === "http:";
}

/** 拆出发现用的 origin / path / endpoint；query 与 hash 不参与（否则会拼出伪路径）。 */
function discoveryEndpoint(serverUrl: string): { origin: string; path: string; endpoint: string } {
  const parsed = new URL(normalizeServerUrl(serverUrl));
  const path = trimTrailingSlash(parsed.pathname);
  return { origin: parsed.origin, path, endpoint: parsed.origin + path };
}

/**
 * 某个 issuer 的 AS 元数据候选。
 *
 * RFC 8414 §3.1：把 well-known 插在 host 与 path 之间；
 * OIDC Discovery：把 well-known 追加在 issuer 之后。
 * 两种都试，最后再兜一个「追加式 AS」兼容少数实现。
 */
export function authorizationServerCandidates(issuer: string): string[] {
  const parsed = new URL(issuer);
  const origin = parsed.origin;
  const path = trimTrailingSlash(parsed.pathname);
  const base = origin + path; // query / hash 不进入候选
  const out: string[] = [];
  const add = (value: string) => {
    if (!out.includes(value)) out.push(value);
  };
  add(origin + WELL_KNOWN_AS + path);
  add(base + WELL_KNOWN_OIDC);
  add(origin + WELL_KNOWN_OIDC + path);
  add(base + WELL_KNOWN_AS);
  return out;
}

/**
 * 一个 MCP 端点 URL 的发现候选，按「先标准、后兼容」排序。
 *
 * 带路径的端点先查 RFC 9728 §3.1 的**路径形态 PRM**，再查 origin 根 PRM：共享
 * origin 上，根 AS / 根 PRM 可能属于别的产品，先绑定路径才不会把客户端交给
 * 别人的授权服务器（混用 / 劫持）。之后才是 RFC 8414 / OIDC 的插入式与根形态，
 * 最后兜旧行为（AS 直接暴露在端点路径下）。query / hash 会被剥掉，避免出现
 * `...?tenant=a/.well-known/...` 这种伪候选。
 */
export function discoveryCandidates(serverUrl: string): string[] {
  const { origin, path, endpoint } = discoveryEndpoint(serverUrl);
  const out: string[] = [];
  const add = (value: string) => {
    if (!out.includes(value)) out.push(value);
  };
  // 1/2：RFC 9728 PRM，先路径形态，再 origin 根
  if (path !== "") add(origin + WELL_KNOWN_PRM + path);
  add(origin + WELL_KNOWN_PRM);
  // 3/4：RFC 8414 §3.1 插入式，再 origin 根
  if (path !== "") add(origin + WELL_KNOWN_AS + path);
  add(origin + WELL_KNOWN_AS);
  // 5/6：OIDC 插入式，再 origin 根
  if (path !== "") add(origin + WELL_KNOWN_OIDC + path);
  add(origin + WELL_KNOWN_OIDC);
  // 7/8：旧行为——AS / OIDC 直接暴露在端点路径下
  add(endpoint + WELL_KNOWN_AS);
  add(endpoint + WELL_KNOWN_OIDC);
  return out;
}

function sameIssuer(left: string, right: string): boolean {
  return trimTrailingSlash(left) === trimTrailingSlash(right);
}

/**
 * 校验 AS / OIDC 元数据。
 *
 * - 给了 `expectedIssuer`（PRM 的 `authorization_servers[]` 驱动二次发现）：
 *   `issuer` 必须存在且与声明值精确相等（只忽略结尾斜杠，path / 大小写不同都拒绝）。
 * - 没给（直连 AS / OIDC 候选）：带 `issuer` 时只要求与发现地址同 origin；
 *   不带 `issuer` 仍接受（真机 Ardot 就是这样），并在 attempts 里记一条 note。
 */
function validateAuthorizationServerMetadata(body: any, target: string, expectedIssuer?: string): { metadata?: any; reason?: string; note?: string } {
  if (body === null || typeof body !== "object") return { reason: "响应不是 JSON 对象" };
  if (typeof body.token_endpoint !== "string" || body.token_endpoint === "") return { reason: "缺少 token_endpoint" };
  const rawIssuer = typeof body.issuer === "string" ? body.issuer.trim() : "";
  if (expectedIssuer !== undefined) {
    const expected = trimTrailingSlash(expectedIssuer);
    if (rawIssuer === "") return { reason: "缺少 issuer（期望 " + expected + "）" };
    let issuer: URL;
    try {
      issuer = new URL(rawIssuer);
    } catch {
      return { reason: "issuer 不是合法 URL" };
    }
    const actual = trimTrailingSlash(issuer.toString());
    if (!sameIssuer(actual, expected)) return { reason: "issuer 不匹配（期望 " + expected + "，实际 " + actual + "）" };
    return { metadata: body };
  }
  if (rawIssuer === "") return { metadata: body, note: "元数据未声明 issuer，按发现地址接受" };
  let issuer: URL;
  try {
    issuer = new URL(rawIssuer);
  } catch {
    return { reason: "issuer 不是合法 URL" };
  }
  if (!isHttpUrl(issuer)) return { reason: "issuer 不是 http(s) URL" };
  if (issuer.origin !== new URL(target).origin) return { reason: "issuer 与发现地址不一致" };
  return { metadata: body };
}

/**
 * RFC 8707 resource 指示器：必须是绝对 http(s) URI，且不能带 fragment。
 * 通过时返回去掉首尾空白的**原样**字符串（保留声明的 query / 结尾斜杠，方便与
 * 资源服务器精确比对），而不是重新序列化后的形式。
 */
export function normalizeResource(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  if (raw === "") return undefined;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }
  if (!isHttpUrl(parsed)) return undefined;
  if (parsed.hash !== "") return undefined;
  return raw;
}

function resolveIssuer(value: unknown, base: string): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return undefined;
  }
  if (!isHttpUrl(url)) return undefined;
  return trimTrailingSlash(url.toString());
}

/**
 * 发现 AS 元数据，并返回逐个候选的诊断信息。
 * `options` 只给测试与排障用，生产调用保持两个参数。
 */
export async function discoverMetadataDetailed(serverUrl: string, fetchImpl: any = fetch, options: DiscoveryOptions = {}): Promise<DiscoveryResult> {
  const timeoutMs = options.timeoutMs ?? DISCOVERY_TIMEOUT_MS;
  const budgetMs = options.budgetMs ?? DISCOVERY_BUDGET_MS;
  let candidates: string[];
  let endpointOrigin: string;
  try {
    endpointOrigin = discoveryEndpoint(serverUrl).origin;
    candidates = discoveryCandidates(serverUrl);
  } catch (error: any) {
    if (error?.message === "缺少服务器 URL") throw error; // 保持原行为：空 URL 仍抛错
    return { attempts: [{ url: String(serverUrl), reason: "URL 无效" }] };
  }
  const attempts: DiscoveryAttempt[] = [];
  const attemptByUrl = new Map<string, DiscoveryAttempt>();
  const tried = new Set<string>();
  const deadline = Date.now() + budgetMs;

  const mark = (target: string, reason: string) => {
    const attempt = attemptByUrl.get(target);
    if (attempt !== undefined && attempt.reason === undefined) attempt.reason = reason;
  };

  const annotate = (target: string, patch: { kind?: "prm" | "as"; note?: string }) => {
    const attempt = attemptByUrl.get(target);
    if (attempt === undefined) return;
    if (patch.kind !== undefined) attempt.kind = patch.kind;
    if (patch.note !== undefined) attempt.note = attempt.note === undefined ? patch.note : attempt.note + "；" + patch.note;
  };

  const fetchJson = async (target: string): Promise<any | undefined> => {
    if (tried.has(target)) return undefined;
    tried.add(target);
    const attempt: DiscoveryAttempt = { url: target };
    attemptByUrl.set(target, attempt);
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      attempt.reason = "URL 无效";
      attempts.push(attempt);
      return undefined;
    }
    if (!isHttpUrl(parsed)) {
      attempt.reason = "不支持的协议";
      attempts.push(attempt);
      return undefined;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      attempt.reason = "超出发现总时长";
      attempts.push(attempt);
      return undefined;
    }
    try {
      const response = await fetchImpl(target, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(Math.max(1, Math.min(timeoutMs, remaining)))
      });
      attempt.status = typeof response?.status === "number" ? response.status : undefined;
      if (response?.ok !== true) {
        attempt.reason = "HTTP " + String(attempt.status ?? "?");
        attempts.push(attempt);
        return undefined;
      }
      const body = await response.json();
      if (body === null || typeof body !== "object") {
        attempt.reason = "响应不是 JSON 对象";
        attempts.push(attempt);
        return undefined;
      }
      attempts.push(attempt);
      return body;
    } catch (error: any) {
      attempt.reason = error?.name === "TimeoutError" ? "请求超时" : "请求失败或响应不是 JSON";
      attempts.push(attempt);
      return undefined;
    }
  };

  for (const target of candidates) {
    const body = await fetchJson(target);
    if (body === undefined) continue;
    const verdict = validateAuthorizationServerMetadata(body, target);
    if (verdict.metadata !== undefined) {
      annotate(target, { kind: "as", note: verdict.note });
      return { metadata: verdict.metadata, attempts };
    }
    if (!Array.isArray(body.authorization_servers)) {
      mark(target, verdict.reason ?? "不是有效的 AS 元数据");
      continue;
    }
    // 这是 PRM：`kind` 记录「本 URL 是 PRM」，resource 的采用 / 忽略写进 note；
    // 真正的失败原因（找不到可用 AS）在二次发现结束后才写，避免把成功信息塞进 reason。
    annotate(target, { kind: "prm", note: "PRM：authorization_servers 驱动二次发现" });
    let prmResource: string | undefined;
    if (body.resource !== undefined) {
      const accepted = normalizeResource(body.resource);
      if (accepted === undefined) {
        annotate(target, { note: "忽略 PRM 的 resource（不是合法的绝对 http(s) URI）" });
      } else if (new URL(accepted).origin !== endpointOrigin) {
        annotate(target, { note: "忽略 PRM 的 resource（与 MCP 端点不同源）：" + accepted });
      } else {
        prmResource = accepted;
        annotate(target, { note: "采用 PRM 的 resource：" + accepted });
      }
    }
    for (const rawIssuer of body.authorization_servers) {
      const issuer = resolveIssuer(rawIssuer, target);
      if (issuer === undefined) continue;
      for (const asTarget of authorizationServerCandidates(issuer)) {
        const asBody = await fetchJson(asTarget);
        if (asBody === undefined) continue;
        const asVerdict = validateAuthorizationServerMetadata(asBody, asTarget, issuer);
        if (asVerdict.metadata !== undefined) {
          annotate(asTarget, { kind: "as", note: asVerdict.note });
          return prmResource === undefined ? { metadata: asVerdict.metadata, attempts } : { metadata: asVerdict.metadata, attempts, resource: prmResource };
        }
        mark(asTarget, asVerdict.reason ?? "不是有效的 AS 元数据");
      }
    }
    mark(target, "PRM 未找到可用的授权服务器元数据");
  }

  return { attempts };
}

/** 兼容入口：签名不变，仍只返回元数据。 */
export async function discoverMetadata(serverUrl: string, fetchImpl: any = fetch): Promise<any | undefined> {
  return (await discoverMetadataDetailed(serverUrl, fetchImpl)).metadata;
}

/** 失败时给用户看的诊断文案：保留原句前缀，附已尝试的 URL；只列失败项，不打印 note。 */
export function discoveryFailureMessage(attempts: DiscoveryAttempt[]): string {
  const head = "这个地址没有暴露 OAuth 发现文档（/.well-known/oauth-authorization-server），无法自动登录";
  const failures = attempts.filter((attempt) => attempt.reason !== undefined);
  if (failures.length === 0) return head;
  const shown = failures.slice(0, 10);
  const lines = shown.map((attempt) => "- " + attempt.url + "（" + attempt.reason + "）");
  if (failures.length > shown.length) lines.push("- …还有 " + (failures.length - shown.length) + " 次尝试");
  return head + "。已尝试：\n" + lines.join("\n");
}

/** PKCE 的 verifier / challenge（S256）。 */
export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** 动态客户端注册（RFC 7591）；服务器没提供端点时返回 undefined。 */
export async function registerClient(metadata: any, redirectUri: string, fetchImpl: any = fetch): Promise<any | undefined> {
  const endpoint = metadata?.registration_endpoint;
  if (typeof endpoint !== "string" || endpoint === "") return undefined;
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
  if (response?.ok !== true) throw new Error("动态客户端注册失败（HTTP " + String(response?.status ?? "?") + "）");
  const body = await response.json();
  if (body === null || typeof body !== "object" || typeof body.client_id !== "string") throw new Error("动态客户端注册返回里没有 client_id");
  return body;
}

/** 拼授权 URL。resource 是 RFC 8707 资源指示器；Ardot 缺它会返回 invalid_target。 */
export function buildAuthorizationUrl(metadata: any, clientId: string, redirectUri: string, challenge: string, state: string, scope?: string, resource?: string): string {
  const endpoint = metadata?.authorization_endpoint;
  if (typeof endpoint !== "string" || endpoint === "") throw new Error("授权端点缺失（发现文档里没有 authorization_endpoint）");
  const url = new URL(endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  const effectiveScope = scope ?? (Array.isArray(metadata?.scopes_supported) ? metadata.scopes_supported.join(" ") : undefined);
  if (typeof effectiveScope === "string" && effectiveScope !== "") url.searchParams.set("scope", effectiveScope);
  if (typeof resource === "string" && resource !== "") url.searchParams.set("resource", resource);
  return url.toString();
}

/* ── 本地回调服务器 ─────────────────────────────────────────────────────── */

/**
 * 起一个只监听 127.0.0.1 的一次性回调服务器。
 * 授权成功后回调带 `?code=&state=`，校验 state 后把 code 交给调用方。
 */
export async function startLoopbackServer(expectedState: string, timeoutMs = 300000): Promise<any> {
  return new Promise((resolveOuter, rejectOuter) => {
    let settle: (value: any) => void;
    const outcome = new Promise((resolve, reject) => {
      settle = (value: any) => (value instanceof Error ? reject(value) : resolve(value));
    });
    // 回调可能**早于**调用方来取结果（比如用户手快、或 state 不匹配当场失败）：
    // 先挂一个空的 catch，避免「先失败、后取用」被判成未处理的拒绝而炸掉宿主进程。
    outcome.catch(() => {});
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
        const address: any = server.address();
        const port = typeof address?.port === "number" ? address.port : 0;
        resolveOuter({
          port,
          redirectUri: "http://127.0.0.1:" + port + "/callback",
          waitForCode: () => outcome,
          close: () => {
            clearTimeout(timer);
            return new Promise<void>((done) => server.close(() => done()));
          }
        });
      })
      .on("error", (error: any) => rejectOuter(error));
  });
}

/* ── 令牌交换与刷新 ─────────────────────────────────────────────────────── */

/** 把令牌响应整理成我们自己的记录形状（含绝对过期时间）。 */
export function normalizeTokenResponse(body: any, previous?: any): any {
  if (body === null || typeof body !== "object" || typeof body.access_token !== "string") throw new Error("令牌响应里没有 access_token");
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : undefined;
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : previous?.refreshToken,
    tokenType: typeof body.token_type === "string" ? body.token_type : "Bearer",
    scope: typeof body.scope === "string" ? body.scope : previous?.scope,
    expiresAt: expiresIn === undefined ? undefined : Date.now() + expiresIn * 1000
  };
}

/**
 * 授权码换令牌。
 * 第 6 个参数兼容旧的 fetchImpl 调用；传 string 时视为 RFC 8707 resource。
 */
export async function exchangeCode(metadata: any, clientId: string, code: string, verifier: string, redirectUri: string, resourceOrFetch?: any, fetchImpl: any = fetch): Promise<any> {
  const resource = typeof resourceOrFetch === "string" ? resourceOrFetch : undefined;
  const fetchFn = typeof resourceOrFetch === "function" ? resourceOrFetch : fetchImpl;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: verifier
  });
  if (resource !== undefined && resource !== "") body.set("resource", resource);
  const response = await fetchFn(metadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: body.toString()
  });
  if (response?.ok !== true) throw new Error("换令牌失败（HTTP " + String(response?.status ?? "?") + "）：" + String(await safeText(response)));
  return normalizeTokenResponse(await response.json());
}

/** 刷新令牌；resource 与授权/换令牌时保持一致。 */
export async function refreshTokens(metadata: any, clientId: string, refreshToken: string, resourceOrFetch?: any, fetchImpl: any = fetch): Promise<any> {
  const resource = typeof resourceOrFetch === "string" ? resourceOrFetch : undefined;
  const fetchFn = typeof resourceOrFetch === "function" ? resourceOrFetch : fetchImpl;
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId });
  if (resource !== undefined && resource !== "") body.set("resource", resource);
  const response = await fetchFn(metadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: body.toString()
  });
  if (response?.ok !== true) throw new Error("刷新令牌失败（HTTP " + String(response?.status ?? "?") + "）：" + String(await safeText(response)));
  return normalizeTokenResponse(await response.json(), { refreshToken });
}

async function safeText(response: any): Promise<string> {
  try {
    const text = await response.text();
    return text.length > 200 ? text.slice(0, 200) + "…" : text;
  } catch {
    return "";
  }
}

/** 令牌是否已经/即将过期（默认提前 60 秒视为过期）。 */
export function isExpired(record: any, skewMs = 60000): boolean {
  if (record === null || typeof record !== "object") return true;
  if (typeof record.expiresAt !== "number") return false;
  return Date.now() + skewMs >= record.expiresAt;
}

/** 授权头值：`Bearer <token>`（token_type 为空时按 Bearer 处理）。 */
export function authorizationHeader(record: any): string {
  const type = typeof record?.tokenType === "string" && record.tokenType !== "" ? record.tokenType : "Bearer";
  return type + " " + String(record?.accessToken ?? "");
}
