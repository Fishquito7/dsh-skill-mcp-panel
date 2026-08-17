/**
 * dsh-panel mcp —— MCP 服务器管理子命令。
 *
 * 与 Web 端共用 profile cordis.patch.yml 受管块和 mcp 模型；CLI 写盘后，
 * 运行中的网关由 DSH watchUserPatches 热加载，无需重启。
 */
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { extractManagedRows, listMcpPatchRows, readPatchFile, writeManagedRows } from "./patch-editor.js";
import { SERVER_NAME_RE, inputFromPatchRow, mcpServerInputSchema, patchRowToView, rowIdForServerName, serverNameFromRowId, toOfficialConfig } from "./mcp/model.js";
import { probeMcpServer } from "./mcp/probe.js";
import { runSkillCli } from "./cli-skill.js";
function profilePatchPath(profile) {
    return join(resolveDshHome(), "profiles", profile, "cordis.patch.yml");
}
function rowServerName(row) {
    return serverNameFromRowId(row.id) ?? (typeof row.config?.serverName === "string" ? row.config.serverName : undefined);
}
async function readRows(profile) {
    const path = profilePatchPath(profile);
    const raw = await readPatchFile(path);
    const managed = extractManagedRows(raw);
    const external = listMcpPatchRows(raw).filter((row) => typeof row.id === "string" && !managed.some((item) => item.id === row.id));
    return { path, managed, external };
}
function usage() {
    console.log([
        "用法:",
        "  dsh-panel mcp list [--profile <name>]",
        "  dsh-panel mcp add --name <serverName> --stdio --command <cmd> [--args <arg> ...] [--env KEY=VALUE ...] [--cwd <path>]",
        "  dsh-panel mcp add --name <serverName> --http --url <url> [--header KEY=VALUE ...]",
        "  dsh-panel mcp remove <serverName> [--yes] [--profile <name>]",
        "  dsh-panel mcp enable <serverName> [--profile <name>]",
        "  dsh-panel mcp disable <serverName> [--profile <name>]",
        "  dsh-panel mcp test <serverName> [--profile <name>]",
        "  dsh-panel mcp update [--yes] [--profile <name>]",
        "",
        "说明: MCP 配置写入当前 profile 的 cordis.patch.yml 受管块；网关在线时自动热加载。",
        "密钥参数可通过 --env/--header 重复传入；已配置密钥在编辑表单中留空保持不变。"
    ].join("\n"));
}
async function confirm(question) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolvePromise) => {
        rl.question(question, (value) => {
            rl.close();
            resolvePromise(value.trim().toLowerCase());
        });
    });
    return answer === "y" || answer === "yes";
}
function parsePairs(values) {
    const out = {};
    for (const value of values) {
        const index = value.indexOf("=");
        if (index <= 0)
            throw new Error("KEY=VALUE 格式无效：" + value);
        const key = value.slice(0, index).trim();
        if (key === "")
            throw new Error("KEY=VALUE 的 key 不能为空：" + value);
        out[key] = value.slice(index + 1);
    }
    return out;
}
async function buildInputFromArgs(args) {
    const flags = { profile: "web", args: [], env: [], headers: [] };
    const positional = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--profile") {
            i += 1;
            if (i >= args.length)
                throw new Error("--profile 需要一个配置名参数");
            flags.profile = args[i];
        }
        else if (arg === "--name") {
            i += 1;
            if (i >= args.length)
                throw new Error("--name 需要一个 serverName 参数");
            flags.name = args[i];
        }
        else if (arg === "--stdio")
            flags.stdio = true;
        else if (arg === "--http")
            flags.http = true;
        else if (arg === "--command") {
            i += 1;
            if (i >= args.length)
                throw new Error("--command 需要一个参数");
            flags.command = args[i];
        }
        else if (arg === "--url") {
            i += 1;
            if (i >= args.length)
                throw new Error("--url 需要一个参数");
            flags.url = args[i];
        }
        else if (arg === "--cwd") {
            i += 1;
            if (i >= args.length)
                throw new Error("--cwd 需要一个路径参数");
            flags.cwd = args[i];
        }
        else if (arg === "--args") {
            i += 1;
            if (i >= args.length)
                throw new Error("--args 需要一个参数");
            flags.args.push(args[i]);
        }
        else if (arg === "--env") {
            i += 1;
            if (i >= args.length)
                throw new Error("--env 需要一个 KEY=VALUE 参数");
            flags.env.push(args[i]);
        }
        else if (arg === "--header") {
            i += 1;
            if (i >= args.length)
                throw new Error("--header 需要一个 KEY=VALUE 参数");
            flags.headers.push(args[i]);
        }
        else if (arg === "--timeout") {
            i += 1;
            if (i >= args.length)
                throw new Error("--timeout 需要一个毫秒参数");
            flags.timeout = parseInt(args[i], 10);
        }
        else if (arg === "--fail-on-startup")
            flags.failOnStartup = true;
        else if (arg === "--no-reconnect")
            flags.noReconnect = true;
        else if (arg === "--help" || arg === "-h") {
            usage();
            process.exit(0);
        }
        else if (arg.startsWith("-"))
            throw new Error("未知参数：" + arg);
        else
            positional.push(arg);
    }
    if (flags.name === undefined || !SERVER_NAME_RE.test(flags.name))
        throw new Error("--name 必须匹配 " + String(SERVER_NAME_RE));
    if (flags.stdio === true && flags.http === true)
        throw new Error("--stdio 与 --http 不能同时使用");
    if (flags.stdio !== true && flags.http !== true)
        throw new Error("add 需要指定 --stdio 或 --http");
    const common = {
        serverName: flags.name,
        toolCallTimeoutMs: Number.isFinite(flags.timeout) && flags.timeout > 0 ? flags.timeout : 60000,
        failOnStartupError: flags.failOnStartup === true,
        reconnect: flags.noReconnect === true ? { enabled: false, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 } : { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 }
    };
    let input;
    if (flags.stdio === true) {
        if (flags.command === undefined)
            throw new Error("--stdio 需要 --command");
        input = mcpServerInputSchema.parse({ ...common, transport: "stdio", command: flags.command, args: flags.args, env: parsePairs(flags.env), cwd: flags.cwd ?? "" });
    }
    else {
        if (flags.url === undefined)
            throw new Error("--http 需要 --url");
        input = mcpServerInputSchema.parse({ ...common, transport: "streamable-http", url: flags.url, headers: parsePairs(flags.headers) });
    }
    return { input, profile: flags.profile };
}
export async function runMcpCli(args) {
    const command = args[0];
    if (command === undefined || command === "--help" || command === "-h" || command === "help") {
        usage();
        return command === undefined ? 2 : 0;
    }
    if (command === "update") {
        return runSkillCli(["update", ...args.slice(1)]);
    }
    const flags = { profile: "web", yes: false };
    const positional = [];
    for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--profile") {
            i += 1;
            if (i >= args.length)
                throw new Error("--profile 需要一个配置名参数");
            flags.profile = args[i];
        }
        else if (arg === "--yes")
            flags.yes = true;
        else
            positional.push(arg);
    }
    if (command === "add") {
        const built = await buildInputFromArgs(args.slice(1));
        const { managed, external } = await readRows(built.profile);
        for (const row of [...managed, ...external]) {
            if (rowServerName(row) === built.input.serverName)
                throw new Error('serverName "' + built.input.serverName + '" 已存在');
        }
        const row = { id: rowIdForServerName(built.input.serverName), name: "@deepseek-ai/dsh-mcp-client", config: toOfficialConfig(built.input) };
        await writeManagedRows(profilePatchPath(built.profile), [...managed, row].sort((a, b) => String(a.config?.serverName ?? "").localeCompare(String(b.config?.serverName ?? ""))));
        console.log('已添加 MCP 服务器 "' + built.input.serverName + '"（' + built.input.transport + "，网关在线时自动热加载）");
        return 0;
    }
    if (command === "list") {
        const { managed, external } = await readRows(flags.profile);
        if (managed.length === 0 && external.length === 0) {
            console.log("没有 MCP 服务器。");
            return 0;
        }
        for (const row of managed) {
            const view = patchRowToView(row);
            if (view !== undefined)
                console.log(["受管", view.enabled ? "启用" : "停用", view.serverName, view.transport, view.transport === "stdio" ? view.command : view.url].filter(Boolean).join("       "));
        }
        for (const row of external) {
            const view = patchRowToView(row);
            if (view !== undefined)
                console.log(["外部", view.enabled ? "启用" : "停用", view.serverName, view.transport, "（cordis.patch.yml 手动管理）"].filter(Boolean).join("       "));
        }
        return 0;
    }
    if (command === "remove" || command === "enable" || command === "disable") {
        const name = positional[0];
        if (name === undefined) {
            console.error(command + " 需要一个 serverName 参数");
            return 2;
        }
        const { managed, external } = await readRows(flags.profile);
        if (external.some((row) => rowServerName(row) === name))
            throw new Error('"' + name + '" 是外部 cordis.patch.yml 行，请手动删除/修改');
        const row = managed.find((candidate) => rowServerName(candidate) === name);
        if (row === undefined)
            throw new Error('MCP 服务器 "' + name + '" 不存在');
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
        const { managed, external } = await readRows(flags.profile);
        const row = [...managed, ...external].find((candidate) => rowServerName(candidate) === name);
        if (row === undefined)
            throw new Error('MCP 服务器 "' + name + '" 不存在');
        const result = await probeMcpServer(inputFromPatchRow(row));
        if (!result.ok) {
            console.error("连接失败：" + (result.error ?? "未知错误"));
            return 1;
        }
        console.log("连接成功，发现 " + result.tools.length + " 个工具：");
        for (const tool of result.tools)
            console.log("  - " + tool.name + (tool.description ? "： " + tool.description : ""));
        return 0;
    }
    console.error('未知命令 "' + command + '"');
    usage();
    return 2;
}
/** 读取 --env-file/--header-file JSON 对象（备用工具函数，暂未接入 add flags）。 */
export async function readJsonSecretFile(path) {
    const data = JSON.parse(await readFile(resolve(path), "utf8"));
    if (data === null || typeof data !== "object" || Array.isArray(data))
        throw new Error(path + " 顶层必须是 JSON 对象");
    for (const value of Object.values(data))
        if (typeof value !== "string")
            throw new Error(path + " 的值必须全部是字符串");
    return data;
}
