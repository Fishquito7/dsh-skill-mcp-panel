import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { McpManagerGateway } from "./lib/mcp/gateway.js";
import { mcpListResultSchema, mcpWorkspaceSavePayloadSchema } from "./lib/mcp/wire.js";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const dir = await mkdtemp(join(tmpdir(), "dsh-panel-gateway-"));
try {
  await writeFile(join(dir, "cordis.patch.yml"), "# profile\n[]\n");
  const ctx = new Context();
  ctx.baseUrl = pathToFileURL(dir).href + "/";
  ctx.provide("loader", {
    entries: function* () {
      yield { id: "panel-mcp-demo", disabled: true, fiber: undefined, options: { name: "@deepseek-ai/dsh-mcp-client" } };
    }
  });
  ctx.provide("tools", {
    schemas() {
      return [];
    }
  });
  // 假凭证 provider：记录 set/unset，用于证明「值进凭证存储、文件只留键名」。
  const credentialCalls = [];
  ctx.provide("credentials", {
    async set(ref, value) {
      credentialCalls.push({ op: "set", ref: String(ref), value });
    },
    async unset(ref) {
      credentialCalls.push({ op: "unset", ref: String(ref) });
    },
    async resolve() {
      return undefined;
    },
    async describe() {
      return { configured: false, writable: true };
    }
  });
  const gateway = new McpManagerGateway(ctx);

  // 1. list empty
  const empty = await gateway.list();
  assert.equal(empty.patch.ok, true);
  assert.equal(empty.servers.length, 0);
  assert.equal(empty.externalServers.length, 0);
  pass("gateway lists empty patch");

  // 2. save disabled row (fake loader already reports matching entry)
  const saved = await gateway.save({
    input: { serverName: "demo", transport: "stdio", command: "node" },
    enabled: false
  });
  assert.equal(saved.server.serverName, "demo");
  assert.equal(saved.server.enabled, false);
  assert.equal(saved.server.toolCount, 0);
  assert.equal(saved.reconciled, true);
  const onDisk = await readFile(join(dir, "cordis.patch.yml"), "utf8");
  assert.match(onDisk, /panel-mcp-demo/);
  assert.match(onDisk, /serverName: demo/);
  pass("gateway save writes managed block and decorates row");

  // 3. list sees managed row
  const after = await gateway.list();
  assert.equal(after.servers.length, 1);
  assert.equal(after.servers[0].serverName, "demo");
  assert.equal(after.servers[0].fiberPhase, null);
  const parsed = mcpListResultSchema.parse(after);
  assert.equal(JSON.stringify(parsed).includes("undefined"), false);
  assert.equal(JSON.stringify(parsed).includes("url"), false); // stdio view must not carry undefined optional fields
  pass("gateway list validates at the Typert JSON boundary");

  // ── 工作区作用域（<projectRoot>/.dsh/mcp.json）────────────────────────────
  const workspace = await mkdtemp(join(tmpdir(), "dsh-panel-ws-"));
  try {
    await mkdir(join(workspace, ".git"), { recursive: true });

    // 4. 空工作区
    const wsEmpty = await gateway.workspaceList({ scope: workspace });
    assert.equal(wsEmpty.workspace.ok, true);
    assert.equal(wsEmpty.workspace.servers.length, 0);
    assert.equal(wsEmpty.workspace.conflicts.length, 0);
    pass("workspaceList reads an empty workspace");

    // 5. 保存：值与全局同形地随 input 送达 → 值进凭证存储，文件只留键名
    const savedWs = await gateway.workspaceSave({
      scope: workspace,
      input: { serverName: "example", transport: "stdio", command: "node", args: ["s.js"], env: { MY_API_KEY: "secret-value" } }
    });
    assert.equal(savedWs.workspace.servers.length, 1);
    assert.equal(savedWs.workspace.servers[0].serverName, "example");
    assert.deepEqual([...savedWs.workspace.servers[0].envKeys], ["MY_API_KEY"]);
    const wsOnDisk = await readFile(join(workspace, ".dsh", "mcp.json"), "utf8");
    assert.equal(wsOnDisk.includes("secret-value"), false, "值绝不能落进工作区文件");
    assert.equal(/"env"\s*:/.test(wsOnDisk), false);
    assert.equal(/"headers"\s*:/.test(wsOnDisk), false);
    assert.deepEqual(credentialCalls, [{ op: "set", ref: "MY_API_KEY", value: "secret-value" }]);
    pass("workspaceSave routes values to the credential store, file stays name-only");

    // 6. http：header 名 → 派生引用名；值同样进凭证存储
    credentialCalls.length = 0;
    const savedHttp = await gateway.workspaceSave({
      scope: workspace,
      input: { serverName: "remote", transport: "streamable-http", url: "https://example.com/mcp", headers: { "X-Api-Key": "k-1" } }
    });
    const httpView = savedHttp.workspace.servers.find((item) => item.serverName === "remote");
    assert.deepEqual([...httpView.headerKeys], ["X-Api-Key"]);
    // 派生出来的引用名记在文件里（视图只回 header 名，引用名不在 wire 上）
    const httpOnDisk = JSON.parse(await readFile(join(workspace, ".dsh", "mcp.json"), "utf8"));
    const httpRow = httpOnDisk.servers.find((item) => item.serverName === "remote");
    assert.equal(httpRow.headerRefs["X-Api-Key"], "MCP_REMOTE_X_API_KEY");
    assert.deepEqual(credentialCalls, [{ op: "set", ref: "MCP_REMOTE_X_API_KEY", value: "k-1" }]);
    pass("workspaceSave derives header reference names and stores their values");

    // 6b. 编辑：null 删键 + unset；未出现的键保留且不动凭证存储
    credentialCalls.length = 0;
    const edited = await gateway.workspaceSave({
      scope: workspace,
      input: { serverName: "example", transport: "stdio", command: "node2", args: [], env: { MY_API_KEY: null, EXTRA_KEY: "v2" } },
      previousServerName: "example"
    });
    const editedView = edited.workspace.servers.find((item) => item.serverName === "example");
    assert.deepEqual([...editedView.envKeys], ["EXTRA_KEY"], "null 的键被删、新键被加");
    assert.equal(editedView.command, "node2");
    assert.deepEqual(credentialCalls, [
      { op: "unset", ref: "MY_API_KEY" },
      { op: "set", ref: "EXTRA_KEY", value: "v2" }
    ]);
    credentialCalls.length = 0;
    const kept = await gateway.workspaceSave({
      scope: workspace,
      input: { serverName: "example", transport: "stdio", command: "node3", args: [] },
      previousServerName: "example"
    });
    assert.deepEqual([...kept.workspace.servers.find((item) => item.serverName === "example").envKeys], ["EXTRA_KEY"], "未出现的键保留在声明里");
    assert.deepEqual(credentialCalls, [], "未出现的键不动凭证存储");
    pass("workspaceSave applies null-deletes and keeps absent keys");

    // 7. 与全局同名 → 拒绝写入
    let conflictRejected = false;
    try {
      await gateway.workspaceSave({ scope: workspace, input: { serverName: "demo", transport: "stdio", command: "node" } });
    } catch (error) {
      conflictRejected = /全局作用域/.test(String(error?.message ?? error));
    }
    assert.equal(conflictRejected, true);
    pass("workspaceSave refuses a serverName already owned by the global scope");

    // 8. 非法引用名 → 拒绝，且**不产生任何凭证写副作用**
    credentialCalls.length = 0;
    let invalidRejected = false;
    try {
      await gateway.workspaceSave({ scope: workspace, input: { serverName: "bad", transport: "stdio", command: "node", env: { "9-bad": "v" } } });
    } catch (error) {
      invalidRejected = /不是合法凭证引用名/.test(String(error?.message ?? error));
    }
    assert.equal(invalidRejected, true);
    assert.deepEqual(credentialCalls, [], "非法声明不得先写凭证再报错");
    pass("workspaceSave refuses an invalid credential reference name before any write");

    // 9. 启停 + 删除
    const disabled = await gateway.workspaceSetEnabled({ scope: workspace, serverName: "example", enabled: false });
    assert.equal(disabled.workspace.servers.find((item) => item.serverName === "example").enabled, false);
    const removed = await gateway.workspaceRemoveServer({ scope: workspace, serverName: "example" });
    assert.equal(removed.workspace.servers.some((item) => item.serverName === "example"), false);
    pass("workspaceSetEnabled and workspaceRemoveServer mutate the declaration file");

    // 10. workspaceTest 对缺 provider 的声明给出可读错误而不是抛
    const tested = await gateway.workspaceTest({ scope: workspace, serverName: "remote" });
    assert.equal(typeof tested.ok, "boolean");
    assert.equal(Array.isArray(tested.tools), true);
    pass("workspaceTest resolves credentials and probes without throwing");

    // 11. 不存在的 serverName / 不存在的工作区都报错
    let missing = false;
    try {
      await gateway.workspaceTest({ scope: workspace, serverName: "nope" });
    } catch {
      missing = true;
    }
    assert.equal(missing, true);
    let badScope = false;
    try {
      await gateway.workspaceList({ scope: join(workspace, "does-not-exist") });
    } catch {
      badScope = true;
    }
    assert.equal(badScope, false, "workspaceList 对不存在的工作区返回 ok:false 而不抛");
    pass("workspace* report missing servers and bad scopes");

    // 12. 面板真正发出的 payload 必须原样通过 strict codec（UI↔host 的接缝）
    //     形状与全局 save 完全一致：input 里带值（由宿主拆分），不再有 server/headerKeys
    credentialCalls.length = 0;
    const clientStdioPayload = {
      scope: workspace,
      input: {
        serverName: "frompanel",
        transport: "stdio",
        command: "node",
        args: ["server.js"],
        env: { MY_API_KEY: "from-panel" },
        toolCallTimeoutMs: 60000,
        failOnStartupError: false,
        reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 }
      }
    };
    const parsedStdio = mcpWorkspaceSavePayloadSchema.parse(clientStdioPayload);
    assert.equal(parsedStdio.input.cwd, "", "缺少 cwd 时由 schema 默认补空串");
    assert.equal("server" in parsedStdio, false, "旧的声明形字段已不在契约里");
    const savedFromPanel = await gateway.workspaceSave(clientStdioPayload);
    const panelStdioView = savedFromPanel.workspace.servers.find((item) => item.serverName === "frompanel");
    assert.deepEqual([...panelStdioView.envKeys], ["MY_API_KEY"]);
    assert.deepEqual(credentialCalls, [{ op: "set", ref: "MY_API_KEY", value: "from-panel" }]);
    pass("workspaceSave accepts exactly what the panel sends (stdio)");

    // 13. http：headers 里的值同样由宿主分流
    credentialCalls.length = 0;
    const clientHttpPayload = {
      scope: workspace,
      input: {
        serverName: "panelhttp",
        transport: "streamable-http",
        url: "https://example.com/mcp",
        headers: { "X-Api-Key": "k1", Authorization: "Bearer t1" },
        toolCallTimeoutMs: 60000,
        failOnStartupError: false,
        reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 }
      }
    };
    const savedHttpFromPanel = await gateway.workspaceSave(clientHttpPayload);
    const panelHttpView = savedHttpFromPanel.workspace.servers.find((item) => item.serverName === "panelhttp");
    assert.deepEqual([...panelHttpView.headerKeys], ["X-Api-Key", "Authorization"]);
    const panelHttpOnDisk = JSON.parse(await readFile(join(workspace, ".dsh", "mcp.json"), "utf8"));
    const panelHttpRow = panelHttpOnDisk.servers.find((item) => item.serverName === "panelhttp");
    assert.equal(panelHttpRow.headerRefs["X-Api-Key"], "MCP_PANELHTTP_X_API_KEY");
    assert.equal(panelHttpRow.headerRefs.Authorization, "MCP_PANELHTTP_AUTHORIZATION");
    assert.deepEqual(credentialCalls, [
      { op: "set", ref: "MCP_PANELHTTP_X_API_KEY", value: "k1" },
      { op: "set", ref: "MCP_PANELHTTP_AUTHORIZATION", value: "Bearer t1" }
    ]);
    pass("workspaceSave accepts exactly what the panel sends (http)");

    // 14. 改名路径：previousServerName 让旧条目被替换而不是留下两条
    const renamed = await gateway.workspaceSave({
      scope: workspace,
      input: { ...clientStdioPayload.input, serverName: "renamed", env: {} },
      previousServerName: "frompanel"
    });
    const names = renamed.workspace.servers.map((item) => item.serverName);
    assert.equal(names.includes("frompanel"), false, "改名后旧条目消失");
    assert.equal(names.includes("renamed"), true, "改名后新条目存在");
    pass("workspaceSave rename replaces the previous entry");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log("\n" + passed + " passed, 0 failed");
console.log("ALL MCP GATEWAY TESTS PASSED");
