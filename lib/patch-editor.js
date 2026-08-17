/**
 * dsh-skill-mcp-panel —— profile cordis.patch.yml 受管块编辑器。
 *
 * 面板只读写 begin/end 标记之间的 MCP 行，标记之外的内容逐字节保留。
 * 写入使用同目录临时文件 + rename，并通过锁文件避免 Web 宿主与 CLI 并发写。
 */
import { open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseDocument, stringify } from "yaml";
export const PANEL_MCP_BLOCK_BEGIN = "# >>> dsh-skill-mcp-panel:mcp:begin";
export const PANEL_MCP_BLOCK_END = "# <<< dsh-skill-mcp-panel:mcp:end";
export const MCP_PLUGIN_NAME = "@deepseek-ai/dsh-mcp-client";
export const MANAGED_ROW_ID_PREFIX = "panel-mcp-";
const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
/** 读取 patch 文件；缺失/读失败统一带路径报错。 */
export async function readPatchFile(path) {
    try {
        return await readFile(path, "utf8");
    }
    catch (error) {
        throw new Error("无法读取 cordis.patch.yml（" + path + "）：" + (error instanceof Error ? error.message : String(error)));
    }
}
/** 校验整份 patch 文本：可解析且顶层是数组。不解出/写回任何值。 */
export async function validatePatchText(raw) {
    const doc = parseDocument(raw, { logLevel: "silent" });
    if (doc.errors.length > 0) {
        throw new Error("cordis.patch.yml 解析失败：" + String(doc.errors[0]?.message ?? doc.errors[0]));
    }
    const parsed = doc.toJS();
    if (!Array.isArray(parsed))
        throw new Error("cordis.patch.yml 顶层必须是 YAML 数组");
}
/** 把 YAML 解析出的顶层条目拍平成 patch 行。 */
function flattenPatchRows(entries) {
    const rows = [];
    if (!Array.isArray(entries))
        return rows;
    const pushRow = (value) => {
        if (value === null || typeof value !== "object" || Array.isArray(value))
            return;
        const row = value;
        if (typeof row.id === "string" || typeof row.name === "string") {
            const normalized = { ...row };
            if (typeof row.id !== "string")
                delete normalized.id;
            if (typeof row.name !== "string")
                delete normalized.name;
            if (typeof row.disabled !== "boolean")
                delete normalized.disabled;
            if (row.config === null || typeof row.config !== "object" || Array.isArray(row.config))
                delete normalized.config;
            rows.push(normalized);
        }
    };
    for (const entry of entries) {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry))
            continue;
        const record = entry;
        if (Array.isArray(record.insert)) {
            for (const row of record.insert)
                pushRow(row);
        }
        else {
            pushRow(record);
        }
    }
    return rows;
}
/** 提取 begin/end 标记之间的受管行；无标记返回空数组。 */
export function extractManagedRows(raw) {
    const begin = raw.indexOf(PANEL_MCP_BLOCK_BEGIN);
    const end = raw.indexOf(PANEL_MCP_BLOCK_END);
    if (begin < 0 && end < 0)
        return [];
    if (begin < 0 || end < 0 || end < begin)
        throw new Error("cordis.patch.yml 中 dsh-skill-mcp-panel 受管块标记不完整（begin/end 必须成对）");
    const blockStart = raw.indexOf("\n", begin);
    if (blockStart < 0)
        throw new Error("cordis.patch.yml 受管块格式损坏");
    const blockText = raw.slice(blockStart + 1, end);
    const doc = parseDocument(blockText, { logLevel: "silent" });
    if (doc.errors.length > 0)
        throw new Error("受管块解析失败：" + String(doc.errors[0]?.message ?? doc.errors[0]));
    const parsed = doc.toJS();
    if (!Array.isArray(parsed))
        throw new Error("受管块内容必须是 YAML 数组");
    return flattenPatchRows(parsed);
}
/** 解析整份 patch 并返回其中所有 MCP 客户端行（不区分是否受管）。 */
export function listMcpPatchRows(raw) {
    const doc = parseDocument(raw, { logLevel: "silent" });
    if (doc.errors.length > 0)
        return [];
    const parsed = doc.toJS();
    if (!Array.isArray(parsed))
        return [];
    return flattenPatchRows(parsed).filter((row) => row.name === MCP_PLUGIN_NAME);
}
/** 生成受管块文本（无行时为空字符串）。 */
export function generateManagedBlock(rows) {
    if (rows.length === 0)
        return "";
    const body = stringify([{ insert: rows }], { indent: 2, lineWidth: 0 });
    return PANEL_MCP_BLOCK_BEGIN + "\n" + body + PANEL_MCP_BLOCK_END + "\n";
}
/**
 * 替换受管块；无标记且要写入行时追加到文件末尾。标记之外的所有字节原样保留。
 */
