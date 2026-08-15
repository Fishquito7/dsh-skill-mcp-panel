/**
 * dsh-skill-viewer —— 版本检查工具（CLI 与宿主共用）。
 *
 * 当前版本取自本插件自己的 package.json；最新版本取自 GitHub Releases
 * 的 latest 标签。版本比较使用简易 semver（数字段逐位比较，忽略 v 前缀）。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
 * 从 GitHub Releases 拉取最新版本号；失败返回 undefined。
 *
 * 不走 api.github.com：未认证 REST API 每个出口 IP 每小时只有 60 次额度，
 * 本机其它工具很容易把额度用光。改用 releases/latest 的 HTML 端点——
 * 它会 302 到 /releases/tag/v<版本>，从最终 URL 解析版本号，没有 IP 限流。
 */
export async function fetchLatestVersion(): Promise<string | undefined> {
  // 手动 AbortController + finally 清理：AbortSignal.timeout 的隐式定时器在
  // Windows 上退出时可能触发 libuv 断言（UV_HANDLE_CLOSING）。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch("https://github.com/Fishquito7/dsh-skill-viewer/releases/latest", {
      headers: { "User-Agent": "dsh-skill-viewer" },
      redirect: "follow",
      signal: controller.signal
    });
    if (!response.ok) return undefined;
    // 消费掉响应体再返回：未消费的 body 在进程退出时同样可能触发断言。
    await response.body?.cancel().catch(() => {});
    const url = response.url ?? "";
    const tag = url.split("/tag/").pop();
    return typeof tag === "string" && tag !== "" && tag !== url ? tag.replace(/^v/, "") : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
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
