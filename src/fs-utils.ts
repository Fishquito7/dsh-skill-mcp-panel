import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RETRYABLE_RENAME_CODES = new Set(["EPERM", "EEXIST", "EACCES"]);

function safeRealpath(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    return resolve(target);
  }
}

/**
 * Check whether the current module is the direct CLI entry point, resolving
 * symlinks on both process.argv[1] and import.meta.url (#95).
 */
export function isMainEntry(moduleUrl: string, argv1: string | undefined = process.argv[1]): boolean {
  if (typeof argv1 !== "string" || argv1.length === 0) return false;
  const direct = resolve(argv1);
  const target = fileURLToPath(moduleUrl);
  if (direct === target || resolve(direct) === resolve(target)) return true;
  return safeRealpath(direct) === safeRealpath(target);
}

/**
 * Write UTF-8 text atomically via a unique sibling temp file, retrying transient
 * Windows rename locks (EPERM/EEXIST/EACCES) without risking an unlinked gap.
 */
export async function writeFileAtomic(
  filePath: string,
  content: string,
  options?: { mode?: number; dirMode?: number }
): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, options?.dirMode !== undefined ? { recursive: true, mode: options.dirMode } : { recursive: true });
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, content, options?.mode !== undefined ? { encoding: "utf8", mode: options.mode } : "utf8");
    const maxAttempts = 6;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await rename(tmp, filePath);
        return;
      } catch (error: any) {
        if (!RETRYABLE_RENAME_CODES.has(error?.code) || attempt === maxAttempts) {
          throw error;
        }
        await new Promise((r) => setTimeout(r, 15 * attempt));
      }
    }
  } finally {
    await rm(tmp, { force: true }).catch(() => {});
  }
}
