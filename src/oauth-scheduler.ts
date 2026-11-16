/**
 * OAuth 2.0 令牌主动续期调度器（Issue #80）。
 *
 * 设计要点：
 *   1. 在 `expiresAt - leadMs`（默认提前 5 分钟）提前触发续期，不依赖人工点击或过期才报错；
 *   2. 同一台服务器同时只允许一个 in-flight 续期请求（single-flight）；
 *   3. 多 profile 并行运行共享同一份 `<dshHome>/skills/.system/skill-viewer/oauth.json`：
 *      刷新前先重读磁盘确认是否已被兄弟进程刷新；若 refresh_token 已轮转并撞上并发 `invalid_grant`，
 *      再读一次磁盘接力采纳兄弟进程写回的新令牌，避免双刷报废；
 *   4. 永久失败（invalid_grant / invalid_client / unauthorized_client 等）立即停止重试并标
 *      `needsReauth: true`；临时失败按有限退避重试（默认最多 3 次），绝不引发重试风暴，
 *      且所有日志与错误状态都经过 `redactOAuthText` 脱敏。
 */
import {
  OAuthRefreshError,
  loadOAuthStore,
  redactOAuthText,
  refreshTokens,
  updateOAuthRecord
} from "./oauth.js";

export const DEFAULT_REFRESH_LEAD_MS = 5 * 60 * 1000;
export const DEFAULT_RETRY_DELAYS_MS = [15_000, 60_000, 180_000];
const MAX_TIMEOUT_MS = 2_147_483_647;

export interface OAuthRefreshOutcome {
  ok: boolean;
  refreshed?: boolean;
  syncedFromDisk?: boolean;
  needsReauth?: boolean;
  expiresAt?: number;
  error?: string;
  record?: any;
}

export interface OAuthSchedulerOptions {
  dshHome: any;
  fetchImpl?: any;
  onTokenRefreshed: (serverName: string, record: any) => Promise<unknown> | unknown;
  onRecordUpdated?: (serverName: string, record: any) => void;
  logger?: { debug?: Function; warn?: Function; info?: Function };
  leadMs?: number;
  retryDelaysMs?: number[];
  now?: () => number;
}

export class OAuthRefreshScheduler {
  private readonly dshHome: any;
  private readonly fetchImpl: any;
  private readonly onTokenRefreshed: (serverName: string, record: any) => Promise<unknown> | unknown;
  private readonly onRecordUpdated?: (serverName: string, record: any) => void;
  private readonly logger?: { debug?: Function; warn?: Function; info?: Function };
  private readonly leadMs: number;
  private readonly retryDelaysMs: number[];
  private readonly now: () => number;
  private readonly timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private readonly inflight: Map<string, Promise<OAuthRefreshOutcome>> = new Map();
  private readonly retryCounts: Map<string, number> = new Map();
  private disposed = false;

  constructor(options: OAuthSchedulerOptions) {
    this.dshHome = options.dshHome;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.onTokenRefreshed = options.onTokenRefreshed;
    this.onRecordUpdated = options.onRecordUpdated;
    this.logger = options.logger;
    this.leadMs = options.leadMs ?? DEFAULT_REFRESH_LEAD_MS;
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.now = options.now ?? (() => Date.now());
  }

  /** 启动时同步一次 oauth.json：为即将过期或已过期的可刷新记录安排续期。 */
  async syncFromStore(): Promise<void> {
    if (this.disposed) return;
    const store = await loadOAuthStore(this.dshHome);
    const activeNames = new Set(Object.keys(store));
    for (const existing of [...this.timers.keys()]) {
      if (!activeNames.has(existing)) this.unschedule(existing);
    }
    for (const [serverName, record] of Object.entries(store)) {
      this.scheduleRecord(serverName, record);
    }
  }

  /** 收到新令牌后刷新定时器并清零失败计数。 */
  schedule(serverName: string, record: any): void {
    this.retryCounts.delete(serverName);
    this.scheduleRecord(serverName, record);
  }

  /** 取消某台服务器的续期计划（断开连接或删除时调用）。 */
  unschedule(serverName: string): void {
    const existing = this.timers.get(serverName);
    if (existing !== undefined) {
      clearTimeout(existing);
      this.timers.delete(serverName);
    }
    this.retryCounts.delete(serverName);
  }

