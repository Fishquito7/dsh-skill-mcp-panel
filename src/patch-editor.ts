/**
 * dsh-skill-mcp-panel —— profile cordis.patch.yml 受管块编辑器。
 *
 * 面板只读写 begin/end 标记之间的 MCP 行，标记之外的内容逐字节保留。
 * 写入使用同目录临时文件 + rename，并通过锁文件避免 Web 宿主与 CLI 并发写。
 */
import { open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isMap, isSeq, parseDocument, stringify } from "yaml";

export const PANEL_MCP_BLOCK_BEGIN = "# >>> dsh-skill-mcp-panel:mcp:begin";
export const PANEL_MCP_BLOCK_END = "# <<< dsh-skill-mcp-panel:mcp:end";
export const MCP_PLUGIN_NAME = "@deepseek-ai/dsh-mcp-client";
export const MANAGED_ROW_ID_PREFIX = "panel-mcp-";

/**
 * cordis 配置层的 !!js 标签：值是 JS 表达式，由宿主装载时求值
 * （@deepseek-ai/cordis-plugin-loader 的 interpolate → new Function + eval）。
 * DSH 官方给的环境变量写法就是它，例如：
 *   Authorization: !!js '`Bearer ${process.env.MCP_TOKEN}`'
 *
 * 面板必须原样往返这个标签：只把值当普通字符串读、再整块重写，表达式就会降级成
 * 字面量字符串——用户的令牌从此变成一个永远发不出去的值，而且没有任何提示。
 */
const JS_EXPR_TAG = "tag:yaml.org,2002:js";

/** 表达式里的换行无法用单引号标量安全往返，退回双引号（JSON 转义）。 */
function quoteJsExpr(expression: string): string {
  if (/[\n\r]/.test(expression)) return JSON.stringify(expression);
  return "'" + expression.replace(/'/g, "''") + "'";
}

/**
 * 自定义 !!js 标签：读时还原成 { __jsExpr } 标记对象（不再有 TAG_RESOLVE_FAILED），
 * 写时按原标签回写。identify 只认「恰好一个 __jsExpr 字符串键」的对象，
 * 不会误伤普通配置对象。
 */
const jsExprTag: any = {
  tag: JS_EXPR_TAG,
  resolve: (value: string) => ({ __jsExpr: value }),
  identify: (value: unknown): boolean =>
    value !== null &&
    typeof value === "object" &&
    Object.keys(value as Record<string, unknown>).length === 1 &&
    typeof (value as { __jsExpr?: unknown }).__jsExpr === "string",
  stringify: (node: any) => quoteJsExpr(String(node.value.__jsExpr))
};

/** 全部解析与序列化共用同一份标签定义，读到的 !!js 才能原样写回。 */
const YAML_CUSTOM_TAGS = [jsExprTag];

/** !!js 表达式节点的标记形状。 */
export interface JsExprValue {
  __jsExpr: string;
}

/** 判断一个 YAML 值是否是面板保留的 !!js 表达式节点。 */
export function isJsExprValue(value: unknown): value is JsExprValue {
  return jsExprTag.identify(value);
}

/** Loader patch 行（宽松形状；受管块只包含 insert 列表）。 */
export interface PatchRow {
  id?: string;
  name?: string;
  disabled?: boolean;
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

const delay = (ms: number) => new Promise<void>((resolvePromise) => setTimeout(resolvePromise, ms));

/** 读取 patch 文件；缺失/读失败统一带路径报错。 */
export async function readPatchFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    throw new Error("无法读取 cordis.patch.yml（" + path + "）：" + (error instanceof Error ? error.message : String(error)));
  }
}

/** 校验整份 patch 文本：可解析且顶层是数组。不解出/写回任何值。 */
export async function validatePatchText(raw: string): Promise<void> {
  const doc = parseDocument(raw, { logLevel: "silent", customTags: YAML_CUSTOM_TAGS });
  if (doc.errors.length > 0) {
    throw new Error("cordis.patch.yml 解析失败：" + String(doc.errors[0]?.message ?? doc.errors[0]));
  }
  const parsed = doc.toJS();
  if (!Array.isArray(parsed)) throw new Error("cordis.patch.yml 顶层必须是 YAML 数组");
}

/** 把 YAML 解析出的单个条目收成 patch 行；`id`/`name` 都不是字符串的条目返回 undefined。 */
function rowFromValue(value: unknown): PatchRow | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" && typeof row.name !== "string") return undefined;
  const normalized: PatchRow = { ...row };
  if (typeof row.id !== "string") delete normalized.id;
  if (typeof row.name !== "string") delete normalized.name;
  if (typeof row.disabled !== "boolean") delete normalized.disabled;
  if (row.config === null || typeof row.config !== "object" || Array.isArray(row.config)) delete normalized.config;
  return normalized;
}

