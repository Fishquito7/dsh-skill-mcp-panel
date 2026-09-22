/**
 * dsh-panel mcp —— MCP 服务器管理子命令。
 *
 * 两条作用域，两个落盘位置：
 *   - 全局：profile 的 cordis.patch.yml 受管块（行为与 2.1.0 完全一致）；
 *   - 工作区：`<workspace>/.dsh/mcp.json`，只记键名与凭证引用名，**永不存密钥值**。
 *
 * CLI 没有运行中的 host，因此拿不到 `ctx.credentials`：工作区作用域下只能声明
 * 键名，值请在 Web 面板的 MCP 页设置（那里走官方 `remote.credentials`）。
 * `test --workspace` 只能用 CLI 进程环境里的值做探活，会把缺值情况打印出来。
 */
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import {
  extractManagedRows,
  listMcpPatchRows,
  readPatchFile,
  writeManagedRows,
  type PatchRow
} from "./patch-editor.js";
import {
  SERVER_NAME_RE,
  inputFromPatchRow,
  mcpServerInputSchema,
  patchRowToView,
  rowIdForServerName,
  serverNameFromRowId,
  toOfficialConfig,
  type McpServerInput
} from "./mcp/model.js";
import { probeMcpServer } from "./mcp/probe.js";
import { loadCredentialSeam, deriveHeaderRefs, resolveWorkspaceServer } from "./mcp/credential-env.js";
import {
  readWorkspaceServers,
  validateWorkspaceServer,
  workspaceMcpFile,
  workspaceMcpServerSchema,
  writeWorkspaceServers,
  type WorkspaceMcpServer
} from "./mcp/workspace-store.js";
import { normalizeWorkspace } from "./scope.js";
import { runSkillCli } from "./cli-skill.js";

function profilePatchPath(profile: string): string {
  return join(resolveDshHome(), "profiles", profile, "cordis.patch.yml");
}

function rowServerName(row: PatchRow): string | undefined {
  return serverNameFromRowId(row.id) ?? (typeof row.config?.serverName === "string" ? row.config.serverName : undefined);
}

async function readRows(profile: string) {
  const path = profilePatchPath(profile);
  const raw = await readPatchFile(path);
  const managed = extractManagedRows(raw);
  const external = listMcpPatchRows(raw).filter((row) => typeof row.id === "string" && !managed.some((item) => item.id === row.id));
  return { path, managed, external };
}

/** 全局作用域里已声明的 serverName（含外部行）。 */
async function globalServerNames(profile: string): Promise<Set<string>> {
  const { managed, external } = await readRows(profile);
  const names = new Set<string>();
  for (const row of [...managed, ...external]) {
    const name = rowServerName(row);
    if (name !== undefined) names.add(name);
  }
  return names;
}

function usage() {
  console.log(
    [
      "用法:",
      "  # 全局作用域 → profile 的 cordis.patch.yml 受管块",
      "  dsh-panel mcp list [--profile <name>]",
      "  dsh-panel mcp add --name <serverName> --stdio --command <cmd> [--args <arg> ...] [--env KEY=VALUE ...] [--cwd <path>]",
      "  dsh-panel mcp add --name <serverName> --http --url <url> [--header KEY=VALUE ...]",
      "  dsh-panel mcp remove <serverName> [--yes] [--profile <name>]",
      "  dsh-panel mcp enable <serverName> [--profile <name>]",
      "  dsh-panel mcp disable <serverName> [--profile <name>]",
      "  dsh-panel mcp test <serverName> [--profile <name>]",
      "  dsh-panel mcp update [--yes] [--profile <name>]",
      "",
      "  # 工作区作用域 → <workspace>/.dsh/mcp.json（只记键名，不存密钥值）",
      "  dsh-panel mcp list --workspace <path>",
      "  dsh-panel mcp add --workspace <path> --name <serverName> --stdio --command <cmd> [--args <arg> ...] [--env-key NAME ...] [--cwd <path>]",
      "  dsh-panel mcp add --workspace <path> --name <serverName> --http --url <url> [--header-key NAME ...]",
      "  dsh-panel mcp remove|enable|disable --workspace <path> <serverName> [--yes]",
      "  dsh-panel mcp test --workspace <path> <serverName>",
      "",
      "说明: 全局配置写入当前 profile 的 cordis.patch.yml 受管块；网关在线时自动热加载。",
      "      工作区配置只对 cwd 落在该工作区（项目根）的会话生效，且永不存密钥值——",
      "      值请用 Web 面板的 MCP 页设置（写入 DSH 官方凭证存储）。",
      "      全局作用域的密钥用 --env/--header 重复传入；已配置密钥在编辑表单中留空保持不变。"
    ].join("\n")
  );
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolvePromise) => {
    rl.question(question, (value) => {
      rl.close();
      resolvePromise(value.trim().toLowerCase());
    });
  });
  return answer === "y" || answer === "yes";
}

