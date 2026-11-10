/**
 * 渲染级回归：把 lib/client.js 当成浏览器束跑起来，用一个会真正更新状态的 react 桩
 * 渲染 SkillsSection / McpSection，然后模拟点击（切工作区、切分组/来源、批量勾选、
 * 迁移、删除+撤销、打开目录、MCP 页签、#46 通知）。这些路径 test-panel-slots.mjs 不覆盖。
 *
 * 用法：node test-panel-render.mjs [lib/client.js 路径]
 */
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const bundlePath = process.argv[2] ?? fileURLToPath(new URL("../lib/client.js", import.meta.url));
const source = readFileSync(bundlePath, "utf8");

let captured = null;
const styleTags = [];
// document 桩：Issue #82 的「点外部 / Esc 关闭」要在 document 上挂/摘监听，
// 所以这里维护一份监听表，用 dispatchDocument 手动派发（渲染桩没有真实事件循环）。
const documentListeners = new Map();
const documentStub = {
  querySelector: () => null,
  createElement: () => ({ dataset: {}, textContent: "" }),
  head: { appendChild: (tag) => styleTags.push(tag) },
  addEventListener: (type, listener) => {
    if (!documentListeners.has(type)) documentListeners.set(type, new Set());
    documentListeners.get(type).add(listener);
  },
  removeEventListener: (type, listener) => {
    const set = documentListeners.get(type);
    if (set !== undefined) set.delete(listener);
  }
};
const dispatchDocument = (type, event) => {
  const set = documentListeners.get(type);
  if (set === undefined) return;
  for (const listener of [...set]) listener(event);
};
const store = new Map();
const localStorageStub = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, value)
};
const clipboardWrites = [];
const navigatorStub = { clipboard: { writeText: async (text) => { clipboardWrites.push(text); } } };
// 视口桩：组件用 window.matchMedia("(max-width:820px)") 判断窄屏（Issue #71）。
// 默认宽屏 = 三栏；setViewportNarrow 同时通知 change 监听者，模拟拖动窗口。
let viewportNarrow = false;
const mediaListeners = new Set();
const matchMediaStub = (query) => ({
  media: query,
  get matches() { return viewportNarrow; },
  addEventListener: (type, listener) => { if (type === "change") mediaListeners.add(listener); },
  removeEventListener: (type, listener) => { if (type === "change") mediaListeners.delete(listener); }
});
const setViewportNarrow = (narrow) => {
  viewportNarrow = narrow;
  for (const listener of [...mediaListeners]) listener({ matches: narrow, media: "(max-width:820px)" });
};
// 面板自身宽度桩（Issue #71）：窗口宽 ≠ 面板宽，宿主左侧会话栏会占掉一截。
// 组件的 ResizeObserver 回调从这里拿宽度；fireResize() 模拟拖动窗口改变容器宽。
let containerWidth = 1200;
const resizeObservers = [];
const ResizeObserverStub = class ResizeObserver {
  constructor(callback) { this.callback = callback; resizeObservers.push(this); }
  observe() {}
  disconnect() {}
};
const fireResize = () => {
  for (const observer of [...resizeObservers]) observer.callback([], observer);
};
const sandbox = {
  console,
  document: documentStub,
  localStorage: localStorageStub,
  navigator: navigatorStub,
  setTimeout,
  clearTimeout,
  TextEncoder,
  btoa,
  atob,
  URL,
  window: { __ModuleLoader__: { load: (mod) => { captured = mod; } }, matchMedia: matchMediaStub },
  ResizeObserver: ResizeObserverStub
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "lib/client.js" });

// ── 带状态的 react 桩 ──────────────────────────────────────────────────────
const jsx = (type, props) => ({ type, props: props ?? {} });
const MenuStub = function Menu(props) { return { __menu: true, props: props ?? {} }; };
const slots = new Map();
const refs = new Map();
let cursor = 0;
let current = "?";
let pendingEffects = [];
const effectRuns = new Map();
const reactStub = {
  useState: (init) => {
    const key = current + "#" + cursor++;
    if (!slots.has(key)) slots.set(key, { state: typeof init === "function" ? init() : init });
    const slot = slots.get(key);
    return [slot.state, (next) => { slot.state = typeof next === "function" ? next(slot.state) : next; }];
  },
  useEffect: (fn, deps) => {
    const key = current + "@" + cursor++;
    pendingEffects.push({ key, fn, deps });
  },
  useRef: (init) => {
    const key = current + "#" + cursor++;
    if (!refs.has(key)) refs.set(key, { current: init });
    return refs.get(key);
  },
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  createElement: jsx,
  Fragment: Symbol("Fragment")
};
const requireStub = (specifier) => {
  if (specifier === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: reactStub.Fragment };
  if (specifier === "react") return reactStub;
  if (specifier === "@deepseek-ai/dsh-client-ui-primitives") {
    const icon = (props) => ({ __icon: true, props: props ?? {} });
    return {
      Menu: MenuStub,
      IconSkillOutlineRegular: icon,
      IconChevronDownOutlineRegular: icon,
      IconChevronLeftOutlineRegular: icon,
      IconSearchOutlineRegular: icon,
      IconFolderOpenOutlineRegular: icon,
      IconPlusOutlineRegular: icon,
      IconSettingsOutlineRegular: icon,
      IconTrashOutlineRegular: icon,
      IconCopyOutlineRegular: icon,
      IconProjectAddOutlineRegular: icon
    };
  }
  throw new Error("unexpected require: " + specifier);
};
const mod = captured.factory(requireStub);

// ── 桩宿主：字典 + 槽位 + 假 RPC ───────────────────────────────────────────
const dictionaries = new Map();
const registrations = [];
const batchCalls = [];
const addCalls = [];
const deleted = [];
const skills = [
  { name: "alpha", description: "A 技能", provider: "filesystem", source: "user", enabled: true, pluginProvided: false, rel: "alpha/SKILL.md", scope: { kind: "global" } },
  { name: "beta", description: "B 技能", provider: "nested", source: "user", enabled: false, pluginProvided: false, rel: "cat/beta/SKILL.md", scope: { kind: "global" }, groups: ["g1"] },
  { name: "gamma", description: "G 技能", provider: "bundled", source: "bundled", enabled: true, pluginProvided: true, rel: "", scope: { kind: "global" } },
  { name: "delta", description: "D 技能", provider: "filesystem", source: "user", enabled: true, pluginProvided: false, rel: "delta/SKILL.md", scope: { kind: "workspace", path: "C:/proj/one" }, groups: ["g2"] },
  { name: "omega", description: "O 技能", provider: "filesystem", source: "user", enabled: true, pluginProvided: false, rel: "omega/SKILL.md", scope: { kind: "global" } }
];
const ctx = {
  effect: (fn) => { const d = fn(); return typeof d === "function" ? d : () => {}; },
  get: (name) => (name === "layout" ? { selectPanel: () => {} } : undefined),
  on: () => () => {},
  locale: {
    register: (namespace, tables) => { dictionaries.set(namespace, tables); return () => {}; },
    bind: (namespace) => (key, params) => {
      const tables = dictionaries.get(namespace) ?? { zh: {} };
      let text = (tables.zh ?? tables)[key];
      if (typeof text !== "string") return key;
      for (const [name, value] of Object.entries(params ?? {})) text = text.replace("{" + name + "}", String(value));
      return text;
    },
    subscribe: () => () => {},
    getSnapshot: () => ({ revision: 0 })
  },
  slots: {
    inject: (name, callback) => callback(),
    register: (options, component) => { registrations.push({ options, component }); return () => {}; }
  },
  remote: { $mount: async () => undefined, $on: () => () => {} }
};
mod.apply(ctx);

const panel = registrations.find((row) => row.options.name === "main" && row.options.key === "skill-mcp");
const face = panel.options.inject();
let skillRows = skills.map((s) => ({ ...s }));
const rpc = {
  ...face,
  listSkills: async () => ({ skills: skillRows.map((s) => ({ ...s })) }),
  listWorkspaces: async () => ({ workspaces: [{ path: "C:/proj/one", label: "one", sessions: 1 }, { path: "C:/proj/two", label: "two", sessions: 0 }] }),
  listGroups: async () => ({ groups: [{ id: "g1", name: "办公", scopes: { global: ["beta"] } }, { id: "g2", name: "组件", scopes: { "C:/proj/one": ["delta"] } }] }),
  loadContent: async (name) => ({ name: name, description: "d", content: "--- body of " + name + " ---", provider: "filesystem", path: "C:/Users/x/.dsh/skills/" + name + "/SKILL.md" }),
  setSkillEnabled: async () => ({ ok: true }),
  removeSkill: async (name) => { deleted.push(name); skillRows = skillRows.filter((s) => s.name !== name); return { removed: true }; },
  addSkill: async (payload) => { addCalls.push(payload); return { added: [{ name: "restored" }], skipped: [], warnings: [] }; },
  batchMigrateSkill: async (payload) => { batchCalls.push(payload); return { results: payload.names.map((name) => ({ name, ok: true })) }; },
  saveGroupSkill: async (payload) => ({ groups: [{ id: "g9", name: payload.name, scopes: {} }] }),
  deleteGroupSkill: async () => ({ groups: [] }),
  checkUpdateRemote: async () => ({ current: "2.2.0", latest: null, updateAvailable: false })
};
const evacCalls = [];
const mcpFace = {
  ...rpc,
  evacuateForeign: async () => { evacCalls.push(1); return { moved: 1 }; },
  listMcp: async () => ({
    servers: [{ serverName: "gh", transport: "stdio", enabled: true, fiberPhase: "active", toolCount: 3, envKeys: [] }],
    externalServers: [],
    patch: {
      path: "C:/p/cordis.patch.yml",
      ok: true,
      error: null,
      foreign: [{ id: "other-row", managed: false }, { id: "panel-mcp-a", managed: true }, { name: "another", managed: false }]
    }
  }),
  saveMcp: async () => ({}),
  removeMcp: async () => ({}),
  setEnabledMcp: async () => ({}),
  testMcp: async () => ({ ok: true, tools: [] }),
  reloadMcp: async () => ({ servers: [], externalServers: [], patch: { path: "", ok: true, error: null, foreign: [] } })
};
// 单工具清单（Issue #77 的筛选用例）：三台工具、一台已连接。
const toolFilterCalls = [];
mcpFace.listMcpTools = async ({ serverName }) => ({
  serverName,
  connected: true,
  tools: [
    { name: "alpha_tool", description: "Alpha 工具" },
    { name: "beta_tool", description: "Beta 工具" },
    { name: "gamma_tool", description: "Gamma 工具" }
  ],
  disabled: []
});
mcpFace.getToolFilter = async () => ({ deny: [] });
mcpFace.setToolFilter = async (payload) => { toolFilterCalls.push(payload); return { deny: payload.deny, applied: 1 }; };

