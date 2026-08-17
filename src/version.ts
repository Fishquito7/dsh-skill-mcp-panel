/**
 * dsh-skill-mcp-panel —— 版本检查工具（CLI 与宿主共用）。
 *
 * 当前版本取自本插件自己的 package.json；最新版本取自 GitHub 官方 REST API
 * 的 releases/latest。版本比较使用简易 semver（数字段逐位比较，忽略 v 前缀）。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** 本包 / 仓库 / 安装 spec（CLI update 与 UI 共用同一事实源）。 */
export const PACKAGE_NAME = "dsh-skill-mcp-panel";
export const REPO_SLUG = "Fishquito7/dsh-skill-mcp-panel";
export const INSTALL_SPEC = `github:${REPO_SLUG}`;
export const RELEASES_LATEST_URL = `https://api.github.com/repos/${REPO_SLUG}/releases/latest`;

export interface UpdateCheckInfo {
  latest: string | null;
  updateAvailable: boolean;
  rateLimited: boolean;
  error?: string;
}

/** 当前安装的插件版本；读取失败回退 0.0.0。 */
export function currentVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * 从 GitHub 官方 API 拉取最新版本信息。
 *
 * 未认证 REST API 每个出口 IP 每小时 60 次额度；可设置 GITHUB_TOKEN 或
 * GH_TOKEN 提升额度并读取私有仓库。403/429 明确标记 rateLimited，由 UI/CLI
 * 提示“限流”，而不是误报“已是最新版本”。
 */
export async function fetchUpdateCheck(): Promise<UpdateCheckInfo> {
  // 手动 AbortController + finally 清理：AbortSignal.timeout 的隐式定时器在
  // Windows 上退出时可能触发 libuv 断言（UV_HANDLE_CLOSING）。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
    const response = await fetch(RELEASES_LATEST_URL, {
      headers: {
        "User-Agent": PACKAGE_NAME,
        "Accept": "application/vnd.github+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      redirect: "follow",
      signal: controller.signal
    });
    if (response.status === 403 || response.status === 429) {
      await response.body?.cancel().catch(() => {});
      return { latest: null, updateAvailable: false, rateLimited: true };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { latest: null, updateAvailable: false, rateLimited: false, error: `GitHub API ${response.status}` };
    }
    const data: any = await response.json().catch(() => undefined);
    const tag = typeof data?.tag_name === "string" ? data.tag_name : "";
    const latest = tag.replace(/^v/, "");
    if (latest === "") {
      return { latest: null, updateAvailable: false, rateLimited: false, error: "missing tag_name" };
    }
    return {
      latest,
      updateAvailable: compareVersions(latest, currentVersion()) > 0,
      rateLimited: false
    };
  } catch (error) {
    return {
      latest: null,
      updateAvailable: false,
      rateLimited: false,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 兼容旧调用点：只返回最新版本字符串；失败/限流都返回 undefined。
 * 新代码请优先使用 fetchUpdateCheck()。
 */
export async function fetchLatestVersion(): Promise<string | undefined> {
  const info = await fetchUpdateCheck();
  return info.latest ?? undefined;
}

/** 简易 semver 比较：a > b 返回正数、a < b 返回负数、相等返回 0。 */
export function compareVersions(a: string, b: string): number {
  const pa = String(a).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
