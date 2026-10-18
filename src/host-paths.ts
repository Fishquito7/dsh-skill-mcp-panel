/**
 * dsh-skill-mcp-panel —— 宿主路径与环境清洗（内联版）。
 *
 * 为什么不再依赖 `@deepseek-ai/dsh-home-paths` / `dsh-subprocess`：
 * 这两个包在 DSH 0.2.1 里各自带了 peer 链（`dsh-invariants`、`dsh-http-proxy`、
 * `@deepseek-ai/cordis`），装进 profile 后只要有一个 peer 没落地，整个插件的导入
 * 链就断（实测 `@deepseek-ai/cordis` 缺失直接让 `import` 失败）。而我们真正用到的
 * 只有两个纯函数，内联进来就能把这条链彻底剪掉。
 *
 * 语义与上游保持一致：
 *   - `DSH_HOME` 优先，未设时用 `~/.dsh`；`~` 与 `~/x` 按用户主目录展开；
 *   - stdio 子进程的环境是从父进程**洗过**的：名字里带 KEY/PASSWORD/SECRET/TOKEN
 *     的、以及 `DSH_*` 全部剔除，显式配置的 env 再覆盖上去。
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** 展开 `~` / `~/x`，其余按绝对路径解析。 */
function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return join(homedir(), value.slice(2));
  return resolve(value);
}

/**
 * 解析 `<dshHome>`。
 * @param override 显式传入的 home（优先于环境变量）
 * @param env 用来查找 `DSH_HOME` 的环境对象（默认 `process.env`）
 */
export function resolveDshHome(override?: string, env: any = process.env): string {
  const direct = typeof override === "string" ? override.trim() : "";
  if (direct !== "") return expandHome(direct);
  const fromEnv = env !== null && typeof env === "object" && typeof env.DSH_HOME === "string" ? env.DSH_HOME.trim() : "";
  return expandHome(fromEnv === "" ? join(homedir(), ".dsh") : fromEnv);
}

/** 敏感环境变量名：与上游 `SENSITIVE_ENV_PATTERN` 同一套判据。 */
const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i;

/**
 * 给 stdio MCP 子进程用的「洗过的父环境」：去掉敏感名与 `DSH_*`。
 * 显式配置的 env 由调用方覆盖在上层。
 */
export function scrubbedParentEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== "string") continue;
    if (SENSITIVE_ENV_PATTERN.test(key)) continue;
    if (key.startsWith("DSH_")) continue;
    out[key] = value;
  }
  return out;
}