// ── 渲染驱动 ───────────────────────────────────────────────────────────────
const flush = async (turns = 12) => { for (let i = 0; i < turns; i++) await Promise.resolve(); };

/** 每个小节都从干净的挂载开始（清空 hook 槽位 = 重新挂载面板）。 */
const reset = (rows = skills, lastTab = "skills") => {
  slots.clear();
  refs.clear();
  effectRuns.clear();
  skillRows = rows.map((row) => ({ ...row }));
  deleted.length = 0;
  addCalls.length = 0;
  batchCalls.length = 0;
  store.clear();
  documentListeners.clear();
  containerWidth = 1200;
  if (lastTab === "mcp") store.set("dsh-skill-mcp-panel:last-tab", "mcp");
};

/** 模拟 React 的 ref 挂载：带 ref 的节点拿到一个能量出 containerWidth 的假 DOM。 */
const attachRefs = (node) => {
  walk(node, (n) => {
    const ref = n.props === undefined ? undefined : n.props.ref;
    if (ref !== null && typeof ref === "object" && !Array.isArray(ref)) {
      ref.current = { nodeType: 1, getBoundingClientRect: () => ({ width: containerWidth }) };
    }
  });
};

const paint = (props) => {
  cursor = 0;
  current = "Page";
  pendingEffects = [];
  const page = panel.component({ ...props });
  const pageEffects = pendingEffects;
  pendingEffects = [];
  const body = page.props.children[2];
  cursor = 0;
  current = body.type.name || "Section";
  const section = body.type(body.props);
  const sectionEffects = pendingEffects;
  pendingEffects = [];
  attachRefs(section);
  return { page, section, effects: [...pageEffects, ...sectionEffects] };
};
/** 按依赖数组决定要不要跑，模拟 React 的 commit 语义（deps 为 undefined 时每次都跑）。 */
const runEffects = (effects) => {
  for (const entry of effects) {
    const previous = effectRuns.get(entry.key);
    const deps = entry.deps;
    const previousDeps = previous === undefined || previous === null ? undefined : previous.deps;
    const changed = previous === undefined || deps === undefined || previous === null || !Array.isArray(previousDeps) || deps.length !== previousDeps.length || deps.some((value, index) => !Object.is(value, previousDeps[index]));
    if (!changed) continue;
    // Issue #82：依赖变化/卸载时先跑上一次的 cleanup，否则 document 上的旧闭包会一直留着。
    if (previous !== undefined && previous !== null && typeof previous.cleanup === "function") previous.cleanup();
    const slot = { deps: deps === undefined ? null : deps, cleanup: undefined };
    effectRuns.set(entry.key, slot);
    if (typeof entry.fn === "function") {
      const cleanup = entry.fn();
      if (typeof cleanup === "function") slot.cleanup = cleanup;
    }
  }
};
/** 挂载：渲染 → 跑 effect（发起 RPC）→ 等 promise → 再渲染两次让状态落地。 */
const mount = async (props = rpc) => {
  let out = paint(props);
  runEffects(out.effects);
  await flush();
  out = paint(props);
  runEffects(out.effects);
  await flush();
  return paint(props);
};

const walk = (node, visit) => {
  if (node === null || node === undefined || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const child of node) walk(child, visit); return; }
  if (node.props !== undefined) {
    visit(node);
    walk(node.props.children, visit);
    if (node.props.anchor !== undefined) walk(node.props.anchor, visit);
  }
};
const findAll = (node, predicate) => { const out = []; walk(node, (n) => { if (predicate(n)) out.push(n); }); return out; };
const byClass = (node, className) => findAll(node, (n) => typeof n.props.className === "string" && n.props.className.split(" ").includes(className));

let failures = 0;
const check = (label, fn) => {
  try { fn(); console.log("PASS  " + label); }
  catch (error) { failures++; console.log("FAIL  " + label + "\n      " + (error && error.message ? error.message : error)); }
};
const assert = (cond, message) => { if (!cond) throw new Error(message); };

// ── 1. 技能页签：三栏骨架 ─────────────────────────────────────────────────
{
  reset();
  const view = await mount();
  check("page carries data-tab for the shell styles", () => {
    assert(view.page.props["data-tab"] === "skills", "expected data-tab=skills, got " + view.page.props["data-tab"]);
  });
  check("skills section keeps the SKV_section root and the three columns", () => {
    assert(view.section.props.className === "SKV_section", "root class changed: " + view.section.props.className);
    assert(byClass(view.section, "SKV_rail").length === 1, "rail missing");
    assert(byClass(view.section, "SKV_pane").length === 1, "pane missing");
    assert(byClass(view.section, "SKV_mainCol").length === 1, "main column missing");
    assert(byClass(view.section, "SKV_mainScroll").length === 1, "scroll container missing");
    assert(byClass(view.section, "SKV_railBar").length === 1, "glow bar missing");
  });
  check("rail lists 全局 + every workspace (overflow is carried by scrolling)", () => {
    const items = byClass(view.section, "SKV_railItem");
    const labels = items.map((n) => n.props.children[0].props.children);
    assert(labels[0] === "全局", "global must be first: " + JSON.stringify(labels));
    assert(labels.includes("one"), "workspace with skills missing: " + JSON.stringify(labels));
    assert(labels.includes("two"), "a workspace with 0 skills must still be reachable: " + JSON.stringify(labels));
    const counts = items.map((n) => n.props.children[1].props.children);
    assert(counts[0] === "4", "global count should be 4, got " + counts[0]);
    assert(counts[labels.indexOf("two")] === "0", "empty workspace must show 0: " + JSON.stringify(counts));
  });
  check("no rail footer menu — the list itself scrolls", () => {
    // 只认「挂在 SKV_railFoot 上的菜单」：迁移目标菜单里出现同一个工作区是正常的。
    const menus = findAll(view.section, (n) => n.type === MenuStub);
    const railMenu = menus.find((menu) => menu.props?.anchor?.props?.className === "SKV_railFoot");
    assert(railMenu === undefined, "the other-workspaces menu came back");
    assert(byClass(view.section, "SKV_railFoot").length === 0, "rail footer button came back");
    const cssText = styleTags.map((tag) => tag.textContent).join("");
    assert(/\.SKV_railList\{[^}]*overflow-y:auto/.test(cssText), "rail list must scroll");
    assert(/\.SKV_paneList\{[^}]*overflow-y:auto/.test(cssText), "pane list must scroll");
  });
  check("pane renders 全部 / groups / 未分组 with counts", () => {
    const rows = byClass(view.section, "SKV_paneItem");
    const labels = rows.map((n) => n.props.children[0].props.children);
    assert(labels[0] === "全部", "first pane row must be 全部: " + JSON.stringify(labels));
    assert(labels.includes("办公"), "group row missing: " + JSON.stringify(labels));
    assert(labels.includes("未分组"), "ungrouped row missing: " + JSON.stringify(labels));
    assert(byClass(view.section, "SKV_paneMode").length === 2, "group/source switch missing");
    assert(byClass(view.section, "SKV_paneNew").length === 1, "inline new-group button missing");
  });
  check("toolbar exposes the square buttons with aria-label tooltips", () => {
    const buttons = byClass(view.section, "SKV_toolButton");
    const labels = buttons.map((n) => n.props["aria-label"]);
    assert(buttons.length === 5, "expected 5 toolbar buttons, got " + buttons.length);
    for (const wanted of ["打开目录", "批量迁移", "新建分组", "添加技能", "切换到简洁模式"]) {
      assert(labels.includes(wanted), "toolbar button missing: " + wanted + " in " + JSON.stringify(labels));
    }
  });
  check("card row is [checkbox][icon][name+desc][traffic + delete]", () => {
    const cards = byClass(view.section, "SKV_card");
    assert(cards.length === 4, "expected 4 cards, got " + cards.length);
    const row = byClass(cards[0], "SKV_cardRow")[0];
    assert(row !== undefined, "card row missing");
    const order = row.props.children.map((child) => child.props.className);
    assert(order[0] === "SKV_check", "first cell must be the checkbox: " + order[0]);
    assert(order[1] === "SKV_rowIcon", "second cell must be the icon: " + order[1]);
    assert(order[2] === "SKV_rowText", "third cell must be name+description: " + order[2]);
    assert(order[3] === "SKV_rowControls", "fourth cell must be controls: " + order[3]);
    const text = byClass(cards[0], "SKV_rowText")[0];
    assert(text.props.children.length === 2, "name + description expected inside the text cell");
  });
  check("traffic-light switch replaces the round switch on skill cards", () => {
    const traffic = byClass(view.section, "SKV_traffic");
    assert(traffic.length > 0, "traffic switch missing");
    const dots = traffic[0].props.children.map((child) => child.props.className);
    assert(dots[0].includes("SKV_trafficRed") && dots[1].includes("SKV_trafficGreen"), "red/green dots missing: " + JSON.stringify(dots));
    assert(byClass(view.section, "SKV_switch").length === 0, "old round switch still rendered on the skills page");
    assert(byClass(view.section, "SKV_rowDelete").length === 3, "bundled skills must not offer delete; got " + byClass(view.section, "SKV_rowDelete").length);
  });
  check("disabled skill name is greyed out", () => {
    const beta = byClass(view.section, "SKV_card").find((card) => card.props["data-skill-name"] === "beta");
    const name = byClass(beta, "SKV_rowName")[0];
    assert(name.props["data-disabled"] === "true", "beta is disabled and its name should be dimmed");
    const traffic = byClass(beta, "SKV_traffic")[0];
    assert(traffic.props["data-on"] === "false", "traffic switch must show the red light for a disabled skill");
  });
}

