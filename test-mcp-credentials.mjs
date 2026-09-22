/**
 * test-mcp-credentials.mjs —— 工作区 MCP 的凭证解析。
 *
 * 用假的 CredentialProvider（与 test-mcp-gateway.mjs 里 ctx.provide 假件同一风格）
 * 验证：值只从 seam 解析出来、缺值不阻断挂载、文法错误被拒、provider 抛错被收敛。
 */
import assert from "node:assert/strict";
import { deriveHeaderRefs, loadCredentialSeam, resolveWorkspaceServer } from "./lib/mcp/credential-env.js";
import { workspaceMcpServerSchema } from "./lib/mcp/workspace-store.js";

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

/** 假 provider：只认给定的字典，`boom` 键抛错。 */
function fakeProvider(values) {
  return {
    calls: [],
    async resolve(ref) {
      this.calls.push(String(ref));
      if (String(ref) === "BOOM") throw new Error("provider exploded");
      const value = values[String(ref)];
      return typeof value === "string" && value !== "" ? { value, source: "file" } : undefined;
    }
  };
}

// 1. stdio：envKeys 解析成明文进 config.env
{
  const server = workspaceMcpServerSchema.parse({
    serverName: "comfyui",
    transport: "stdio",
    command: "node",
    args: ["server.js"],
    envKeys: ["COMFYUI_URL", "COMFY_BIN"]
  });
  const provider = fakeProvider({ COMFYUI_URL: "http://127.0.0.1:8188", COMFY_BIN: "C:\\comfy.exe" });
  const resolved = await resolveWorkspaceServer(server, provider);
  check(resolved.input !== undefined, "stdio 声明解析成功");
  check(resolved.input.env.COMFYUI_URL === "http://127.0.0.1:8188", "env 值来自凭证 seam");
  check(resolved.input.env.COMFY_BIN === "C:\\comfy.exe", "第二个 env 键同样解析");
  check(resolved.missing.length === 0 && resolved.invalid.length === 0, "无缺失、无非法");
  check(provider.calls.length === 2, "每个引用只解析一次");
}

// 2. 缺值不阻断：仍产出 input，只记 missing
{
  const server = workspaceMcpServerSchema.parse({ serverName: "x", transport: "stdio", command: "node", envKeys: ["UNSET_REF"] });
  const resolved = await resolveWorkspaceServer(server, fakeProvider({}));
  check(resolved.input !== undefined, "缺值仍产出可挂载 input");
  check(resolved.missing.length === 1 && resolved.missing[0] === "UNSET_REF", "缺失引用被记录");
}

// 3. provider 缺失（宿主未装官方 seam）：全部记 missing，不抛
{
  const server = workspaceMcpServerSchema.parse({ serverName: "x", transport: "stdio", command: "node", envKeys: ["A_KEY"] });
  const resolved = await resolveWorkspaceServer(server, undefined);
  check(resolved.input !== undefined && resolved.missing[0] === "A_KEY", "无 provider 时记 missing 且不抛");
}

// 4. provider 抛错 → 收敛成 invalid，不影响其余键
{
  const server = workspaceMcpServerSchema.parse({ serverName: "x", transport: "stdio", command: "node", envKeys: ["BOOM", "COMFYUI_URL"] });
  const resolved = await resolveWorkspaceServer(server, fakeProvider({ COMFYUI_URL: "http://x" }));
  check(resolved.invalid.length === 1, "provider 抛错被收敛为 invalid");
  check(resolved.input.env.COMFYUI_URL === "http://x", "其余键照常解析");
}

// 5. http：headerRefs 解析成 headers
{
  const server = workspaceMcpServerSchema.parse({
    serverName: "remote",
    transport: "streamable-http",
    url: "https://example.com/mcp",
    headerRefs: { "X-Api-Key": "MCP_REMOTE_X_API_KEY", Authorization: "REMOTE_AUTH" }
  });
  const provider = fakeProvider({ MCP_REMOTE_X_API_KEY: "k-123", REMOTE_AUTH: "Bearer t" });
  const resolved = await resolveWorkspaceServer(server, provider);
  check(resolved.input !== undefined, "http 声明解析成功");
  check(resolved.input.headers["X-Api-Key"] === "k-123", "header 值按映射填充");
  check(resolved.input.headers.Authorization === "Bearer t", "第二个 header 同样填充");
}

// 6. 文法非法的引用名被拒（不进入 resolve）
{
  const server = workspaceMcpServerSchema.parse({ serverName: "x", transport: "stdio", command: "node", envKeys: ["ok_REF"] });
  server.envKeys = ["9-bad"];
  const provider = fakeProvider({ "9-bad": "v" });
  const resolved = await resolveWorkspaceServer(server, provider);
  check(resolved.invalid.length === 1, "非法引用名被拒");
  check(provider.calls.length === 0, "非法引用名不会去问 provider");
}

// 7. schema 兜底：stdio 缺 command 时给出 error 而不是抛
{
  const server = workspaceMcpServerSchema.parse({ serverName: "x", transport: "stdio", command: "" });
  const resolved = await resolveWorkspaceServer(server, fakeProvider({}));
  check(resolved.input === undefined && typeof resolved.error === "string", "非法配置收敛成 error");
}

// 8. header 引用名派生：稳定且合法
{
  const refs = deriveHeaderRefs("remote", ["X-Api-Key", "Authorization"]);
  check(refs["X-Api-Key"] === "MCP_REMOTE_X_API_KEY", "X-Api-Key 派生成 MCP_REMOTE_X_API_KEY");
  check(refs.Authorization === "MCP_REMOTE_AUTHORIZATION", "Authorization 派生成 MCP_REMOTE_AUTHORIZATION");
  check(deriveHeaderRefs("a-b", ["x y"]).constructor === Object, "派生对任意字符不抛");
}

// 9. 官方 seam 缺失时必须优雅降级（本仓库未安装该 peer，正是这条路径）
{
  const seam = await loadCredentialSeam();
  check(seam === undefined || typeof seam.credentialRef === "function", "loadCredentialSeam 不抛且形态正确");
}

console.log("\n" + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
console.log("ALL MCP CREDENTIAL TESTS PASSED");