/**
 * dsh-panel mcp —— MCP 服务器管理子命令。
 *
 * 与 Web 端共用 profile cordis.patch.yml 受管块和 mcp 模型；CLI 写盘后，
 * 运行中的网关由 DSH watchUserPatches 热加载，无需重启。
 *
 * --profile 是必填的：MCP 配置本来就是按 profile 存的，默认成 web 会让人在
 * 别的 profile 里改配置却写进了 web。名字必须已存在，否则拒绝（dsh plugin
 * 会拿错名新建 profile，本命令不允许这种副作用）。
 */
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolveDshHome } from "./host-paths.js";
import {
  authorizationHeader,
  buildAuthorizationUrl,
  createPkce,
  discoverMetadataDetailed,
  discoveryFailureMessage,
  exchangeCode,
  loadOAuthStore,
  normalizeServerUrl,
  registerClient,
  removeOAuthRecord,
  saveOAuthRecord,
  startLoopbackServer
} from "./oauth.js";
import {
  MCP_PLUGIN_NAME,
  readManagedBlock,
  listMcpPatchRows,
  readMcpEntryText,
  readPatchFile,
  removeMcpEntry,
  replaceMcpEntryText,
  replaceMcpEntryWithRow,
  setEntryDisabled,
  writeManagedRows,
  type PatchRow
} from "./patch-editor.js";
import {
  SERVER_NAME_RE,
  parseWireScalar,
  inputFromPatchRow,
  mcpServerInputSchema,
  patchRowToView,
  rowIdForServerName,
  serverNameOfRow,
  toOfficialConfig,
  type McpServerInput,
  type WireScalar
} from "./mcp/model.js";
import { probeMcpServer } from "./mcp/probe.js";
import { runSkillCli } from "./cli-skill.js";
import { ProfileError, knownProfileList, requireProfile, type ProfileInfo } from "./profiles.js";

function profilePatchPath(profile: string): string {
  return join(resolveDshHome(), "profiles", profile, "cordis.patch.yml");
}

function rowServerName(row: PatchRow): string | undefined {
  return serverNameOfRow(row);
}

async function readRows(profile: string) {
  const path = profilePatchPath(profile);
  const raw = await readPatchFile(path);
  // managed 只用于「新建时追加进受管块」。已有的 MCP 行一律走 all，就地改。
  const { managed, foreign } = readManagedBlock(raw);
  const all = listMcpPatchRows(raw);
  return { path, raw, managed, all, foreign };
}

/**
 * 按 serverName + entryId 定位唯一一行。两个都给时按「都对上」匹配，文件里
 * serverName 重复（不同 id）或 id 重复（不同 serverName）都能唯一定位；
 * `--id` 可从 `dsh-panel mcp list --ids` 或卡片上拿到。
 */
function resolveRow(rows: PatchRow[], ref: { serverName?: string; entryId?: string }): PatchRow {
  const name = typeof ref.serverName === "string" && ref.serverName !== "" ? ref.serverName : undefined;
  const entryId = typeof ref.entryId === "string" && ref.entryId !== "" ? ref.entryId : undefined;
  const label = name ?? entryId ?? "";
  const matches = rows.filter(
    (row) => (name === undefined || rowServerName(row) === name) && (entryId === undefined || row.id === entryId)
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error('MCP 行 "' + label + '" 在 cordis.patch.yml 里不唯一（id 或 serverName 重复）。'
      + "请用 dsh-panel mcp raw --id <entryId> 按 id 逐条修正，让每一行的 id 和 config.serverName 都唯一");
  }
  if (name !== undefined) {
    const byName = rows.filter((row) => rowServerName(row) === name);
    if (byName.length === 1) return byName[0];
    if (byName.length > 1) {
      throw new Error('serverName "' + name + '" 对应多条 MCP 行：请加 --id <entryId>（entryId 见 dsh-panel mcp list --ids），'
        + "或直接改 cordis.patch.yml 消掉重名");
    }
  }
  if (entryId !== undefined) {
    const byId = rows.filter((row) => row.id === entryId);
    if (byId.length === 1) return byId[0];
    if (byId.length > 1) throw new Error('id "' + entryId + '" 对应多条 MCP 行，请用原文按 id 逐条修正');
  }
  throw new Error('MCP 服务器 "' + label + '" 不存在');
}

/** 这一行的 patch-editor 定位器（id + serverName，缺 id 时只给 serverName）。 */
function locatorOf(row: PatchRow): { id?: string; serverName?: string } {
  return { id: typeof row.id === "string" ? row.id : undefined, serverName: rowServerName(row) };
}