function parsePairs(values: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const value of values) {
    const index = value.indexOf("=");
    if (index <= 0) throw new Error("KEY=VALUE 格式无效：" + value);
    const key = value.slice(0, index).trim();
    if (key === "") throw new Error("KEY=VALUE 的 key 不能为空：" + value);
    out[key] = value.slice(index + 1);
  }
  return out;
}

type AddArgs =
  | { kind: "global"; profile: string; input: McpServerInput }
  | { kind: "workspace"; profile: string; workspace: string; server: WorkspaceMcpServer };

async function buildAddArgs(args: string[]): Promise<AddArgs> {
  const flags: any = { profile: "web", args: [], env: [], headers: [], envKeys: [], headerKeys: [] };
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--profile") {
      i += 1;
      if (i >= args.length) throw new Error("--profile 需要一个配置名参数");
      flags.profile = args[i];
    } else if (arg === "--name") {
      i += 1;
      if (i >= args.length) throw new Error("--name 需要一个 serverName 参数");
      flags.name = args[i];
    } else if (arg === "--workspace") {
      i += 1;
      if (i >= args.length) throw new Error("--workspace 需要一个工作区路径参数");
      flags.workspace = args[i];
    } else if (arg === "--stdio") flags.stdio = true;
    else if (arg === "--http") flags.http = true;
    else if (arg === "--command") {
      i += 1;
      if (i >= args.length) throw new Error("--command 需要一个参数");
      flags.command = args[i];
    } else if (arg === "--url") {
      i += 1;
      if (i >= args.length) throw new Error("--url 需要一个参数");
      flags.url = args[i];
    } else if (arg === "--cwd") {
      i += 1;
      if (i >= args.length) throw new Error("--cwd 需要一个路径参数");
      flags.cwd = args[i];
    } else if (arg === "--args") {
      i += 1;
      if (i >= args.length) throw new Error("--args 需要一个参数");
      flags.args.push(args[i]);
    } else if (arg === "--env") {
      i += 1;
      if (i >= args.length) throw new Error("--env 需要一个 KEY=VALUE 参数");
      flags.env.push(args[i]);
    } else if (arg === "--header") {
      i += 1;
      if (i >= args.length) throw new Error("--header 需要一个 KEY=VALUE 参数");
      flags.headers.push(args[i]);
    } else if (arg === "--env-key") {
      i += 1;
      if (i >= args.length) throw new Error("--env-key 需要一个键名参数");
      flags.envKeys.push(args[i]);
    } else if (arg === "--header-key") {
      i += 1;
      if (i >= args.length) throw new Error("--header-key 需要一个 header 名参数");
      flags.headerKeys.push(args[i]);
    } else if (arg === "--timeout") {
      i += 1;
      if (i >= args.length) throw new Error("--timeout 需要一个毫秒参数");
      flags.timeout = parseInt(args[i], 10);
    } else if (arg === "--fail-on-startup") flags.failOnStartup = true;
    else if (arg === "--no-reconnect") flags.noReconnect = true;
    else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else if (arg.startsWith("-")) throw new Error("未知参数：" + arg);
    else positional.push(arg);
  }
  if (flags.name === undefined || !SERVER_NAME_RE.test(flags.name)) throw new Error("--name 必须匹配 " + String(SERVER_NAME_RE));
  if (flags.stdio === true && flags.http === true) throw new Error("--stdio 与 --http 不能同时使用");
  if (flags.stdio !== true && flags.http !== true) throw new Error("add 需要指定 --stdio 或 --http");
  const common = {
    serverName: flags.name,
    toolCallTimeoutMs: Number.isFinite(flags.timeout) && flags.timeout > 0 ? flags.timeout : 60000,
    failOnStartupError: flags.failOnStartup === true,
    reconnect: flags.noReconnect === true ? { enabled: false, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 } : { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 }
  };

  // ── 工作区作用域：只接受键名，永不接受值 ────────────────────────────────
  if (flags.workspace !== undefined) {
    if (flags.env.length > 0 || flags.headers.length > 0) {
      throw new Error(
        "--workspace 作用域不存密钥值：请用 --env-key/--header-key 只声明键名，值在 Web 面板的「MCP」页设置（写入 DSH 官方凭证存储）"
      );
    }
    const draft: any =
      flags.stdio === true
        ? {
            ...common,
            transport: "stdio",
            command: flags.command ?? "",
            args: flags.args,
            cwd: flags.cwd ?? "",
            envKeys: flags.envKeys,
            headerRefs: {}
          }
        : {
            ...common,
            transport: "streamable-http",
            url: flags.url ?? "",
            envKeys: [],
            headerRefs: deriveHeaderRefs(flags.name, flags.headerKeys)
          };
    if (flags.stdio === true && flags.command === undefined) throw new Error("--stdio 需要 --command");
    if (flags.http === true && flags.url === undefined) throw new Error("--http 需要 --url");
    const server = workspaceMcpServerSchema.parse(draft) as WorkspaceMcpServer;
    const problems = validateWorkspaceServer(server);
    if (problems.length > 0) throw new Error("工作区 MCP 声明无效：" + problems.join("；"));
    return { kind: "workspace", profile: flags.profile, workspace: flags.workspace, server };
  }

  // ── 全局作用域：行为与 2.1.0 一致 ───────────────────────────────────────
  if (flags.envKeys.length > 0 || flags.headerKeys.length > 0) {
    throw new Error("--env-key/--header-key 只用于 --workspace 作用域；全局作用域请用 --env/--header 传 KEY=VALUE");
  }
  let input: McpServerInput;
  if (flags.stdio === true) {
    if (flags.command === undefined) throw new Error("--stdio 需要 --command");
    input = mcpServerInputSchema.parse({ ...common, transport: "stdio", command: flags.command, args: flags.args, env: parsePairs(flags.env), cwd: flags.cwd ?? "" });
  } else {
    if (flags.url === undefined) throw new Error("--http 需要 --url");
    input = mcpServerInputSchema.parse({ ...common, transport: "streamable-http", url: flags.url, headers: parsePairs(flags.headers) });
  }
  return { kind: "global", profile: flags.profile, input };
}