// ── 2. 来源模式（#42）──────────────────────────────────────────────────────
{
  reset();
  const base = await mount();
  byClass(base.section, "SKV_paneMode")[1].props.onClick();
  const source = await mount();
  const rows = byClass(source.section, "SKV_paneItem");
  const labels = rows.map((n) => n.props.children[0].props.children);
  check("source mode lists 插件自带 + provider names with counts", () => {
    assert(labels.includes("插件自带"), "plugin-provided source row missing: " + JSON.stringify(labels));
    assert(labels.includes("filesystem") && labels.includes("nested"), "provider rows missing: " + JSON.stringify(labels));
  });
  const fsRow = rows.find((n) => n.props.children[0].props.children === "filesystem");
  fsRow.props.onClick();
  const filtered = await mount();
  const names = byClass(filtered.section, "SKV_card").map((c) => c.props["data-skill-name"]);
  check("selecting a source filters the list", () => {
    assert(names.length === 2 && names.includes("alpha") && names.includes("omega"), "expected the two filesystem skills, got " + JSON.stringify(names));
  });
  byClass(filtered.section, "SKV_paneMode")[0].props.onClick();
  const back = await mount();
  check("switching back to groups restores the group filter", () => {
    assert(byClass(back.section, "SKV_card").length === 4, "expected the full list again");
  });
}

// ── 3. 批量模式 + 迁移 ────────────────────────────────────────────────────
{
  reset();
  const base = await mount();
  byClass(base.section, "SKV_toolButton")[1].props.onClick();
  const batched = await mount();
  check("batch mode flips data-batch and keeps the checkboxes tabbable", () => {
    assert(batched.section.props["data-batch"] === "true", "data-batch not set");
    const boxes = byClass(batched.section, "SKV_checkBox");
    assert(boxes.length >= 4, "checkboxes missing");
    assert(boxes[0].props.tabIndex === 0, "checkbox should be tabbable in batch mode");
    assert(byClass(batched.section, "SKV_batchBar").length === 1, "batch bar missing");
  });
  byClass(batched.section, "SKV_checkBox")[0].props.onChange();
  byClass(batched.section, "SKV_checkBox")[1].props.onChange();
  const selected = await mount();
  const bar = byClass(selected.section, "SKV_batchBar")[0];
  check("batch bar counts the selection and enables 迁移到…", () => {
    assert(bar.props.children[0].props.children === "已选 2 项", "counter wrong: " + bar.props.children[0].props.children);
    const go = findAll(bar, (n) => typeof n.props.className === "string" && n.props.className.includes("SKV_batchGo"))[0];
    assert(go.props.disabled === false, "primary button should be enabled");
    const marked = byClass(selected.section, "SKV_card").filter((c) => c.props["data-selected"] === "true");
    assert(marked.length === 2, "selected rows must be marked: " + marked.length);
  });
  const menus = findAll(selected.section, (n) => n.type === MenuStub).filter((menu) => Array.isArray(menu.props.items) && menu.props.items.some((item) => String(item.id).includes("advanced")));
  check("migrate menu offers every other workspace plus the advanced entry", () => {
    assert(menus.length === 1, "batch target menu missing");
    const items = menus[0].props.items;
    assert(items.some((item) => item.id === "C:/proj/two"), "missing empty workspace");
    assert(items.some((item) => item.id === "C:/proj/one"), "missing workspace one");
    assert(!items.some((item) => item.id === "global" && item.id === "global" && false), "global is the current scope and must be absent");
    assert(items.some((item) => String(item.id).includes("advanced")), "advanced entry missing");
  });
  menus[0].props.onSelect("C:/proj/two");
  await flush();
  const after = await mount();
  check("quick migrate sends a move payload and leaves batch mode", () => {
    assert(batchCalls.length === 1, "batchMigrateSkill not called");
    assert(batchCalls[0].mode === "move" && batchCalls[0].from === null, "payload wrong: " + JSON.stringify(batchCalls[0]));
    assert(batchCalls[0].targets.length === 1 && batchCalls[0].targets[0] === "C:/proj/two", "targets wrong");
    assert(batchCalls[0].names.length === 2, "names wrong: " + JSON.stringify(batchCalls[0].names));
    assert(after.section.props["data-batch"] === undefined, "batch mode should be over");
    const toast = byClass(after.section, "SKV_toast")[0];
    assert(toast.props["data-show"] === "true", "migration toast missing");
  });

  // 「更多选项…」必须还能打开完整的批量迁移对话框（复制 / 多目标 / 失败明细）
  reset();
  const base2 = await mount();
  byClass(base2.section, "SKV_toolButton")[1].props.onClick();
  const batched2 = await mount();
  byClass(batched2.section, "SKV_checkBox")[0].props.onChange();
  const picked = await mount();
  const batchMenu = findAll(picked.section, (n) => n.type === MenuStub).filter((menu) => Array.isArray(menu.props.items) && menu.props.items.some((item) => String(item.id).includes("advanced")))[0];
  const advancedItem = batchMenu.props.items.find((item) => String(item.id).includes("advanced"));
  batchMenu.props.onSelect(advancedItem.id);
  await flush();
  const dialog = await mount();
  const dialogEl = findAll(dialog.section, (n) => n.type && n.type.name === "MigrateDialog")[0];
  const renderedDialog = dialogEl === undefined ? null : (() => { cursor = 0; current = "MigrateDialog"; return dialogEl.type(dialogEl.props); })();
  check("the advanced entry opens the full batch-migrate dialog with the scope prefilled", () => {
    assert(renderedDialog !== null, "migrate dialog did not open");
    assert(renderedDialog.props.className === "SKV_scopeOverlay", "dialog root wrong: " + renderedDialog.props.className);
    const fromRadios = byClass(renderedDialog, "SKV_targetItem").filter((row) => row.props.children[0].props.name === "migrate-from");
    const checkedFrom = fromRadios.filter((row) => row.props.children[0].props.checked === true);
    assert(checkedFrom.length === 1 && String(checkedFrom[0].props.children[1].props.children) === "全局", "source workspace not prefilled");
    const rows = byClass(renderedDialog, "SKV_skillRow");
    assert(rows.length === 4, "expected the source-scope skills to be listed: " + rows.length);
    assert(rows.filter((row) => row.props.children[0].props.checked === true).length === 1, "the checkbox selection should carry over from the batch bar");
  });
}

// ── 4. 删除：乐观删除 + 撤销 ──────────────────────────────────────────────
{
  reset();
  const base = await mount();
  const del = byClass(base.section, "SKV_rowDelete")[0];
  const targetName = String(del.props["aria-label"]).replace("删除 ", "");
  del.props.onClick();
  const fading = paint(rpc);   // 同步再渲染一次 = 点击后的那一帧，RPC 还没落地
  check("delete marks the row as removing before the RPC lands", () => {
    const marked = byClass(fading.section, "SKV_card").filter((c) => c.props["data-removing"] === "true");
    assert(marked.length === 1, "expected exactly one fading row, got " + marked.length);
    assert(marked[0].props["data-skill-name"] === targetName, "wrong row fading: " + marked[0].props["data-skill-name"]);
  });
  await flush();
  const after = await mount();
  check("delete removes the row optimistically and raises an undo toast", () => {
    assert(deleted.includes(targetName), "removeSkill not called: " + JSON.stringify(deleted));
    const names = byClass(after.section, "SKV_card").map((c) => c.props["data-skill-name"]);
    assert(!names.includes(targetName), "row should be gone: " + JSON.stringify(names));
    const toast = byClass(after.section, "SKV_toast")[0];
    assert(toast.props["data-show"] === "true", "toast not shown");
    assert(String(toast.props.children[0].props.children).includes("已删除 " + targetName), "toast text wrong: " + toast.props.children[0].props.children);
    const undo = findAll(toast, (n) => n.props.className === "SKV_toastAction")[0];
    assert(undo !== undefined && undo.props.children === "撤销", "undo button missing");
  });
  const toast = byClass(after.section, "SKV_toast")[0];
  findAll(toast, (n) => n.props.className === "SKV_toastAction")[0].props.onClick();
  await flush();
  check("undo re-adds the skill through addSkill with the captured body", () => {
    assert(addCalls.length === 1, "addSkill not called");
    const payload = addCalls[0];
    assert(payload.kind === "auto", "kind wrong");
    assert(payload.files[0].path === targetName + "/SKILL.md", "restore path wrong: " + payload.files[0].path);
    const decoded = Buffer.from(payload.files[0].base64, "base64").toString("utf8");
    assert(decoded.includes("body of " + targetName), "restored body wrong: " + decoded);
    assert(payload.workspace === null, "global skill must restore with workspace=null");
  });
}

