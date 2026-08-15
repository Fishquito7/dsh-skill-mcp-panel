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

/** 从 GitHub Releases 拉取最新版本号；失败返回 undefined。 */
export async function fetchLatestVersion(): Promise<string | undefined> {
  try {
    const response = await fetch("https://api.github.com/repos/Fishquito7/dsh-skill-viewer/releases/latest", {
      headers: { "User-Agent": "dsh-skill-viewer" },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) return undefined;
    const data = await response.json();
    return typeof data.tag_name === "string" ? String(data.tag_name).replace(/^v/, "") : undefined;
  } catch {
    return undefined;
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