/** 把 YAML 解析出的顶层条目拍平成 patch 行。 */
function flattenPatchRows(entries: unknown): PatchRow[] {
  const rows: PatchRow[] = [];
  if (!Array.isArray(entries)) return rows;
  for (const entry of entries) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (Array.isArray(record.insert)) {
      for (const member of record.insert) {
        const row = rowFromValue(member);
        if (row !== undefined) rows.push(row);
      }
    } else {
      const row = rowFromValue(record);
      if (row !== undefined) rows.push(row);
    }
  }
  return rows;
}

/**
 * 面板自己的行：`id` 以 `panel-mcp-` 开头。这是「面板拥有这一行」的唯一判据
 * （与行级操作 isManagedRow / findRowByServerName 一致）。
 *
 * 关键：判据只能看**这一行**。受管块里允许存在别的工具、旧版本或用户手写的
 * 条目，它们不是我们的，一律原样保留（见 ManagedBlockForeign）。
 */
export function isManagedRow(row: PatchRow): boolean {
  return typeof row.id === "string" && row.id.startsWith(MANAGED_ROW_ID_PREFIX);
}

/**
 * 受管块里**不属于面板**的部分。面板必须原样保留它们：顶层的 `- id:` 条目是
 * 「按 id 定向覆盖」，`insert` 成员是「追加」——把前者折叠进 insert 会改掉语义，
 * 并让同一个 loader id 出现两行（dsh-market 的试算按 id 计数，直接判重复而回滚
 * 整批更新，见 ADR-0003）。
 */
export interface ManagedBlockForeign {
  /** 外来顶层条目的原始文本（逐字节，含 `- ` 前缀与行尾换行）。 */
  top: string;
  /** 外来 `insert` 条目的原始文本（逐字节）。面板不认领放进外来 insert 里的行。 */
  insert: string;
  /** 外来部分里认出 id / name 的条目，供界面提示「块内还有哪些行不属于面板」。 */
  entries: { id?: string; name?: string; managed: boolean }[];
}

const EMPTY_FOREIGN: ManagedBlockForeign = { top: "", insert: "", entries: [] };

/**
 * 受管块里每个顶层条目的完整文本跨度（含 `- ` 前缀、行尾换行、以及条目之间的注释）。
 *
 * 跨度按「下一个条目的行首」界定并**首尾相接铺满整块**（第一段从 0 开始，最后一段
 * 到块尾），而不是按节点自身的 range：嵌套块集合（如 `insert:` 下面的列表）的 range
 * 末尾不覆盖自己的内容，而注释与空行不属于任何节点。铺满之后块内每个字节都有着落，
 * 外来部分才能真正逐字节搬运。
 */
function blockItemSpans(text: string, nodes: any[]): { start: number; end: number }[] {
  const starts = nodes.map((node) => text.lastIndexOf("\n", node.range[0] - 1) + 1);
  return nodes.map((_, index) => ({
    start: index === 0 ? 0 : starts[index],
    end: index + 1 < nodes.length ? starts[index + 1] : text.length
  }));
}

/** 条目是不是 `insert:` 列表；是则返回成员节点。 */
function insertMembers(node: any): any[] | undefined {
  if (!isMap(node) || node.items.length !== 1) return undefined;
  const pair = node.items[0];
  const key = pair?.key as { value?: unknown } | undefined;
  if (key === undefined || key === null || typeof key !== "object" || key.value !== "insert") return undefined;
  return isSeq(pair.value) ? pair.value.items : undefined;
}

/**
 * 读受管块：面板自己的行 + 块内不属于面板的部分。
 * 无标记时返回空结果；标记不完整、块内容解析失败则抛错。
 */