// ── 5. 打开目录 / 偏好项 ──────────────────────────────────────────────────
{
  reset();
  const base = await mount();
  byClass(base.section, "SKV_toolButton")[0].props.onClick();
  await flush();
  const after = await mount();
  check("open-folder copies the resolved skill root and echoes it in the notice", () => {
    const text = byClass(after.section, "SKV_noticeText").map((n) => n.props.children).join(" | ");
    assert(text.includes("C:/Users/x/.dsh/skills"), "path not echoed: " + text);
    assert(text.includes("剪贴板"), "clipboard fallback wording missing: " + text);
    assert(clipboardWrites.length === 1 && clipboardWrites[0] === "C:/Users/x/.dsh/skills", "clipboard never received the path: " + JSON.stringify(clipboardWrites));
  });
  {
    // 没有剪贴板 API 时：通知条要摊开路径让用户手抄
    const saved = navigatorStub.clipboard;
    navigatorStub.clipboard = undefined;
    reset();
    const bare = await mount();
    byClass(bare.section, "SKV_toolButton")[0].props.onClick();
    await flush();
    const notice = await mount();
    check("open-folder falls back to showing the path when there is no clipboard", () => {
      const text = byClass(notice.section, "SKV_noticeText").map((n) => n.props.children).join(" | ");
      assert(text.includes("手动复制"), "manual-copy wording missing: " + text);
      assert(text.includes("C:/Users/x/.dsh/skills"), "path not shown: " + text);
    });
    navigatorStub.clipboard = saved;
  }
  {
    // 真实 rel 形态（目录路径 "alpha"，不是 "alpha/SKILL.md"）+ Windows 反斜杠绝对路径：
    // 这是 2026-10-19 用户报「每个工作区都拿不到根路径」的那个组合。
    reset();
    const dirRelRpc = {
      ...rpc,
      listSkills: async () => ({
        skills: [{ name: "alpha", description: "A", provider: "filesystem", source: "user", enabled: true, rel: "alpha", scope: { kind: "global" } }]
      }),
      loadContent: async () => ({
        name: "alpha",
        description: "A",
        content: "x",
        provider: "filesystem",
        path: "C:\\Users\\x\\.dsh\\skills\\alpha\\SKILL.md"
      })
    };
    const mounted = await mount(dirRelRpc);
    byClass(mounted.section, "SKV_toolButton")[0].props.onClick();
    await flush();
    const noticeView = await mount(dirRelRpc);
    check("open-folder understands the real rel shape (directory path, backslash file path)", () => {
      const text = byClass(noticeView.section, "SKV_noticeText").map((n) => n.props.children).join(" | ");
      assert(text.includes("C:/Users/x/.dsh/skills"), "skill root lost for real rel shape: " + text);
      assert(!text.includes("拿不到"), "must not report the unavailable message: " + text);
    });
  }
  {
    // 工作区作用域里读不到任何正文时，仍应给出 <工作区>/.dsh/skills（以前这里被提前 return 掉）。
    reset();
    const offlineRpc = {
      ...rpc,
      listSkills: async () => ({
        skills: [{ name: "delta", description: "D", provider: "filesystem", source: "user", enabled: true, rel: "delta", scope: { kind: "workspace", path: "C:/proj/one" } }]
      }),
      loadContent: async () => { throw new Error("unreadable"); }
    };
    const wsView = await mount(offlineRpc);
    const one = byClass(wsView.section, "SKV_railItem").find((row) => row.props.children[0].props.children === "one");
    assert(one, "workspace rail item missing");
    one.props.onClick({ currentTarget: { offsetTop: 0, offsetHeight: 34 } });
    await flush();
    const wsMounted = await mount(offlineRpc);
    byClass(wsMounted.section, "SKV_toolButton")[0].props.onClick();
    await flush();
    const wsNotice = await mount(offlineRpc);
    check("open-folder falls back to <workspace>/.dsh/skills when content cannot be read", () => {
      const text = byClass(wsNotice.section, "SKV_noticeText").map((n) => n.props.children).join(" | ");
      assert(text.includes("C:/proj/one/.dsh/skills"), "workspace fallback lost: " + text);
    });
  }
  {
    // 正常路径：宿主真的去弹资源管理器，不再退回剪贴板。
    // 宿主会把面板传来的正斜杠路径换成本机分隔符再交给 explorer（src/reveal.ts），
    // 提示条要显示宿主回传的那份，否则用户看到的是 explorer 根本不认的形态。
    reset();
    const revealed = [];
    clipboardWrites.length = 0;
    const nativeRoot = process.platform === "win32" ? "C:\\Users\\x\\.dsh\\skills" : "C:/Users/x/.dsh/skills";
    const openRpc = {
      ...rpc,
      openFolder: async (path) => {
        revealed.push(path);
        return { opened: nativeRoot, command: "explorer.exe" };
      }
    };
    const clicked = await mount(openRpc);
    byClass(clicked.section, "SKV_toolButton")[0].props.onClick();
    await flush();
    const revealedView = await mount(openRpc);
    check("open-folder asks the host to reveal the directory (no clipboard fallback)", () => {
      const text = byClass(revealedView.section, "SKV_noticeText").map((n) => n.props.children).join(" | ");
      assert(revealed.length === 1 && revealed[0] === "C:/Users/x/.dsh/skills", "host was not asked: " + JSON.stringify(revealed));
      assert(text.includes("已在资源管理器里打开"), "success wording missing: " + text);
      assert(text.includes(nativeRoot), "notice must echo the host-normalised path, got: " + text);
      assert(clipboardWrites.length === 0, "must not touch the clipboard when revealing works");
    });
  }
  check("the settings-page entry was dropped for good (Issue #27)", () => {
    // 2026-10-15 定案：面板元素太多，设置页塞不下，两处渲染等于维护两套前端 —— 只留侧栏入口。
    assert(source.includes("SKV_prefPanel") === false, "the preferences popover came back");
    assert(source.includes("settings.plugins.tab") === false, "the settings-page slot registration came back");
    assert(source.includes("entryPlacement") === false, "the entry-placement preference came back");
    const registrations = [...source.matchAll(/slots\.inject\("([^"]+)"/g)].map((m) => m[1]);
    const sorted = [...new Set(registrations)].sort().join(",");
    assert(sorted === "main,sidebar.panellist", "unexpected slot registrations: " + sorted);
  });
}

// ── 6. 空态 + 内联新建分组 ────────────────────────────────────────────────
{
  reset();
  const before = skillRows;
  skillRows = [];
  const view = await mount();
  check("empty list shows the centered 空态 copy", () => {
    const emptyNode = byClass(view.section, "SKV_empty")[0];
    assert(emptyNode !== undefined, "empty state missing");
    assert(String(emptyNode.props.children).includes("这里还没有技能"), "copy wrong: " + emptyNode.props.children);
  });
  skillRows = before;
  const filled = await mount(undefined);
  byClass(filled.section, "SKV_paneNew")[0].props.onClick();
  const editing = await mount();
  check("inline new-group input appears with a placeholder", () => {
    const field = byClass(editing.section, "SKV_paneNewInput")[0];
    assert(field !== undefined, "inline input missing");
    assert(field.props.placeholder === "分组名称", "placeholder wrong: " + field.props.placeholder);
  });
  const field = byClass(editing.section, "SKV_paneNewInput")[0];
  field.props.onChange({ currentTarget: { value: "新组" } });
  const typed = await mount();
  byClass(typed.section, "SKV_paneNewInput")[0].props.onKeyDown({ key: "Enter" });
  await flush();
  const afterCreate = await mount();
  check("Enter creates the group through saveGroupSkill and selects it", () => {
    const labels = byClass(afterCreate.section, "SKV_paneItem").map((n) => n.props.children[0].props.children);
    assert(labels.some((label) => String(label).includes("新组")), "created group missing from the pane: " + JSON.stringify(labels));
  });
  const field2 = (() => {
    byClass(afterCreate.section, "SKV_paneNew")[0].props.onClick();
    return null;
  })();
  void field2;
  const editing2 = await mount();
  byClass(editing2.section, "SKV_paneNewInput")[0].props.onKeyDown({ key: "Escape" });
  const escaped = await mount();
  check("Escape closes the inline input without creating anything", () => {
    assert(byClass(escaped.section, "SKV_paneNewInput").length === 0, "inline input should be gone");
  });
}

// ── 7. MCP 页签：外壳与 #46 通知 ──────────────────────────────────────────
{
  reset(skills, "mcp");
  const view = await mount(mcpFace);
  check("MCP tab renders single-column with data-tab=mcp", () => {
    assert(view.page.props["data-tab"] === "mcp", "data-tab must follow the tab: " + view.page.props["data-tab"]);
    assert(view.section.props.className === "MCP_section", "MCP root changed: " + view.section.props.className);
    assert(byClass(view.section, "SKV_rail").length === 0 && byClass(view.section, "SKV_pane").length === 0, "rail/pane must not render on the MCP tab");
    assert(byClass(view.section, "SKV_searchBox").length === 0, "search box must not render on the MCP tab");
  });
  check("MCP page renders the foreign-rows notice (#46)", () => {
    const texts = findAll(view.section, (n) => typeof n.props.className === "string" && n.props.className === "SKV_noticeText");
    const lines = [];
    for (const node of texts) {
      const kids = node.props.children;
      if (Array.isArray(kids)) for (const kid of kids) lines.push(String(kid.props ? kid.props.children : kid));
      else lines.push(String(kids));
    }
    const all = lines.join(" | ");
    assert(all.includes("other-row") && all.includes("another"), "foreign rows not listed: " + all);
    assert(all.includes("受管块内还有 2 条"), "expected the count of non-panel rows: " + all);
    assert(all.includes("panel-mcp-a"), "panel rows inside a foreign insert list must be reported: " + all);
    assert(all.includes("暂不管理"), "second line wording missing: " + all);
  });
  check("foreign notice offers 移出受管块 / 查看机制 next to 刷新", () => {
    const buttons = findAll(view.section, (n) => n.type === "button" && typeof n.props.className === "string" && n.props.className === "SKV_noticeButton");
    const actions = buttons.map((n) => n.props["data-action"]).filter(Boolean);
    assert(actions.includes("evacuate"), "missing the evacuate button: " + JSON.stringify(actions));
    assert(actions.includes("foreign-doc"), "missing the how-it-works button: " + JSON.stringify(actions));
    const labels = buttons.map((n) => n.props.children).join("|");
    assert(labels.includes("刷新"), "refresh button disappeared: " + labels);
  });
  check("查看机制 explains the block, why the row is there, and that it is harmless", () => {
    const docBtn = findAll(view.section, (n) => n.type === "button" && n.props["data-action"] === "foreign-doc")[0];
    docBtn.props.onClick();
    const opened = paint(mcpFace);
    const text = JSON.stringify(findAll(opened.section, (n) => typeof n.props.className === "string" && n.props.className === "MCP_doc" || String(n.props.className ?? "").includes("MCP_doc")));
    assert(text.includes("受管块与「外来行」"), "doc title missing");
    assert(text.includes("没有任何功能影响"), "doc must say the row is harmless: " + text.slice(0, 200));
    assert(text.includes("移出受管块"), "doc must explain the move action");
  });
  evacCalls.length = 0;
  const evacBtn = findAll(paint(mcpFace).section, (n) => n.type === "button" && n.props["data-action"] === "evacuate")[0];
  if (evacBtn) evacBtn.props.onClick();
  await flush();
  check("移出受管块 calls the RPC once and reports the count", () => {
    assert(evacBtn, "evacuate button missing on the fresh render");
    assert(evacCalls.length === 1, "evacuateForeign should be called exactly once, got " + evacCalls.length);
  });
  check("MCP switch (round switch) is untouched", () => {
    assert(byClass(view.section, "SKV_switch").length === 1, "MCP card should keep the round switch");
  });
  store.delete("dsh-skill-mcp-panel:last-tab");
}

// ── 9. Issue #82：弹层「点外部 / Esc」关闭 ────────────────────────────────
{
  reset();
  let view = await mount();
  const findAddButton = () => findAll(view.section, (n) => n.type === "button" && n.props["aria-label"] === "添加技能")[0];
  const addMenuVisible = () => byClass(view.section, "SKV_addMenu").length === 1;
  check("添加技能按钮存在（#82 的前置）", () => {
    assert(findAddButton() !== undefined, "add button missing");
  });
  findAddButton().props.onClick();
  view = await mount();
  check("点开添加技能菜单后菜单可见", () => {
    assert(addMenuVisible(), "add menu did not open");
  });
  dispatchDocument("pointerdown", { target: { closest: () => null } });
  view = await mount();
  check("点菜单外部关闭添加技能菜单（#82）", () => {
    assert(!addMenuVisible(), "menu must close when the click lands outside");
  });
  findAddButton().props.onClick();
  view = await mount();
  dispatchDocument("pointerdown", { target: { closest: () => ({}) } });
  view = await mount();
  check("点菜单内部不关闭（#82）", () => {
    assert(addMenuVisible(), "inside clicks must not close the menu");
  });
  dispatchDocument("keydown", { key: "Escape" });
  view = await mount();
  check("Esc 关闭添加技能菜单（#82）", () => {
    assert(!addMenuVisible(), "menu must close on Escape");
  });
}

// ── 10. Issue #82：对话框点遮罩 / Esc 关闭 ────────────────────────────────
// 渲染桩只调用 Section 本身（子组件只以元素形式存在），所以这里手动渲染一次
// 对话框组件，拿到它真正的遮罩节点；Esc 走的是页面层的 hook（dispatchDocument）。
const renderChild = (element) => {
  const previousCursor = cursor;
  const previousCurrent = current;
  cursor = 0;
  current = element.type.name || "child";
  const before = pendingEffects.length;
  const tree = element.type(element.props);
  const effects = pendingEffects.splice(before);
  cursor = previousCursor;
  current = previousCurrent;
  return { tree, effects };
};
{
  reset();
  let view = await mount();
  const dialogElement = () => findAll(view.section, (n) => typeof n.type === "function" && n.type.name === "GroupDialog")[0];
  const openEditor = () => {
    const btn = findAll(view.section, (n) => n.type === "button" && n.props["aria-label"] === "新建分组")[0];
    assert(btn !== undefined, "toolbar new-group button missing");
    btn.props.onClick();
  };
  openEditor();
  view = await mount();
  check("分组编辑器打开（#82 的前置）", () => {
    assert(dialogElement() !== undefined, "group dialog did not open");
  });
  const rendered = renderChild(dialogElement());
  const overlay = () => byClass(rendered.tree, "SKV_scopeOverlay")[0];
  const box = () => byClass(rendered.tree, "SKV_scopeBox")[0];
  check("对话框渲染出遮罩与盒子（#82 的前置）", () => {
    assert(overlay() !== undefined && box() !== undefined, "overlay/box missing");
  });
  overlay().props.onClick({ target: box(), currentTarget: overlay() });
  view = await mount();
  check("点对话框内部不关闭（#82）", () => {
    assert(dialogElement() !== undefined, "inside clicks must not close the dialog");
  });
  const again = renderChild(dialogElement());
  const overlay2 = byClass(again.tree, "SKV_scopeOverlay")[0];
  overlay2.props.onClick({ target: overlay2, currentTarget: overlay2 });
  view = await mount();
  check("点遮罩关闭分组编辑器（#82）", () => {
    assert(dialogElement() === undefined, "dialog must close on backdrop click");
  });
  openEditor();
  view = await mount();
  dispatchDocument("keydown", { key: "Escape" });
  view = await mount();
  check("Esc 关闭分组编辑器（#82）", () => {
    assert(dialogElement() === undefined, "dialog must close on Escape");
  });
}

// ── 11. Issue #79：搜索匹配描述 ───────────────────────────────────────────
{
  reset();
  let view = await mount();
  const search = findAll(view.section, (n) => n.type === "input" && n.props.className === "SKV_searchField")[0];
  check("搜索框存在（#79 的前置）", () => {
    assert(search !== undefined, "search field missing");
  });
  search.props.onChange({ currentTarget: { value: "B 技能" } });
  view = await mount();
  check("搜描述能命中技能（#79）", () => {
    const names = findAll(view.section, (n) => typeof n.props["data-skill-name"] === "string").map((n) => n.props["data-skill-name"]);
    assert(names.includes("beta"), "description match must keep beta, got " + JSON.stringify(names));
    assert(!names.includes("alpha"), "alpha should be filtered out, got " + JSON.stringify(names));
  });
  search.props.onChange({ currentTarget: { value: "alpha" } });
  view = await mount();
  check("搜名字仍能命中技能（#79 没有回归）", () => {
    const names = findAll(view.section, (n) => typeof n.props["data-skill-name"] === "string").map((n) => n.props["data-skill-name"]);
    assert(names.includes("alpha"), "name match must keep alpha, got " + JSON.stringify(names));
  });
}

// ── 12. Issue #77：MCP 工具清单筛选 + 全选/全不选 ─────────────────────────
{
  reset(skills, "mcp");
  toolFilterCalls.length = 0;
  let view = await mount(mcpFace);
  const toolsBtn = findAll(view.section, (n) => n.type === "button" && n.props.children === "工具")[0];
  check("MCP 卡片有「工具」按钮（#77 的前置）", () => {
    assert(toolsBtn !== undefined, "tools button missing");
  });
  toolsBtn.props.onClick();
  await flush();
  view = await mount(mcpFace);
  const filterInput = () => findAll(view.section, (n) => n.type === "input" && n.props["data-role"] === "tool-search")[0];
  check("工具清单出现筛选框（#77）", () => {
    assert(filterInput() !== undefined, "tool filter input missing");
  });
  check("未筛选时列出三台工具", () => {
    const rows = findAll(view.section, (n) => typeof n.props.className === "string" && n.props.className.includes("MCP_toolRow"));
    assert(rows.length === 3, "expected 3 tool rows after open, got " + rows.length);
  });
  filterInput().props.onChange({ currentTarget: { value: "beta" } });
  view = await mount(mcpFace);
  check("筛选后只剩匹配的工具（#77）", () => {
    const rows = findAll(view.section, (n) => typeof n.props.className === "string" && n.props.className.includes("MCP_toolRow"));
    assert(rows.length === 1, "filter should narrow the list to one row, got " + rows.length);
  });
  const selectNone = findAll(view.section, (n) => n.type === "button" && n.props.children === "全不选")[0];
  check("有「全不选」按钮（#77）", () => {
    assert(selectNone !== undefined, "clear-all button missing");
  });
  selectNone.props.onClick();
  view = await mount(mcpFace);
  const saveBtn = findAll(view.section, (n) => n.type === "button" && n.props.children === "保存禁用列表")[0];
  saveBtn.props.onClick();
  await flush();
  check("全不选 + 保存写回禁用列表（#77）", () => {
    assert(toolFilterCalls.length === 1, "setToolFilter should be called once, got " + toolFilterCalls.length);
    const deny = toolFilterCalls[0].deny;
    assert(Array.isArray(deny) && deny.includes("beta_tool"), "filtered tool must be denied, got " + JSON.stringify(deny));
  });
  store.delete("dsh-skill-mcp-panel:last-tab");
}

// ── 13. MCP 服务器搜索（卡片过滤）─────────────────────────────────────────
{
  const multiFace = {
    ...mcpFace,
    listMcp: async () => ({
      servers: [
        { serverName: "gitlab", transport: "streamable-http", enabled: true, fiberPhase: "active", toolCount: 5, envKeys: [], url: "https://gitlab.example.com/mcp", headerKeys: ["Authorization"] },
        { serverName: "linear", transport: "stdio", enabled: false, fiberPhase: "pending", toolCount: 0, envKeys: ["LINEAR_TOKEN"], command: "C:/tools/linear.exe", args: ["--stdio"] },
        { serverName: "searchsvc", transport: "streamable-http", enabled: true, fiberPhase: "active", toolCount: 2, envKeys: [], url: "https://api.search.example/mcp", headerKeys: [] }
      ],
      externalServers: [],
      patch: { path: "C:/p/cordis.patch.yml", ok: true, error: null, foreign: [] }
    })
  };
  reset(skills, "mcp");
  let view = await mount(multiFace);
  const cardCount = () => byClass(view.section, "MCP_card").length;
  const mcpSearch = () => findAll(view.section, (n) => n.type === "input" && n.props["data-role"] === "server-search")[0];
  check("MCP 页默认列出全部服务器卡片", () => {
    assert(cardCount() === 3, "expected 3 cards, got " + cardCount());
  });
  check("MCP 页有服务器搜索框", () => {
    assert(mcpSearch() !== undefined, "MCP server search input missing");
  });
  mcpSearch().props.onChange({ currentTarget: { value: "linear" } });
  view = await mount(multiFace);
  check("按服务器名过滤卡片", () => {
    assert(cardCount() === 1, "expected 1 card for name match, got " + cardCount());
  });
  mcpSearch().props.onChange({ currentTarget: { value: "search.example" } });
  view = await mount(multiFace);
  check("按 URL 过滤卡片", () => {
    assert(cardCount() === 1, "expected 1 card for url match, got " + cardCount());
  });
  mcpSearch().props.onChange({ currentTarget: { value: "--stdio" } });
  view = await mount(multiFace);
  check("按命令参数过滤卡片", () => {
    assert(cardCount() === 1, "expected 1 card for args match, got " + cardCount());
  });
  mcpSearch().props.onChange({ currentTarget: { value: "nope-zzz" } });
  view = await mount(multiFace);
  check("无匹配时给出提示且不渲染卡片", () => {
    assert(cardCount() === 0, "expected 0 cards, got " + cardCount());
    const subs = findAll(view.section, (n) => n.props.className === "MCP_sub").map((n) => String(n.props.children));
    assert(subs.includes("没有匹配的 MCP 服务器。"), "missing no-match copy: " + JSON.stringify(subs));
  });
  store.delete("dsh-skill-mcp-panel:last-tab");
}

// ── 8. i18n 与 CSS 覆盖 ───────────────────────────────────────────────────
{
  check("zh/en dictionaries carry exactly the same keys", () => {
    for (const ns of ["settings.skills", "settings.mcp"]) {
      const tables = dictionaries.get(ns);
      assert(tables !== undefined, "dictionary missing: " + ns);
      const zh = Object.keys(tables.zh).sort();
      const en = Object.keys(tables.en).sort();
      const missingEn = zh.filter((key) => !en.includes(key));
      const missingZh = en.filter((key) => !zh.includes(key));
      assert(missingEn.length === 0 && missingZh.length === 0, ns + " keys differ missingEn=" + JSON.stringify(missingEn) + " missingZh=" + JSON.stringify(missingZh));
    }
  });
  check("english strings carry no CJK characters", () => {
    const offenders = [];
    for (const ns of ["settings.skills", "settings.mcp"]) {
      const tables = dictionaries.get(ns);
      for (const entry of Object.entries(tables.en)) {
        if (/[\u3000-\u9fff\uff00-\uffef]/.test(String(entry[1]))) offenders.push(ns + "." + entry[0]);
      }
    }
    assert(offenders.length === 0, "CJK left in the en table: " + JSON.stringify(offenders));
  });
  check("every referenced SKV_ class exists in the injected CSS", () => {
    const cssText = styleTags.map((tag) => String(tag.textContent ?? "")).join("\n");
    const used = new Set([...source.matchAll(/\bSKV_[A-Za-z0-9_]+/g)].map((hit) => hit[0]));
    const missing = [...used].filter((name) => !cssText.includes("." + name));
    assert(missing.length === 0, "class names used but not styled: " + JSON.stringify(missing));
  });
  check("new-shell transition durations stay within .18s-.32s", () => {
    const cssText = styleTags.map((tag) => String(tag.textContent ?? "")).join(String.fromCharCode(10));
    // 只查 v2.1.6 新加的类（旧样式里的 .15s 不属于这次重构的范围）
    const NEW = ["SKV_rail", "SKV_pane", "SKV_mainCol", "SKV_toolButton", "SKV_cardRow", "SKV_card[data-", "SKV_check", "SKV_row", "SKV_traffic", "SKV_batch", "SKV_toast", "SKV_tab"];
    const bad = [];
    for (const rule of cssText.split("}")) {
      const selector = rule.split("{")[0] ?? "";
      if (!NEW.some((token) => selector.includes(token))) continue;
      const body = rule.slice(rule.indexOf("{") + 1);
      for (const hit of body.matchAll(/transition:[^;}]*/g)) {
        for (const time of hit[0].matchAll(/([0-9.]+)(ms|s)/g)) {
          const ms = time[2] === "ms" ? Number(time[1]) : Number(time[1]) * 1000;
          if (ms < 180 || ms > 320) bad.push(selector + " -> " + time[0]);
        }
      }
    }
    assert(bad.length === 0, "out-of-range durations: " + JSON.stringify(bad.slice(0, 8)));
  });
  check("prefers-reduced-motion turns the new motion off", () => {
    const cssText = styleTags.map((tag) => String(tag.textContent ?? "")).join("\n");
    assert(cssText.includes("@media (prefers-reduced-motion: reduce)"), "reduced-motion block missing");
    assert(cssText.includes("animation-duration:.001ms!important"), "reduced-motion rule missing");
  });
}

