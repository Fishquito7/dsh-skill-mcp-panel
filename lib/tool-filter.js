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
 * 2026-10-20 修 Issue #59 / #62（禁用任一工具后宿主主线程 100% 卡死）：
 * 宿主的 `ScopedLayers.effect()` 在**施加限制之后**和**撤销限制（dispose）时**都会
 * 同步 `ctx.emit("tools/change")`（见 @deepseek-ai/dsh-scope 的 ScopedLayers.effect，
 * 以及 dsh-tools 里 `layers = new ScopedLayers(..., () => this.ctx.emit("tools/change"))`）。
 * 而本插件此前既监听 `tools/change`、又在监听器里 undo/restrict——于是
 *   tools/change → applyNow → undo()/restrict() → 同步 emit → applyNow → …
 * 自己触发自己，同步无限递归；爆栈抛出的 RangeError 被空 catch 吞掉，外层继续再来，
 * 表现为不崩但持续烧 CPU。现在改成三条约束：
 *   - **重入守卫**：`syncAll()` 在自己的 undo/restrict 引发的回调里直接返回；
 *   - **只在集合真的变化时重施**：记住上一次施加的签名，没变就什么都不做；
 *   - **监听器归控制器统一持有**：插件实例不再各自 `c.on("tools/change")`，
 *     挂载途中的 agent 用 `mounting` 挡掉，避免「挂载 → emit → 再挂载」。
 * 另外所有原本静默的 catch 都接到了 logger（这次故障没有日志的直接原因）。
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
/** 把错误整理成一行日志文本。 */
function errorText(error) {
    if (error !== null && typeof error === "object" && "message" in error)
        return String(error.message);
    return String(error);
}
/**
 * 往宿主 logger 打一条警告（拿不到 logger 时退回 console）。
 *
 * 这次「禁用工具后卡死」没有任何日志，就是因为关键 catch 是空的；这里统一接到
 * logger，出问题时至少能在宿主日志里看到 [tool-filter] 前缀。
 */
