/**
 * dsh-skill-mcp-panel —— 从"加载我们的那个宿主"里解析官方包。
 *
 * 面板把 `@deepseek-ai/dsh-mcp-client` / `@deepseek-ai/dsh-credentials` 声明为
 * optional peer（与 misakanet 同款），运行时再解析。裸 `import(spec)` 在
 * profile 装在用户主目录下时通常能成（Node 的上溯查找会碰到宿主安装位置），
 * 但这件事依赖安装位置，不可靠——本模块把它变成确定行为：
 *
 *   1. 先试普通 `import(spec)`（快路径，覆盖绝大多数安装）；
 *   2. 失败则用 `createRequire` 从若干"宿主锚点"解析绝对路径再 import：
 *      cordis 上下文的 baseUrl（profile 目录）、正在运行的 dsh 入口
 *      （process.argv[1]），以及 node 可执行文件位置兜底。
 *
 * 这样面板无论装在哪儿（自定义 DSH_HOME、`file:` 直连检出、非系统盘）都能
 * 找到宿主自带的那份官方实现，而不是静默退化。
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

/** createRequire 接受的锚点：文件路径或 file: URL。 */
function anchorsFor(ctx: any): string[] {
  const anchors: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === "string" && value.trim() !== "") anchors.push(value.trim());
  };
  push(ctx?.baseUrl);
  push(process.argv[1]);
  push(process.execPath);
  return anchors;
}

function asRequireAnchor(value: string): string {
  if (value.startsWith("file:")) return value;
  return pathToFileURL(value).href;
}

/**
 * 解析一个官方包并返回它的模块命名空间；到处都找不到时返回 undefined
 * （调用方据此降级，绝不抛给会话）。
 */
export async function importFromHarness(spec: string, ctx: any): Promise<any | undefined> {
  try {
    return await import(spec);
  } catch {
    // 快路径失败：改从宿主锚点解析绝对路径
  }
  for (const anchor of anchorsFor(ctx)) {
    try {
      const resolved = createRequire(asRequireAnchor(anchor)).resolve(spec);
      return await import(pathToFileURL(resolved).href);
    } catch {
      // 换下一个锚点
    }
  }
  return undefined;
}
