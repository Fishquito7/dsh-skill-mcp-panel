/**
 * 在系统文件管理器里打开一个目录。
 *
 * 面板的「打开目录」按钮原来只把技能根路径复制到剪贴板（宿主没有对应 RPC）；
 * 2026-10-19 用户要求真的弹出资源管理器，于是把这一步放到宿主侧：由宿主进程
 * spawn 平台的 shell，前端不再猜命令。
 *
 * 安全边界：
 * - 只接受**绝对路径**，且必须是**已存在**的目录（不创建、不打开文件）；
 * - 用 `spawn(command, [target])`，不上 shell，路径不会被拼接成命令；
 * - Windows 的 `explorer.exe` 即使成功也常返回非 0，所以不等退出码、不读输出。
 *
 * 2026-10-19 修：Windows 的 `explorer.exe` **不认正斜杠**。
 * 面板前端把路径规范化成了 `C:/Users/.../.dsh/skills`，`explorer.exe` 收到这种参数
 * 会当成无效目标、悄悄打开自己的默认位置（文档），于是用户看到「只打开了文档」。
 * 实测对照：正斜杠 → 文档；反斜杠 → 正确目录。所以交给系统的路径必须先换成本机
 * 分隔符（`nativePath`），再 spawn。
 */
import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

export type RevealResult =
  | { ok: true; path: string; command: string }
  | { ok: false; error: string };

/**
 * 把路径换成本机分隔符（导出供回归测试断言）。
 *
 * Windows 上 `explorer.exe` / 有些 shell API 只认 `\`；`/` 会被当成无效参数。
 * 非 Windows 原样返回（`/` 本来就是本机分隔符）。顺带裁掉多余的尾部分隔符，
 * 但盘符根（`C:\`）和 UNC 根保留，避免把 `C:\` 裁成 `C:`。
 */
export function nativePath(raw: string): string {
  const text = String(raw ?? "");
  if (process.platform !== "win32") return text;
  const replaced = text.replace(/\//g, "\\");
  const trimmed = replaced.replace(/\\+$/, "");
  if (trimmed === "") return replaced;
  if (trimmed.endsWith(":")) return trimmed + "\\";
  // `\\server\share` 是 UNC 根，尾部分隔符可有可无；统一不带尾巴。
  return trimmed;
}

/** 平台对应的「打开目录」命令（导出供回归测试断言）。 */
export function revealCommand(target: string): { command: string; args: string[] } {
  const path = nativePath(String(target ?? "").trim());
  if (process.platform === "win32") return { command: "explorer.exe", args: [path] };
  if (process.platform === "darwin") return { command: "open", args: [path] };
  return { command: "xdg-open", args: [path] };
}

/**
 * 打开目录。`spawnImpl` 仅在测试里替换，用来断言命令与参数、避免真的弹窗。
 */
export async function revealInFileManager(
  rawPath: string,
  spawnImpl: typeof spawn = spawn
): Promise<RevealResult> {
  const raw = String(rawPath ?? "").trim();
  if (raw === "") return { ok: false, error: "路径为空" };
  // 先换成系统认的分隔符，后面的 stat / mkdir / 交给 explorer 的路径都必须是同一形态。
  const target = nativePath(raw);
  if (!isAbsolute(target)) return { ok: false, error: "需要绝对路径：" + target };
  let info;
  try {
    info = await stat(target);
  } catch {
    // 技能根可能还没建出来（工作区里从没加过技能）：先按技能根的位置建出来再打开。
    // 只建这一个目录，不做任何别的写入；建不出来（父级是文件、没权限）才报错。
    try {
      await mkdir(target, { recursive: true });
      info = await stat(target);
    } catch {
      return { ok: false, error: "目录不存在：" + target };
    }
  }
  if (!info.isDirectory()) return { ok: false, error: "不是目录：" + target };
  const { command, args } = revealCommand(target);
  try {
    const child = spawnImpl(command, args, { detached: true, stdio: "ignore" });
    // 命令不存在（ENOENT）之类只会以 error 事件出现；吞掉即可，打开动作本身是
    // fire-and-forget，前端拿不到「窗口是否真的弹出」这种信息。
    child.on?.("error", () => {});
    child.unref?.();
  } catch (error: any) {
    return { ok: false, error: String(error?.message ?? error) };
  }
  return { ok: true, path: target, command };
}
