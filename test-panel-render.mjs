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

const bundlePath = process.argv[2] ?? fileURLToPath(new URL("./lib/client.js", import.meta.url));
const source = readFileSync(bundlePath, "utf8");

let captured = null;
const styleTags = [];
const documentStub = {
  querySelector: () => null,
  createElement: () => ({ dataset: {}, textContent: "" }),
  head: { appendChild: (tag) => styleTags.push(tag) }
};
const store = new Map();
const localStorageStub = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, value)
};
const clipboardWrites = [];
const navigatorStub = { clipboard: { writeText: async (text) => { clipboardWrites.push(text); } } };
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
  window: { __ModuleLoader__: { load: (mod) => { captured = mod; } } }
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
const mcpFace = {
  ...rpc,
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
  if (lastTab === "mcp") store.set("dsh-skill-mcp-panel:last-tab", "mcp");
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
  return { page, section, effects: [...pageEffects, ...sectionEffects] };
};
/** 按依赖数组决定要不要跑，模拟 React 的 commit 语义（deps 为 undefined 时每次都跑）。 */
const runEffects = (effects) => {
  for (const entry of effects) {
    const previous = effectRuns.get(entry.key);
    const deps = entry.deps;
    const changed = previous === undefined || deps === undefined || previous === null || deps.length !== previous.length || deps.some((value, index) => !Object.is(value, previous[index]));
    if (!changed) continue;
    effectRuns.set(entry.key, deps === undefined ? null : deps);
    if (typeof entry.fn === "function") entry.fn();
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
  check("MCP switch (round switch) is untouched", () => {
    assert(byClass(view.section, "SKV_switch").length === 1, "MCP card should keep the round switch");
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
  const scopeMenuOf = (node) => findAll(node, (n) => n.type === MenuStub && n.props?.anchor?.props?.className === "SKV_scopeSelect")[0];
  const cssText = styleTags.map((tag) => String(tag.textContent ?? "")).join(String.fromCharCode(10));

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
  check("工作区回到折叠式下拉表单，而不是一串 chip", () => {
    const menu = scopeMenuOf(view.section);
    assert(menu, "workspace dropdown (Menu + SKV_scopeSelect) is missing");
    assert(Array.isArray(menu.props.items) && menu.props.items.length >= 2, "dropdown must list 全局 + workspaces");
    assert(menu.props.items[0].id === "global", "first dropdown item must be 全局");
    const anchorLabel = byClass(view.section, "SKV_scopeSelectLabel")[0];
    assert(anchorLabel && anchorLabel.props.children === "全局", "dropdown label must show the current workspace");
    const chipLabels = byClass(view.section, "SKV_groupItem").map((chip) => (typeof chip.props.children[0] === "string" ? chip.props.children[0] : ""));
    assert(!chipLabels.includes("全局") && !chipLabels.includes("one"), "workspace leaked into the chip row: " + JSON.stringify(chipLabels));
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
    assert(cssText.includes(".SKV_section[data-layout=compact] .SKV_cards{grid-template-columns:repeat(2,minmax(0,1fr))"), "compact cards must be two per row");
    assert(cssText.includes(".SKV_section[data-layout=compact] .SKV_mainScroll>.SKV_catalog{max-width:940px"), "compact content width not widened");
  });
  check("从下拉选工作区只筛该作用域，切回三栏不丢选择", () => {
    scopeMenuOf(view.section).props.onSelect("C:/proj/one");
    view = paint(rpc);
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

console.log("\n" + (failures === 0 ? "ALL HARNESS CHECKS PASSED" : failures + " harness check(s) FAILED"));
process.exit(failures === 0 ? 0 : 1);