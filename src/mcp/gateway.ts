/**
 * dsh-skill-mcp-panel —— MCP 宿主服务（mcpManager）。
 */
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { fileURLToPath } from "node:url";
import { join, basename, resolve } from "node:path";
import {
  MCP_PLUGIN_NAME,
  extractManagedRows,
  listMcpPatchRows,
  readPatchFile,
  writeManagedRows,
  type PatchRow
} from "../patch-editor.js";
import {
  applyServerEdit,
  inputFromPatchRow,
  mcpServerInputSchema,
  patchRowToView,
  rowIdForServerName,
  serverNameFromRowId,
  type McpServerInput
} from "./model.js";
import {
  mcpRemovePayloadSchema,
  mcpSavePayloadSchema,
  mcpSetEnabledPayloadSchema,
  mcpTestPayloadSchema,
  mcpWorkspaceListPayloadSchema,
  mcpWorkspaceRemovePayloadSchema,
  mcpWorkspaceSavePayloadSchema,
  mcpWorkspaceSetEnabledPayloadSchema,
  mcpWorkspaceTestPayloadSchema
} from "./wire.js";
import { fiberPhaseOf, getLoaderEntry, mcpToolCount, waitForLoaderState } from "./status.js";
import { probeMcpServer } from "./probe.js";
import { loadCredentialSeam, resolveWorkspaceServer } from "./credential-env.js";
import { headerRefName } from "./ref-name.js";
import {
  readWorkspaceServers,
  validateWorkspaceServer,
  writeWorkspaceServers,
  type WorkspaceMcpServer
} from "./workspace-store.js";
import { normalizeWorkspace } from "../scope.js";


function stripUndefined(value: any): any {
  if (Array.isArray(value)) return value.map((item) => stripUndefined(item));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      out[key] = stripUndefined(item);
    }
    return out;
  }
  return value;
}

const MANAGED_ROW_IDS = new Set<string>();

function isManagedRow(row: PatchRow): boolean {
  return typeof row.id === "string" && row.id.startsWith("panel-mcp-");
}

/**
 * 面板受管块所在的 patch 文件：优先 profile 的 baseUrl，回退包位置。
 * 导出供工作区运行时（runtime.ts）读取全局 serverName 做同名冲突检测。
 */
export function panelPatchPath(ctx: any): string {
  const base = ctx?.baseUrl;
  if (typeof base === "string" && base.length > 0) {
    try {
      const url = new URL(base);
      if (url.protocol === "file:") return join(fileURLToPath(url), "cordis.patch.yml");
    } catch {
      // fall through to package-location fallback
    }
  }
  const packageDir = fileURLToPath(new URL("../../", import.meta.url));
  return join(resolve(packageDir, "../.."), "cordis.patch.yml");
}

/** 全局作用域已声明的 serverName 集合（受管块 + 外部 MCP 行）。 */
export async function globalServerNames(ctx: any): Promise<Set<string>> {
  const names = new Set<string>();
  try {
    const raw = await readPatchFile(panelPatchPath(ctx));
    for (const row of [...extractManagedRows(raw), ...listMcpPatchRows(raw)]) {
      const name = row.config?.serverName;
      if (typeof name === "string" && name !== "") names.add(name);
    }
  } catch {
    // patch 不可读：没有全局声明可比对（冲突检测退化为不检测）
  }
  return names;
}

export class McpManagerGateway extends TypertRemoteService {
  /** 技能半区实例：复用它的工作区枚举与标题缓存，避免第二份口径。 */
  private readonly skillsGateway: any;

  constructor(ctx: any, skillsGateway?: any) {
    super(ctx, "mcpManager");
    this.skillsGateway = skillsGateway;
  }

  get C(): any {
    return this.ctx as any;
  }

  patchPath(): string {
    return panelPatchPath(this.C);
  }