export function replaceManagedBlock(raw, rows) {
    const begin = raw.indexOf(PANEL_MCP_BLOCK_BEGIN);
    const end = raw.indexOf(PANEL_MCP_BLOCK_END);
    const block = generateManagedBlock(rows);
    if (begin >= 0 || end >= 0) {
        if (begin < 0 || end < 0 || end < begin)
            throw new Error("cordis.patch.yml 中 dsh-skill-mcp-panel 受管块标记不完整（begin/end 必须成对）");
        const lineStart = raw.lastIndexOf("\n", begin - 1) + 1;
        const afterEnd = raw.indexOf("\n", end);
        const lineEnd = afterEnd < 0 ? raw.length : afterEnd + 1;
        const next = raw.slice(0, lineStart) + block + raw.slice(lineEnd);
        if (block !== "")
            return next;
        // 删除最后一批受管行后，原文件可能只剩注释（或原先就是 `[]` 模板）；
        // 此时必须补回流式空数组，否则 patch 文件不再是合法顶层数组。
        const meaningful = next.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#"));
        if (meaningful.length === 0)
            return next.replace(/\s*$/, "") + "\n[]\n";
        return next;
    }
    if (block === "")
        return raw;
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
export async function writeFileAtomic(path, content) {
    const temp = join(dirname(path), ".dsh-panel-tmp-" + process.pid + "-" + Math.random().toString(36).slice(2, 8));
    try {
        await writeFile(temp, content, "utf8");
        try {
            await rename(temp, path);
        }
        catch (error) {
            if (error === null || typeof error !== "object" || !["EPERM", "EEXIST", "EACCES"].includes(error.code ?? ""))
                throw error;
            await rm(path, { force: true });
            await rename(temp, path);
        }
    }
    finally {
        await rm(temp, { force: true }).catch(() => { });
    }
}
/**
 * 以 `<path>.panel.lock` 为锁执行 fn。锁文件记录 pid + 时间；超过 30 秒视为
 * 陈旧锁自动清理。获取超时 5 秒。
 */
export async function withPatchLock(path, fn) {
    const lockPath = path + ".panel.lock";
    const started = Date.now();
    let handle;
    while (handle === undefined) {
        try {
            handle = await open(lockPath, "wx");
        }
        catch (error) {
            if (error === null || typeof error !== "object" || error.code !== "EEXIST")
                throw error;
            try {
                const info = await stat(lockPath);
                if (Date.now() - info.mtimeMs > 30000)
                    await rm(lockPath, { force: true }).catch(() => { });
            }
            catch {
                // 锁在检查间隙被释放：继续重试。
            }
            if (Date.now() - started > 5000)
                throw new Error("等待 cordis.patch.yml 写锁超时（可能有其他 dsh-panel 进程正在写入）");
            await delay(50);
        }
    }
    try {
        await handle.writeFile(process.pid + "\n" + Date.now() + "\n", "utf8");
        return await fn();
    }
    finally {
        await handle.close().catch(() => { });
        await rm(lockPath, { force: true }).catch(() => { });
    }
}
/**
 * 读取 patch 文件、替换受管块、校验、加锁原子写回。
 * 返回写回后的完整文本。
 */
export async function writeManagedRows(path, rows) {
    return withPatchLock(path, async () => {
        const raw = await readPatchFile(path);
        const next = replaceManagedBlock(raw, rows);
        await validatePatchText(next);
        await writeFileAtomic(path, next);
        return next;
    });
}
