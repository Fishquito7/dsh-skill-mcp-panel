/**
 * dsh-skill-mcp-panel —— MCP 单工具禁用与作用域分层（Issue #44, #55, #62, #91）。
 *
 * 目标：让用户能按 MCP 工具名直接从**模型可见的工具清单**里藏掉多余的工具
 * （省去几千到几万 token 的工具 schema 上下文，不是运行时抛错拒调），
 * 并在不改 `cordis.patch.yml` 的前提下支持多层覆盖（#55）：
 *   1. 全局默认（global）：持久化的 Profile 级基线禁用集；
 *   2. 工作区覆盖（workspaces[cwd]）：命中当前会话工作区时追加禁用集；
 *   3. 当前会话覆盖（sessionOverrides，纯内存，会话结束后自动清理）：支持临时追加或放行；
 *   4. 子代理例外（roles.subagentAllow / roles.subagentDeny）：为子代理/协作代理放行或额外禁用。
 *
 * 生效优先级：
 *   effective = ((global ∪ workspace ∪ sessionDeny) \ sessionAllow)
 *   若 agent 为 subagent（origin === "subagent" 或 delegationDepth > 0）：
 *     effective = (effective \ roles.subagentAllow) ∪ roles.subagentDeny
 *
 * 配置持久化于 `<profileDir>/.dsh-skill-mcp-panel/tool-filter.json`（Profile 隔离，#91）。
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "./fs-utils.js";
import { groupsRoot } from "./groups.js";

const TOOL_FILTER_VERSION = 1;
const PROFILE_DATA_DIR = ".dsh-skill-mcp-panel";

export interface ToolFilterRoles {
  subagentAllow: string[];
  subagentDeny: string[];
}

export interface ToolFilterPolicy {
  version: number;
  deny: string[];
  workspaces: Record<string, string[]>;
  roles: ToolFilterRoles;
}

export interface SessionToolOverride {
  deny: string[];
  allow: string[];
}

export function normalizeToolNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed === "" || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out.sort();
}

export function normalizeWorkspaceKey(raw: string): string {
  const unified = String(raw ?? "").trim().replace(/\\/g, "/");
  if (unified === "") return "";
  if (unified === "/") return "/";
  const stripped = unified.replace(/\/+$/, "");
  return /^[a-zA-Z]:$/.test(stripped) ? stripped + "/" : stripped;
}

function workspaceLookupKey(raw: string): string {
  const norm = normalizeWorkspaceKey(raw);
  return /^[a-zA-Z]:\//.test(norm) ? norm[0].toLowerCase() + norm.slice(1) : norm;
}

export function emptyToolFilterPolicy(deny: string[] = []): ToolFilterPolicy {
  return {
    version: TOOL_FILTER_VERSION,
    deny: normalizeToolNames(deny),
    workspaces: {},
    roles: { subagentAllow: [], subagentDeny: [] }
  };
}

export function normalizeToolFilterPolicy(raw: any): ToolFilterPolicy {
  if (Array.isArray(raw)) return emptyToolFilterPolicy(raw);
  if (raw === null || typeof raw !== "object") return emptyToolFilterPolicy([]);
  const workspaces: Record<string, string[]> = {};
  if (raw.workspaces !== null && typeof raw.workspaces === "object" && !Array.isArray(raw.workspaces)) {
    for (const [k, v] of Object.entries(raw.workspaces as Record<string, unknown>)) {
      const key = normalizeWorkspaceKey(k);
      const list = normalizeToolNames(v);
      if (key !== "" && list.length > 0) workspaces[key] = list;
    }
  }
  const rolesRaw = raw.roles !== null && typeof raw.roles === "object" ? raw.roles : {};
  return {
    version: TOOL_FILTER_VERSION,
    deny: normalizeToolNames(raw.deny),
    workspaces,
    roles: {
      subagentAllow: normalizeToolNames(rolesRaw.subagentAllow),
      subagentDeny: normalizeToolNames(rolesRaw.subagentDeny)
    }
  };
}

/** 当前禁用工具列表的文件位置（Profile 隔离不可用时的 legacy 全局路径）。 */
export function toolFilterFile(dshHome: string): string {
  return join(groupsRoot(dshHome), "tool-filter.json");
}