  async readRows() {
    const path = this.patchPath();
    const raw = await readPatchFile(path);
    const managed = extractManagedRows(raw);
    const allMcp = listMcpPatchRows(raw);
    const managedIds = new Set(managed.map((row) => row.id).filter((id): id is string => typeof id === "string"));
    const external = allMcp.filter((row) => typeof row.id === "string" && !managedIds.has(row.id));
    return { path, raw, managed, external };
  }

  decorate(row: PatchRow, managed: boolean, entry: any, enabled: boolean) {
    const view: any = patchRowToView(row);
    if (view === undefined) return undefined;
    const fiberPhase = fiberPhaseOf(entry?.fiber?.state);
    return stripUndefined({
      ...view,
      enabled,
      managed,
      fiberPhase,
      toolCount: enabled ? mcpToolCount(this.C, view.serverName) : 0
    });
  }

  async list() {
    let patch = { path: this.patchPath(), ok: false, error: null as string | null };
    try {
      const { path, managed, external } = await this.readRows();
      patch = { path, ok: true, error: null };
      const servers: any[] = [];
      for (const row of managed) {
        const entry = typeof row.id === "string" ? getLoaderEntry(this.C, row.id) : undefined;
        const view = this.decorate(row, true, entry, row.disabled !== true);
        if (view !== undefined) servers.push(view);
      }
      const externalServers: any[] = [];
      for (const row of external) {
        const entry = typeof row.id === "string" ? getLoaderEntry(this.C, row.id) : undefined;
        const view = this.decorate(row, false, entry, row.disabled !== true);
        if (view !== undefined) externalServers.push(view);
      }
      return { servers, externalServers, patch };
    } catch (error) {
      return { servers: [], externalServers: [], patch: { ...patch, error: error instanceof Error ? error.message : String(error) } };
    }
  }

  findRowByServerName(rows: PatchRow[], serverName: string): PatchRow | undefined {
    return rows.find((row) => serverNameFromRowId(row.id) === serverName || (row.config?.serverName === serverName && isManagedRow(row)));
  }

  configInputFromRow(row: PatchRow): McpServerInput {
    return inputFromPatchRow(row);
  }

  async save(rawPayload: unknown) {
    const payload = mcpSavePayloadSchema.parse(rawPayload);
    const input = payload.input;
    const previousName = payload.previousServerName ?? input.serverName;
    const { managed, external } = await this.readRows();

    for (const row of external) {
      const name = row.config?.serverName;
      if (name === input.serverName) throw new Error('serverName "' + input.serverName + '" 已被 cordis.patch.yml 中的外部 MCP 行占用，请在文件中手动处理');
    }
    for (const row of managed) {
      const name = row.config?.serverName;
      if (name === input.serverName && serverNameFromRowId(row.id) !== previousName) {
        throw new Error('serverName "' + input.serverName + '" 已存在（受管行 ' + String(row.id) + "）");
      }
    }

    const previous = managed.find((row) => serverNameFromRowId(row.id) === previousName || row.config?.serverName === previousName);
    if (payload.previousServerName !== undefined && previous === undefined) {
      throw new Error('要编辑的 MCP 行不存在："' + previousName + '"');
    }
    const enabled = previous !== undefined ? previous.disabled !== true : payload.enabled;
    const nextRow = applyServerEdit(previous, input, enabled);
    const nextRows = managed.filter((row) => serverNameFromRowId(row.id) !== previousName && row.config?.serverName !== previousName);
    nextRows.push(nextRow);
    nextRows.sort((a, b) => String(a.config?.serverName ?? "").localeCompare(String(b.config?.serverName ?? "")));
    await writeManagedRows(this.patchPath(), nextRows);

    const reconciled = enabled
      ? await waitForLoaderState(this.C, nextRow.id!, (entry) => entry !== undefined && entry.disabled !== true)
      : await waitForLoaderState(this.C, nextRow.id!, (entry) => entry !== undefined && entry.disabled === true);

    const entry = getLoaderEntry(this.C, nextRow.id!);
    const server = this.decorate(nextRow, true, entry, enabled);
    if (server === undefined) throw new Error("写入成功但生成的 MCP 行无效");
    return { server, reconciled };
  }