export function readManagedBlock(raw: string): { managed: PatchRow[]; foreign: ManagedBlockForeign } {
  const begin = raw.indexOf(PANEL_MCP_BLOCK_BEGIN);
  const end = raw.indexOf(PANEL_MCP_BLOCK_END);
  if (begin < 0 && end < 0) return { managed: [], foreign: EMPTY_FOREIGN };
  if (begin < 0 || end < 0 || end < begin) throw new Error("cordis.patch.yml 中 dsh-skill-mcp-panel 受管块标记不完整（begin/end 必须成对）");
  const blockStart = raw.indexOf("\n", begin);
  if (blockStart < 0) throw new Error("cordis.patch.yml 受管块格式损坏");
  const text = raw.slice(blockStart + 1, end);
  const doc = parseDocument(text, { logLevel: "silent", customTags: YAML_CUSTOM_TAGS });
  if (doc.errors.length > 0) throw new Error("受管块解析失败：" + String(doc.errors[0]?.message ?? doc.errors[0]));
  const parsed = doc.toJS();
  if (!Array.isArray(parsed)) throw new Error("受管块内容必须是 YAML 数组");

  const managed: PatchRow[] = [];
  const topParts: string[] = [];
  const insertParts: string[] = [];
  const entries: ManagedBlockForeign["entries"] = [];
  const nodes: any[] = isSeq(doc.contents) ? doc.contents.items : [];
  const spans = blockItemSpans(text, nodes);
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    const value: any = parsed[index];
    const members = insertMembers(node);
    if (members !== undefined) {
      // 只有「成员全是面板行」的 insert 条目才归面板所有。混着外来成员的整条原样
      // 保留——认领其中长得像面板行的那几条会同时触发重复写入。
      const rows: (PatchRow | undefined)[] = (Array.isArray(value?.insert) ? value.insert : []).map(rowFromValue);
      const owned = rows.length > 0 && rows.every((row) => row !== undefined && isManagedRow(row));
      if (owned) {
        for (const row of rows) managed.push(row as PatchRow);
        continue;
      }
      for (const row of rows) if (row !== undefined) entries.push({ id: row.id, name: row.name, managed: isManagedRow(row) });
      insertParts.push(text.slice(spans[index].start, spans[index].end));
      continue;
    }
    const row = rowFromValue(value);
    if (row !== undefined && isManagedRow(row)) {
      managed.push(row);
      continue;
    }
    if (row !== undefined) entries.push({ id: row.id, name: row.name, managed: false });
    topParts.push(text.slice(spans[index].start, spans[index].end));
  }
  return { managed, foreign: { top: topParts.join(""), insert: insertParts.join(""), entries } };
}

/** 提取 begin/end 标记之间的受管行（只含面板自己的行）；无标记返回空数组。 */
export function extractManagedRows(raw: string): PatchRow[] {
  return readManagedBlock(raw).managed;
}

/** 解析整份 patch 并返回其中所有 MCP 客户端行（不区分是否受管）。 */
export function listMcpPatchRows(raw: string): PatchRow[] {
  const doc = parseDocument(raw, { logLevel: "silent", customTags: YAML_CUSTOM_TAGS });
  if (doc.errors.length > 0) return [];
  const parsed = doc.toJS();
  if (!Array.isArray(parsed)) return [];
  return flattenPatchRows(parsed).filter((row) => row.name === MCP_PLUGIN_NAME);
}

/**
 * 生成受管块文本（三部分都为空时返回空字符串）。
 *
 * 顺序：外来顶层条目 → 外来 insert 条目 → 面板自己的 `insert` 列表。外来部分逐字节
 * 原样搬运，面板只重建自己那一段。
 */
export function generateManagedBlock(rows: PatchRow[], foreign: ManagedBlockForeign = EMPTY_FOREIGN, baseIndent = ""): string {
  const parts: string[] = [];
  if (foreign.top !== "") parts.push(foreign.top.replace(/\s*$/, "\n"));
  if (foreign.insert !== "") parts.push(foreign.insert.replace(/\s*$/, "\n"));
  if (rows.length > 0) {
    const body = stringify([{ insert: rows }], { indent: 2, lineWidth: 0, customTags: YAML_CUSTOM_TAGS });
    parts.push(baseIndent === "" ? body : body.split("\n").map((line) => (line === "" ? line : baseIndent + line)).join("\n"));
  }
  if (parts.length === 0) return "";
  return PANEL_MCP_BLOCK_BEGIN + "\n" + parts.join("") + PANEL_MCP_BLOCK_END + "\n";
}

/** 块内顶层条目的基准缩进（正常是空字符串；整块被缩进时按原样对齐）。 */
function blockBaseIndent(raw: string): string {
  const begin = raw.indexOf(PANEL_MCP_BLOCK_BEGIN);
  if (begin < 0) return "";
  const end = raw.indexOf(PANEL_MCP_BLOCK_END);
  const blockStart = raw.indexOf("\n", begin);
  if (blockStart < 0) return "";
  const text = raw.slice(blockStart + 1, end < 0 ? undefined : end);
  for (const line of text.split("\n")) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (!line.trimStart().startsWith("-")) continue;
    return /^[ \t]*/.exec(line)?.[0] ?? "";
  }
  return "";
}

