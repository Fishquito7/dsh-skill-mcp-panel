/**
 * dsh-skill-mcp-panel —— MCP 单工具禁用（按工具名做上下文瘦身）。
 *
 * 用户诉求（Issue #44）：MCP 服务器一挂就几十个工具，每次会话都要把这些工具的
 * schema 注入上下文，云端/本地模型都吃不消。面板允许按**工具名**禁用其中一部分。
 *
 * 实现依赖三条实测结论（2026-10-15 原型，见 docs/adr/0005）：
 *   1. `ctx.tools.restrict({ deny })` 只接受 **scoped ctx**（agent 作用域或它的祖先），
 *      unscoped 的全局 ctx 调用会被宿主拒绝（"would mask every agent"）；
 *   2. 被限制的工具会从该作用域模型可见的 schema 里**消失**（真省上下文），
 *      与 `tools.guard()` 只拒绝调用、不省上下文不同；
 *   3. 作用域内的子插件拿得到 scoped ctx（`scopeOf(ctx) !== undefined`），
 *      而 `agent.ctx` 就是 agent 自己的作用域——所以「按 agent 施加」是可行路径。
 *
 * 于是禁用是**按 agent 施加**的：订阅 `agent/created`，在 agent 的作用域上注册限制，
 * 作用域销毁时限制随之解绑；`agent/disposed` 只用来清账。
 *
 * 配置保存在 `<dshHome>/skills/.system/skill-viewer/tool-filter.json`：
 *   { "version": 1, "deny": ["mcp__github__search", ...] }
 * 只记**完整公开工具名**（`mcp__<serverName>__<原始名>`）。服务器改名或工具改名后
 * 名字对不上就不生效——这是刻意的：宁可不生效，也不去猜用户的意图。
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { groupsRoot } from "./groups.js";
/** 单工具禁用配置的版本号。 */
export const TOOL_FILTER_VERSION = 1;
/** 配置文件路径（与分组配置同目录，都在技能根下的隐藏区）。 */
export function toolFilterFile(dshHome) {
    return join(groupsRoot(dshHome), "tool-filter.json");
}
/**
 * 读取禁用列表；文件缺失或损坏时按空列表处理（最坏情况只是禁用失效）。
 * @returns { string[] }
 */
export async function loadToolFilter(dshHome) {
    try {
        const parsed = JSON.parse(await readFile(toolFilterFile(dshHome), "utf8"));
        if (parsed !== null && typeof parsed === "object" && Array.isArray(parsed.deny)) {
            return parsed.deny.filter((name) => typeof name === "string" && name !== "");
        }
    }
    catch {
        // 文件缺失或损坏：按空配置处理
    }
    return [];
}
/** 原子写入禁用列表（同目录临时文件 + rename；Windows 覆盖失败退化为 rm + rename）。 */
export async function saveToolFilter(dshHome, deny) {
    const path = toolFilterFile(dshHome);
    await mkdir(dirname(path), { recursive: true });
    const temp = path + ".tmp-" + process.pid + "-" + Math.random().toString(36).slice(2, 8);
    await writeFile(temp, JSON.stringify({ version: TOOL_FILTER_VERSION, deny }, null, 2) + "\n", "utf8");
    try {
        await rename(temp, path);
    }
    catch (error) {
        if (error === null || typeof error !== "object" || !["EPERM", "EEXIST", "EACCES"].includes(error.code ?? ""))
            throw error;
        await writeFile(path, JSON.stringify({ version: TOOL_FILTER_VERSION, deny }, null, 2) + "\n", "utf8");
    }
}
/**
 * 把禁用列表施加到**每一个** agent 的作用域上。
 *
 * 为什么不是全局一次搞定：宿主明确禁止 unscoped 的全局限制（会遮蔽所有 agent）；
 * 也不能直接 `agent.ctx.tools.restrict(...)`——服务访问受宿主 inject 门禁约束，
 * 必须从一个**声明了 inject 的插件上下文**里发起。所以这里的做法是：在
 * `agent/created` 时往该 agent 的作用域下挂一个微型插件（声明 `inject: ["tools"]`），
 * 由它在自己的作用域上注册限制。实测（2026-10-15 原型，docs/adr/0005）：
 *   - 被禁用的工具会从该 agent 模型可见的 schema 里消失；
 *   - 其他 agent 与全局视角不受影响；
 *   - 插件纤维是 agent 作用域的子节点，agent 销毁时限制随之解绑。
 *
 * 名字必须在施加时**已经**存在于可限制集合里，否则 `restrict()` 直接抛错
 * （"names unknown global tool"）。MCP 服务器是异步连上来的，所以插件里：
 *   - 只对当前已知的名字注册限制；
 *   - 监听 `tools/change`，等工具真的出现后再补一次。
 */