  async removeServer(rawPayload: unknown) {
    const payload = mcpRemovePayloadSchema.parse(rawPayload);
    const { managed } = await this.readRows();
    const row = managed.find((candidate) => serverNameFromRowId(candidate.id) === payload.serverName || candidate.config?.serverName === payload.serverName);
    if (row === undefined) {
      throw new Error('MCP 行 "' + payload.serverName + '" 不存在或不是面板受管行（外部行请在 cordis.patch.yml 中手动删除）');
    }
    const nextRows = managed.filter((candidate) => candidate !== row);
    await writeManagedRows(this.patchPath(), nextRows);
    const reconciled = await waitForLoaderState(this.C, row.id!, (entry) => entry === undefined);
    return { ok: true, reconciled };
  }

  async setEnabled(rawPayload: unknown) {
    const payload = mcpSetEnabledPayloadSchema.parse(rawPayload);
    const { managed } = await this.readRows();
    const row = managed.find((candidate) => serverNameFromRowId(candidate.id) === payload.serverName || candidate.config?.serverName === payload.serverName);
    if (row === undefined) throw new Error('MCP 行 "' + payload.serverName + '" 不存在或不是面板受管行');
    row.disabled = !payload.enabled;
    await writeManagedRows(this.patchPath(), managed);
    const reconciled = payload.enabled
      ? await waitForLoaderState(this.C, row.id!, (entry) => entry !== undefined && entry.disabled !== true)
      : await waitForLoaderState(this.C, row.id!, (entry) => entry !== undefined && entry.disabled === true);
    const entry = getLoaderEntry(this.C, row.id!);
    const server = this.decorate(row, true, entry, payload.enabled);
    if (server === undefined) throw new Error("写入成功但生成的 MCP 行无效");
    return { server, reconciled };
  }

  async test(rawPayload: unknown) {
    const payload = mcpTestPayloadSchema.parse(rawPayload);
    if (payload !== null && typeof payload === "object" && !("transport" in payload) && "serverName" in payload) {
      const { managed, external } = await this.readRows();
      const row = [...managed, ...external].find((candidate) => candidate.config?.serverName === payload.serverName || serverNameFromRowId(candidate.id) === payload.serverName);
      if (row === undefined) throw new Error('MCP 行 "' + String(payload.serverName) + '" 不存在');
      return probeMcpServer(this.configInputFromRow(row));
    }
    return probeMcpServer(payload);
  }

  // ── 工作区作用域 ─────────────────────────────────────────────────────────

  /** 某工作区的显示名：优先 DSH 工作区标题，取不到回退文件夹名。 */
  private async workspaceLabel(projectRoot: string): Promise<string> {
    try {
      const titles = await this.skillsGateway?.workspaceTitles?.();
      const label = titles?.map?.get(titles.keyOf(resolve(projectRoot)));
      if (typeof label === "string" && label !== "") return label;
    } catch {
      // 取不到标题：回退文件夹名
    }
    return basename(projectRoot) || projectRoot;
  }

  /** 工作区声明的脱敏视图：只有键名，没有承载密钥值的位置。 */
  private workspaceServerView(server: WorkspaceMcpServer): any {
    return stripUndefined({
      serverName: server.serverName,
      transport: server.transport,
      enabled: server.enabled !== false,
      ...(server.transport === "stdio"
        ? { command: server.command, args: server.args, cwd: server.cwd }
        : { url: server.url }),
      envKeys: server.envKeys ?? [],
      headerKeys: Object.keys(server.headerRefs ?? {}),
      toolCallTimeoutMs: server.toolCallTimeoutMs,
      failOnStartupError: server.failOnStartupError,
      reconnect: server.reconnect
    });
  }

