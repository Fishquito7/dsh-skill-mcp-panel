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
import { dirname, join, relative, sep } from "node:path";
import { homedir } from "node:os";
import { resolveDshHome } from "./host-paths.js";
import chokidar from "chokidar";
import { buildRoots, collectSkillEntries, parseFrontmatter, SKIP_DIR_NAMES } from "./skill-files.js";
/** 嵌套技能的 rank（custom 带；低于用户根 400/500，高于项目根 100/200）。 */
export const NESTED_SKILL_RANK = 300;
/** 注册表里的提供方名字；面板据此区分「文件技能」与「插件自带技能」。 */
export const NESTED_PROVIDER_NAME = "nested";
/**
 * 监听时要跳过的路径：只看**根目录以下**的段（隐藏目录、依赖目录）。根本身就在
 * ~/.agents、~/.dsh 这类点目录里，按绝对路径逐段判断会把整棵树都忽略掉。
 */
function isIgnoredWatchPath(roots, candidate) {
    const root = roots.find((path) => candidate === path || candidate.startsWith(path + sep));
    const inside = root === undefined ? candidate : relative(root, candidate);
    return inside.split(/[/\\]/).some((part) => SKIP_DIR_NAMES.has(part) || part.startsWith("."));
}
export class NestedSkillProvider {
    rank;
    name = NESTED_PROVIDER_NAME;
    constructor(rank, signal, invalidate) {
        this.rank = rank;
        const roots = this.roots();
        const watcher = chokidar.watch(roots, {
            ignoreInitial: true,
            ignored: (candidate) => isIgnoredWatchPath(roots, candidate),
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