  /** 清理全部定时器，避免插件卸载后继续运行。 */
  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.retryCounts.clear();
  }

  private clearTimer(serverName: string): void {
    const existing = this.timers.get(serverName);
    if (existing !== undefined) {
      clearTimeout(existing);
      this.timers.delete(serverName);
    }
  }

  private scheduleRecord(serverName: string, record: any): void {
    this.clearTimer(serverName);
    if (this.disposed || record === null || typeof record !== "object") return;
    if (typeof record.refreshToken !== "string" || record.refreshToken === "") return;
    if (typeof record.tokenEndpoint !== "string" || record.tokenEndpoint === "") return;
    if (record.needsReauth === true) return;
    if (typeof record.expiresAt !== "number") return;

    const dueAt = record.expiresAt - this.leadMs;
    const delay = dueAt - this.now();
    if (delay <= 0) {
      void this.refreshServer(serverName);
      return;
    }
    const waitMs = Math.min(delay, MAX_TIMEOUT_MS);
    const timer = setTimeout(() => {
      this.timers.delete(serverName);
      if (this.disposed) return;
      if (waitMs < delay) this.scheduleRecord(serverName, record);
      else void this.refreshServer(serverName);
    }, waitMs);
    (timer as any)?.unref?.();
    this.timers.set(serverName, timer);
  }

  /** 按服务器名执行单次续期（in-flight 去重）。 */
  refreshServer(serverName: string, options: { force?: boolean } = {}): Promise<OAuthRefreshOutcome> {
    if (this.disposed) return Promise.resolve({ ok: false, error: "scheduler disposed" });
    const existing = this.inflight.get(serverName);
    if (existing !== undefined) return existing;
    const task = this.runRefresh(serverName, options).finally(() => {
      if (this.inflight.get(serverName) === task) this.inflight.delete(serverName);
    });
    this.inflight.set(serverName, task);
    return task;
  }

  private async applyHeaderSafe(serverName: string, record: any): Promise<void> {
    try {
      await this.onTokenRefreshed(serverName, record);
    } catch (error) {
      this.logger?.warn?.(
        "dsh-skill-mcp-panel: OAuth 刷新后回写配置失败（" + serverName + "）：" + redactOAuthText(String((error as any)?.message ?? error))
      );
    }
  }

  private async runRefresh(serverName: string, options: { force?: boolean }): Promise<OAuthRefreshOutcome> {
    const store = await loadOAuthStore(this.dshHome);
    const snapshot = store[serverName];
    if (snapshot === null || typeof snapshot !== "object") {
      this.unschedule(serverName);
      return { ok: false, error: "该服务器尚未建立 OAuth 授权记录" };
    }
    if (snapshot.needsReauth === true && options.force !== true) {
      this.clearTimer(serverName);
      return { ok: false, needsReauth: true, error: snapshot.refreshError ?? "授权已失效，需要重新登录" };
    }
    if (options.force !== true && typeof snapshot.expiresAt === "number" && snapshot.expiresAt - this.now() > this.leadMs) {
      await this.applyHeaderSafe(serverName, snapshot);
      this.scheduleRecord(serverName, snapshot);
      return { ok: true, refreshed: false, syncedFromDisk: true, expiresAt: snapshot.expiresAt, record: snapshot };
    }
    if (typeof snapshot.refreshToken !== "string" || snapshot.refreshToken === "") {
      return { ok: false, error: "授权服务器未提供 refresh_token，过期后需重新登录" };
    }
    if (typeof snapshot.tokenEndpoint !== "string" || snapshot.tokenEndpoint === "") {
      return { ok: false, error: "缺少 tokenEndpoint，请重新执行 OAuth 登录" };
    }

    let tokenPayload: any;
    try {
      tokenPayload = await refreshTokens(
        { token_endpoint: snapshot.tokenEndpoint },
        snapshot.clientId ?? "",
        snapshot.refreshToken,
        snapshot.resource,
        this.fetchImpl
      );
    } catch (error: any) {
      return this.handleRefreshFailure(serverName, snapshot, error);
    }

    const updatedAt = this.now();
    let aborted = false;
    const saved = await updateOAuthRecord(this.dshHome, serverName, (current) => {
      if (current === undefined) {
        aborted = true;
        return undefined;
      }
      const next: any = {
        ...current,
        accessToken: tokenPayload.accessToken,
        refreshToken: tokenPayload.refreshToken ?? current.refreshToken,
        tokenType: tokenPayload.tokenType ?? current.tokenType ?? "Bearer",
        scope: tokenPayload.scope ?? current.scope,
        expiresAt: tokenPayload.expiresAt,
        obtainedAt: current.obtainedAt ?? updatedAt,
        updatedAt,
        lastRefreshAttemptAt: updatedAt
      };
      delete next.needsReauth;
      delete next.refreshError;
      return next;
    });

    if (aborted || saved === undefined) {
      this.unschedule(serverName);
      return { ok: false, error: "OAuth 连接已断开" };
    }

    await this.applyHeaderSafe(serverName, saved);
    this.retryCounts.delete(serverName);
    this.scheduleRecord(serverName, saved);
    this.onRecordUpdated?.(serverName, saved);
    this.logger?.info?.("dsh-skill-mcp-panel: 已主动续期 OAuth 令牌（" + serverName + "）");
    return { ok: true, refreshed: true, expiresAt: saved.expiresAt, record: saved };
  }

  private async handleRefreshFailure(serverName: string, snapshot: any, error: any): Promise<OAuthRefreshOutcome> {
    const permanent = error instanceof OAuthRefreshError && error.permanent === true;
    const safeError = redactOAuthText(String(error?.message ?? error));
    const attemptAt = this.now();
    let adopted: any;
    let vanished = false;

    const saved = await updateOAuthRecord(this.dshHome, serverName, (current) => {
      if (current === undefined) {
        vanished = true;
        return undefined;
      }
      const rotatedBySibling =
        current.refreshToken !== snapshot.refreshToken ||
        current.accessToken !== snapshot.accessToken ||
        (typeof current.expiresAt === "number" && (snapshot.expiresAt === undefined || current.expiresAt > snapshot.expiresAt));
      if (rotatedBySibling && current.needsReauth !== true) {
        adopted = current;
        return current;
      }
      const next: any = {
        ...current,
        refreshError: safeError,
        lastRefreshAttemptAt: attemptAt
      };
      if (permanent) next.needsReauth = true;
      return next;
    });

    if (vanished) {
      this.unschedule(serverName);
      return { ok: false, error: "OAuth 连接已断开" };
    }

    if (adopted !== undefined) {
      await this.applyHeaderSafe(serverName, adopted);
      this.retryCounts.delete(serverName);
      this.scheduleRecord(serverName, adopted);
      this.onRecordUpdated?.(serverName, adopted);
      return { ok: true, refreshed: false, syncedFromDisk: true, expiresAt: adopted.expiresAt, record: adopted };
    }

    if (permanent) {
      this.clearTimer(serverName);
      this.retryCounts.delete(serverName);
      if (saved !== undefined) this.onRecordUpdated?.(serverName, saved);
      this.logger?.warn?.("dsh-skill-mcp-panel: OAuth 刷新永久失败，需要重新登录（" + serverName + "）：" + safeError);
      return { ok: false, needsReauth: true, error: safeError };
    }

    const attempt = this.retryCounts.get(serverName) ?? 0;
    if (!this.disposed && attempt < this.retryDelaysMs.length) {
      const delay = this.retryDelaysMs[attempt];
      this.retryCounts.set(serverName, attempt + 1);
      this.clearTimer(serverName);
      const timer = setTimeout(() => {
        this.timers.delete(serverName);
        if (!this.disposed) void this.refreshServer(serverName);
      }, delay);
      (timer as any)?.unref?.();
      this.timers.set(serverName, timer);
    } else {
      this.clearTimer(serverName);
    }
    if (saved !== undefined) this.onRecordUpdated?.(serverName, saved);
    this.logger?.warn?.("dsh-skill-mcp-panel: OAuth 刷新失败（" + serverName + "）：" + safeError);
    return { ok: false, needsReauth: false, error: safeError };
  }
}