  /**
   * 组装一个工作区视图：项目根归一化 → 读声明 → 标注与全局的同名冲突。
   * （挂载结果的运行时报告不在这里：它只在会话创建时算一次，放进视图会显示成
   * 过期信息；运行时改为只写日志。）
   */
  async workspaceView(rawScope: string): Promise<any> {
    let projectRoot: string;
    try {
      projectRoot = await normalizeWorkspace(rawScope);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const label = basename(rawScope) || rawScope;
      return {
        path: rawScope,
        label,
        ok: false,
        error: message,
        servers: [],
        conflicts: []
      };
    }
    const label = await this.workspaceLabel(projectRoot);
    const store = await readWorkspaceServers(projectRoot);
    const globals = await globalServerNames(this.C);
    const conflicts = store.servers.filter((server) => globals.has(server.serverName)).map((server) => server.serverName);
    return {
      path: projectRoot,
      label,
      ok: store.ok,
      error: store.error,
      servers: store.servers.map((server) => this.workspaceServerView(server)),
      conflicts
    };
  }

  async workspaceList(rawPayload: unknown) {
    const payload = mcpWorkspaceListPayloadSchema.parse(rawPayload);
    return { workspace: await this.workspaceView(payload.scope) };
  }

  /**
   * 保存一条工作区声明。
   *
   * 输入形状与全局 `save` 完全一致（值内联在 `input.env` / `input.headers` 里），
   * 这里负责拆分：
   *   - 字符串值 → 官方凭证存储 `credentials.set()`；
   *   - `null`   → `credentials.unset()`，并从声明里删掉这个键；
   *   - 未出现   → 保留既有声明与既有值（编辑时不重填密钥的实现方式）。
   * 落盘的声明只含键名，所以 `<工作区>/.dsh/mcp.json` 里永远没有值。
   */
  async workspaceSave(rawPayload: unknown) {
    const payload = mcpWorkspaceSavePayloadSchema.parse(rawPayload);
    const projectRoot = await normalizeWorkspace(payload.scope);
    const input = payload.input;
    const previousName = payload.previousServerName ?? input.serverName;

    const { servers } = await readWorkspaceServers(projectRoot);
    const previous = servers.find((item) => item.serverName === previousName);
    if (payload.previousServerName !== undefined && previous === undefined) {
      throw new Error('要编辑的工作区服务器不存在："' + previousName + '"');
    }
    if (servers.some((item) => item.serverName === input.serverName && item.serverName !== previousName)) {
      throw new Error('该工作区中已存在 serverName "' + input.serverName + '"');
    }
    const globals = await globalServerNames(this.C);
    if (globals.has(input.serverName)) {
      throw new Error(
        'serverName "' + input.serverName + '" 已被全局作用域占用（cordis.patch.yml）。同名会让该会话解析出两组工具，请换名，或改到全局作用域编辑'
      );
    }

    // ── 声明（只键名）先算好并校验，避免"先写凭证再报错"的副作用 ─────────
    const envPatch = (input.transport === "stdio" ? input.env : undefined) ?? {};
    const headerPatch = (input.transport === "streamable-http" ? input.headers : undefined) ?? {};
    const previousEnv = new Set(previous?.transport === "stdio" ? previous.envKeys : []);
    const previousHeaders = new Map(Object.entries((previous?.headerRefs ?? {}) as Record<string, string>));
    const envKeys = new Set(previousEnv);
    for (const [name, value] of Object.entries(envPatch)) {
      if (value === null) envKeys.delete(name);
      else envKeys.add(name);
    }
    const headerRefs = new Map(previousHeaders);
    for (const [header, value] of Object.entries(headerPatch)) {
      if (value === null) headerRefs.delete(header);
      else headerRefs.set(header, headerRefName(input.serverName, header));
    }

    const declaration: WorkspaceMcpServer = {
      serverName: input.serverName,
      transport: input.transport,
      enabled: previous !== undefined ? previous.enabled !== false : payload.enabled,
      command: input.transport === "stdio" ? input.command : "",
      args: input.transport === "stdio" ? input.args : [],
      cwd: input.transport === "stdio" ? input.cwd : "",
      url: input.transport === "streamable-http" ? input.url : "",
      envKeys: [...envKeys],
      headerRefs: Object.fromEntries(headerRefs),
      toolCallTimeoutMs: input.toolCallTimeoutMs,
      failOnStartupError: input.failOnStartupError,
      reconnect: input.reconnect
    } as WorkspaceMcpServer;
    const problems = validateWorkspaceServer(declaration);
    if (problems.length > 0) throw new Error("工作区 MCP 声明无效：" + problems.join("；"));

    // ── 值 → 官方凭证存储 ────────────────────────────────────────────────
    const provider = this.C.get?.("credentials");
    const seam = await loadCredentialSeam(this.C);
    const failures: string[] = [];
    const store = async (refName: string, value: string | null) => {
      if (provider === undefined || typeof provider.set !== "function") {
        failures.push(refName + "（该 DSH 未提供凭证服务）");
        return;
      }
      const branded = seam === undefined ? refName : seam.credentialRef(refName);
      try {
        if (value === null) await provider.unset(branded);
        else await provider.set(branded, value);
      } catch (error) {
        failures.push(refName + "（" + (error instanceof Error ? error.message : String(error)) + "）");
      }
    };
    for (const [name, value] of Object.entries(envPatch)) await store(name, value);
    for (const [header, value] of Object.entries(headerPatch)) await store(headerRefName(input.serverName, header), value);
    if (failures.length > 0) {
      throw new Error("凭证写入失败，声明未改动：" + failures.join("；"));
    }

    const next = servers.filter((item) => item.serverName !== previousName && item.serverName !== declaration.serverName);
    next.push(declaration);
    next.sort((left, right) => left.serverName.localeCompare(right.serverName));
    await writeWorkspaceServers(projectRoot, next);
    return { workspace: await this.workspaceView(projectRoot) };
  }