/** 按 Profile 根目录定位 tool-filter.json。 */
export function profileToolFilterFile(profileDir: string): string {
  return join(profileDir, PROFILE_DATA_DIR, "tool-filter.json");
}

/** 从宿主 ctx 提取 Profile 目录。 */
export function profileDirOf(ctx: any): string | undefined {
  try {
    const profile = typeof ctx?.get === "function" ? ctx.get("profileContext") : undefined;
    const dir = profile?.dir;
    return typeof dir === "string" && dir !== "" ? dir : undefined;
  } catch {
    return undefined;
  }
}

function resolveToolFilterPath(dshHome: string, profileDir?: string): string {
  return typeof profileDir === "string" && profileDir !== ""
    ? profileToolFilterFile(profileDir)
    : toolFilterFile(dshHome);
}

function parseToolFilterPolicyPayload(raw: string): ToolFilterPolicy | undefined {
  const parsed: any = JSON.parse(raw);
  if (parsed !== null && typeof parsed === "object" && Array.isArray(parsed.deny)) {
    return normalizeToolFilterPolicy(parsed);
  }
  return undefined;
}

/** 读取完整工具过滤策略；Profile 首次缺失时懒迁移旧全局配置 (#91)。 */
export async function loadToolFilterPolicy(dshHome: string, profileDir?: string): Promise<ToolFilterPolicy> {
  const target = resolveToolFilterPath(dshHome, profileDir);
  try {
    const raw = await readFile(target, "utf8");
    return parseToolFilterPolicyPayload(raw) ?? emptyToolFilterPolicy([]);
  } catch (error: any) {
    if (error?.code !== "ENOENT" || typeof profileDir !== "string" || profileDir === "") {
      return emptyToolFilterPolicy([]);
    }
  }
  try {
    const legacyRaw = await readFile(toolFilterFile(dshHome), "utf8");
    const migrated = parseToolFilterPolicyPayload(legacyRaw);
    if (migrated === undefined) return emptyToolFilterPolicy([]);
    await writeFileAtomic(target, JSON.stringify(migrated, null, 2) + "\n").catch(() => {});
    return migrated;
  } catch {
    return emptyToolFilterPolicy([]);
  }
}

/** 原子写入完整工具过滤策略（写到当前 profile 目录；无 profileContext 时退回 dshHome）。 */
export async function saveToolFilterPolicy(dshHome: string, policy: ToolFilterPolicy, profileDir?: string): Promise<ToolFilterPolicy> {
  const normalized = normalizeToolFilterPolicy(policy);
  const path = resolveToolFilterPath(dshHome, profileDir);
  await writeFileAtomic(path, JSON.stringify(normalized, null, 2) + "\n");
  return normalized;
}

/** 兼容入口：只读全局基线 `deny` 数组。 */
export async function loadToolFilter(dshHome: string, profileDir?: string): Promise<string[]> {
  return (await loadToolFilterPolicy(dshHome, profileDir)).deny;
}

/** 兼容入口：写全局 `deny` 时保留已保存的 `workspaces` 与 `roles` 覆盖层。 */
export async function saveToolFilter(dshHome: string, deny: string[], profileDir?: string): Promise<void> {
  const current = await loadToolFilterPolicy(dshHome, profileDir);
  await saveToolFilterPolicy(dshHome, { ...current, deny: normalizeToolNames(deny) }, profileDir);
}

/** 从 agent 对象判断是否为子代理（subagent / teammate）。 */
export function isSubagentAgent(agent: any): boolean {
  const header = agent?.session?.header;
  if (header?.origin === "subagent") return true;
  if (typeof header?.delegationDepth === "number" && header.delegationDepth > 0) return true;
  if (agent?.origin === "subagent") return true;
  return false;
}