/** CLI 端的凭证取值：只能用本进程环境（没有 host，就读不到 DSH 凭证存储）。 */
const processEnvProvider = {
  async resolve(ref: any) {
    const key = typeof ref === "string" ? ref : String(ref);
    const value = process.env[key];
    return typeof value === "string" && value !== "" ? { value, source: "env" } : undefined;
  }
};

async function probeWorkspaceServer(projectRoot: string, name: string) {
  const { servers } = await readWorkspaceServers(projectRoot);
  const server = servers.find((candidate) => candidate.serverName === name);
  if (server === undefined) throw new Error('该工作区没有 serverName "' + name + '"（' + workspaceMcpFile(projectRoot) + "）");
  const seam = await loadCredentialSeam();
  const resolved = await resolveWorkspaceServer(server, processEnvProvider, seam);
  if (resolved.input === undefined) {
    const reason = resolved.error ?? (resolved.invalid.length > 0 ? resolved.invalid.join("；") : "工作区声明无效");
    return { ok: false, tools: [] as { name: string; description?: string }[], error: reason };
  }
  if (resolved.missing.length > 0) {
    console.log(
      "提示：以下凭证引用在 CLI 进程环境里没有值，测试可能失真：" +
        resolved.missing.join(", ") +
        "（CLI 读不到 DSH 凭证存储，完整解析需要运行中的 host）"
    );
  }
  return probeMcpServer(resolved.input);
}

function workspaceServerLine(server: WorkspaceMcpServer): string {
  const refs = [...(server.envKeys ?? []), ...Object.values(server.headerRefs ?? {})];
  return [
    server.enabled === false ? "停用" : "启用",
    server.serverName,
    server.transport,
    server.transport === "stdio" ? server.command : server.url,
    refs.length > 0 ? "引用: " + refs.join(", ") : "（无凭证引用）"
  ]
    .filter(Boolean)
    .join("       ");
}