  async workspaceRemoveServer(rawPayload: unknown) {
    const payload = mcpWorkspaceRemovePayloadSchema.parse(rawPayload);
    const projectRoot = await normalizeWorkspace(payload.scope);
    const { servers } = await readWorkspaceServers(projectRoot);
    if (!servers.some((item) => item.serverName === payload.serverName)) {
      throw new Error('该工作区中没有 serverName "' + payload.serverName + '"');
    }
    await writeWorkspaceServers(projectRoot, servers.filter((item) => item.serverName !== payload.serverName));
    return { workspace: await this.workspaceView(projectRoot) };
  }

  async workspaceSetEnabled(rawPayload: unknown) {
    const payload = mcpWorkspaceSetEnabledPayloadSchema.parse(rawPayload);
    const projectRoot = await normalizeWorkspace(payload.scope);
    const { servers } = await readWorkspaceServers(projectRoot);
    const target = servers.find((item) => item.serverName === payload.serverName);
    if (target === undefined) throw new Error('该工作区中没有 serverName "' + payload.serverName + '"');
    target.enabled = payload.enabled;
    await writeWorkspaceServers(projectRoot, servers);
    return { workspace: await this.workspaceView(projectRoot) };
  }

  /** 测试连接：先用官方凭证 seam 解析出明文，再走与全局作用域相同的探针。 */
  async workspaceTest(rawPayload: unknown) {
    const payload = mcpWorkspaceTestPayloadSchema.parse(rawPayload);
    const projectRoot = await normalizeWorkspace(payload.scope);
    const { servers } = await readWorkspaceServers(projectRoot);
    const server = servers.find((item) => item.serverName === payload.serverName);
    if (server === undefined) throw new Error('该工作区中没有 serverName "' + payload.serverName + '"');
    const seam = await loadCredentialSeam(this.C);
    const resolved = await resolveWorkspaceServer(server, this.C.get?.("credentials"), seam);
    if (resolved.input === undefined) {
      const reason = resolved.error ?? (resolved.invalid.length > 0 ? resolved.invalid.join("；") : "工作区声明无效");
      return { ok: false, tools: [], error: reason };
    }
    return probeMcpServer(resolved.input);
  }

  reload() {
    return this.list();
  }
}

// 供 CLI 复用：判断一个 patch 行是否由面板管理。
export { MANAGED_ROW_IDS, isManagedRow, MCP_PLUGIN_NAME };