function warnOf(ctx, message) {
    const line = "[tool-filter] " + message;
    try {
        const logger = typeof ctx?.get === "function" ? ctx.get("logger") : undefined;
        if (logger !== null && typeof logger === "object" && typeof logger.warn === "function") {
            logger.warn(line);
            return;
        }
    }
    catch {
        // logger 服务不可用：继续退回 console
    }
    try {
        if (typeof console !== "undefined" && typeof console.warn === "function")
            console.warn(line);
    }
    catch {
        // 连 console 都没有（极简宿主）：放弃这条日志，不影响功能
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
 * （"names unknown global tool"）。MCP 服务器是异步连上来的，所以控制器监听
 * `tools/change`，等工具真的出现后再对每个 agent 补一轮（`sync()`）；每轮只在
 * 实际集合变化时才 undo + restrict（见文件头 2026-10-20 的说明）。
 */
export class ToolFilterController {
    ctx;
    deny;
    mounted = new Map();
    /** 正在挂载的 agent：挂载途中 restrict() 会同步 emit tools/change，必须挡住重入。 */
    mounting = new Set();
    /** tools/change 的重入守卫（我们自己 undo/restrict 引发的回调直接忽略）。 */
    syncing = false;
    disposed = false;
    constructor(ctx, deny) {
        this.ctx = ctx;
        this.deny = deny;
    }
    /**
     * 生成挂到 agent 作用域上的过滤插件。
     *
     * `holder.sync()` 由控制器在 `tools/change` 时调用——插件实例自己**不订阅**
     * `tools/change`，否则每个实例都会在事件里重入自己，又回到这次修的递归。
     */
    pluginFor(deny) {
        const holder = { sync: () => { } };
        return {
            holder,
            plugin: {
                name: "dsh-skill-mcp-panel:tool-filter",
                inject: ["tools"],
                apply(c) {
                    let undo;
                    /** 上一次真正施加的禁用集合签名；null 表示当前没有施加。 */
                    let applied = null;
                    let live = true;
                    /** 单个插件实例的重入守卫：挂载时 restrict() 的同步 emit 会绕回这里。 */
                    let inside = false;
                    const sync = () => {
                        if (!live || inside)
                            return;
                        inside = true;
                        try {
                            syncOnce();
                        }
                        finally {
                            inside = false;
                        }
                    };
                    const syncOnce = () => {
                        let known;
                        try {
                            known = new Set(c.tools.view(undefined).restrictableNames);
                        }
                        catch (error) {
                            warnOf(c, "读取可限制工具列表失败：" + errorText(error));
                            return;
                        }
                        const usable = deny.filter((name) => known.has(name));
                        const signature = usable.slice().sort().join("\u0000");
                        // 集合没变就什么都不做：这是 Issue #62 里 CPU 的热点（每次 tools/change
                        // 都 undo + view + restrict 一轮，view() 本身还是 O(工具数 × 层数)）。
                        if (signature === applied)
                            return;
                        if (undo !== undefined) {
                            try {
                                undo();
                            }
                            catch (error) {
                                warnOf(c, "撤销上一轮限制失败：" + errorText(error));
                            }
                            undo = undefined;
                            applied = null;
                        }
                        if (usable.length === 0) {
                            applied = "";
                            return;
                        }
                        try {
                            undo = c.tools.restrict({ deny: usable });
                            applied = signature;
                        }
                        catch (error) {
                            // 名字在注册的一瞬间消失了：留给下一次 tools/change 再试。
                            warnOf(c, "施加工具限制失败：" + errorText(error));
                            undo = undefined;
                            applied = null;
                        }
                    };
                    holder.sync = sync;
                    // 插件纤维被宿主回收时停止再施加（纤维销毁时限制本身会被宿主自动撤销）。
                    try {
                        c.effect(() => () => {
                            live = false;
                            holder.sync = () => { };
                        });
                    }
                    catch {
                        // 极简宿主没有 effect：至少别再被控制器调到
                    }
                    sync();
                }
            }
        };
    }
    /**
     * 对所有已挂载的 agent 补一轮限制。
     *
     * 重入守卫是这次修复的核心：`undo()` 与 `restrict()` 都会**同步**触发
     * `tools/change`，而控制器正是监听这个事件——没有守卫就是无限递归。
     */
    syncAll() {
        if (this.disposed || this.syncing)
            return;
        this.syncing = true;
        try {
            for (const entry of [...this.mounted.values()]) {
                try {
                    entry.holder.sync();
                }
                catch (error) {
                    warnOf(this.ctx, "重新施加工具限制失败：" + errorText(error));
                }
            }
        }
        finally {
            this.syncing = false;
        }
    }
    /** 给一个 agent 施加限制；已经施加过（或正在挂载）的跳过。 */
    applyTo(agent) {
        if (this.disposed || this.deny.length === 0)
            return;
        const id = typeof agent?.id === "string" ? agent.id : undefined;
        if (id === undefined || this.mounted.has(id) || this.mounting.has(id))
            return;
        const scopeCtx = agent.ctx;
        if (scopeCtx === undefined || typeof scopeCtx.plugin !== "function")
            return;
        this.mounting.add(id);
        try {
            const { plugin, holder } = this.pluginFor(this.deny);
            const fiber = scopeCtx.plugin(plugin);
            this.mounted.set(id, { fiber, holder });
        }
        catch (error) {
            // 作用域已经销毁或不接受挂载：跳过，不因为一个 agent 失败就中断。
            warnOf(this.ctx, "挂载工具过滤插件失败（agent " + id + "）：" + errorText(error));
        }
        finally {
            this.mounting.delete(id);
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
        this.unmountAll();
        this.reapply();
    }
    /** 卸载所有过滤插件（纤维销毁会连带撤销它注册的限制）。 */
    unmountAll() {
        for (const [id, entry] of [...this.mounted.entries()]) {
            this.mounted.delete(id);
            try {
                entry.fiber?.dispose?.();
            }
            catch (error) {
                // 作用域已经没了，忽略（但留一条日志，别再无声吞掉）
                warnOf(this.ctx, "卸载工具过滤插件失败（agent " + id + "）：" + errorText(error));
            }
        }
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
        this.unmountAll();
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
    // 工具集合变化（MCP 服务器连上来 / 工具注册）时对每个 agent 补一轮。
    // 事件由控制器统一持有，且 syncAll() 带重入守卫——restrict()/undo() 自己也会
    // 同步触发这个事件，不挡就是 Issue #59 / #62 的无限递归。
    const offTools = ctx.on("tools/change", () => controller.syncAll());
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