export async function runMcpCli(args: string[]): Promise<number> {
  const command = args[0];
  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    usage();
    return command === undefined ? 2 : 0;
  }

  if (command === "update") {
    return runSkillCli(["update", ...args.slice(1)]);
  }

  const flags: any = { profile: "web", yes: false };
  const positional: string[] = [];
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--profile") {
      i += 1;
      if (i >= args.length) throw new Error("--profile 需要一个配置名参数");
      flags.profile = args[i];
    } else if (arg === "--workspace") {
      i += 1;
      if (i >= args.length) throw new Error("--workspace 需要一个工作区路径参数");
      flags.workspace = args[i];
    } else if (arg === "--yes") flags.yes = true;
    else positional.push(arg);
  }

  if (command === "add") {
    const built = await buildAddArgs(args.slice(1));
    if (built.kind === "workspace") {
      const projectRoot = await normalizeWorkspace(built.workspace);
      const globals = await globalServerNames(built.profile);
      if (globals.has(built.server.serverName)) {
        throw new Error('serverName "' + built.server.serverName + '" 已被全局作用域占用（同名会让会话解析出两组工具，请换名）');
      }
      const { servers } = await readWorkspaceServers(projectRoot);
      if (servers.some((candidate) => candidate.serverName === built.server.serverName)) {
        throw new Error('该工作区中已存在 serverName "' + built.server.serverName + '"');
      }
      const next = [...servers, built.server].sort((a, b) => a.serverName.localeCompare(b.serverName));
      await writeWorkspaceServers(projectRoot, next);
      const refs = [...built.server.envKeys, ...Object.values(built.server.headerRefs)];
      console.log('已添加工作区 MCP 服务器 "' + built.server.serverName + '" → ' + workspaceMcpFile(projectRoot));
      if (refs.length > 0) console.log("该声明用到的凭证引用（值不在文件里，请用 Web 面板「MCP」页设置）：" + refs.join(", "));
      console.log("改动对新开的会话生效。");
      return 0;
    }
    const { managed, external } = await readRows(built.profile);
    for (const row of [...managed, ...external]) {
      if (rowServerName(row) === built.input.serverName) throw new Error('serverName "' + built.input.serverName + '" 已存在');
    }
    const row = { id: rowIdForServerName(built.input.serverName), name: "@deepseek-ai/dsh-mcp-client", config: toOfficialConfig(built.input) };
    await writeManagedRows(profilePatchPath(built.profile), [...managed, row].sort((a, b) => String(a.config?.serverName ?? "").localeCompare(String(b.config?.serverName ?? ""))));
    console.log('已添加 MCP 服务器 "' + built.input.serverName + '"（' + built.input.transport + "，网关在线时自动热加载）");
    return 0;
  }

  if (command === "list") {
    if (flags.workspace !== undefined) {
      const projectRoot = await normalizeWorkspace(flags.workspace);
      const store = await readWorkspaceServers(projectRoot);
      if (!store.ok) {
        console.error(String(store.error));
        return 1;
      }
      if (store.servers.length === 0) {
        console.log("该工作区没有 MCP 服务器。（" + store.path + "）");
        return 0;
      }
      const globals = await globalServerNames(flags.profile);
      for (const server of store.servers) {
        const conflict = globals.has(server.serverName) ? "      与全局同名（已忽略）" : "";
        console.log(workspaceServerLine(server) + conflict);
      }
      console.log("（" + store.path + "）");
      return 0;
    }
    const { managed, external } = await readRows(flags.profile);
    if (managed.length === 0 && external.length === 0) {
      console.log("没有 MCP 服务器。");
      return 0;
    }
    for (const row of managed) {
      const view = patchRowToView(row);
      if (view !== undefined) console.log(["受管", view.enabled ? "启用" : "停用", view.serverName, view.transport, view.transport === "stdio" ? view.command : view.url].filter(Boolean).join("       "));
    }
    for (const row of external) {
      const view = patchRowToView(row);
      if (view !== undefined) console.log(["外部", view.enabled ? "启用" : "停用", view.serverName, view.transport, "（cordis.patch.yml 手动管理）"].filter(Boolean).join("       "));
    }
    return 0;
  }

  if (command === "remove" || command === "enable" || command === "disable") {
    const name = positional[0];
    if (name === undefined) {
      console.error(command + " 需要一个 serverName 参数");
      return 2;
    }
    if (flags.workspace !== undefined) {
      const projectRoot = await normalizeWorkspace(flags.workspace);
      const { servers } = await readWorkspaceServers(projectRoot);
      const server = servers.find((candidate) => candidate.serverName === name);
      if (server === undefined) throw new Error('该工作区没有 serverName "' + name + '"');
      if (command === "remove") {
        if (!flags.yes) {
          const ok = await confirm('确认从工作区删除 MCP 服务器 "' + name + '"？此操作不可恢复 (y/N): ');
          if (!ok) {
            console.log("已取消");
            return 0;
          }
        }
        await writeWorkspaceServers(projectRoot, servers.filter((candidate) => candidate !== server));
        console.log('已从工作区删除 MCP 服务器 "' + name + '"');
        return 0;
      }
      server.enabled = command === "enable";
      await writeWorkspaceServers(projectRoot, servers);
      console.log("已" + (command === "enable" ? "启用" : "停用") + ' 工作区 MCP 服务器 "' + name + '"（对新会话生效）');
      return 0;
    }
    const { managed, external } = await readRows(flags.profile);
    if (external.some((row) => rowServerName(row) === name)) throw new Error('"' + name + '" 是外部 cordis.patch.yml 行，请手动删除/修改');
    const row = managed.find((candidate) => rowServerName(candidate) === name);
    if (row === undefined) throw new Error('MCP 服务器 "' + name + '" 不存在');
    if (command === "remove") {
      if (!flags.yes) {
        const ok = await confirm('确认删除 MCP 服务器 "' + name + '"？此操作不可恢复 (y/N): ');
        if (!ok) {
          console.log("已取消");
          return 0;
        }
      }
      await writeManagedRows(profilePatchPath(flags.profile), managed.filter((candidate) => candidate !== row));
      console.log('已删除 MCP 服务器 "' + name + '"');
      return 0;
    }
    row.disabled = command === "disable";
    await writeManagedRows(profilePatchPath(flags.profile), managed);
    console.log('已' + (command === "enable" ? "启用" : "停用") + ' MCP 服务器 "' + name + '"');
    return 0;
  }

  if (command === "test") {
    const name = positional[0];
    if (name === undefined) {
      console.error("test 需要一个 serverName 参数");
      return 2;
    }
    if (flags.workspace !== undefined) {
      const projectRoot = await normalizeWorkspace(flags.workspace);
      const result = await probeWorkspaceServer(projectRoot, name);
      if (!result.ok) {
        console.error("连接失败：" + (result.error ?? "未知错误"));
        return 1;
      }
      console.log("连接成功，发现 " + result.tools.length + " 个工具：");
      for (const tool of result.tools) console.log("  - " + tool.name + (tool.description ? "： " + tool.description : ""));
      return 0;
    }
    const { managed, external } = await readRows(flags.profile);
    const row = [...managed, ...external].find((candidate) => rowServerName(candidate) === name);
    if (row === undefined) throw new Error('MCP 服务器 "' + name + '" 不存在');
    const result = await probeMcpServer(inputFromPatchRow(row));
    if (!result.ok) {
      console.error("连接失败：" + (result.error ?? "未知错误"));
      return 1;
    }
    console.log("连接成功，发现 " + result.tools.length + " 个工具：");
    for (const tool of result.tools) console.log("  - " + tool.name + (tool.description ? "： " + tool.description : ""));
    return 0;
  }

  console.error('未知命令 "' + command + '"');
  usage();
  return 2;
}

/** 读取 --env-file/--header-file JSON 对象（备用工具函数，暂未接入 add flags）。 */
export async function readJsonSecretFile(path: string): Promise<Record<string, string>> {
  const data = JSON.parse(await readFile(resolve(path), "utf8"));
  if (data === null || typeof data !== "object" || Array.isArray(data)) throw new Error(path + " 顶层必须是 JSON 对象");
  for (const value of Object.values(data as Record<string, unknown>)) if (typeof value !== "string") throw new Error(path + " 的值必须全部是字符串");
  return data as Record<string, string>;
}
