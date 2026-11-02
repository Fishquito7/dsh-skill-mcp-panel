import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  authorizationHeader,
  buildAuthorizationUrl,
  createPkce,
  discoverMetadata,
  discoverMetadataDetailed,
  discoveryCandidates,
  discoveryFailureMessage,
  exchangeCode,
  isExpired,
  loadOAuthStore,
  normalizeServerUrl,
  refreshTokens,
  registerClient,
  removeOAuthRecord,
  saveOAuthRecord,
  startLoopbackServer
} from "../lib/oauth.js";

let passed = 0;
let failed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

/** 新增用例的聚合执行器：一条失败不中断后续用例，便于一次看到全部红点。 */
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log("PASS  " + name);
  } catch (error) {
    failed += 1;
    console.log("FAIL  " + name + "\n      " + (error instanceof Error ? error.message : String(error)));
  }
}

/** 发现顺序用例的轻量 fixture：按 pathname 路由，404 返回 HTML，便于覆盖 JSON 解析失败。 */
async function startDiscoveryFixture(routes) {
  let origin;
  const requests = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    requests.push(url.pathname);
    const handler = routes[url.pathname];
    if (handler === undefined) {
      response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      response.end("<h1>404</h1>");
      return;
    }
    const value = await handler(url, origin);
    if (value === "hang") return;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(value));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = "http://127.0.0.1:" + server.address().port;
  return {
    origin,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      })
  };
}