/**
 * 替换受管块；无标记且要写入行时追加到文件末尾。标记之外的所有字节原样保留，
 * 标记之内的**外来条目也原样保留**（不传 `foreign` 时自动从 `raw` 里读一遍）。
 */
export function replaceManagedBlock(raw: string, rows: PatchRow[], foreign?: ManagedBlockForeign): string {
  const begin = raw.indexOf(PANEL_MCP_BLOCK_BEGIN);
  const end = raw.indexOf(PANEL_MCP_BLOCK_END);
  const foreignPart = foreign ?? (begin >= 0 || end >= 0 ? readManagedBlock(raw).foreign : EMPTY_FOREIGN);
  const block = generateManagedBlock(rows, foreignPart, blockBaseIndent(raw));

  if (begin >= 0 || end >= 0) {
    if (begin < 0 || end < 0 || end < begin) throw new Error("cordis.patch.yml 中 dsh-skill-mcp-panel 受管块标记不完整（begin/end 必须成对）");
    const lineStart = raw.lastIndexOf("\n", begin - 1) + 1;
    const afterEnd = raw.indexOf("\n", end);
    const lineEnd = afterEnd < 0 ? raw.length : afterEnd + 1;
    const next = raw.slice(0, lineStart) + block + raw.slice(lineEnd);
    if (block !== "") return next;
    // 删除最后一批受管行后，原文件可能只剩注释（或原先就是 `[]` 模板）；
    // 此时必须补回流式空数组，否则 patch 文件不再是合法顶层数组。
    const meaningful = next.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#"));
    if (meaningful.length === 0) return next.replace(/\s*$/, "") + "\n[]\n";
    return next;
  }

  if (block === "") return raw;
  // 空 profile 模板是流式空数组 `[]`：直接追加块序列会变成 `[] - insert`，
  // 必须在追加前把 `[]` 替换为受管块序列。
  const lines = raw.split(/\r?\n/);
  const meaningful = lines.map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#"));
  if (meaningful.length === 1 && meaningful[0] === "[]") {
    const index = raw.lastIndexOf("[]");
    return raw.slice(0, index) + block + raw.slice(index + 2);
  }
  const prefix = raw.length === 0 ? "" : raw.endsWith("\n") ? "\n" : "\n\n";
  return raw + prefix + block;
}

/** 同目录临时文件 + rename 原子写；Windows 上 rename 覆盖失败时退化为 rm+rename。 */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  const temp = join(dirname(path), ".dsh-panel-tmp-" + process.pid + "-" + Math.random().toString(36).slice(2, 8));
  try {
    await writeFile(temp, content, "utf8");
    try {
      await rename(temp, path);
    } catch (error) {
      if (error === null || typeof error !== "object" || !["EPERM", "EEXIST", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      await rm(path, { force: true });
      await rename(temp, path);
    }
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
}

/**
 * 以 `<path>.panel.lock` 为锁执行 fn。锁文件记录 pid + 时间；超过 30 秒视为
 * 陈旧锁自动清理。获取超时 5 秒。
 */
export async function withPatchLock<T>(path: string, fn: () => Promise<T> | T): Promise<T> {
  const lockPath = path + ".panel.lock";
  const started = Date.now();
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  while (handle === undefined) {
    try {
      handle = await open(lockPath, "wx");
    } catch (error) {
      if (error === null || typeof error !== "object" || (error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > 30000) await rm(lockPath, { force: true }).catch(() => {});
      } catch {
        // 锁在检查间隙被释放：继续重试。
      }
      if (Date.now() - started > 5000) throw new Error("等待 cordis.patch.yml 写锁超时（可能有其他 dsh-panel 进程正在写入）");
      await delay(50);
    }
  }
  try {
    await handle.writeFile(process.pid + "\n" + Date.now() + "\n", "utf8");
    return await fn();
  } finally {
    await handle.close().catch(() => {});
    await rm(lockPath, { force: true }).catch(() => {});
  }
}

/**
 * 读取 patch 文件、替换受管块、校验、加锁原子写回。
 * 返回写回后的完整文本。
 */
export async function writeManagedRows(path: string, rows: PatchRow[]): Promise<string> {
  return withPatchLock(path, async () => {
    const raw = await readPatchFile(path);
    const next = replaceManagedBlock(raw, rows);
    await validatePatchText(next);
    await writeFileAtomic(path, next);
    return next;
  });
}