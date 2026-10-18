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
  exchangeCode,
  isExpired,
  loadOAuthStore,
  normalizeServerUrl,
  refreshTokens,
  registerClient,
  removeOAuthRecord,
  saveOAuthRecord,
  startLoopbackServer
} from "./lib/oauth.js";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

// ── 假 IdP：把 RFC 6749 / 7591 / 8414 里我们真正用到的几步做出来 ──────────
const issuer = { clientId: undefined, code: undefined, verifier: undefined, refreshCount: 0, scope: undefined };
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
  const authUrl = buildAuthorizationUrl(metadata, client.client_id, loopback.redirectUri, challenge, "state-fixture");
  assert.equal(authUrl.includes("code_challenge_method=S256"), true);
  assert.equal(authUrl.includes("scope=mcp.read+mcp.write"), true, "没给 scope 时用服务器声明的范围");
  pass("registers a client, builds a PKCE authorization url");

  // 4. 模拟浏览器走完授权：跟随 302 打到本地回调
  const authorizeResponse = await fetch(authUrl, { redirect: "manual" });
  assert.equal(authorizeResponse.status, 302);
  await fetch(authorizeResponse.headers.get("location"));
  const { code } = await loopback.waitForCode();
  assert.equal(code, issuer.code);
  await loopback.close();
  pass("loopback callback captures the authorization code");

  // 5. 换令牌 + 刷新
  const tokens = await exchangeCode(metadata, client.client_id, code, verifier, loopback.redirectUri);
  assert.equal(tokens.accessToken, "token-1");
  assert.equal(tokens.refreshToken, "refresh-1");
  assert.equal(isExpired(tokens), false);
  assert.equal(isExpired(tokens, 3600 * 1000 * 2), true, "过期判定要支持提前量");
  assert.equal(authorizationHeader(tokens), "Bearer token-1");
  const refreshed = await refreshTokens(metadata, client.client_id, tokens.refreshToken);
  assert.equal(refreshed.accessToken, "token-2");
  assert.equal(issuer.refreshCount, 1);
  assert.equal(refreshed.refreshToken, "refresh-1", "刷新响应没给新 refresh_token 时要沿用旧的");
  pass("exchanges the code and refreshes the token");

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

console.log("\n" + passed + " passed, 0 failed");
console.log("ALL OAUTH TESTS PASSED");
