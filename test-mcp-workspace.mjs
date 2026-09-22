/**
 * test-mcp-workspace.mjs —— 工作区 MCP 声明文件（<projectRoot>/.dsh/mcp.json）。
 *
 * 覆盖：路径约定、读写往返、缺失=空、损坏=报错、schema 默认值、
 * 以及"永不存密钥值"的结构性保证（文件里只有键名与引用名）。
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readWorkspaceServers,
  validateWorkspaceServer,
  workspaceMcpFile,
  workspaceMcpServerSchema,
  writeWorkspaceServers
} from "./lib/mcp/workspace-store.js";

let passed = 0;
let failed = 0;
function check(cond, label) {
  if (cond) {
    passed += 1;
    console.log("PASS  " + label);
  } else {
    failed += 1;
    console.log("FAIL  " + label);
  }
}

const root = await mkdtemp(join(tmpdir(), "dsh-panel-wsmcp-"));
try {
  // 1. 路径约定
  check(workspaceMcpFile("D:\\proj") === join("D:\\proj", ".dsh", "mcp.json"), "workspaceMcpFile 落在 <root>/.dsh/mcp.json");

  // 2. 文件不存在 = 该工作区没有工作区级 MCP（不是错误）
  const absent = await readWorkspaceServers(root);
  check(absent.ok === true && absent.servers.length === 0, "缺失文件读作空且 ok");

  // 3. 读写往返（含 schema 默认值）
  const server = workspaceMcpServerSchema.parse({
    serverName: "comfyui",
    transport: "stdio",
    command: "node",
    args: ["server.js"],
    envKeys: ["COMFYUI_URL"]
  });
  check(server.enabled === true, "enabled 默认 true");
  check(server.toolCallTimeoutMs === 60000, "toolCallTimeoutMs 默认 60000");
  check(server.reconnect.enabled === true && server.reconnect.maxAttempts === 10, "reconnect 默认值填充");
  check(server.headerRefs !== undefined && Object.keys(server.headerRefs).length === 0, "headerRefs 默认空对象");

  await writeWorkspaceServers(root, [server]);
  const read = await readWorkspaceServers(root);
  check(read.ok === true && read.servers.length === 1, "写回后能读回 1 条");
  check(read.servers[0].serverName === "comfyui" && read.servers[0].envKeys[0] === "COMFYUI_URL", "读回内容一致");

  // 4. 结构保证：文件里没有任何值字段
  const raw = await readFile(workspaceMcpFile(root), "utf8");
  const parsed = JSON.parse(raw);
  check(parsed.version === 1, "写入文件头 version=1（迁移的唯一钩子）");
  check(!/"(env|headers)"\s*:/.test(raw), "文件里没有 env/headers 值字段");
  check(/"envKeys"/.test(raw) && /"headerRefs"/.test(raw), "只有 envKeys/headerRefs 键名形态");

  // 5. 损坏文件 → ok:false 且带原因（不抛）
  await writeFile(workspaceMcpFile(root), "{ not json", "utf8");
  const broken = await readWorkspaceServers(root);
  check(broken.ok === false && typeof broken.error === "string" && broken.error.length > 0, "损坏文件报 ok:false 且带原因");

  // 6. 结构非法（serverName 不合规）也报 ok:false
  await writeFile(workspaceMcpFile(root), JSON.stringify({ version: 1, servers: [{ serverName: "bad name!", transport: "stdio" }] }), "utf8");
  const invalid = await readWorkspaceServers(root);
  check(invalid.ok === false, "结构非法报 ok:false");

  // 7. validateWorkspaceServer 的各种问题
  const okServer = workspaceMcpServerSchema.parse({ serverName: "x", transport: "stdio", command: "node", envKeys: ["A_B"], headerRefs: { "X-Api-Key": "MCP_X_X_API_KEY" } });
  check(validateWorkspaceServer(okServer).length === 0, "合法声明无问题");

  const badRef = workspaceMcpServerSchema.parse({ serverName: "x", transport: "stdio", command: "node", envKeys: ["9-bad"] });
  check(validateWorkspaceServer(badRef).length === 1, "非法 env 引用名被拒");

  const noCommand = workspaceMcpServerSchema.parse({ serverName: "x", transport: "stdio", command: "" });
  check(validateWorkspaceServer(noCommand).length === 1, "stdio 缺 command 被拒");

  const noUrl = workspaceMcpServerSchema.parse({ serverName: "x", transport: "streamable-http", url: "" });
  check(validateWorkspaceServer(noUrl).length === 1, "http 缺 url 被拒");

  const badHeader = workspaceMcpServerSchema.parse({ serverName: "x", transport: "streamable-http", url: "https://e.com", headerRefs: { "X-A": "1bad" } });
  check(validateWorkspaceServer(badHeader).length === 1, "非法 header 引用名被拒");

  const emptyHeader = workspaceMcpServerSchema.parse({ serverName: "x", transport: "streamable-http", url: "https://e.com", headerRefs: { "  ": "OK_REF" } });
  check(validateWorkspaceServer(emptyHeader).length === 1, "空 header 名被拒");

  // 8. 写空数组 = 该工作区没有声明
  await writeWorkspaceServers(root, []);
  const emptied = await readWorkspaceServers(root);
  check(emptied.ok === true && emptied.servers.length === 0, "写空数组后读作空");
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("\n" + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
console.log("ALL MCP WORKSPACE STORE TESTS PASSED");