// ── 假 IdP：把 RFC 6749 / 7591 / 8414 里我们真正用到的几步做出来 ──────────
const issuer = { clientId: undefined, code: undefined, verifier: undefined, refreshCount: 0, scope: undefined, authorizeResource: undefined, tokenResources: [] };
const idp = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const json = (body, status = 200) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  if (url.pathname === "/.well-known/oauth-authorization-server") {
    return json({
      issuer: "http://127.0.0.1:" + idp.address().port,
      authorization_endpoint: "http://127.0.0.1:" + idp.address().port + "/authorize",
      token_endpoint: "http://127.0.0.1:" + idp.address().port + "/token",
      registration_endpoint: "http://127.0.0.1:" + idp.address().port + "/register",
      scopes_supported: ["mcp.read", "mcp.write"]
    });
  }
  if (url.pathname === "/register") {
    issuer.clientId = "client-fixture-" + Math.random().toString(36).slice(2, 8);
    return json({ client_id: issuer.clientId, token_endpoint_auth_method: "none" });
  }
  if (url.pathname === "/authorize") {
    const redirect = url.searchParams.get("redirect_uri") ?? "";
    const state = url.searchParams.get("state") ?? "";
    issuer.verifier = url.searchParams.get("code_challenge") ?? "";
    issuer.scope = url.searchParams.get("scope") ?? "";
    issuer.authorizeResource = url.searchParams.get("resource") ?? "";
    issuer.code = "code-fixture-" + Math.random().toString(36).slice(2, 8);
    const target = new URL(redirect);
    target.searchParams.set("code", issuer.code);
    target.searchParams.set("state", state);
    response.writeHead(302, { location: target.toString() });
    response.end();
    return;
  }
  if (url.pathname === "/token") {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const params = new URLSearchParams(body);
      const grant = params.get("grant_type");
      issuer.tokenResources.push(params.get("resource") ?? "");
      if (params.get("client_id") !== issuer.clientId) return json({ error: "invalid_client" }, 401);
      if (grant === "authorization_code") {
        if (params.get("code") !== issuer.code) return json({ error: "invalid_grant" }, 400);
        if (params.get("code_verifier") === null || params.get("code_verifier") === "") return json({ error: "invalid_request", error_description: "缺少 code_verifier" }, 400);
        return json({ access_token: "token-1", refresh_token: "refresh-1", token_type: "Bearer", expires_in: 3600, scope: "mcp.read" });
      }
      if (grant === "refresh_token") {
        if (params.get("refresh_token") !== "refresh-1") return json({ error: "invalid_grant" }, 400);
        issuer.refreshCount += 1;
        return json({ access_token: "token-2", token_type: "Bearer", expires_in: 3600 });
      }
      return json({ error: "unsupported_grant_type" }, 400);
    });
    return;
  }
  response.writeHead(404);
  response.end();
});
await new Promise((resolve) => idp.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + idp.address().port;

try {
  // 1. URL 规范化
  assert.equal(normalizeServerUrl("example.com/mcp/"), "https://example.com/mcp");
  assert.equal(normalizeServerUrl("http://127.0.0.1:1234/mcp"), "http://127.0.0.1:1234/mcp");
  pass("server url normalization");

  // 2. 发现文档
  const metadata = await discoverMetadata(origin);
  assert.equal(metadata.token_endpoint, origin + "/token");
  assert.equal(typeof metadata.registration_endpoint, "string");
  pass("discovers the authorization server metadata");

  // 3. 动态注册 + PKCE + 授权 URL
  const { verifier, challenge } = createPkce();
  assert.notEqual(verifier, challenge);
  assert.equal(challenge.length > 20, true);
  const loopback = await startLoopbackServer("state-fixture");
  const client = await registerClient(metadata, loopback.redirectUri);
  assert.equal(client.client_id, issuer.clientId);
  const resource = origin + "/mcp";
  const authUrl = buildAuthorizationUrl(metadata, client.client_id, loopback.redirectUri, challenge, "state-fixture", undefined, resource);
  assert.equal(authUrl.includes("code_challenge_method=S256"), true);
  assert.equal(authUrl.includes("scope=mcp.read+mcp.write"), true, "没给 scope 时用服务器声明的范围");
  assert.equal(new URL(authUrl).searchParams.get("resource"), resource, "授权 URL 要带 RFC 8707 resource");
  pass("registers a client, builds a PKCE authorization url with resource");

  // 4. 模拟浏览器走完授权：跟随 302 打到本地回调
  const authorizeResponse = await fetch(authUrl, { redirect: "manual" });
  assert.equal(authorizeResponse.status, 302);
  await fetch(authorizeResponse.headers.get("location"));
  const { code } = await loopback.waitForCode();
  assert.equal(code, issuer.code);
  assert.equal(issuer.authorizeResource, resource, "授权端点要收到 resource");
  await loopback.close();
  pass("loopback callback captures the authorization code");

  // 5. 换令牌 + 刷新
  const tokens = await exchangeCode(metadata, client.client_id, code, verifier, loopback.redirectUri, resource);
  assert.equal(tokens.accessToken, "token-1");
  assert.equal(tokens.refreshToken, "refresh-1");
  assert.equal(isExpired(tokens), false);
  assert.equal(isExpired(tokens, 3600 * 1000 * 2), true, "过期判定要支持提前量");
  assert.equal(authorizationHeader(tokens), "Bearer token-1");
  const refreshed = await refreshTokens(metadata, client.client_id, tokens.refreshToken, resource);
  assert.equal(refreshed.accessToken, "token-2");
  assert.equal(issuer.refreshCount, 1);
  assert.deepEqual(issuer.tokenResources, [resource, resource], "换令牌与刷新都要带 resource");
  assert.equal(refreshed.refreshToken, "refresh-1", "刷新响应没给新 refresh_token 时要沿用旧的");
  pass("exchanges the code and refreshes the token");
  const legacyFetch = async () => ({ ok: true, status: 200, json: async () => ({ access_token: "token-legacy", token_type: "Bearer" }) });
  const legacyTokens = await exchangeCode(metadata, client.client_id, code, verifier, loopback.redirectUri, legacyFetch);
  assert.equal(legacyTokens.accessToken, "token-legacy");
  pass("keeps the legacy fetchImpl argument working");

  // 6. 落盘：读写与断开
  const dir = await mkdtemp(join(tmpdir(), "dsh-panel-oauth-"));
  try {
    assert.deepEqual(await loadOAuthStore(dir), {});
    await saveOAuthRecord(dir, "demo", { ...tokens, clientId: client.client_id });
    const store = await loadOAuthStore(dir);
    assert.equal(store.demo.accessToken, "token-1");
    assert.equal(store.demo.clientId, client.client_id);
    await removeOAuthRecord(dir, "demo");
    assert.deepEqual(await loadOAuthStore(dir), {});
    pass("stores and clears oauth records");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  // 7. 状态不匹配的回调必须被拒绝（CSRF 防护）
  const guarded = await startLoopbackServer("expected-state", 5000);
  const bad = await fetch(guarded.redirectUri + "?code=x&state=wrong").then(
    () => "resolved",
    () => "rejected"
  );
  assert.equal(bad, "resolved", "HTTP 层仍要回 200，让浏览器看到一句人话");
  await assert.rejects(() => guarded.waitForCode(), /state 不匹配/);
  await guarded.close();
  pass("rejects a callback whose state does not match");
} finally {
  await new Promise((resolve) => idp.close(resolve));
}

// ── 发现顺序：路径形态 PRM 优先，兼容根形态与旧行为 ───────────────────────
await test("discovers root AS metadata for a pathed endpoint", async () => {
  const fx = await startDiscoveryFixture({
    "/.well-known/oauth-authorization-server": (_url, origin) => ({
      issuer: origin,
      token_endpoint: origin + "/token"
    })
  });
  try {
    const metadata = await discoverMetadata(fx.origin + "/mcp");
    assert.equal(metadata?.token_endpoint, fx.origin + "/token");
  } finally {
    await fx.close();
  }
});

await test("discovers AS metadata through RFC 9728 PRM", async () => {
  const fx = await startDiscoveryFixture({
    "/.well-known/oauth-protected-resource/sse": (_url, origin) => ({
      resource: origin + "/sse",
      authorization_servers: [origin + "/as"]
    }),
    "/.well-known/oauth-authorization-server/as": (_url, origin) => ({
      issuer: origin + "/as",
      token_endpoint: origin + "/as/token"
    })
  });
  try {
    const result = await discoverMetadataDetailed(fx.origin + "/sse");
    assert.equal(result.metadata?.token_endpoint, fx.origin + "/as/token");
    assert.equal(result.resource, fx.origin + "/sse");
  } finally {
    await fx.close();
  }
});

await test("hits the RFC 9728 path-form PRM first for a pathed endpoint", async () => {
  const fx = await startDiscoveryFixture({
    "/.well-known/oauth-protected-resource/mcp": (_url, origin) => ({
      resource: origin + "/mcp",
      authorization_servers: [origin]
    }),
    "/.well-known/oauth-authorization-server": (_url, origin) => ({
      issuer: origin,
      token_endpoint: origin + "/token"
    })
  });
  try {
    const result = await discoverMetadataDetailed(fx.origin + "/mcp");
    assert.equal(fx.requests[0], "/.well-known/oauth-protected-resource/mcp", "第一个请求必须是路径形态 PRM");
    assert.equal(result.metadata?.token_endpoint, fx.origin + "/token");
    assert.equal(result.resource, fx.origin + "/mcp");
    const prm = result.attempts.find((attempt) => attempt.url === fx.origin + "/.well-known/oauth-protected-resource/mcp");
    assert.equal(prm?.kind, "prm", "PRM 用 kind 记录，不占用 reason");
    assert.equal(prm?.reason, undefined, "成功的 PRM 不能写 reason");
    assert.match(prm?.note ?? "", /采用 PRM 的 resource/);
  } finally {
    await fx.close();
  }
});

await test("still discovers an origin-root AS for a pathed endpoint", async () => {
  const fx = await startDiscoveryFixture({
    "/.well-known/oauth-authorization-server": (_url, origin) => ({
      issuer: origin,
      token_endpoint: origin + "/token"
    })
  });
  try {
    const result = await discoverMetadataDetailed(fx.origin + "/mcp");
    assert.equal(result.metadata?.token_endpoint, fx.origin + "/token");
    assert.equal(result.resource, undefined, "没有 PRM 时 resource 交给调用方兜底");
    assert.deepEqual(fx.requests, [
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-authorization-server/mcp",
      "/.well-known/oauth-authorization-server"
    ]);
  } finally {
    await fx.close();
  }
});

await test("falls back to the legacy well-known path", async () => {
  const fx = await startDiscoveryFixture({
    "/mcp/.well-known/oauth-authorization-server": (_url, origin) => ({
      issuer: origin,
      token_endpoint: origin + "/token"
    })
  });
  try {
    const result = await discoverMetadataDetailed(fx.origin + "/mcp");
    assert.equal(result.metadata?.token_endpoint, fx.origin + "/token");
    // 第 7 个候选命中即返回，所以只记录了 7 次尝试（候选总数为 8，见 dedupe 用例）。
    assert.equal(result.attempts.length, 7);
    assert.equal(result.attempts[6].url, fx.origin + "/mcp/.well-known/oauth-authorization-server");
    assert.equal(result.attempts[6].status, 200);
    assert.equal(result.attempts[6].reason, undefined);
  } finally {
    await fx.close();
  }
});

await test("finds a legacy endpoint-path AS document when standard candidates 404", async () => {
  const fx = await startDiscoveryFixture({
    "/v1/mcp/.well-known/oauth-authorization-server": (_url, origin) => ({
      issuer: origin,
      token_endpoint: origin + "/token"
    })
  });
  try {
    const result = await discoverMetadataDetailed(fx.origin + "/v1/mcp");
    const legacyUrl = fx.origin + "/v1/mcp/.well-known/oauth-authorization-server";
    assert.equal(result.metadata?.token_endpoint, fx.origin + "/token");
    assert.ok(
      result.attempts.some((attempt) => attempt.url === legacyUrl),
      "legacy URL 必须出现在 attempts 里"
    );
    const successes = result.attempts.filter((attempt) => attempt.status === 200);
    assert.equal(successes.length, 1);
    assert.equal(successes[0].url, legacyUrl, "成功的必须是 legacy URL");
    assert.equal(successes[0].reason, undefined);
  } finally {
    await fx.close();
  }
});

await test("reports every attempted URL when all candidates 404", async () => {
  const fx = await startDiscoveryFixture({});
  try {
    const result = await discoverMetadataDetailed(fx.origin + "/mcp");
    assert.equal(result.metadata, undefined);
    assert.equal(result.attempts.length, 8);
    assert.ok(result.attempts.every((attempt) => attempt.status === 404 && attempt.reason === "HTTP 404"));
    const message = discoveryFailureMessage(result.attempts);
    assert.match(message, /已尝试：/);
    assert.equal(message.split("\n").filter((line) => line.startsWith("- ")).length, 8);
    assert.match(message, /oauth-protected-resource\/mcp/);
  } finally {
    await fx.close();
  }
});

await test("rejects metadata without token_endpoint", async () => {
  const fx = await startDiscoveryFixture({
    "/.well-known/oauth-authorization-server": (_url, origin) => ({ issuer: origin })
  });
  try {
    const result = await discoverMetadataDetailed(fx.origin);
    assert.equal(result.metadata, undefined);
    assert.equal(result.attempts[0].url, fx.origin + "/.well-known/oauth-protected-resource");
    assert.equal(result.attempts[1].url, fx.origin + "/.well-known/oauth-authorization-server");
    assert.equal(result.attempts[1].status, 200);
    assert.equal(result.attempts[1].reason, "缺少 token_endpoint");
  } finally {
    await fx.close();
  }
});

await test("rejects metadata whose issuer is on another origin", async () => {
  const fx = await startDiscoveryFixture({
    "/mcp/.well-known/oauth-authorization-server": (_url, origin) => ({
      issuer: "https://other.example.com",
      token_endpoint: origin + "/token"
    })
  });
  try {
    const result = await discoverMetadataDetailed(fx.origin + "/mcp");
    assert.equal(result.metadata, undefined);
    const legacyAs = result.attempts.find((attempt) => attempt.url === fx.origin + "/mcp/.well-known/oauth-authorization-server");
    assert.equal(legacyAs?.status, 200);
    assert.equal(legacyAs?.reason, "issuer 与发现地址不一致");
  } finally {
    await fx.close();
  }
});

await test("records a per-request timeout", async () => {
  const fx = await startDiscoveryFixture({
    "/.well-known/oauth-authorization-server": () => "hang"
  });
  const startedAt = Date.now();
  try {
    const result = await discoverMetadataDetailed(fx.origin, fetch, { timeoutMs: 50, budgetMs: 1000 });
    assert.equal(result.metadata, undefined);
    const timedOut = result.attempts.find((attempt) => attempt.url === fx.origin + "/.well-known/oauth-authorization-server");
    assert.equal(timedOut?.status, undefined);
    assert.equal(timedOut?.reason, "请求超时");
    assert.ok(Date.now() - startedAt < 2000);
  } finally {
    await fx.close();
  }
});

await test("ignores non-http authorization_servers", async () => {
  const fx = await startDiscoveryFixture({
    "/.well-known/oauth-protected-resource/sse": (_url, origin) => ({
      resource: origin + "/sse",
      authorization_servers: ["file:///etc/passwd"]
    })
  });
  try {
    const result = await discoverMetadataDetailed(fx.origin + "/sse");
    assert.equal(result.metadata, undefined);
    assert.equal(result.resource, undefined);
    assert.ok(result.attempts.every((attempt) => !attempt.url.startsWith("file:")));
    const prm = result.attempts.find((attempt) => attempt.url.endsWith("/.well-known/oauth-protected-resource/sse"));
    assert.equal(prm?.status, 200);
    assert.equal(prm?.kind, "prm");
    assert.equal(prm?.reason, "PRM 未找到可用的授权服务器元数据");
    assert.match(prm?.note ?? "", /采用 PRM 的 resource/);
  } finally {
    await fx.close();
  }
});

await test("ignores a cross-origin PRM resource and records why", async () => {
  const fx = await startDiscoveryFixture({
    "/.well-known/oauth-protected-resource/mcp": (_url, origin) => ({
      resource: "https://other.example/mcp",
      authorization_servers: [origin]
    }),
    "/.well-known/oauth-authorization-server": (_url, origin) => ({
      issuer: origin,
      token_endpoint: origin + "/token"
    })
  });
  try {
    const result = await discoverMetadataDetailed(fx.origin + "/mcp");
    assert.equal(result.metadata?.token_endpoint, fx.origin + "/token");
    assert.equal(result.resource, undefined, "跨 origin 的 PRM resource 必须忽略");
    const prm = result.attempts.find((attempt) => attempt.url === fx.origin + "/.well-known/oauth-protected-resource/mcp");
    assert.equal(prm?.kind, "prm");
    assert.match(prm?.note ?? "", /忽略 PRM 的 resource/);
    assert.match(prm?.note ?? "", /不同源/);
  } finally {
    await fx.close();
  }
});

await test("rejects PRM-driven AS metadata whose issuer path differs", async () => {
  const fx = await startDiscoveryFixture({
    "/.well-known/oauth-protected-resource/mcp": (_url, origin) => ({
      authorization_servers: [origin + "/t1"]
    }),
    "/.well-known/oauth-authorization-server/t1": (_url, origin) => ({
      issuer: origin + "/t2",
      token_endpoint: origin + "/t2/token"
    })
  });
  try {
    const result = await discoverMetadataDetailed(fx.origin + "/mcp");
    assert.equal(result.metadata, undefined);
    const asAttempt = result.attempts.find((attempt) => attempt.url === fx.origin + "/.well-known/oauth-authorization-server/t1");
    assert.equal(asAttempt?.status, 200);
    assert.equal(asAttempt?.reason, "issuer 不匹配（期望 " + fx.origin + "/t1，实际 " + fx.origin + "/t2）");
    const prm = result.attempts.find((attempt) => attempt.url === fx.origin + "/.well-known/oauth-protected-resource/mcp");
    assert.equal(prm?.reason, "PRM 未找到可用的授权服务器元数据");
  } finally {
    await fx.close();
  }
});

await test("accepts an exact issuer match ignoring a trailing slash", async () => {
  const fx = await startDiscoveryFixture({
    "/.well-known/oauth-protected-resource/mcp": (_url, origin) => ({
      authorization_servers: [origin + "/t1/"]
    }),
    "/.well-known/oauth-authorization-server/t1": (_url, origin) => ({
      issuer: origin + "/t1/",
      token_endpoint: origin + "/token"
    })
  });
  try {
    const result = await discoverMetadataDetailed(fx.origin + "/mcp");
    assert.equal(result.metadata?.token_endpoint, fx.origin + "/token");
  } finally {
    await fx.close();
  }
});

await test("rejects metadata without issuer for PRM-driven discovery", async () => {
  const fx = await startDiscoveryFixture({
    "/.well-known/oauth-protected-resource/mcp": (_url, origin) => ({
      authorization_servers: [origin + "/t1"]
    }),
    "/.well-known/oauth-authorization-server/t1": (_url, origin) => ({
      token_endpoint: origin + "/token"
    })
  });
  try {
    const result = await discoverMetadataDetailed(fx.origin + "/mcp");
    assert.equal(result.metadata, undefined);
    const asAttempt = result.attempts.find((attempt) => attempt.url === fx.origin + "/.well-known/oauth-authorization-server/t1");
    assert.equal(asAttempt?.status, 200);
    assert.equal(asAttempt?.reason, "缺少 issuer（期望 " + fx.origin + "/t1）");
  } finally {
    await fx.close();
  }
});

await test("accepts metadata without issuer for direct discovery", async () => {
  const fx = await startDiscoveryFixture({
    "/.well-known/oauth-authorization-server": (_url, origin) => ({
      token_endpoint: origin + "/token"
    })
  });
  try {
    const result = await discoverMetadataDetailed(fx.origin);
    assert.equal(result.metadata?.token_endpoint, fx.origin + "/token");
    const asAttempt = result.attempts.find((attempt) => attempt.url === fx.origin + "/.well-known/oauth-authorization-server");
    assert.equal(asAttempt?.status, 200);
    assert.equal(asAttempt?.kind, "as");
    assert.match(asAttempt?.note ?? "", /未声明 issuer/);
  } finally {
    await fx.close();
  }
});

await test("never emits query-bearing discovery candidates", async () => {
  const candidates = discoveryCandidates("https://h.example/mcp?tenant=a#frag");
  assert.equal(candidates.length, 8);
  assert.ok(candidates.every((url) => !url.includes("?") && !url.includes("#")));
  assert.deepEqual(candidates, [
    "https://h.example/.well-known/oauth-protected-resource/mcp",
    "https://h.example/.well-known/oauth-protected-resource",
    "https://h.example/.well-known/oauth-authorization-server/mcp",
    "https://h.example/.well-known/oauth-authorization-server",
    "https://h.example/.well-known/openid-configuration/mcp",
    "https://h.example/.well-known/openid-configuration",
    "https://h.example/mcp/.well-known/oauth-authorization-server",
    "https://h.example/mcp/.well-known/openid-configuration"
  ]);
  const seen = [];
  const result = await discoverMetadataDetailed(
    "https://h.example/mcp?tenant=a",
    async (url) => {
      seen.push(url);
      return { ok: false, status: 404, json: async () => ({}) };
    },
    { timeoutMs: 100, budgetMs: 2000 }
  );
  assert.equal(result.metadata, undefined);
  assert.equal(seen.length, 8);
  assert.ok(seen.every((url) => !url.includes("?")), "发出去的请求不能带配置里的 query");
});

await test("deduplicates candidates without a path", async () => {
  const origin = "https://example.com";
  const candidates = discoveryCandidates(origin);
  assert.equal(candidates.length, 3);
  assert.equal(new Set(candidates).size, 3);
  assert.deepEqual(candidates, [
    origin + "/.well-known/oauth-protected-resource",
    origin + "/.well-known/oauth-authorization-server",
    origin + "/.well-known/openid-configuration"
  ]);
  const pathed = discoveryCandidates(origin + "/mcp");
  assert.equal(pathed.length, 8);
  assert.equal(new Set(pathed).size, 8);
  assert.deepEqual(discoveryCandidates(origin + "/"), candidates, "path 为 / 时与空 path 一样去重");
  assert.deepEqual(discoveryCandidates(origin + "/mcp/"), pathed, "结尾斜杠不影响候选");
});

await test("resolves a relative issuer from PRM", async () => {
  const fx = await startDiscoveryFixture({
    "/.well-known/oauth-protected-resource/sse": (_url, origin) => ({
      resource: origin + "/sse",
      authorization_servers: ["/as"]
    }),
    "/.well-known/oauth-authorization-server/as": (_url, origin) => ({
      issuer: origin + "/as",
      token_endpoint: origin + "/as/token"
    })
  });
  try {
    const result = await discoverMetadataDetailed(fx.origin + "/sse");
    assert.equal(result.metadata?.token_endpoint, fx.origin + "/as/token");
    assert.equal(result.resource, fx.origin + "/sse");
  } finally {
    await fx.close();
  }
});

console.log("\n" + passed + " passed, " + failed + " failed");
if (failed === 0) console.log("ALL OAUTH TESTS PASSED");
else process.exitCode = 1;
