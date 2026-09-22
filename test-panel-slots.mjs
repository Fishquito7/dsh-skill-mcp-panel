/**
 * 回归守卫：主页面板必须挂在宿主侧栏的两个槽位上，而不是设置页。
 *
 * 背景
 *   迁移前「技能」「MCP」注册在 settings.section（设置弹窗里的 tab）。
 *   迁移后改为宿主全局面板的标准组合：
 *     sidebar.panellist  —— list 槽位，一行图标 + label（「插件」行同款机制）
 *     main               —— keyed 槽位，中央主区整页内容（key 必须等于行 id）
 *   两者 id/key 一旦不一致，点击侧栏行会在宿主里抛错且不切换主区；
 *   若误把 settings.section 加回来，就会重新出现重复入口。
 *
 * 本测试把 lib/client.js 当成浏览器里的经典脚本真正跑一遍：
 *   1. 用桩 __ModuleLoader__ 捕获 factory，再用桩 require 喂 react 三件套；
 *   2. 用桩 ctx 执行 apply()，收集全部 ctx.slots.register 调用；
 *   3. 断言侧栏行 id/order/label、主区 key、以及 settings.section 已彻底消失；
 *   4. 断言两个字形组件渲染出的 class 与尺寸，以及样式表里蒙版图像仍在
 *      （旧实现把暗色主题开关规则拼接在图标样式串尾部，删图标时极易误删）。
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
const sandbox = {
  console,
  document: documentStub,
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

check("two sidebar rows are registered", () => {
  assert.equal(rows.length, 2, "expected exactly 2 sidebar.panellist registrations");
});

check("rows sit right below the host's 插件 row (order 0)", () => {
  const byId = Object.fromEntries(rows.map((row) => [row.options.id, row.options.order]));
  assert.deepEqual(byId, { skills: 1, mcp: 2 });
});

check("row labels resolve from the zh dictionaries", () => {
  const byId = Object.fromEntries(rows.map((row) => [row.options.id, row.options.label()]));
  assert.deepEqual(byId, { skills: "技能", mcp: "MCP" });
});

check("both rows resolve to the reserved-for-us main keys", () => {
  const keys = panels.map((row) => row.options.key).sort();
  assert.deepEqual(keys, ["mcp", "skills"]);
  const rowIds = rows.map((row) => row.options.id).sort();
  assert.deepEqual(rowIds, keys, "every sidebar row must address a registered main key");
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

check("each row renders its own glyph at the requested size", () => {
  const skillsIcon = renderGlyph(rows[0], { size: 18, active: true });
  assert.equal(skillsIcon.type, "span");
  assert.equal(skillsIcon.props.className, "SKV_panelIcon SKV_panelIconSkills");
  // 展开成宿主侧对象：vm 沙箱里造的对象原型不同，直接 deepEqual 会被判为不等价。
  assert.deepEqual({ ...skillsIcon.props.style }, { width: 18, height: 18 });
  const mcpIcon = renderGlyph(rows[1], { size: 16, active: false });
  assert.equal(mcpIcon.props.className, "SKV_panelIcon SKV_panelIconMcp");
});

check("glyph falls back to 16px when the host omits size", () => {
  assert.deepEqual({ ...renderGlyph(rows[0], {}).props.style }, { width: 16, height: 16 });
});

// 宿主把「槽位 owner props + 标准 props + inject face」合成后交给页面组件。
const pageProps = (row, namespace) => ({ t: ctx.locale.bind(namespace), ...(row.options.inject ?? {})() });

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

check("skills page renders inside the full-page shell with its header", () => {
  const page = panels.find((row) => row.options.key === "skills").component(pageProps(panels[0], "settings.skills"));
  assert.equal(page.props.className, "SKV_page", "main-slot page must own its own scroll/padding shell");
  const [, head, section] = page.props.children;
  assert.equal(head.props.className, "SKV_pageHead");
  const [title, intro] = head.props.children;
  assert.equal(title.type, "h2");
  assert.equal(title.props.children, "技能");
  assert.equal(intro.props.className, "SKV_pageIntro");
  assert.equal(intro.props.children, "管理全局与工作区里的技能：搜索、展开正文、启用/停用、删除、添加、迁移与分组。");
  assert.equal(typeof section.type, "function", "the skills panel component must be rendered below the header");
});

check("mcp page renders in the shell without a duplicate header", () => {
  const row = panels.find((r) => r.options.key === "mcp");
  const page = row.component(pageProps(row, "settings.mcp"));
  assert.equal(page.props.className, "SKV_page");
  assert.equal(typeof page.props.children[1].type, "function");
});

check("both panels offer a back arrow that returns to the conversation", () => {
  for (const [key, namespace] of [["skills", "settings.skills"], ["mcp", "settings.mcp"]]) {
    const row = panels.find((r) => r.options.key === key);
    const button = renderBackButton(row.component(pageProps(row, namespace)));
    assert.equal(button.props.title, "返回会话", key + " back control should carry the zh tooltip");
    // 展开成宿主侧数组：vm 沙箱里造的数组原型不同，直接 deepEqual 会被判为不等价。
    assert.deepEqual([...button.props.children.map((child) => (child.type === "span" ? child.props.children : "<glyph>"))], ["<glyph>", "返回会话"]);
    layoutCalls.length = 0;
    button.props.onClick();
    assert.deepEqual(layoutCalls, [null], key + " back control must call layout.selectPanel(null)");
  }
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
  const skills = barren.find((row) => row.options.name === "main" && row.options.key === "skills");
  assert.ok(skills, "skills main panel should register even without the layout service");
  const face = skills.options.inject();
  assert.equal(typeof face.backToConversation, "function");
  assert.doesNotThrow(() => face.backToConversation());
  assert.deepEqual(layoutCalls, [], "no layout service must mean no selectPanel call");
});

check("icon mask artwork and dark-theme switch rules are still shipped", () => {
  const css = styleTags.map((tag) => String(tag.textContent ?? "")).join("\n");
  assert.ok(css.includes(".SKV_panelIconSkills{-webkit-mask:url(data:image/png;base64,"), "skills mask missing");
  assert.ok(css.includes(".SKV_panelIconMcp{-webkit-mask:url(data:image/png;base64,"), "mcp mask missing");
  assert.ok(css.includes("body[data-ds-dark-theme] .SKV_switchThumb{background:#fff}"), "dark-theme switch rule lost");
  assert.ok(css.includes(".SKV_page{"), "page shell styles missing");
  assert.equal(css.includes("data-skills-nav"), false, "dead settings-nav patch CSS left behind");
});

// ── 工作区作用域：面板到宿主的 payload 契约 ──────────────────────────────────
// 这一段把「浏览器里真的会发什么」钉死：宿主 wire 是 strict codec，客户端多送或
// 少送一个字段都会在运行时才炸；这里用桩 remote 记录实际调用参数。
const remoteCalls = [];
const envelope = (value) => ({ ok: true, value });
// 客户端 CONTRIBUTION 必须为自己要调的每个方法声明 descriptor；漏一个在生产里
// 就是 "remote[method] is not a function"。这里直接从束源解析声明集合，并让桩
// remote 只暴露已声明的方法——漏声明会以生产同款错误在此暴露。
const declaredMcpMethods = new Set([...source.matchAll(/dsh-skill-mcp-panel#mcpManager\/([A-Za-z]+)"/g)].map((match) => match[1]));
const recorder = (namespace, declared) => new Proxy({}, {
  get: (_target, method) => {
    if (declared !== undefined && !declared.has(String(method))) return undefined;
    return async (...args) => {
      remoteCalls.push({ namespace, method: String(method), args });
      if (namespace === "skillsViewer" && String(method) === "workspaces") return envelope({ workspaces: [{ path: "D:/ws", label: "WS" }] });
      if (namespace === "mcpManager" && String(method) === "workspaceList") {
        return envelope({ workspace: { path: "D:/ws", label: "WS", ok: true, error: null, servers: [], conflicts: [] } });
      }
      return envelope(undefined);
    };
  }
});
const mcpRemote = recorder("mcpManager", declaredMcpMethods);
const skillsRemote = recorder("skillsViewer");
ctx.get = (name) => {
  if (name === "layout") return layoutStub;
  if (name === "remote.mcpManager") return mcpRemote;
  if (name === "remote.skillsViewer") return skillsRemote;
  return undefined;
};
const lastCall = (namespace, method) => [...remoteCalls].reverse().find((row) => row.namespace === namespace && row.method === method);
const checkAsync = async (label, fn) => {
  try {
    await fn();
    console.log("PASS  " + label);
  } catch (error) {
    failures += 1;
    console.log("FAIL  " + label + "\n      " + (error && error.message ? error.message : error));
  }
};
const mcpFace = () => panels.find((row) => row.options.key === "mcp").options.inject();

await checkAsync("every remote method the panel calls has a declared client descriptor", () => {
  const declaredMethods = (namespace) =>
    new Set([...source.matchAll(new RegExp("dsh-skill-mcp-panel#" + namespace + "\\/([A-Za-z]+)\"", "g"))].map((match) => match[1]));
  const missing = [];
  for (const [callee, namespace] of [["callRemote", "skillsViewer"], ["callMcp", "mcpManager"]]) {
    const declared = declaredMethods(namespace);
    for (const match of source.matchAll(new RegExp(callee + "\\(\"([A-Za-z]+)\"", "g"))) {
      if (!declared.has(match[1])) missing.push(namespace + "." + match[1]);
    }
  }
  assert.deepEqual(missing, [], "remote methods called without a client descriptor: " + missing.join(", "));
});

await checkAsync("the mcpManager descriptor surface is the frozen set the page relies on", () => {
  const expected = ["list", "save", "removeServer", "setEnabled", "test", "reload", "workspaceList", "workspaceSave", "workspaceRemoveServer", "workspaceSetEnabled", "workspaceTest"];
  const missing = expected.filter((method) => !declaredMcpMethods.has(method));
  assert.deepEqual(missing, [], "missing client descriptors: " + missing.join(", "));
});

await checkAsync("client no longer depends on the credentials namespace", () => {
  assert.equal(mod.inject.includes("remote.credentials"), false, "values now ride the save payload; the client must not need credentials");
  assert.ok(mod.inject.includes("remote"), "remote itself stays declared");
});

await checkAsync("listWorkspaceMcp sends only { scope } to workspaceList", async () => {
  await mcpFace().listWorkspaceMcp("D:/ws");
  const call = lastCall("mcpManager", "workspaceList");
  assert.ok(call, "workspaceList was never called");
  assert.equal(call.args.length, 1);
  assert.deepEqual(Object.keys(call.args[0]), ["scope"], "the payload must be exactly { scope } (no sessionId)");
  assert.equal(call.args[0].scope, "D:/ws");
});

await checkAsync("saveWorkspaceMcp sends the global-shaped input, values included", async () => {
  const input = {
    serverName: "x",
    transport: "streamable-http",
    url: "https://e.com/mcp",
    headers: { "X-Api-Key": "v", Gone: null },
    toolCallTimeoutMs: 60000,
    failOnStartupError: false,
    reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 }
  };
  await mcpFace().saveWorkspaceMcp("D:/ws", input, "old");
  const payload = lastCall("mcpManager", "workspaceSave").args[0];
  assert.equal(payload.scope, "D:/ws");
  assert.equal(payload.previousServerName, "old");
  assert.equal(payload.input.transport, "streamable-http");
  assert.deepEqual({ ...payload.input.headers }, { "X-Api-Key": "v", Gone: null }, "values (and null-deletes) ride the payload; the host splits them");
  assert.equal("server" in payload, false, "the old declaration-shaped field must be gone");
  assert.equal("headerKeys" in payload, false, "header names are no longer lifted out of the input");
});

await checkAsync("saveWorkspaceMcp omits an absent previousServerName", async () => {
  await mcpFace().saveWorkspaceMcp("D:/ws", { serverName: "y", transport: "stdio", command: "node" }, undefined);
  const payload = lastCall("mcpManager", "workspaceSave").args[0];
  assert.equal("previousServerName" in payload, false, "an absent previousServerName must not be sent");
  assert.equal(payload.input.command, "node");
});

await checkAsync("workspace toggle / remove / test send the documented payloads", async () => {
  const face = mcpFace();
  await face.setWorkspaceEnabledMcp("D:/ws", "x", false);
  assert.deepEqual({ ...lastCall("mcpManager", "workspaceSetEnabled").args[0] }, { scope: "D:/ws", serverName: "x", enabled: false });
  await face.removeWorkspaceMcp("D:/ws", "x");
  assert.deepEqual({ ...lastCall("mcpManager", "workspaceRemoveServer").args[0] }, { scope: "D:/ws", serverName: "x" });
  await face.testWorkspaceMcp("D:/ws", "x");
  assert.deepEqual({ ...lastCall("mcpManager", "workspaceTest").args[0] }, { scope: "D:/ws", serverName: "x" });
});

check("workspace scope styles are shipped with the MCP stylesheet", () => {
  const css = styleTags.map((tag) => String(tag.textContent ?? "")).join("\n");
  assert.ok(css.includes(".MCP_scopeBar{"), "scope bar styles missing");
  assert.ok(css.includes(".MCP_scopeLabel{"), "scope label style missing");
  assert.ok(css.includes(".MCP_scopeBtn[data-active=true]"), "active scope button rule missing");
  // 卡片凭证区已被表单取代：相关样式与文案都不该再被发出去。
  assert.equal(/MCP_secret(Row|Input|Box|Name|Badge)/.test(css), false, "removed credential-row styles are still shipped");
  assert.equal(/keysOnlyHint|secretsTitle|secretsLoading|workspaceFile|workspaceMounted|workspaceMissing/.test(source), false, "removed strings are still shipped");
});

check("the two MCP dictionaries declare exactly the same keys", () => {
  // 渲染用的是 t("key")：某一侧字典漏键时不会报错，只会把 key 名当文案显示出来
  // （workspaceMissing 就这样漏过一次）。这里把两侧的键集钉成相等。
  const sliceDict = (name) => {
    const start = source.indexOf("const " + name + " = {");
    assert.ok(start >= 0, name + " not found in the bundle");
    const end = source.indexOf("};", start);
    assert.ok(end > start, name + " block end not found");
    const body = source.slice(start, end);
    return new Set([...body.matchAll(/^\s*([A-Za-z][A-Za-z0-9]*):/gm)].map((match) => match[1]));
  };
  const zh = sliceDict("mcpZh");
  const en = sliceDict("mcpEn");
  const onlyZh = [...zh].filter((key) => !en.has(key));
  const onlyEn = [...en].filter((key) => !zh.has(key));
  assert.deepEqual(onlyZh, [], "keys present only in mcpZh: " + onlyZh.join(", "));
  assert.deepEqual(onlyEn, [], "keys present only in mcpEn: " + onlyEn.join(", "));
  assert.ok(zh.size > 20, "dictionary parse looks wrong: only " + zh.size + " keys");
  // 渲染里引用的 t("...") 必须都在字典里（MCP 页用到的这部分键名逐个点名）。
  for (const key of ["scopeLabel", "scopeGlobal", "scopeWorkspaceBadge", "workspaceSubtitle", "workspaceEmpty", "workspaceConflict", "workspaceOnlyNewSessions", "fieldEnv", "fieldHeaders"]) {
    assert.ok(zh.has(key), "mcpZh is missing a key the panel renders: " + key);
  }
});

console.log("\n" + (failures === 0 ? "all panel-slot checks passed" : failures + " check(s) failed"));
process.exit(failures === 0 ? 0 : 1);