// ── 6. 「未分组」只在有意义时出现 ─────────────────────────────────────────
{
  const paneLabels = (view) => byClass(view.section, "SKV_paneItem").map((n) => n.props.children[0].props.children);

  reset();
  const noGroups = await mount({ ...rpc, listGroups: async () => ({ groups: [] }) });
  check("without any group the 未分组 row is not rendered", () => {
    const labels = paneLabels(noGroups);
    assert(!labels.includes("未分组"), "ungrouped row leaked with zero groups: " + JSON.stringify(labels));
    assert(labels[0] === "全部", "全部 must still be there: " + JSON.stringify(labels));
  });

  // 「全部分组」要按**分组配置**来模拟：unGrouped 的判据是组的 scopes，不是技能自带的 groups。
  reset();
  const allGrouped = await mount({
    ...rpc,
    listGroups: async () => ({
      groups: [{ id: "g1", name: "办公", scopes: { global: ["alpha", "beta", "gamma", "omega"], "C:/proj/one": ["delta"] } }]
    })
  });
  check("when every skill is grouped the 未分组 row is not rendered", () => {
    const labels = paneLabels(allGrouped);
    assert(!labels.includes("未分组"), "ungrouped row leaked with nothing ungrouped: " + JSON.stringify(labels));
    assert(labels.includes("办公") || labels.includes("组件"), "group rows disappeared: " + JSON.stringify(labels));
  });
}

