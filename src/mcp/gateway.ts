/**
 * dsh-skill-mcp-panel —— MCP 宿主服务（mcpManager）。
 */
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { resolveDshHome } from "../host-paths.js";
import { loadToolFilter, saveToolFilter } from "../tool-filter.js";
import {
  authorizationHeader,
  buildAuthorizationUrl,
  createPkce,
  discoverMetadata,
  exchangeCode,
  isExpired,
  loadOAuthStore,
  normalizeServerUrl,
  registerClient,
  removeOAuthRecord,
  saveOAuthRecord,
  startLoopbackServer
} from "../oauth.js";
import {
  MCP_PLUGIN_NAME,
  isManagedRow,
  listMcpPatchRows,
  readManagedBlock,
  readPatchFile,
  writeManagedRows,
  type PatchRow
} from "../patch-editor.js";
import {
  applyServerEdit,
  describeSchemaError,
  inputFromPatchRow,
  mcpServerInputSchema,
  patchRowToView,
  rowIdForServerName,
  serverNameFromRowId,
  type McpServerInput
} from "./model.js";
import {
  mcpOAuthPollPayloadSchema,
  mcpOAuthServerPayloadSchema,
  mcpOAuthStartPayloadSchema,
  mcpRemovePayloadSchema,
  mcpSavePayloadSchema,
  mcpSetEnabledPayloadSchema,
  mcpTestPayloadSchema,
  mcpToolsPayloadSchema,
  mcpToolFilterPayloadSchema
} from "./wire.js";
import { fiberPhaseOf, getLoaderEntry, mcpToolCount, waitForLoaderState } from "./status.js";
import { probeMcpServer } from "./probe.js";


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

/**
 * handler 内校验 payload：失败抛「字段：原因」的中文错误。
 * 网关边界的 codec 是宽松 schema（见 wire.ts），校验必须在这里做，
 * 否则失败会退化成宿主那句泛化的 `failed boundary validation`。
 */
function parseWirePayload(schema: { safeParse: (value: unknown) => any }, raw: unknown, label: string): any {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  throw new Error(label + "：" + describeSchemaError(result.error));
}

/** 进行中的 OAuth 登录流程（flowId → 流程状态）。一次登录一条，完成或失败即清理。 */
const OAUTH_FLOWS = new Map<string, any>();

export class McpManagerGateway extends TypertRemoteService {
  toolFilter: any;

  constructor(ctx: any, toolFilter?: any) {
    super(ctx, "mcpManager");
    this.toolFilter = toolFilter;
  }

  get C(): any {
    return this.ctx as any;
  }

