/**
 * 回归守卫：主页面板必须挂在宿主侧栏的两个槽位上，而不是设置页。
 *
 * 背景
 *   迁移前「技能」「MCP」注册在 settings.section（设置弹窗里的 tab）。
 *   迁移后改为宿主全局面板的标准组合：
 *     sidebar.panellist  —— list 槽位，一行图标 + label（「插件」行同款机制）
 *     main               —— keyed 槽位，中央主区整页内容（key 必须等于行 id）
 *   v2.1.5 起技能与 MCP 合并成**一行**入口（Skill/MCP），页签在面板内部切换；
 *   页签选择记在 localStorage，下次打开停在上次离开的那一页。
 *
 * 本测试把 lib/client.js 当成浏览器里的经典脚本真正跑一遍：
 *   1. 用桩 __ModuleLoader__ 捕获 factory，再用桩 require 喂 react 三件套；
 *   2. 用桩 ctx 执行 apply()，收集全部 ctx.slots.register 调用；
 *   3. 断言侧栏行 id/order/label、主区 key、页签行为与 settings.section 已消失；
 *   4. 断言字形组件渲染出的 class 与尺寸，以及样式表里蒙版图像仍在。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

let failures = 0;
const check = (label, fn) => {
  try {
    fn();
    console.log("PASS  " + label);
  } catch (error) {
    failures += 1;
    console.log("FAIL  " + label + "\n      " + (error && error.message ? error.message : error));
  }
};

const source = readFileSync(new URL("./lib/client.js", import.meta.url), "utf8");

// ── 载入浏览器束（经典脚本，自带 window.__ModuleLoader__.load）──────────────
let captured = null;
// 宿主标签是"先 appendChild、后写 textContent"，所以捕获元素本身而不是快照。
const styleTags = [];
const documentStub = {
  querySelector: () => null,
  createElement: () => ({ dataset: {}, textContent: "" }),
  head: { appendChild: (tag) => { styleTags.push(tag); } }
};
// 「上次停留的页签」存储桩：getItem 读 storedTab，setItem 记账。
let storedTab = null;
const storageWrites = [];
const localStorageStub = {
  getItem: () => storedTab,
  setItem: (key, value) => { storageWrites.push([key, value]); storedTab = value; }
};
const sandbox = {
  console,
  document: documentStub,
  localStorage: localStorageStub,
  window: { __ModuleLoader__: { load: (mod) => { captured = mod; } } }
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "lib/client.js" });

check("bundle registers itself through window.__ModuleLoader__", () => {
  assert.ok(captured, "load() was never called");
  assert.equal(captured.id, "dsh-skill-mcp-panel");
});

// ── 桩 require：浏览器束只能 require 外壳种子词 ─────────────────────────────
const jsx = (type, props) => ({ type, props: props ?? {} });
const reactStub = {
  useState: (init) => [typeof init === "function" ? init() : init, () => {}],
  useEffect: () => undefined,
  useRef: (init) => ({ current: init }),
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  createElement: jsx,
  Fragment: Symbol("Fragment")
};
const requireStub = (specifier) => {
  if (specifier === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: reactStub.Fragment };
  if (specifier === "react") return reactStub;
  if (specifier === "@deepseek-ai/dsh-client-ui-primitives") return {};
  throw new Error("unexpected require: " + specifier);
};

const mod = captured.factory(requireStub);
check("bundle exports apply/inject", () => {
  assert.equal(typeof mod.apply, "function");
  assert.ok(Array.isArray(mod.inject));
});

// ── 桩宿主：字典 + 槽位注册账本 ─────────────────────────────────────────────
const dictionaries = new Map();
const registrations = [];
const injections = [];
// 「返回会话」要打到的宿主 layout 服务：selectPanel(null) 就是把主区还给会话。
const layoutCalls = [];
const layoutStub = { selectPanel: (panelId) => { layoutCalls.push(panelId); } };
const ctx = {
  effect: (fn) => {
    const dispose = fn();
    return typeof dispose === "function" ? dispose : () => {};
  },
  get: (name) => (name === "layout" ? layoutStub : undefined),
  on: () => () => {},
  locale: {
    register: (namespace, tables) => {
      dictionaries.set(namespace, tables);
      return () => {};
    },
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
    inject: (name, callback) => {
      injections.push(name);
      return callback();
    },
    register: (options, component) => {
      registrations.push({ options, component });
      return () => {};
    }
  },
  remote: { $mount: async () => undefined, $on: () => () => {} }
};

mod.apply(ctx);

const pick = (name) => registrations.filter((row) => row.options.name === name);
const rows = pick("sidebar.panellist");
const panels = pick("main");

check("exactly one sidebar row is registered (skills + MCP merged)", () => {
  assert.equal(rows.length, 1, "expected exactly 1 sidebar.panellist registration");
  assert.equal(rows[0].options.id, "skill-mcp");
});

check("the row sits right below the host's 插件 row (order 0)", () => {
  assert.equal(rows[0].options.order, 1);
});

check("row label resolves from the zh dictionary", () => {
  assert.equal(rows[0].options.label(), "Skill/MCP");
});

check("the row addresses the reserved-for-us main key", () => {
  assert.equal(panels.length, 1, "expected exactly 1 main registration");
  assert.equal(panels[0].options.key, "skill-mcp");
  assert.equal(rows[0].options.id, panels[0].options.key, "sidebar row must address a registered main key");
});

check("settings.section is no longer used", () => {
  assert.equal(pick("settings.section").length, 0, "settings page registration came back");
  assert.equal(/settings\.section/.test(source), false, "bundle still mentions settings.section");
});

check("slot injections only target the sidebar/panel slots", () => {
  assert.deepEqual([...new Set(injections)].sort(), ["main", "sidebar.panellist"]);
});

// 桩 jsx 不执行函数组件，这里手动展开一层（行组件 → 共享的 PanelGlyph）。
const renderGlyph = (row, ownerProps) => {
  const element = row.component(ownerProps);
  assert.equal(typeof element.type, "function", "row component should render the shared glyph");
  return element.type(element.props);
};

check("the row renders its glyph at the requested size", () => {
  const icon = renderGlyph(rows[0], { size: 18, active: true });
  assert.equal(icon.type, "span");
  assert.equal(icon.props.className, "SKV_panelIcon SKV_panelIconMerged");
  // 展开成宿主侧对象：vm 沙箱里造的对象原型不同，直接 deepEqual 会被判为不等价。
  assert.deepEqual({ ...icon.props.style }, { width: 18, height: 18 });
});

check("glyph falls back to 16px when the host omits size", () => {
  assert.deepEqual({ ...renderGlyph(rows[0], {}).props.style }, { width: 16, height: 16 });
});

// 宿主把「槽位 owner props + 标准 props + inject face」合成后交给页面组件。
const pageProps = (row) => ({ ...(row.options.inject ?? {})() });

// 桩 jsx 不执行函数组件：这里显式展开「页面 → 左上角返回按钮」两层。
const renderBackButton = (page) => {
  const top = page.props.children[0];
  assert.equal(top.props.className, "SKV_pageTop", "the back control must sit in the page's top-left row");
  const back = top.props.children;
  assert.equal(typeof back.type, "function", "top row should hold the shared back control");
  const button = back.type(back.props);
  assert.equal(button.type, "button");
  return button;
};

const renderPage = () => panels[0].component(pageProps(panels[0]));

check("the merged page owns the full-page shell", () => {
  const page = renderPage();
  assert.equal(page.props.className, "SKV_page", "main-slot page must own its own scroll/padding shell");
});

check("the page renders two tabs: 技能 and MCP", () => {
  const page = renderPage();
  const tabs = page.props.children[1];
  assert.equal(tabs.props.className, "SKV_tabs");
  assert.equal(tabs.props.role, "tablist");
  const labels = tabs.props.children.map((button) => button.props.children);
  assert.deepEqual([...labels], ["技能", "MCP"]);
});

check("skills is the default tab when nothing was remembered", () => {
  storedTab = null;
  const page = renderPage();
  const [skillsTab, mcpTab] = page.props.children[1].props.children;
  assert.equal(skillsTab.props["data-active"], "true");
  assert.equal(mcpTab.props["data-active"], "false");
  // 第三个孩子是当前页签的正文：技能页签下必须是技能面板组件。
  assert.equal(page.props.children[2].type(page.props.children[2].props).props.className, "SKV_section");
});

check("the remembered tab is reopened on the next mount", () => {
  storedTab = "mcp";
  const page = renderPage();
  const [skillsTab, mcpTab] = page.props.children[1].props.children;
  assert.equal(mcpTab.props["data-active"], "true");
  assert.equal(skillsTab.props["data-active"], "false");
  // MCP 正文：t 必须是 MCP 字典绑定（技能字典里没有 title 这个键的同一句话）。
  const body = page.props.children[2];
  assert.equal(body.type(body.props).props.className, "MCP_section");
  storedTab = null;
});

check("switching tabs writes the choice for next time", () => {
  storageWrites.length = 0;
  const page = renderPage();
  const [skillsTab, mcpTab] = page.props.children[1].props.children;
  mcpTab.props.onClick();
  skillsTab.props.onClick();
  assert.deepEqual(storageWrites.map(([, value]) => value), ["mcp", "skills"]);
  assert.ok(storageWrites.every(([key]) => key === "dsh-skill-mcp-panel:last-tab"));
});

check("the merged panel offers a back arrow that returns to the conversation", () => {
  const button = renderBackButton(renderPage());
  assert.equal(button.props.title, "返回会话", "back control should carry the zh tooltip");
  // 展开成宿主侧数组：vm 沙箱里造的数组原型不同，直接 deepEqual 会被判为不等价。
  assert.deepEqual([...button.props.children.map((child) => (child.type === "span" ? child.props.children : "<glyph>"))], ["<glyph>", "返回会话"]);
  layoutCalls.length = 0;
  button.props.onClick();
  assert.deepEqual(layoutCalls, [null], "back control must call layout.selectPanel(null)");
});

check("a host without the layout service leaves the arrow inert instead of throwing", () => {
  layoutCalls.length = 0; // 上一条检查留下的调用记录不算数
  // 真的把 apply 跑在「没有 layout 服务」的宿主上，取回注入面里的返回动作再调用，
  // 而不是替换成一个空函数——这样才覆盖 bundle 里的 ctx.get("layout") 兜底分支。
  const barren = [];
  const ctxWithoutLayout = {
    ...ctx,
    get: () => undefined,
    slots: {
      inject: (name, callback) => callback(),
      register: (options, component) => {
        barren.push({ options, component });
        return () => {};
      }
    }
  };
  mod.apply(ctxWithoutLayout);
  const panel = barren.find((row) => row.options.name === "main" && row.options.key === "skill-mcp");
  assert.ok(panel, "merged main panel should register even without the layout service");
  const face = panel.options.inject();
  assert.equal(typeof face.backToConversation, "function");
  assert.doesNotThrow(() => face.backToConversation());
  assert.deepEqual(layoutCalls, [], "no layout service must mean no selectPanel call");
});

check("a host without localStorage still opens the skills tab", () => {
  const bare = { ...sandbox };
  delete bare.localStorage;
  const bareSandbox = { ...sandbox, localStorage: undefined };
  // 直接跑 readLastTab 的等价路径：删掉全局后 typeof 判定必须兜住。
  const previous = sandbox.localStorage;
  sandbox.localStorage = undefined;
  try {
    const page = renderPage();
    const [skillsTab] = page.props.children[1].props.children;
    assert.equal(skillsTab.props["data-active"], "true");
  } finally {
    sandbox.localStorage = previous;
  }
  void bare;
  void bareSandbox;
});

check("the MCP panel carries a how-it-works button that toggles the doc block", () => {
  // 默认桩的 setter 是空操作，点不开折叠块；这里换一个会记状态的 useState 桩，
  // 并用 captured.factory 再取一份独立的 bundle 实例（不污染前面的检查）。
  const states = [];
  let cursor = 0;
  const statefulReact = {
    ...reactStub,
    useState: (init) => {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof init === "function" ? init() : init;
      return [states[index], (next) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
    }
  };
  const statefulRequire = (specifier) => {
    if (specifier === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: reactStub.Fragment };
    if (specifier === "react") return statefulReact;
    if (specifier === "@deepseek-ai/dsh-client-ui-primitives") return {};
    throw new Error("unexpected require: " + specifier);
  };
  const bundle2 = captured.factory(statefulRequire);
  const regs = [];
  const ctx2 = {
    ...ctx,
    slots: {
      inject: (name, callback) => callback(),
      register: (options, component) => { regs.push({ options, component }); return () => {}; }
    }
  };
  bundle2.apply(ctx2);
  const panel = regs.find((row) => row.options.name === "main" && row.options.key === "skill-mcp");
  assert.ok(panel, "merged panel must register");
  const renderSection = () => {
    cursor = 0;
    const page = panel.component({ ...panel.options.inject() });
    const body = page.props.children[2];
    return body.type(body.props);
  };
  storedTab = "mcp";
  let section = renderSection();
  assert.equal(section.props.className, "MCP_section");
  const buttons = section.props.children[0].props.children.filter((child) => child && child.type === "button");
  assert.equal(buttons.length, 2, "head should hold the how-it-works button plus refresh");
  assert.equal(buttons[0].props["aria-expanded"], false);
  assert.equal(buttons[0].props.children, "注册机制");
  assert.equal(section.props.children.filter((child) => child && child.props && child.props.className === "MCP_doc").length, 0);
  buttons[0].props.onClick();
  section = renderSection();
  const doc = section.props.children.find((child) => child && child.props && child.props.className === "MCP_doc");
  assert.ok(doc, "doc block must render after the toggle");
  const text = doc.props.children.map((child) => String(child.props.children)).join(" | ");
  assert.ok(text.includes("DSH 的 MCP 注册机制"), "doc must explain the registration mechanism");
  assert.ok(text.includes("!!js"), "doc must explain the !!js expression rule");
  assert.ok(text.includes("cordis.patch.yml"), "doc must name the config file");
  storedTab = null;
});
check("the merged panel icon is the shipped SVG, and tab/dark-theme styles survive", () => {
  const css = styleTags.map((tag) => String(tag.textContent ?? "")).join("\n");
  const iconRule = css.slice(css.indexOf(".SKV_panelIconMerged"), css.indexOf(".SKV_panelIconMerged") + 2000);
  assert.ok(iconRule.length > 0, "merged icon rule missing from the injected CSS");
  assert.ok(css.includes(".SKV_panelIcon{flex:none;display:inline-block;background-color:currentColor}"), "icon must paint with currentColor");
  assert.ok(iconRule.includes("-webkit-mask:url(\"data:image/svg+xml;utf8,<svg "), "webkit mask missing");
  assert.ok(iconRule.includes(";mask:url(\"data:image/svg+xml;utf8,<svg "), "standard mask missing (non-webkit engines)");
  assert.ok(iconRule.includes("center/contain no-repeat"), "mask must be sized to the row");
  // 图形必须与 assets/skill-mcp-icon.svg 里的路径逐条一致：换图标时两边一起改，别让 CSS 里留下旧图。
  const drawingPaths = (text) => (text.match(/d='([^']+)'|d="([^"]+)"/g) || []).map((item) => item.slice(3, -1));
  const asset = readFileSync(new URL("./assets/skill-mcp-icon.svg", import.meta.url), "utf8");
  const fromAsset = drawingPaths(asset);
  assert.equal(fromAsset.length, 3, "the icon asset should carry three strokes");
  assert.deepEqual([...new Set(drawingPaths(iconRule))], fromAsset, "injected icon must match assets/skill-mcp-icon.svg");
  assert.equal(drawingPaths(iconRule).length, 6, "the SVG must be inlined for both mask declarations");
  assert.equal(/metadata|c2pa/i.test(asset + iconRule), false, "C2PA metadata must not ship");
  for (const dead of ["SKV_panelIconSkills", "SKV_panelIconMcp", "base64,iVBOR"]) {
    assert.equal(css.includes(dead), false, "dead per-panel icon left behind: " + dead);
  }
  assert.ok(css.includes("body[data-ds-dark-theme] .SKV_switchThumb{background:#fff}"), "dark-theme switch rule lost");
  assert.ok(css.includes(".SKV_page{"), "page shell styles missing");
  assert.ok(css.includes(".SKV_tabs{"), "tab styles missing");
  assert.ok(css.includes(".SKV_pluginToggle{"), "plugin-skill toggle styles missing");
  assert.equal(css.includes("data-skills-nav"), false, "dead settings-nav patch CSS left behind");
});
console.log("\n" + (failures === 0 ? "all panel-slot checks passed" : failures + " check(s) failed"));
process.exit(failures === 0 ? 0 : 1);
