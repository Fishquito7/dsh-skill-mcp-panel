/**
 * dsh-skill-mcp-panel —— 工作区级 MCP 声明文件 `<projectRoot>/.dsh/mcp.json`。
 *
 * 与全局作用域（写进 profile 的 cordis.patch.yml 受管块）并列的第二条作用域：
 * 只有 cwd 落在该项目根的会话才会拿到这些服务器。
 *
 * **本文件永不存密钥值。** 它只记声明：
 *   - `envKeys`     子进程环境变量名，同时就是凭证引用名；
 *   - `headerRefs`  HTTP header 名 → 凭证引用名 的显式映射。
 * 明文由 DSH 官方凭证 seam（`ctx.credentials`）在挂载时解析，因此这个文件
 * 可以安全地随工作区仓库提交。
 *
 * 写盘复用 patch-editor 的原子写 + 写锁（与 profile patch 同一套约定）。
 */
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { writeFileAtomic, withPatchLock } from "../patch-editor.js";
import {
  DEFAULT_TOOL_CALL_TIMEOUT_MS,
  SERVER_NAME_RE,
  reconnectSchema
} from "./model.js";
import { isReferenceName } from "./ref-name.js";

/** 单条工作区声明的 schema：磁盘文件与 CLI 的 `add --workspace` 共用同一份。 */
export const workspaceMcpServerSchema = z.object({
  serverName: z.string().regex(SERVER_NAME_RE, "serverName 只能包含 1-32 位字母、数字、下划线或连字符"),
  transport: z.enum(["stdio", "streamable-http"]),
  /** 与全局卡片一致的启停位：false = 该声明不参与会话挂载。 */
  enabled: z.boolean().default(true),
  command: z.string().default(""),
  args: z.array(z.string()).default([]),
  cwd: z.string().default(""),
  url: z.string().default(""),
  /** 环境变量名（= 凭证引用名）。值不在这里。 */
  envKeys: z.array(z.string()).default([]),
  /** header 名 → 凭证引用名。值不在这里。 */
  headerRefs: z.record(z.string(), z.string()).default({}),
  toolCallTimeoutMs: z.number().int().min(1).default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
  failOnStartupError: z.boolean().default(false),
  reconnect: reconnectSchema
});

/** 文件头只有 `version`：它是将来迁移的唯一钩子（写入者标记不再单独记）。 */
const workspaceFileSchema = z.object({
  version: z.literal(1).default(1),
  servers: z.array(workspaceMcpServerSchema).default([])
});

export type WorkspaceMcpServer = z.infer<typeof workspaceMcpServerSchema>;

/** 某工作区（项目根）的 MCP 声明文件路径。 */
export function workspaceMcpFile(projectRoot: string): string {
  return join(projectRoot, ".dsh", "mcp.json");
}

export interface WorkspaceStoreResult {
  path: string;
  ok: boolean;
  error: string | null;
  servers: WorkspaceMcpServer[];
}

/**
 * 读取一个工作区的声明文件。文件不存在 = 该工作区没有工作区级 MCP（不是错误）；
 * 文件存在但损坏则 `ok:false` 并带原因，由调用方决定是提示还是忽略。
 */
export async function readWorkspaceServers(projectRoot: string): Promise<WorkspaceStoreResult> {
  const path = workspaceMcpFile(projectRoot);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as { code?: string } | undefined)?.code === "ENOENT") {
      return { path, ok: true, error: null, servers: [] };
    }
    return {
      path,
      ok: false,
      error: "无法读取工作区 MCP 文件（" + path + "）：" + (error instanceof Error ? error.message : String(error)),
      servers: []
    };
  }
  try {
    const parsed = workspaceFileSchema.parse(JSON.parse(raw));
    return { path, ok: true, error: null, servers: parsed.servers as WorkspaceMcpServer[] };
  } catch (error) {
    return {
      path,
      ok: false,
      error: "工作区 MCP 文件无效（" + path + "）：" + (error instanceof Error ? error.message : String(error)),
      servers: []
    };
  }
}

/**
 * 离线校验一条工作区声明（写盘前用）。返回问题列表，空数组表示通过。
 *
 * 引用名文法以 @deepseek-ai/dsh-credentials 的 `credentialRef` 为准，这里用
 * 本地镜像做同样判断，保证 CLI 没装官方 seam 时也能拒绝坏配置。
 */
export function validateWorkspaceServer(server: WorkspaceMcpServer): string[] {
  const problems: string[] = [];
  for (const key of server.envKeys) {
    if (!isReferenceName(key)) {
      problems.push('env 键名 "' + key + '" 不是合法凭证引用名（需为 POSIX shell 标识符，如 MY_API_KEY）');
    }
  }
  for (const [header, ref] of Object.entries(server.headerRefs ?? {})) {
    if (header.trim() === "") problems.push("headerRefs 中存在空 header 名");
    if (!isReferenceName(ref)) {
      problems.push('header "' + header + '" 的引用名 "' + ref + '" 不是合法凭证引用名');
    }
  }
  if (server.transport === "stdio" && server.command.trim() === "") {
    problems.push('stdio 服务器 "' + server.serverName + '" 缺少 command');
  }
  if (server.transport === "streamable-http" && server.url.trim() === "") {
    problems.push('http 服务器 "' + server.serverName + '" 缺少 url');
  }
  return problems;
}

/** 写回一个工作区的声明文件（原子写 + 写锁）。 */
export async function writeWorkspaceServers(projectRoot: string, servers: WorkspaceMcpServer[]): Promise<string> {
  const path = workspaceMcpFile(projectRoot);
  const body = JSON.stringify({ version: 1, servers }, null, 2) + "\n";
  await mkdir(dirname(path), { recursive: true });
  return withPatchLock(path, async () => {
    await writeFileAtomic(path, body);
    return path;
  });
}
