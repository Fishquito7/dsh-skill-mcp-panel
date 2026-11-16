import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { probeMcpServer } from "../lib/mcp/probe.js";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const fixture = fileURLToPath(new URL("./mcp-server-fixture.mjs", import.meta.url));
const ok = await probeMcpServer({
  serverName: "fixture",
  transport: "stdio",
  command: process.execPath,
  args: [fixture]
});
assert.equal(ok.ok, true, ok.error);
assert.equal(ok.tools.length, 1);
assert.equal(ok.tools[0].name, "hello");
pass("stdio probe discovers fixture tool");

const bad = await probeMcpServer({
  serverName: "missing",
  transport: "stdio",
  command: process.execPath,
  args: [fixture + ".missing"]
});
assert.equal(bad.ok, false);
assert.equal(bad.tools.length, 0);
assert.ok(bad.error);
pass("stdio probe reports spawn failure");

const invalid = await probeMcpServer({ serverName: "bad/name", transport: "stdio", command: "node" });
assert.equal(invalid.ok, false);
assert.match(invalid.error ?? "", /配置无效/);
pass("probe rejects invalid input without connecting");

// !!js 表达式在连接前求值：能求出来就照常连，求不出来要给可读原因，
// 绝不能把表达式原文当成命令/令牌发给服务器。
const exprOk = await probeMcpServer({
  serverName: "expr-ok",
  transport: "stdio",
  command: { __jsExpr: "process.execPath" },
  args: [fixture],
  env: { DSH_PANEL_PROBE: { __jsExpr: "process.env.DSH_PANEL_PROBE_MARK" } }
});
assert.equal(exprOk.ok, true, exprOk.error);
assert.equal(exprOk.tools.length, 1);
pass("stdio probe evaluates !!js expressions before connecting");

const emptyExpr = await probeMcpServer({
  serverName: "expr-empty",
  transport: "stdio",
  command: { __jsExpr: "process.env.DSH_PANEL_MISSING_COMMAND" }
});
assert.equal(emptyExpr.ok, false);
assert.match(emptyExpr.error ?? "", /!!js 表达式/);
pass("probe reports a readable error when a !!js expression resolves to nothing");

const brokenExpr = await probeMcpServer({
  serverName: "expr-broken",
  transport: "stdio",
  command: { __jsExpr: "process.env[" }
});
assert.equal(brokenExpr.ok, false);
assert.match(brokenExpr.error ?? "", /求值失败/);
pass("probe reports evaluation failures instead of sending the raw text");

// #94：${credential:REF} 模板展开、优先级、未配置提示、未启用提示与错误脱敏
const tmpProbeDir = await mkdtemp(join(tmpdir(), "dsh-panel-probe-cred-"));
try {
  const probeHome = join(tmpProbeDir, "home");
  const probeCwd = join(tmpProbeDir, "proj");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(probeHome, { recursive: true });
  await mkdir(probeCwd, { recursive: true });
  await writeFile(join(probeHome, ".credentials.yaml"), "version: 1\nrefs:\n  YAML_TOK: yaml-secret-alpha-1234\n  HTTP_KEY: super-secret-http-9999\n", "utf8");
  await writeFile(join(probeCwd, ".env"), "CWD_TOK=cwd-secret-beta-5678\n", "utf8");

  const credOk = await probeMcpServer(
    {
      serverName: "cred-stdio",
      transport: "stdio",
      command: process.execPath,
      args: [fixture],
      env: { ONE: "${credential:YAML_TOK}", TWO: "${credential:CWD_TOK}" },
      expandTemplates: true
    },
    { dshHome: probeHome, cwd: probeCwd }
  );
  assert.equal(credOk.ok, true, credOk.error);
  pass("probe resolves ${credential:REF} from .credentials.yaml and .env when expandTemplates=true (#94)");

  const notExpanded = await probeMcpServer({
    serverName: "cred-disabled",
    transport: "stdio",
    command: process.execPath,
    args: [fixture],
    env: { ONE: "${credential:YAML_TOK}" }
  }, { dshHome: probeHome, cwd: probeCwd });
  assert.equal(notExpanded.ok, false);
  assert.match(notExpanded.error ?? "", /expandTemplates/);
  pass("probe rejects unexpanded ${credential:REF} with an actionable expandTemplates error (#94)");

  const missingCred = await probeMcpServer({
    serverName: "cred-missing",
    transport: "stdio",
    command: process.execPath,
    args: [fixture],
    env: { ONE: "${credential:NOT_CONFIGURED_XYZ}" },
    expandTemplates: true
  }, { dshHome: probeHome, cwd: probeCwd });
  assert.equal(missingCred.ok, false);
  assert.match(missingCred.error ?? "", /NOT_CONFIGURED_XYZ/);
  pass("probe reports missing credential ref names before connecting (#94)");

  // HTTP 脱敏测试：服务器把 Authorization 头原文回显进错误响应体时，错误文案不能泄露密钥
  let seenAuth = "";
  const srv = createServer((req, res) => {
    seenAuth = String(req.headers.authorization ?? "");
    res.statusCode = 401;
    res.end("Unauthorized token=" + seenAuth);
  });
  await new Promise((resolveListen) => srv.listen(0, "127.0.0.1", resolveListen));
  try {
    const port = srv.address().port;
    const redactedRes = await probeMcpServer(
      {
        serverName: "cred-http-redact",
        transport: "streamable-http",
        url: "http://127.0.0.1:" + port + "/mcp?k=${credential:HTTP_KEY}",
        headers: { Authorization: "Bearer ${credential:HTTP_KEY}" },
        expandTemplates: true
      },
      { dshHome: probeHome, cwd: probeCwd, timeoutMs: 3000 }
    );
    assert.equal(redactedRes.ok, false);
    assert.equal(seenAuth, "Bearer super-secret-http-9999", "server must receive expanded credential header");
    assert.equal((redactedRes.error ?? "").includes("super-secret-http-9999"), false, "secret value must be redacted from probe errors");
    pass("probe expands HTTP credentials and redacts resolved secrets on failure (#94)");
  } finally {
    await new Promise((resolveClose) => srv.close(resolveClose));
  }
} finally {
  await rm(tmpProbeDir, { recursive: true, force: true });
}
console.log("\n" + passed + " passed, 0 failed");
console.log("ALL MCP PROBE TESTS PASSED");