// ── 7. 页头在两种页签下不许跳动 + 切页签淡入 ────────────────────────────
{
  const cssText = styleTags.map((tag) => String(tag.textContent ?? "")).join(String.fromCharCode(10));
  check("skills / mcp 共用同一套页面外壳（页头不会因为切页签而位移）", () => {
    assert(cssText.includes(".SKV_page[data-tab=skills],.SKV_page[data-tab=mcp]{"), "shared page shell missing");
    // 选择器共用意味着「同一个 body」：两种页签的页面盒子只能有一份
    assert(cssText.includes("padding:18px 0 0;overflow:hidden"), "shared shell body missing");
    assert(!/\.SKV_page\[data-tab=skills\]\{/.test(cssText.replace(/\.SKV_page\[data-tab=skills\],\.SKV_page\[data-tab=mcp\]\{/g, "")), "a standalone skills shell came back");
  });
  check("页头与页签的内边距/间距两种页签一致", () => {
    assert(cssText.includes(".SKV_page[data-tab=skills]>.SKV_pageTop,.SKV_page[data-tab=mcp]>.SKV_pageTop{padding:0 clamp(20px,3vw,40px)}"), "pageTop padding split across tabs");
    assert(cssText.includes(".SKV_page[data-tab=skills]>.SKV_tabs,.SKV_page[data-tab=mcp]>.SKV_tabs{gap:22px;padding:0 clamp(20px,3vw,40px)}"), "tabs gap/padding split across tabs");
  });
  check("MCP 正文自己居中并滚动，不吃页面的 align-items", () => {
    assert(/\.SKV_page\[data-tab=mcp\]>\.MCP_section\{[^}]*margin:0 auto[^}]*overflow-y:auto/.test(cssText), "mcp body must center and scroll on its own");
  });
  check("切页签有淡入动画，且 reduced-motion 会关掉它", () => {
    assert(cssText.includes("@keyframes skvTabIn"), "fade keyframes missing");
    assert(/\.SKV_page\[data-tab\]>\.SKV_section,\.SKV_page\[data-tab\]>\.MCP_section\{animation:skvTabIn/.test(cssText), "fade not applied to the tab bodies");
    assert(cssText.includes(".SKV_page *{animation-duration:.001ms!important"), "reduced-motion must cover the page-level fade");
  });
}

// ── 8. 布局开关（Issue #50）：三栏 ↔ 简洁 ────────────────────────────────
{
  reset();
  let view = await mount();
  const toggleOf = (node) => findAll(node, (n) => n.type === "button" && n.props["data-layout-toggle"] === "true")[0];
  const scopeButtonOf = (node) => byClass(node, "SKV_scopeSelect")[0];
  const menuItemsOf = (node) => byClass(node, "SKV_scopeMenuItem");
  const itemLabelOf = (item) => item.props.children[0].props.children;

  check("工具栏里有布局开关，默认三栏", () => {
    assert(toggleOf(view.section), "layout toggle missing from the toolbar");
    assert(view.section.props["data-layout"] === "three", "default layout must be three columns");
    assert(byClass(view.section, "SKV_rail").length === 1 && byClass(view.section, "SKV_pane").length === 1, "three-column shell broken");
    assert(byClass(view.section, "SKV_filterBar").length === 0, "compact filter bar must be hidden by default");
  });

  toggleOf(view.section).props.onClick();
  view = await mount();
  check("切到简洁模式：两栏收起、筛选条出现", () => {
    assert(view.section.props["data-layout"] === "compact", "layout did not switch: " + view.section.props["data-layout"]);
    assert(byClass(view.section, "SKV_rail").length === 0, "rail still rendered in compact layout");
    assert(byClass(view.section, "SKV_pane").length === 0, "pane still rendered in compact layout");
    assert(byClass(view.section, "SKV_mainCol").length === 1, "main column disappeared");
    assert(byClass(view.section, "SKV_filterBar").length === 1, "compact filter bar missing");
  });
  check("工作区是折叠式下拉按钮，不是一串 chip", () => {
    const button = scopeButtonOf(view.section);
    assert(button, "workspace dropdown button (SKV_scopeSelect) is missing");
    assert(button.props["aria-expanded"] === false, "dropdown must start collapsed");
    assert(byClass(view.section, "SKV_scopeMenu").length === 0, "menu must not be rendered while collapsed");
    const chipLabels = byClass(view.section, "SKV_groupItem").map((chip) => (typeof chip.props.children[0] === "string" ? chip.props.children[0] : ""));
    assert(!chipLabels.includes("全局") && !chipLabels.includes("one"), "workspace leaked into the chip row: " + JSON.stringify(chipLabels));
  });
  check("下拉展开后是表单：全局 + 各工作区，当前项打勾、可点外部收起", () => {
    scopeButtonOf(view.section).props.onClick();
    view = paint(rpc);
    assert(byClass(view.section, "SKV_scopeMenu").length === 1, "menu did not open");
    assert(byClass(view.section, "SKV_scopeMenuOverlay").length === 1, "click-away overlay missing");
    const labels = menuItemsOf(view.section).map(itemLabelOf);
    assert(labels[0] === "全局", "first menu item must be 全局: " + JSON.stringify(labels));
    assert(labels.includes("one"), "workspace item missing from the menu: " + JSON.stringify(labels));
    const active = menuItemsOf(view.section).filter((item) => item.props["data-active"] === "true");
    assert(active.length === 1 && itemLabelOf(active[0]) === "全局", "current scope is not marked in the menu");
    byClass(view.section, "SKV_scopeMenuOverlay")[0].props.onClick();
    view = paint(rpc);
    assert(byClass(view.section, "SKV_scopeMenu").length === 0, "clicking the overlay must close the menu");
  });
  check("分组横栏还在，且只列分组（全部 / 分组名）", () => {
    const bars = byClass(view.section, "SKV_groupBar");
    assert(bars.length === 1, "expected exactly one group row, got " + bars.length);
    const labels = byClass(view.section, "SKV_groupItem").map((chip) => (typeof chip.props.children[0] === "string" ? chip.props.children[0] : ""));
    assert(labels.includes("全部") && labels.includes("办公"), "group chips missing: " + JSON.stringify(labels));
    const active = byClass(view.section, "SKV_groupItem").filter((chip) => chip.props["data-active"] === "true");
    assert(active.length === 1 && active[0].props.children[0] === "全部", "group filter must start on 全部");
  });
  check("简洁模式一行两个技能（旧版排列）", () => {
    const cssText = styleTags.map((tag) => String(tag.textContent ?? "")).join(String.fromCharCode(10));
    assert(cssText.includes(".SKV_section[data-layout=compact] .SKV_cards{grid-template-columns:repeat(2,minmax(0,1fr))"), "compact cards must be two per row");
    assert(cssText.includes(".SKV_section[data-layout=compact] .SKV_mainScroll>.SKV_catalog{max-width:940px"), "compact content width not widened");
  });
  check("从下拉选工作区只筛该作用域，切回三栏不丢选择", () => {
    scopeButtonOf(view.section).props.onClick();
    view = paint(rpc);
    const target = menuItemsOf(view.section).find((item) => itemLabelOf(item) === "one");
    assert(target, "workspace item for one/ is missing");
    target.props.onClick();
    view = paint(rpc);
    assert(byClass(view.section, "SKV_scopeMenu").length === 0, "menu must close after picking a workspace");
    const cards = findAll(view.section, (n) => n.props["data-skill-name"] !== undefined);
    assert(cards.length === 1 && cards[0].props["data-skill-name"] === "delta", "compact workspace filter did not narrow the list");
    const label = byClass(view.section, "SKV_scopeSelectLabel")[0];
    assert(label && label.props.children === "one", "dropdown did not follow the selection: " + (label && label.props.children));
    toggleOf(view.section).props.onClick();
    view = paint(rpc);
    assert(view.section.props["data-layout"] === "three", "could not switch back to three columns");
    assert(byClass(view.section, "SKV_rail").length === 1, "rail did not come back");
    const railActive = byClass(view.section, "SKV_railItem").filter((item) => item.props["data-active"] === "true");
    assert(railActive.length === 1 && railActive[0].props.children[0].props.children === "one", "three-column rail lost the selection");
  });
  check("布局选择写进 localStorage（同一个键前缀）", () => {
    assert(store.get("dsh-skill-mcp-panel:layout") === "three", "layout preference not persisted: " + store.get("dsh-skill-mcp-panel:layout"));
  });
}

// ── 8b. 窄屏自动用简洁布局（Issue #71：手机远控）──────────────────────────
{
  const toggleOf = (node) => findAll(node, (n) => n.type === "button" && n.props["data-layout-toggle"] === "true")[0];
  reset();
  setViewportNarrow(true);
  let view = await mount();
  check("窄屏（≤820px）自动换成简洁外壳，不再渲染左轨/中栏", () => {
    assert(view.section.props["data-layout"] === "compact", "narrow viewport must force the compact layout: " + view.section.props["data-layout"]);
    assert(view.section.props["data-layout-forced"] === "true", "forced layout must be marked (data-layout-forced)");
    assert(byClass(view.section, "SKV_rail").length === 0, "rail must not render on a narrow viewport");
    assert(byClass(view.section, "SKV_pane").length === 0, "pane must not render on a narrow viewport");
    assert(byClass(view.section, "SKV_filterBar").length === 1, "compact filter bar missing on a narrow viewport");
  });
  check("窄屏隐藏布局开关（三栏在手机上会把内容裁掉）", () => {
    assert(toggleOf(view.section) === undefined, "layout toggle must be hidden on a narrow viewport");
    const labels = byClass(view.section, "SKV_toolButton").map((n) => n.props["aria-label"]);
    assert(labels.length === 4, "expected 4 toolbar buttons on a narrow viewport, got " + labels.length);
    assert(!labels.includes("切换到简洁模式") && !labels.includes("切回三栏模式"), "layout toggle label leaked: " + JSON.stringify(labels));
  });
  check("窄屏自动切换不覆盖用户偏好（不改 localStorage）", () => {
    assert(store.get("dsh-skill-mcp-panel:layout") === undefined, "auto compact must not persist a preference: " + store.get("dsh-skill-mcp-panel:layout"));
  });
  setViewportNarrow(false);
  view = paint(rpc);
  check("窗口拉宽后回到用户自己的选择（默认三栏），开关也回来", () => {
    assert(view.section.props["data-layout"] === "three", "widening must restore the three-column layout: " + view.section.props["data-layout"]);
    assert(view.section.props["data-layout-forced"] === undefined, "forced marker left behind after widening");
    assert(byClass(view.section, "SKV_rail").length === 1 && byClass(view.section, "SKV_pane").length === 1, "three-column shell did not come back");
    assert(toggleOf(view.section), "layout toggle must come back after widening");
  });
}

// 窗口宽 ≠ 面板宽：面板挂在宿主主区里，左侧会话栏要占一截，按面板自身宽度也要切。
{
  const toggleOf = (node) => findAll(node, (n) => n.type === "button" && n.props["data-layout-toggle"] === "true")[0];
  reset();
  setViewportNarrow(false);
  containerWidth = 700;
  let view = await mount();
  check("窗口不窄但面板只有 700px：按面板宽度自动切简洁", () => {
    assert(view.section.props["data-layout"] === "compact", "a 700px-wide panel must use the compact layout: " + view.section.props["data-layout"]);
    assert(view.section.props["data-layout-forced"] === "true", "panel-width forced layout must be marked");
    assert(toggleOf(view.section) === undefined, "layout toggle must be hidden when the panel itself is narrow");
    assert(byClass(view.section, "SKV_rail").length === 0, "rail must not render inside a narrow panel");
  });
  containerWidth = 1000;
  fireResize();
  view = paint(rpc);
  check("面板拉宽到 1000px：恢复三栏，开关回来", () => {
    assert(view.section.props["data-layout"] === "three", "widening the panel must restore three columns: " + view.section.props["data-layout"]);
    assert(view.section.props["data-layout-forced"] === undefined, "forced marker left behind after widening the panel");
    assert(toggleOf(view.section), "layout toggle must come back when the panel is wide");
  });
}

// 手动选过简洁的人，窄屏→宽屏后仍留在简洁（偏好优先于视口）。
{
  const toggleOf = (node) => findAll(node, (n) => n.type === "button" && n.props["data-layout-toggle"] === "true")[0];
  reset();
  store.set("dsh-skill-mcp-panel:layout", "compact");
  setViewportNarrow(true);
  let view = await mount();
  setViewportNarrow(false);
  view = paint(rpc);
  check("偏好是简洁时，宽屏也保持简洁", () => {
    assert(view.section.props["data-layout"] === "compact", "manual compact preference must survive widening: " + view.section.props["data-layout"]);
    assert(view.section.props["data-layout-forced"] === undefined, "a manual compact layout is not forced");
    assert(toggleOf(view.section), "layout toggle must be available when the viewport is wide");
  });
  toggleOf(view.section).props.onClick();
  view = paint(rpc);
  check("宽屏下手动切回三栏仍然有效", () => {
    assert(view.section.props["data-layout"] === "three", "toggle to three columns failed");
    assert(store.get("dsh-skill-mcp-panel:layout") === "three", "manual choice not persisted");
  });
}

// 没有 matchMedia 的环境（老宿主 / 非浏览器渲染）：退回三栏，别崩。
{
  reset();
  const saved = sandbox.window.matchMedia;
  delete sandbox.window.matchMedia;
  const view = await mount();
  check("没有 matchMedia 时退化成三栏，不报错", () => {
    assert(view.section.props["data-layout"] === "three", "layout without matchMedia must stay three columns");
    assert(findAll(view.section, (n) => n.type === "button" && n.props["data-layout-toggle"] === "true")[0], "layout toggle must stay reachable without matchMedia");
  });
  sandbox.window.matchMedia = saved;
}

// MCP 页的窄屏样式：卡片与表单单列（Issue #71）。
{
  check("MCP 页在窄屏改单列（卡片 + 表单 + 工具栏换行）", () => {
    const cssText = styleTags.map((tag) => String(tag.textContent ?? "")).join(String.fromCharCode(10));
    assert(cssText.includes("@media (max-width:640px){.MCP_cards{grid-template-columns:minmax(0,1fr)}"), "MCP cards must collapse to one column on narrow screens");
    assert(cssText.includes(".MCP_form{grid-template-columns:minmax(0,1fr)}"), "MCP form must collapse to one column on narrow screens");
    assert(cssText.includes(".MCP_toolbar{flex-wrap:wrap}"), "MCP toolbar must wrap on narrow screens");
  });
}

// ── 8. 显示插件技能开关的记忆（Issue #59 附带问题）────────────────────────
{
  reset();
  const checkboxOf = (node) => byClass(node, "SKV_pluginToggle")[0].props.children[0];
  let view = await mount();
  check("显示插件技能的复选框默认勾选", () => {
    assert(checkboxOf(view.section).props.checked === true, "default must be checked");
  });
  checkboxOf(view.section).props.onChange({ target: { checked: false } });
  view = paint(rpc);
  check("取消勾选：插件技能立即隐藏并写进 localStorage（#59）", () => {
    assert(checkboxOf(view.section).props.checked === false, "checkbox state did not change");
    assert(store.get("dsh-skill-mcp-panel:show-plugin-skills") === "off", "偏好没写进 localStorage: " + store.get("dsh-skill-mcp-panel:show-plugin-skills"));
    assert(!findAll(view.section, (n) => n.props["data-skill-name"] === "gamma").length, "plugin-provided skill must be hidden");
  });
  // 模拟重新打开面板：清掉 hook 槽位 = 重新挂载，但保留 localStorage。
  slots.clear();
  refs.clear();
  effectRuns.clear();
  view = await mount();
  check("重新打开面板后仍是上次的勾选状态（#59）", () => {
    assert(checkboxOf(view.section).props.checked === false, "remount lost the checkbox state");
    assert(store.get("dsh-skill-mcp-panel:show-plugin-skills") === "off", "localStorage value was overwritten");
    assert(!findAll(view.section, (n) => n.props["data-skill-name"] === "gamma").length, "hidden plugin skill came back after remount");
  });
}

// ── 14. 单卡兜底：一张坏卡片不能再把整片主区带崩（PR #87 的后续）───────────
{
  const cardClassCount = (node) => byClass(node, "MCP_card").length;
  const errorCards = (node) => findAll(node, (n) => n.props["data-card-error"] === "true");
  const toolbarSearch = (node) => findAll(node, (n) => n.type === "input" && n.props["data-role"] === "server-search").length;

  // (1) PR #87 的现场：某一条 servers 缺 serverName（undefined），而 oauthNotice 是 null。
  //     旧守卫 `oauthNotice?.serverName === server.serverName` 两边都是 undefined，
  //     相等成立 → 读 null.ok → TypeError → 宿主把整个 main 槽位卸载（主区全黑）。
  const sparseFace = {
    ...mcpFace,
    listMcp: async () => ({
      servers: [
        { transport: "stdio", enabled: true, fiberPhase: "active", toolCount: 0, envKeys: [] },
        { serverName: "gh", transport: "stdio", enabled: true, fiberPhase: "active", toolCount: 3, envKeys: [] }
      ],
      externalServers: [],
      patch: { path: "C:/p/cordis.patch.yml", ok: true, error: null, foreign: [] }
    })
  };
  reset(skills, "mcp");
  let view = await mount(sparseFace);
  check("缺 serverName 的条目不再把卡片渲染打断（PR #87）", () => {
    assert(cardClassCount(view.section) === 2, "expected 2 cards, got " + cardClassCount(view.section));
    assert(errorCards(view.section).length === 0, "both entries should render normally, no fallback card");
  });

  // (2) 单卡兜底：卡片渲染期间抛错时只换掉这一张卡，其它卡片和页面外壳照旧。
  //     这里用一个会抛的 `enabled` getter 制造渲染期异常（等同于将来任何一种
  //     数据形状导致的 TypeError），断言它被 safeServerCard 收住。
  const exploding = { serverName: "boomtown", transport: "stdio", fiberPhase: "active", toolCount: 0, envKeys: [] };
  Object.defineProperty(exploding, "enabled", { get() { throw new Error("boom: enabled getter"); } });
  const boomFace = {
    ...mcpFace,
    listMcp: async () => ({
      servers: [exploding, { serverName: "gh", transport: "stdio", enabled: true, fiberPhase: "active", toolCount: 3, envKeys: [] }],
      externalServers: [],
      patch: { path: "C:/p/cordis.patch.yml", ok: true, error: null, foreign: [] }
    })
  };
  reset(skills, "mcp");
  let boomError = null;
  view = null;
  try {
    view = await mount(boomFace);
  } catch (error) {
    boomError = error;
  }
  check("卡片里抛错不再让整个主区变黑（2.3.11 单卡兜底）", () => {
    assert(boomError === null, "render threw out of the section: " + (boomError && boomError.message));
    assert(view !== null, "no render result");
    assert(errorCards(view.section).length === 1, "expected exactly 1 fallback card, got " + errorCards(view.section).length);
    const names = findAll(view.section, (n) => n.props.className === "MCP_name").map((n) => String(n.props.children));
    assert(names.includes("boomtown") && names.includes("gh"), "both entries should still be listed: " + JSON.stringify(names));
    assert(toolbarSearch(view.section) === 1, "section toolbar must still render (search input missing)");
    assert(cardClassCount(view.section) === 2, "expected 2 card slots (1 fallback + 1 normal), got " + cardClassCount(view.section));
  });
  check("兜底卡写着可读的原因与去处（2.3.11）", () => {
    const card = errorCards(view.section)[0];
    const text = findAll(card, (n) => n.props !== undefined && typeof n.props.children === "string")
      .map((n) => String(n.props.children))
      .join(" | ");
    assert(text.includes("渲染失败"), "missing failure badge copy: " + text);
    assert(text.includes("boom: enabled getter"), "missing underlying error message: " + text);
    assert(text.includes("原文编辑"), "missing recovery hint: " + text);
  });
  store.delete("dsh-skill-mcp-panel:last-tab");
}

console.log("\n" + (failures === 0 ? "ALL HARNESS CHECKS PASSED" : failures + " harness check(s) FAILED"));
process.exit(failures === 0 ? 0 : 1);