export class ToolFilterController {
    ctx;
    deny;
    mounted = new Map();
    disposed = false;
    constructor(ctx, deny) {
        this.ctx = ctx;
        this.deny = deny;
    }
    /** 挂到 agent 作用域上的过滤插件；`inject` 是硬要求，不能省。 */
    pluginFor(deny) {
        return {
            name: "dsh-skill-mcp-panel:tool-filter",
            inject: ["tools"],
            apply(c) {
                let undo;
                const applyNow = () => {
                    if (undo !== undefined) {
                        try {
                            undo();
                        }
                        catch {
                            // 上一轮的注册可能已随作用域销毁，忽略。
                        }
                        undo = undefined;
                    }
                    if (deny.length === 0)
                        return;
                    let known;
                    try {
                        known = new Set(c.tools.view(undefined).restrictableNames);
                    }
                    catch {
                        return;
                    }
                    const usable = deny.filter((name) => known.has(name));
                    if (usable.length === 0)
                        return;
                    try {
                        undo = c.tools.restrict({ deny: usable });
                    }
                    catch {
                        // 名字在注册的一瞬间消失了：留给下一次 tools/change。
                        undo = undefined;
                    }
                };
                applyNow();
                c.on("tools/change", applyNow);
            }
        };
    }
    /** 给一个 agent 施加限制；已经施加过的跳过。 */
    applyTo(agent) {
        if (this.disposed || this.deny.length === 0)
            return;
        const id = typeof agent?.id === "string" ? agent.id : undefined;
        if (id === undefined || this.mounted.has(id))
            return;
        const scopeCtx = agent.ctx;
        if (scopeCtx === undefined || typeof scopeCtx.plugin !== "function")
            return;
        try {
            this.mounted.set(id, scopeCtx.plugin(this.pluginFor(this.deny)));
        }
        catch {
            // 作用域已经销毁或不接受挂载：跳过，不因为一个 agent 失败就中断。
        }
    }
    /** 补一轮：对所有已知 agent 重新施加（新工具上线、配置变更后调用）。 */
    reapply() {
        if (this.disposed)
            return;
        for (const agent of this.listAgents())
            this.applyTo(agent);
    }
    /** agent 销毁后清账（限制本身由它自己的作用域解绑）。 */
    release(id) {
        this.mounted.delete(id);
    }
    /** 更新禁用列表：先全部卸载，再按新列表重新施加。 */
    setDeny(deny) {
        this.deny = deny;
        for (const [id, fiber] of [...this.mounted.entries()]) {
            this.mounted.delete(id);
            try {
                fiber?.dispose?.();
            }
            catch {
                // 作用域已经没了，忽略。
            }
        }
        this.reapply();
    }
    listAgents() {
        try {
            const agents = this.ctx.get("agents");
            const rows = agents?.list?.();
            return Array.isArray(rows) ? rows : [];
        }
        catch {
            return [];
        }
    }
    /** 当前实际挂着过滤插件的 agent 数（给界面显示）。 */
    activeCount() {
        return this.mounted.size;
    }
    /** 当前生效的禁用列表（网关读它，避免再去读盘）。 */
    denyOf() {
        return this.deny;
    }
    dispose() {
        this.disposed = true;
        for (const [id, fiber] of [...this.mounted.entries()]) {
            this.mounted.delete(id);
            try {
                fiber?.dispose?.();
            }
            catch {
                // 同上。
            }
        }
    }
}
/**
 * 挂上控制器：订阅 agent 生命周期与工具变化事件。
 * @returns 拆除函数（插件卸载时调用）。
 */
export function attachToolFilter(ctx, deny) {
    const controller = new ToolFilterController(ctx, deny);
    const offCreated = ctx.on("agent/created", (payload) => {
        controller.applyTo(payload?.agent);
    });
    const offDisposed = ctx.on("agent/disposed", (payload) => {
        const agent = payload?.agent;
        if (typeof agent?.id === "string")
            controller.release(agent.id);
    });
    const offTools = ctx.on("tools/change", () => controller.reapply());
    controller.reapply();
    const originalDispose = controller.dispose.bind(controller);
    controller.dispose = () => {
        for (const off of [offCreated, offDisposed, offTools]) {
            if (typeof off === "function") {
                try {
                    off();
                }
                catch {
                    // 事件订阅可能随作用域一起被宿主清掉，忽略。
                }
            }
        }
        originalDispose();
    };
    return controller;
}