/** 受管块里的非 MCP 外来行提示（这些行面板仍不改写，但必须让用户看见）。 */
function describeForeign(foreign: { entries: { id?: string; name?: string; managed: boolean }[] }): string | undefined {
  const others = foreign.entries.filter((entry) => entry.name !== MCP_PLUGIN_NAME);
  if (others.length === 0) return undefined;
  return "受管块内还有 " + others.length + " 条不属于 MCP 的行（" + others.map((entry) => entry.id ?? entry.name ?? "?").join("、") + "），面板不会改动它们";
}

function usage() {
  console.log([
    "用法:",
    "  dsh-panel mcp list --profile <name>",
    "  dsh-panel mcp add --name <serverName> --stdio --command <cmd> [--args <arg> ...] [--env KEY=VALUE ...] [--cwd <path>] --profile <name>",
    "  dsh-panel mcp add --name <serverName> --http --url <url> [--header KEY=VALUE ...] --profile <name>",
    "  dsh-panel mcp remove <serverName> [--id <entryId>] [--yes] --profile <name>",
    "  dsh-panel mcp enable <serverName> [--id <entryId>] --profile <name>",
    "  dsh-panel mcp disable <serverName> [--id <entryId>] --profile <name>",
    "  dsh-panel mcp raw <serverName> [--id <entryId>] --profile <name>            打印这一条的原文 YAML",
    "  dsh-panel mcp raw <serverName> [--id <entryId>] --profile <name> --set <file>   用文件内容替换这一条",
    "  dsh-panel mcp test <serverName> [--id <entryId>] --profile <name>",
    "  dsh-panel mcp oauth <serverName> --profile <name> [--scope \"a b\"] [--client-id ID] [--timeout <秒>] [--no-open]",
    "        给 streamable-http 的服务器做一次 OAuth 登录（授权码 + PKCE，回调落在本机 127.0.0.1）",
    "  dsh-panel mcp oauth <serverName> --profile <name> --disconnect   断开登录并清掉本地令牌",
    "  dsh-panel mcp update [--yes] [--profile <name>]      等价于 dsh-panel update",
    "",
    "公共参数:",
    "  --profile <name>                    目标 profile，必须已存在；除 update 外必填",
    "                                      名字打错会被拒绝，绝不会新建 profile",
    "",
    "说明: 文件里每一条 @deepseek-ai/dsh-mcp-client 都能启停、删除、用原文改；",
    "没有 id 的手写行也能启停（面板按这一条自己的缩进插 disabled）。",
    "--id <entryId> 用于 serverName 重复时精确指定某一行（list --ids 能看到 entryId）。",
    "新建的服务器仍追加到受管块。网关在线时自动热加载。",
    "密钥参数可通过 --env/--header 重复传入；已配置密钥在编辑表单中留空保持不变。",
    "",
                        "环境变量: 值里写 ${NAME} 即读取环境变量 NAME（保存时格式化为 cordis.patch.yml",
                        "里的 !!js 表达式，由 DSH 装载时求值）。以 !!js 开头的值按进阶写法原样透传：",
                        "  --env 'GITHUB_TOKEN=${GITHUB_TOKEN}'",
                        "  --header 'Authorization=Bearer ${MCP_TOKEN}'",
                        "  --header 'Authorization=!!js `Bearer ${process.env.MCP_TOKEN}`'"
  ].join("\n"));
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

function parsePairs(values: string[]): Record<string, WireScalar> {
  const out: Record<string, WireScalar> = {};
  for (const value of values) {
    const index = value.indexOf("=");
    if (index <= 0) throw new Error("KEY=VALUE 格式无效：" + value);
    const key = value.slice(0, index).trim();
    if (key === "") throw new Error("KEY=VALUE 的 key 不能为空：" + value);
    // 值以 "!!js " 开头即写进 cordis.patch.yml 的 !!js 标签，由宿主装载时求值。
    out[key] = parseWireScalar(value.slice(index + 1));
  }
  return out;
}

async function buildInputFromArgs(args: string[]): Promise<{ input: McpServerInput }> {
  const flags: any = { profile: undefined, args: [], env: [], headers: [] };
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
  let input: McpServerInput;
  if (flags.stdio === true) {
    if (flags.command === undefined) throw new Error("--stdio 需要 --command");
    input = mcpServerInputSchema.parse({ ...common, transport: "stdio", command: parseWireScalar(flags.command), args: flags.args.map((item: string) => parseWireScalar(item)), env: parsePairs(flags.env), cwd: flags.cwd === undefined ? "" : parseWireScalar(flags.cwd) });
  } else {
    if (flags.url === undefined) throw new Error("--http 需要 --url");
    input = mcpServerInputSchema.parse({ ...common, transport: "streamable-http", url: parseWireScalar(flags.url), headers: parsePairs(flags.headers) });
  }
  return { input };
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

  const flags: any = { profile: undefined, yes: false, set: undefined, id: undefined };
  const positional: string[] = [];
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--profile") {
      i += 1;
      if (i >= args.length) throw new Error("--profile 需要一个配置名参数");
      flags.profile = args[i];
    } else if (arg === "--yes") flags.yes = true;
    else if (arg === "--id") {
      i += 1;
      if (i >= args.length) throw new Error("--id 需要一个 entryId 参数");
      flags.id = args[i];
    } else if (arg === "--ids") flags.ids = true;
    else if (arg === "--set") {
      i += 1;
      if (i >= args.length) throw new Error("--set 需要一个文件路径");
      flags.set = args[i];
    } else positional.push(arg);
  }

  // profile 校验必须在任何读写之前：错名要在这一层挡掉，
  // 否则 dsh plugin 会安静地按错名新建一个 profile。
  if (flags.profile === undefined) {
    console.error("必须用 --profile <name> 指定目标 profile（mcp 子命令不再默认 web）。有效：" + knownProfileList());
    return 2;
  }
  let profile: ProfileInfo;
  try {
    profile = requireProfile(flags.profile);
  } catch (error) {
    if (error instanceof ProfileError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }

  if (command === "oauth") {
    const name = positional[0];
    if (name === undefined) {
      console.error("oauth 需要一个 serverName 参数");
      return 2;
    }
    const { all } = await readRows(profile.name);
    const row = resolveRow(all, { serverName: name, entryId: flags.id });
    const config: any = row.config ?? {};
    const dshHome = resolveDshHome();
    const flagValue = (flag: string) => {
      const index = args.indexOf(flag);
      return index >= 0 && index + 1 < args.length ? args[index + 1] : undefined;
    };
    const disconnect = args.includes("--disconnect");

    if (disconnect) {
      const headers = config.headers !== null && typeof config.headers === "object" && !Array.isArray(config.headers) ? { ...config.headers } : {};
      delete headers.Authorization;
      const nextConfig = { ...config };
      if (Object.keys(headers).length === 0) delete nextConfig.headers;
      else nextConfig.headers = headers;
      await replaceMcpEntryWithRow(profilePatchPath(profile.name), locatorOf(row), { ...row, config: nextConfig });
      await removeOAuthRecord(dshHome, name);
      console.log('已断开 "' + name + '" 的 OAuth 登录（Authorization 头与本地令牌都清掉了）');
      return 0;
    }

    if (config.transport !== "streamable-http" || typeof config.url !== "string" || config.url === "") {
      throw new Error("只有 streamable-http 的服务器能用 OAuth 登录（stdio 由本地进程自己管凭据）");
    }
    const timeoutMs = Number(flagValue("--timeout") ?? 300) * 1000;
    const serverUrl = normalizeServerUrl(config.url);
    const discovery: any = await discoverMetadataDetailed(config.url);
    const metadata = discovery.metadata;
    if (metadata === undefined) throw new Error(discoveryFailureMessage(discovery.attempts));
    // PRM 声明的 resource 优先（同源才接受，见 oauth.ts）；没有就用配置里的 endpoint。
    const resourceUrl = typeof discovery.resource === "string" && discovery.resource !== "" ? discovery.resource : serverUrl;
    const state = randomBytes(16).toString("base64url");
    const { verifier, challenge } = createPkce();
    const loopback = await startLoopbackServer(state, timeoutMs);
    try {
      const previous = (await loadOAuthStore(dshHome))[name];
      const clientId = flagValue("--client-id") ?? previous?.clientId ?? (await registerClient(metadata, loopback.redirectUri))?.client_id;
      if (typeof clientId !== "string" || clientId === "") throw new Error("拿不到 client_id：服务器既不支持动态注册，也没有用 --client-id 指定");
      const authUrl = buildAuthorizationUrl(metadata, clientId, loopback.redirectUri, challenge, state, flagValue("--scope"), resourceUrl);
      console.log("在浏览器里完成授权：" + authUrl);
      console.log("（回调地址 " + loopback.redirectUri + " 由本次命令监听，授权完成后自动继续；" + Math.round(timeoutMs / 1000) + " 秒内没完成就超时）");
      if (!args.includes("--no-open")) {
        try {
          const opener: [string, string[]] =
            process.platform === "win32" ? ["cmd", ["/c", "start", "", authUrl]] : process.platform === "darwin" ? ["open", [authUrl]] : ["xdg-open", [authUrl]];
          const child: any = spawn(opener[0], opener[1], { detached: true, stdio: "ignore" });
          child.unref?.();
        } catch {
          // 打不开浏览器就把 URL 留给用户手动打开，不是错误。
        }
      }
      const { code } = await loopback.waitForCode();
      const tokens = await exchangeCode(metadata, clientId, code, verifier, loopback.redirectUri, resourceUrl);
      await saveOAuthRecord(dshHome, name, { ...tokens, clientId, serverUrl: resourceUrl, tokenEndpoint: metadata.token_endpoint });
      const headers = config.headers !== null && typeof config.headers === "object" && !Array.isArray(config.headers) ? { ...config.headers } : {};
      headers.Authorization = authorizationHeader(tokens);
      await replaceMcpEntryWithRow(profilePatchPath(profile.name), locatorOf(row), { ...row, config: { ...config, headers } });
      console.log('已登录 "' + name + '"：Authorization 头已写入 profile，网关会热加载这一行');
      if (typeof tokens.expiresAt === "number") {
        console.log("令牌有效期到 " + new Date(tokens.expiresAt).toLocaleString() + "；过期后用 dsh-panel mcp oauth " + name + " --profile " + profile.name + " 重新登录（会自动复用已注册的客户端）");
      }
      return 0;
    } finally {
      await loopback.close();
    }
  }

  if (command === "add") {
    const { input } = await buildInputFromArgs(args.slice(1));
    const { managed, all, foreign } = await readRows(profile.name);
    for (const row of all) {
      if (rowServerName(row) === input.serverName) throw new Error('serverName "' + input.serverName + '" 已存在');
    }
    const row = { id: rowIdForServerName(input.serverName), name: "@deepseek-ai/dsh-mcp-client", config: toOfficialConfig(input) };
    if (all.some((item) => item.id === row.id)) throw new Error('id "' + row.id + '" 已存在');
    await writeManagedRows(profilePatchPath(profile.name), [...managed, row].sort((a, b) => String(a.config?.serverName ?? "").localeCompare(String(b.config?.serverName ?? ""))));
    console.log('已添加 MCP 服务器 "' + input.serverName + '"（' + input.transport + "，网关在线时自动热加载）");
    const addHint = describeForeign(foreign);
    if (addHint !== undefined) console.log("提示：" + addHint);
    return 0;
  }

  if (command === "list") {
    const { all, foreign } = await readRows(flags.profile);
    const hint = describeForeign(foreign);
    if (all.length === 0) {
      console.log("没有 MCP 服务器。");
      if (hint !== undefined) console.log("提示：" + hint);
      return 0;
    }
    for (const row of all) {
      const view = patchRowToView(row);
      if (view === undefined) continue;
      const cells = [view.enabled ? "启用" : "停用", view.serverName, view.transport, view.transport === "stdio" ? view.command : view.url];
      if (flags.ids === true) cells.push(view.entryId ?? "(无 id)");
      console.log(cells.filter(Boolean).join("       "));
    }
    if (hint !== undefined) console.log("提示：" + hint);
    return 0;
  }

  if (command === "raw") {
    const name = positional[0];
    if (name === undefined) {
      console.error("raw 需要一个 serverName 参数");
      return 2;
    }
    const { raw, all } = await readRows(flags.profile);
    const row = resolveRow(all, { serverName: name, entryId: flags.id });
    if (flags.set !== undefined) {
      const text = await readFile(resolve(flags.set), "utf8");
      await replaceMcpEntryText(profilePatchPath(flags.profile), locatorOf(row), text);
      console.log('已用原文更新 MCP 服务器 "' + name + '"');
      return 0;
    }
    process.stdout.write(readMcpEntryText(raw, locatorOf(row)));
    return 0;
  }

  if (command === "remove" || command === "enable" || command === "disable") {
    const name = positional[0];
    if (name === undefined) {
      console.error(command + " 需要一个 serverName 参数");
      return 2;
    }
    const { all, foreign } = await readRows(flags.profile);
    const writeHint = describeForeign(foreign);
    const row = resolveRow(all, { serverName: name, entryId: flags.id });
    if (command === "remove") {
      if (!flags.yes) {
        const ok = await confirm('确认删除 MCP 服务器 "' + name + '"？此操作不可恢复 (y/N): ');
        if (!ok) {
          console.log("已取消");
          return 0;
        }
      }
      await removeMcpEntry(profilePatchPath(flags.profile), locatorOf(row));
      console.log('已删除 MCP 服务器 "' + name + '"');
      if (writeHint !== undefined) console.log("提示：" + writeHint);
      return 0;
    }
    // 没有 id 的手写行也能开关：disabled 键按这一条自己的缩进插入/删除。
    const nextRow: PatchRow = { ...row };
    if (command === "enable") delete nextRow.disabled;
    else nextRow.disabled = true;
    await setEntryDisabled(profilePatchPath(flags.profile), locatorOf(row), command === "disable");
    console.log('已' + (command === "enable" ? "启用" : "停用") + ' MCP 服务器 "' + name + '"');
    if (writeHint !== undefined) console.log("提示：" + writeHint);
    return 0;
  }

  if (command === "test") {
    const name = positional[0];
    if (name === undefined) {
      console.error("test 需要一个 serverName 参数");
      return 2;
    }
    const { all } = await readRows(flags.profile);
    const row = resolveRow(all, { serverName: name, entryId: flags.id });
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