/** 读取 agent 关联的工作区路径（用于匹配 workspace 层）。 */
export function agentWorkspaceOf(agent: any): string | undefined {
  const raw = agent?.session?.header?.cwd ?? agent?.cwd ?? agent?.workspace;
  return typeof raw === "string" && raw.trim() !== "" ? raw : undefined;
}

/** 读取 agent 关联的会话 ID。 */
export function agentSessionIdOf(agent: any): string | undefined {
  const raw = agent?.session?.header?.id ?? agent?.session?.id ?? agent?.sessionId;
  return typeof raw === "string" && raw !== "" ? raw : undefined;
}

function agentParentSessionIdOf(agent: any): string | undefined {
  const raw = agent?.session?.header?.parentSession;
  return typeof raw === "string" && raw !== "" ? raw : undefined;
}

/** 计算某个 agent 在全部作用域叠加后实际应生效的禁用列表。 */
export function resolveEffectiveDeny(
  policy: ToolFilterPolicy,
  sessionOverrides: Map<string, SessionToolOverride>,
  agent: any
): string[] {
  const denySet = new Set<string>(policy.deny);
  const cwd = agentWorkspaceOf(agent);
  if (cwd !== undefined) {
    const targetKey = workspaceLookupKey(cwd);
    for (const [wsKey, wsDeny] of Object.entries(policy.workspaces)) {
      if (workspaceLookupKey(wsKey) === targetKey) {
        for (const name of wsDeny) denySet.add(name);
      }
    }
  }

  const sessionId = agentSessionIdOf(agent);
  const parentId = agentParentSessionIdOf(agent);
  const override =
    (sessionId !== undefined ? sessionOverrides.get(sessionId) : undefined) ??
    (parentId !== undefined ? sessionOverrides.get(parentId) : undefined);
  if (override !== undefined) {
    for (const name of override.deny) denySet.add(name);
    for (const name of override.allow) denySet.delete(name);
  }

  if (isSubagentAgent(agent)) {
    for (const name of policy.roles.subagentAllow) denySet.delete(name);
    for (const name of policy.roles.subagentDeny) denySet.add(name);
  }

  return [...denySet].sort();
}

