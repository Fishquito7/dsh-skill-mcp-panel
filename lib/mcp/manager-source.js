/**
 * dsh-skill-mcp-panel —— 经 DSH 官方服务读写 dsh-mcp-manager 的服务器。
 *
 * 读：`settings.describe()` 给出 manager 那一行的 user 层（profile 里写的原文）与 value
 *     （补齐默认值后的生效值）；`mcpManager.list()` 给出每台服务器的运行状态。
 * 写：`settings.mutate()`，与 DSH 设置写入走同一条通道（ConfigEditor 文件锁、manager 校验、
 *     热加载、revision 冲突检测），面板不自己拼这一段 YAML。
 * 两个服务都在用到时 `ctx.get()`：宿主没挂 manager 时这一块静默缺席，不影响 mcp-client 行。
 */
import { loaderEntries, mcpToolCount } from "./status.js";
import { MANAGER_PLUGIN_NAME, inputToManagerEntry, managerEntryText, managerEntryToView, parseManagerEntryText, phaseOfManagerStatus, probeResultOf } from "./manager-model.js";
const SERVERS_KEY = "servers";
function serversOf(section) {
    const servers = section?.[SERVERS_KEY];
    return servers !== null && typeof servers === "object" && !Array.isArray(servers) ? servers : {};
}
function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}
/** 改名或新写一个名字时，它不能已被 manager 的其它条目或 mcp-client 行占用（manager 会拒绝挂载）。 */
function assertNameFree(snapshot, previousName, name, clientNames) {
    if (name === previousName)
        return;
    if (snapshot.value[name] !== undefined)
        throw new Error('dsh-mcp-manager 里已有服务器 "' + name + '"');
    if (clientNames.includes(name))
        throw new Error('serverName "' + name + '" 已被一条 dsh-mcp-client 行使用');
}
function replaceOps(previousName, name, entry) {
    const set = { op: "set", path: [SERVERS_KEY, name], value: entry };
    return name === previousName ? [set] : [{ op: "unset", path: [SERVERS_KEY, previousName] }, set];
}
export class ManagerServers {
    ctx;
    constructor(ctx) {
        this.ctx = ctx;
    }
    /** manager 那一行的 settings 命名空间：它在 loader 里的 entry id（桌面版为 mcp-manager）。 */
    namespace() {
        const entry = loaderEntries(this.ctx).find((item) => item?.options?.name === MANAGER_PLUGIN_NAME);
        return typeof entry?.options?.id === "string" ? entry.options.id : undefined;
    }
    snapshot() {
        const ns = this.namespace();
        const settings = this.ctx.get?.("settings");
        if (ns === undefined || typeof settings?.describe !== "function")
            return undefined;
        const descriptor = settings.describe().find((row) => row?.ns === ns);
        if (descriptor === undefined)
            return undefined;
        return { ns, revision: descriptor.revision, user: serversOf(descriptor.user), value: serversOf(descriptor.value) };
    }
    names() {
        return Object.keys(this.snapshot()?.value ?? {});
    }
    statusByName() {
        const manager = this.ctx.get?.("mcpManager");
        const statuses = new Map();
        if (typeof manager?.list !== "function")
            return statuses;
        for (const row of manager.list())
            statuses.set(row.name, row.status);
        return statuses;
    }
    viewOf(name, entry, statuses) {
        const view = managerEntryToView(name, entry);
        if (view === undefined)
            return undefined;
        return { ...view, managed: true, fiberPhase: phaseOfManagerStatus(statuses.get(name)), toolCount: mcpToolCount(this.ctx, name) };
    }
    list() {
        const snapshot = this.snapshot();
        if (snapshot === undefined)
            return [];
        const statuses = this.statusByName();
        return Object.entries(snapshot.value)
            .map(([name, entry]) => this.viewOf(name, entry, statuses))
            .filter((view) => view !== undefined);
    }
    /** 取一个已有条目：user 层优先（编辑时保留手写字段），没写在 profile 里的退回生效值。 */
    require(name) {
        const snapshot = this.snapshot();
        if (snapshot === undefined)
            throw new Error("DSH 的 dsh-mcp-manager 当前不可用，无法修改它的服务器");
        const entry = snapshot.user[name] ?? snapshot.value[name];
        if (entry === undefined)
            throw new Error('dsh-mcp-manager 里没有服务器 "' + name + '"');
        return { snapshot, entry };
    }
    async mutate(snapshot, ops) {
        await this.ctx.get("settings").mutate(snapshot.ns, ops, snapshot.revision);
    }
    /** 写完后按最新生效值生成卡片。 */
    viewAfterWrite(name) {
        const entry = this.snapshot()?.value[name];
        const view = entry === undefined ? undefined : this.viewOf(name, entry, this.statusByName());
        if (view === undefined)
            throw new Error('已写入，但 dsh-mcp-manager 里找不到服务器 "' + name + '"');
        return view;
    }
    async setEnabled(name, enabled) {
        const { snapshot } = this.require(name);
        await this.mutate(snapshot, [{ op: "set", path: [SERVERS_KEY, name, "enabled"], value: enabled }]);
        return this.viewAfterWrite(name);
    }
    async save(input, previousName, clientNames) {
        const { snapshot, entry } = this.require(previousName);
        assertNameFree(snapshot, previousName, input.serverName, clientNames);
        await this.mutate(snapshot, replaceOps(previousName, input.serverName, inputToManagerEntry(input, entry)));
        return this.viewAfterWrite(input.serverName);
    }
    async remove(name) {
        const { snapshot } = this.require(name);
        await this.mutate(snapshot, [{ op: "unset", path: [SERVERS_KEY, name] }]);
    }
    readRaw(name) {
        return managerEntryText(name, this.require(name).entry);
    }
    async writeRaw(previousName, text, clientNames) {
        const { snapshot } = this.require(previousName);
        const { name, entry } = parseManagerEntryText(text);
        assertNameFree(snapshot, previousName, name, clientNames);
        await this.mutate(snapshot, replaceOps(previousName, name, entry));
        return this.viewAfterWrite(name);
    }
    /** 用 manager 自己的 probe 测试：会解析 ${credential:…} 模板，且不碰正在运行的实例。 */
    async probe(name) {
        const manager = this.ctx.get?.("mcpManager");
        if (typeof manager?.probe !== "function")
            return { ok: false, tools: [], error: "DSH 的 dsh-mcp-manager 当前不可用" };
        try {
            return probeResultOf(await manager.probe(name));
        }
        catch (error) {
            return { ok: false, tools: [], error: errorText(error) };
        }
    }
}