  patchPath(): string {
    const base = this.C.baseUrl;
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

  async readRows() {
    const path = this.patchPath();
    const raw = await readPatchFile(path);
    // managed 只含面板自己的行；块内其余条目（外来行）原样保留、面板永不改写。
    const { managed, foreign } = readManagedBlock(raw);
    const allMcp = listMcpPatchRows(raw);
    const managedIds = new Set(managed.map((row) => row.id).filter((id): id is string => typeof id === "string"));
    const external = allMcp.filter((row) => typeof row.id === "string" && !managedIds.has(row.id));
    return { path, raw, managed, external, foreign };
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
    let patch = { path: this.patchPath(), ok: false, error: null as string | null, foreign: [] as { id?: string; name?: string; managed: boolean }[] };
    try {
      const { path, managed, external, foreign } = await this.readRows();
      patch = { path, ok: true, error: null, foreign: foreign.entries };
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
        // 面板自己的行落在受管块之外时，行级操作仍然认它（findRowByServerName 用
        // isManagedRow），但改写只发生在受管块里，所以它在这里只读。标 orphan 让界面
        // 能说清"这行是面板的，只是不在块内"，而不是笼统的"外部管理"。
        if (view !== undefined) externalServers.push(isManagedRow(row) ? { ...view, orphan: true } : view);
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
    const payload = parseWirePayload(mcpSavePayloadSchema, rawPayload, "MCP 配置无效");
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
    const payload = parseWirePayload(mcpRemovePayloadSchema, rawPayload, "删除参数无效");
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
    const payload = parseWirePayload(mcpSetEnabledPayloadSchema, rawPayload, "启用参数无效");
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
    const payload = parseWirePayload(mcpTestPayloadSchema, rawPayload, "测试参数无效");
    if (payload !== null && typeof payload === "object" && !("transport" in payload) && "serverName" in payload) {
      const { managed, external } = await this.readRows();
      const row = [...managed, ...external].find((candidate) => candidate.config?.serverName === payload.serverName || serverNameFromRowId(candidate.id) === payload.serverName);
      if (row === undefined) throw new Error('MCP 行 "' + String(payload.serverName) + '" 不存在');
      return probeMcpServer(this.configInputFromRow(row));
    }
    return probeMcpServer(payload);
  }

  /**
   * 某个 MCP 服务器当前注册的工具（公开名 `mcp__<serverName>__<原始名>`）。
   * 只读工具注册表、不启动服务器：服务器还没连上时返回空列表，界面按「未连接」显示。
   */
  serverToolRows(serverName: string) {
    const prefix = "mcp__" + serverName + "__";
    const rows: any[] = [];
    try {
      const view = this.C.tools.view(undefined);
      for (const name of view.knownNames ?? []) {
        if (typeof name !== "string" || !name.startsWith(prefix)) continue;
        const definition = typeof view.visible?.get === "function" ? view.visible.get(name) : undefined;
        rows.push(stripUndefined({ name, description: typeof definition?.description === "string" ? definition.description : undefined }));
      }
    } catch {
      // 工具注册表不可用：当作「一个都不知道」，界面显示未连接。
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  }

  dshHomeOf(): string {
    return resolveDshHome();
  }

  /** 运行中控制器的禁用列表；还没挂上（或没有控制器）时返回 undefined，由调用方读盘。 */
  liveDeny(): string[] | undefined {
    const names = this.toolFilter?.denyOf?.();
    return Array.isArray(names) ? [...names] : undefined;
  }

  /** 列出一个 MCP 服务器的工具，并标出其中已被禁用的（Issue #44）。 */
  async listTools(rawPayload: unknown) {
    const payload = parseWirePayload(mcpToolsPayloadSchema, rawPayload, "工具查询参数无效");
    const tools = this.serverToolRows(payload.serverName);
    const deny = this.liveDeny() ?? await loadToolFilter(this.dshHomeOf());
    return {
      serverName: payload.serverName,
      tools,
      disabled: deny.filter((name) => tools.some((row) => row.name === name)),
      connected: tools.length > 0
    };
  }

  /** 读取单工具禁用列表。 */
  async getToolFilter() {
    const deny = this.liveDeny() ?? await loadToolFilter(this.dshHomeOf());
    return { deny: [...deny].sort(), applied: this.appliedAgentCount() };
  }

  /** 写入单工具禁用列表并立刻重新施加到所有 agent（Issue #44）。 */
  async setToolFilter(rawPayload: unknown) {
    const payload = parseWirePayload(mcpToolFilterPayloadSchema, rawPayload, "工具过滤参数无效");
    const deny: string[] = [
      ...new Set<string>(payload.deny.filter((value: unknown): value is string => typeof value === "string" && value.startsWith("mcp__")))
    ].sort();
    await saveToolFilter(this.dshHomeOf(), deny);
    if (this.toolFilter !== undefined && typeof this.toolFilter.setDeny === "function") this.toolFilter.setDeny(deny);
    return { deny, applied: this.appliedAgentCount() };
  }

  appliedAgentCount(): number {
    return this.toolFilter !== undefined && typeof this.toolFilter.activeCount === "function" ? this.toolFilter.activeCount() : 0;
  }

  /** 找到某个服务器的受管行（OAuth 要读写它的 headers）。 */
  managedRow(rows: PatchRow[], serverName: string): PatchRow | undefined {
    return rows.find((row) => serverNameFromRowId(row.id) === serverName || row.config?.serverName === serverName);
  }

  /** 把 Authorization 头写进那一行（其它 header 原样保留）。 */
  async writeAuthHeader(serverName: string, value: string | undefined) {
    const { managed } = await this.readRows();
    const row = this.managedRow(managed, serverName);
    if (row === undefined) throw new Error('MCP 行 "' + serverName + '" 不存在或不是面板受管行');
    const config: any = row.config ?? {};
    const headers = config.headers !== null && typeof config.headers === "object" && !Array.isArray(config.headers) ? { ...config.headers } : {};
    if (value === undefined) delete headers.Authorization;
    else headers.Authorization = value;
    const next = managed.map((candidate) => (candidate === row ? { ...row, config: { ...config, headers } } : candidate));
    await writeManagedRows(this.patchPath(), next);
  }

  /**
   * 开始一次 OAuth 登录（Issue #45 的面板入口）。
   * 返回授权地址：前端交给浏览器打开，然后轮询 `oauthPoll`。
   */
  async oauthStart(rawPayload: unknown) {
    const payload = parseWirePayload(mcpOAuthStartPayloadSchema, rawPayload, "OAuth 参数无效");
    const { managed, external } = await this.readRows();
    const row = this.managedRow([...managed, ...external], payload.serverName);
    if (row === undefined) throw new Error('MCP 行 "' + payload.serverName + '" 不存在');
    const config: any = row.config ?? {};
    if (config.transport !== "streamable-http" || typeof config.url !== "string" || config.url === "") {
      throw new Error("只有 streamable-http 的服务器能用 OAuth 登录（stdio 由本地进程自己管凭据）");
    }
    const metadata = await discoverMetadata(config.url);
    if (metadata === undefined) throw new Error("这个地址没有暴露 OAuth 发现文档（/.well-known/oauth-authorization-server），无法自动登录");
    const state = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const { verifier, challenge } = createPkce();
    const timeoutMs = Math.max(30, Math.min(900, Number(payload.timeoutSeconds ?? 300))) * 1000;
    const loopback = await startLoopbackServer(state, timeoutMs);
    const previous = (await loadOAuthStore(this.dshHomeOf()))[payload.serverName];
    const clientId = payload.clientId ?? previous?.clientId ?? (await registerClient(metadata, loopback.redirectUri))?.client_id;
    if (typeof clientId !== "string" || clientId === "") {
      await loopback.close();
      throw new Error("拿不到 client_id：服务器既不支持动态注册，也没有指定 clientId");
    }
    const authUrl = buildAuthorizationUrl(metadata, clientId, loopback.redirectUri, challenge, state, payload.scope);
    const flowId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const flow: any = {
      flowId,
      serverName: payload.serverName,
      state,
      clientId,
      metadata,
      redirectUri: loopback.redirectUri,
      verifier,
      url: normalizeServerUrl(config.url),
      status: "pending",
      error: undefined,
      startedAt: Date.now(),
      loopback
    };
    OAUTH_FLOWS.set(flowId, flow);
    // 后台等回调：失败也记在 flow 上、交给轮询回报，不在这里抛。
    loopback.waitForCode().then(
      (result: any) => {
        flow.code = result.code;
      },
      (error: any) => {
        flow.status = "failed";
        flow.error = error instanceof Error ? error.message : String(error);
      }
    );
    return { flowId, authUrl, redirectUri: loopback.redirectUri, expiresInSeconds: Math.round(timeoutMs / 1000) };
  }

  /** 轮询一次 OAuth 流程：pending / done / failed。拿到 code 就换令牌并落盘。 */
  async oauthPoll(rawPayload: unknown) {
    const payload = parseWirePayload(mcpOAuthPollPayloadSchema, rawPayload, "OAuth 轮询参数无效");
    const flow = OAUTH_FLOWS.get(payload.flowId);
    if (flow === undefined) throw new Error("这次登录流程不存在或已经结束，请重新点一次登录");
    if (flow.status === "failed") {
      OAUTH_FLOWS.delete(payload.flowId);
      await flow.loopback.close();
      return { status: "failed", error: flow.error ?? "授权失败", serverName: flow.serverName };
    }
    if (flow.code === undefined) return { status: "pending", serverName: flow.serverName };
    if (flow.status === "done") {
      return { status: "done", serverName: flow.serverName, expiresAt: flow.expiresAt ?? null, header: flow.header ?? "" };
    }
    flow.status = "exchanging";
    try {
      const tokens = await exchangeCode(flow.metadata, flow.clientId, flow.code, flow.verifier, flow.redirectUri);
      await saveOAuthRecord(this.dshHomeOf(), flow.serverName, {
        ...tokens,
        clientId: flow.clientId,
        serverUrl: flow.url,
        tokenEndpoint: flow.metadata.token_endpoint
      });
      const header = authorizationHeader(tokens);
      await this.writeAuthHeader(flow.serverName, header);
      flow.status = "done";
      flow.expiresAt = tokens.expiresAt;
      flow.header = header;
      await flow.loopback.close();
      const row = this.managedRow((await this.readRows()).managed, flow.serverName);
      if (row !== undefined && typeof row.id === "string") await waitForLoaderState(this.C, row.id, (entry: any) => entry !== undefined);
      return { status: "done", serverName: flow.serverName, expiresAt: flow.expiresAt ?? null, header };
    } catch (error) {
      flow.status = "failed";
      flow.error = error instanceof Error ? error.message : String(error);
      await flow.loopback.close();
      OAUTH_FLOWS.delete(payload.flowId);
      return { status: "failed", error: flow.error, serverName: flow.serverName };
    }
  }

  /** 某个服务器当前的 OAuth 状态（给卡片显示）。 */
  async oauthStatus(rawPayload: unknown) {
    const payload = parseWirePayload(mcpOAuthServerPayloadSchema, rawPayload, "OAuth 参数无效");
    const store = await loadOAuthStore(this.dshHomeOf());
    const record = store[payload.serverName];
    if (record === undefined) return { connected: false, headerReady: false, expiresAt: null, expired: false };
    const { managed, external } = await this.readRows();
    const row = this.managedRow([...managed, ...external], payload.serverName);
    const config: any = row?.config ?? {};
    const headers = config.headers !== null && typeof config.headers === "object" && !Array.isArray(config.headers) ? config.headers : {};
    return {
      connected: typeof headers.Authorization === "string" && headers.Authorization.indexOf("Bearer ") === 0,
      headerReady: typeof record.accessToken === "string",
      expiresAt: typeof record.expiresAt === "number" ? record.expiresAt : null,
      expired: isExpired(record)
    };
  }

  /** 断开 OAuth：删掉 Authorization 头与本地令牌记录。 */
  async oauthDisconnect(rawPayload: unknown) {
    const payload = parseWirePayload(mcpOAuthServerPayloadSchema, rawPayload, "OAuth 参数无效");
    await this.writeAuthHeader(payload.serverName, undefined);
    await removeOAuthRecord(this.dshHomeOf(), payload.serverName);
    const row = this.managedRow((await this.readRows()).managed, payload.serverName);
    if (row !== undefined && typeof row.id === "string") await waitForLoaderState(this.C, row.id, (entry: any) => entry !== undefined);
    return { disconnected: true, serverName: payload.serverName };
  }

  reload() {
    return this.list();
  }
}

// 供 CLI 复用：判断一个 patch 行是否由面板管理。
export { MANAGED_ROW_IDS, isManagedRow, MCP_PLUGIN_NAME };
