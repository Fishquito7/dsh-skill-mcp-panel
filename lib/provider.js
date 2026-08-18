/**
 * 运行时嵌套技能提供方（高内聚：与管理界面共用 collectSkillEntries 扫描）。
 *
 * 官方 @deepseek-ai/dsh-skill-filesystem 只做扁平发现（`根/<名>/SKILL.md` 一层）。
 * 本提供方把深度 >= 2 的嵌套技能（如 `~/.agents/skills/lark-cli/lark-approval/SKILL.md`，
 * pi/Codex 布局）注册进 ctx.skills 注册表，让 agent 真正能调用：
 *
 * - list() 复用 collectSkillEntries（与管理 UI 同一份遍历），只收 rel 含 "/" 的条目；
 * - 第一层（`根/<名>/SKILL.md`）归官方扁平加载器所有，不重复注册；
 * - chokidar 递归 watcher 保持热更新（同官方加载器），变更 → control.invalidate()。
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import chokidar from "chokidar";
import { buildRoots, collectSkillEntries, parseFrontmatter } from "./skill-files.js";
/** 嵌套技能的 rank（custom 带；低于用户根 400/500，高于项目根 100/200）。 */
export const NESTED_SKILL_RANK = 300;
export class NestedSkillProvider {
    rank;
    name = "nested";
    constructor(rank, signal, invalidate) {
        this.rank = rank;
        const watcher = chokidar.watch(this.roots(), {
            ignoreInitial: true,
            ignored: (candidate) => {
                const parts = candidate.split(/[/\\]/);
                return parts.some((part) => part === "node_modules" || part.startsWith("."));
            },
        });
        let timer;
        const kick = () => {
            if (timer !== undefined)
                return;
            timer = setTimeout(() => {
                timer = undefined;
                invalidate();
            }, 120);
        };
        watcher.on("add", kick);
        watcher.on("unlink", kick);
        watcher.on("addDir", kick);
        watcher.on("unlinkDir", kick);
        watcher.on("change", kick);
        watcher.on("error", () => {
            /* keep watching; the next successful event still invalidates */
        });
        signal.addEventListener("abort", () => {
            void watcher.close();
        }, { once: true });
    }
    async list(options = {}) {
        const roots = await buildRoots(options.cwd, this.homes());
        const entries = await collectSkillEntries(roots);
        const candidates = [];
        for (const entry of entries) {
            if (!entry.enabled)
                continue;
            if (!entry.rel || !entry.rel.includes("/"))
                continue; // 深度>=2；第一层归扁平加载器
            candidates.push({
                name: entry.name,
                description: entry.description,
                ...(entry.whenToUse === undefined ? {} : { whenToUse: entry.whenToUse }),
                invocation: { modelInvocable: entry.modelInvocable ?? true, userInvocable: entry.userInvocable ?? true },
                provider: this.name,
                source: entry.source,
                rank: this.rank,
                locator: { path: entry.file, directory: dirname(entry.file) },
                resourceBase: { kind: "directory", path: dirname(entry.file) },
                path: entry.file,
                rel: entry.rel,
            });
        }
        return candidates;
    }
    async get(candidate, options = {}) {
        options.signal?.throwIfAborted();
        const raw = await readFile(candidate.locator.path, { encoding: "utf8", signal: options.signal });
        const parsed = parseFrontmatter(raw);
        if (parsed === undefined)
            return;
        return {
            name: parsed.name,
            description: parsed.description,
            ...(parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse }),
            invocation: { modelInvocable: parsed.modelInvocable ?? true, userInvocable: parsed.userInvocable ?? true },
            provider: this.name,
            source: candidate.source,
            resourceBase: { kind: "directory", path: candidate.locator.directory },
            path: candidate.locator.path,
            content: parsed.body,
        };
    }
    /** 被递归 watcher 监视的根（用户级根；项目根随 list() 的 cwd 动态扫描）。 */
    roots() {
        const { dshHome, agentsHome } = this.homes();
        return [join(agentsHome, "skills"), join(dshHome, "skills")];
    }
    homes() {
        const dshHome = resolveDshHome(undefined, process.env);
        const agentsHome = process.env.DSH_AGENTS_HOME ?? join(homedir(), ".agents");
        return { dshHome, agentsHome };
    }
}