/** 把错误整理成一行日志文本。 */
function errorText(error: unknown): string {
  if (error !== null && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return String(error);
}

function warnOf(ctx: any, message: string): void {
  const line = "[tool-filter] " + message;
  try {
    const logger = typeof ctx?.get === "function" ? ctx.get("logger") : undefined;
    if (logger !== null && typeof logger === "object" && typeof logger.warn === "function") {
      logger.warn(line);
      return;
    }
  } catch {
    // logger 不可用
  }
  try {
    if (typeof console !== "undefined" && typeof console.warn === "function") console.warn(line);
  } catch {
    // 忽略
  }
}

/** 一个 agent 上挂着的过滤插件：纤维 + 重新施加 / 切换限制集合的回调。 */
interface MountedFilter {
  fiber: any;
  holder: { sync: () => void; setDeny: (next: string[]) => void };
}

/**
 * 把作用域策略动态施加到每一个 agent。
 * 每个 agent 根据自身 workspace / session / subagent 角色计算 effectiveDeny，
 * 通过 `holder.setDeny(next)` 原位更新，避免频繁卸载重挂导致 flicker 或重入。
 */
export class ToolFilterController {
  ctx: any;
  policy: ToolFilterPolicy;
  sessionOverrides: Map<string, SessionToolOverride> = new Map();
  mounted: Map<string, MountedFilter> = new Map();
  /** 正在挂载的 agent：挂载途中 restrict() 会同步 emit tools/change，必须挡住重入。 */
  mounting: Set<string> = new Set();
  /** tools/change 的重入守卫。 */
  syncing = false;
  disposed = false;

  constructor(ctx: any, initial: string[] | ToolFilterPolicy) {
    this.ctx = ctx;
    this.policy = normalizeToolFilterPolicy(initial);
  }

  /** 兼容旧调用方直接读 `controller.deny`。 */
  get deny(): string[] {
    return this.policy.deny;
  }

  pluginFor(initialDeny: string[]): { plugin: any; holder: { sync: () => void; setDeny: (next: string[]) => void } } {
    let activeDeny = initialDeny.slice();
    const holder: { sync: () => void; setDeny: (next: string[]) => void } = {
      sync: () => {},
      setDeny: (next: string[]) => {
        activeDeny = next.slice();
      }
    };
    return {
      holder,
      plugin: {
        name: "dsh-skill-mcp-panel:tool-filter",
        inject: ["tools"],
        apply(c: any) {
          let undo: (() => void) | undefined;
          let applied: string | null = null;
          let live = true;
          let inside = false;
          const sync = () => {
            if (!live || inside) return;
            inside = true;
            try {
              syncOnce();
            } finally {
              inside = false;
            }
          };
          const syncOnce = () => {
            let known: Set<string>;
            try {
              known = new Set<string>(c.tools.view(undefined).restrictableNames);
            } catch (error) {
              warnOf(c, "读取可限制工具列表失败：" + errorText(error));
              return;
            }
            const usable = activeDeny.filter((name) => known.has(name));
            const signature = usable.slice().sort().join("\u0000");
            if (signature === applied) return;
            if (undo !== undefined) {
              try {
                undo();
              } catch (error) {
                warnOf(c, "撤销上一轮限制失败：" + errorText(error));
              }
              undo = undefined;
              applied = null;
            }
            if (usable.length === 0) {
              applied = "";
              return;
            }
            try {
              undo = c.tools.restrict({ deny: usable });
              applied = signature;
            } catch (error) {
              warnOf(c, "施加工具限制失败：" + errorText(error));
              undo = undefined;
              applied = null;
            }
          };
          holder.sync = sync;
          holder.setDeny = (next: string[]) => {
            activeDeny = next.slice();
            sync();
          };
          try {
            c.effect(() => () => {
              live = false;
              holder.sync = () => {};
              holder.setDeny = () => {};
            });
          } catch {
            // 极简宿主无 effect
          }
          sync();
        }
      }
    };
  }

  /** 对所有已挂载的 agent 补一轮限制。 */
  syncAll(): void {
    if (this.disposed || this.syncing) return;
    this.syncing = true;
    try {
      for (const entry of [...this.mounted.values()]) {
        try {
          entry.holder.sync();
        } catch (error) {
          warnOf(this.ctx, "重新施加工具限制失败：" + errorText(error));
        }
      }
    } finally {
      this.syncing = false;
    }
  }

  /** 按 agent 作用域计算有效禁用集并挂载或原位更新。 */
  applyTo(agent: any): void {
    if (this.disposed || agent === null || typeof agent !== "object") return;
    const id = typeof agent.id === "string" ? agent.id : undefined;
    if (id === undefined || this.mounting.has(id)) return;
    const effective = resolveEffectiveDeny(this.policy, this.sessionOverrides, agent);
    const mounted = this.mounted.get(id);
    if (mounted !== undefined) {
      this.syncing = true;
      try {
        if (effective.length === 0) {
          this.mounted.delete(id);
          mounted.fiber?.dispose?.();
        } else {
          mounted.holder.setDeny(effective);
        }
      } catch (error) {
        warnOf(this.ctx, "更新工具限制失败（agent " + id + "）：" + errorText(error));
      } finally {
        this.syncing = false;
      }
      return;
    }
    if (effective.length === 0) return;
    const scopeCtx = agent.ctx;
    if (scopeCtx === undefined || typeof scopeCtx.plugin !== "function") return;
    this.mounting.add(id);
    try {
      const { plugin, holder } = this.pluginFor(effective);
      const fiber = scopeCtx.plugin(plugin);
      this.mounted.set(id, { fiber, holder });
    } catch (error) {
      warnOf(this.ctx, "挂载工具过滤插件失败（agent " + id + "）：" + errorText(error));
    } finally {
      this.mounting.delete(id);
    }
  }

  /** 对全部已知 agent 重新计算并施加/更新限制。 */
  reapply(): void {
    if (this.disposed) return;
    for (const agent of this.listAgents()) this.applyTo(agent);
  }

  /** agent 销毁后清账，并在无其它同会话 agent 存活时清理会话级内存覆盖。 */
  release(id: string, agent?: any): void {
    this.mounted.delete(id);
    const sessionId = agentSessionIdOf(agent);
    if (sessionId !== undefined && this.sessionOverrides.has(sessionId)) {
      const stillAlive = this.listAgents().some((other) => other?.id !== id && agentSessionIdOf(other) === sessionId);
      if (!stillAlive) this.sessionOverrides.delete(sessionId);
    }
  }

  /** 更新完整持久策略（global / workspaces / roles）并立即重算每个 agent。 */
  setPolicy(nextPolicy: ToolFilterPolicy): void {
    this.policy = normalizeToolFilterPolicy(nextPolicy);
    this.reapply();
  }

  /** 更新某个会话的内存覆盖并立即重算每个 agent（override 为空则清除该会话覆盖）。 */
  setSessionOverride(sessionId: string, override: { deny?: string[]; allow?: string[] } | undefined): void {
    if (typeof sessionId !== "string" || sessionId === "") return;
    const deny = normalizeToolNames(override?.deny);
    const allow = normalizeToolNames(override?.allow);
    if (deny.length === 0 && allow.length === 0) {
      this.sessionOverrides.delete(sessionId);
    } else {
      this.sessionOverrides.set(sessionId, { deny, allow });
    }
    this.reapply();
  }

  /** 兼容入口：仅更新全局禁用列表，保留已有的工作区与角色覆盖。 */
  setDeny(deny: string[]): void {
    this.policy = { ...this.policy, deny: normalizeToolNames(deny) };
    this.reapply();
  }

  unmountAll(): void {
    for (const [id, entry] of [...this.mounted.entries()]) {
      this.mounted.delete(id);
      try {
        entry.fiber?.dispose?.();
      } catch (error) {
        warnOf(this.ctx, "卸载工具过滤插件失败（agent " + id + "）：" + errorText(error));
      }
    }
  }

  listAgents(): any[] {
    try {
      const agents = this.ctx.get("agents");
      const rows = agents?.list?.();
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  activeCount(): number {
    return this.mounted.size;
  }

  denyOf(): string[] {
    return this.policy.deny;
  }

  policyOf(): ToolFilterPolicy {
    return this.policy;
  }

  sessionOverridesObject(): Record<string, SessionToolOverride> {
    const out: Record<string, SessionToolOverride> = {};
    for (const [id, val] of this.sessionOverrides.entries()) out[id] = val;
    return out;
  }

  dispose(): void {
    this.disposed = true;
    this.sessionOverrides.clear();
    this.unmountAll();
  }
}

export function attachToolFilter(ctx: any, initial: string[] | ToolFilterPolicy): ToolFilterController {
  const controller = new ToolFilterController(ctx, initial);
  const offCreated = ctx.on("agent/created", (payload: any) => {
    controller.applyTo(payload?.agent);
  });
  const offDisposed = ctx.on("agent/disposed", (payload: any) => {
    const agent = payload?.agent;
    if (typeof agent?.id === "string") controller.release(agent.id, agent);
  });
  const offTools = ctx.on("tools/change", () => controller.syncAll());
  controller.reapply();
  const originalDispose = controller.dispose.bind(controller);
  controller.dispose = () => {
    for (const off of [offCreated, offDisposed, offTools]) {
      if (typeof off === "function") {
        try {
          off();
        } catch {
          // 忽略
        }
      }
    }
    originalDispose();
  };
  return controller;
}
