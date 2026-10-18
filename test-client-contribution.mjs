/**
 * 回归守卫：浏览器束 $mount 的 Remote 贡献必须与宿主 manifest 一一对应。
 *
 * 背景（Issue #51）
 *   客户端 `remote.<namespace>` 上的方法**只来自本插件自己 $mount 的那份描述符**：
 *   宿主 `dsh-api-gateway` 的 mountContribution 只把 `contribution.descriptors` 里的
 *   方法装到命名空间服务上，没列出来的方法根本不存在，调用时报
 *   `remote[method] is not a function`（浏览器里就是这句）。
 *   2.2.0 加「单工具禁用」（listTools / getToolFilter / setToolFilter）与「OAuth 登录」
 *   入口时，只改了宿主侧 `src/mcp/wire.ts`，忘了同步浏览器束里的 CONTRIBUTION，
 *   于是点 MCP 卡片的「工具」按钮必然抛错——渲染级测试（test-panel-render.mjs）把假 rpc
 *   直接注进 inject() 的 face，走不到 $mount，所以覆盖不到这条。
 *
 * 本测试：
 *   1. 把 lib/client.js 当经典脚本跑起来，捕获它交给 ctx.remote.$mount 的贡献项；
 *   2. 与 lib/index.js 的 PANEL_MANIFEST.invocations 做双向全量比对
 *      （方法、命名空间、参数名/来源、结果 codec 符号）；
 *   3. 单独点名 6 个「客户端真的会调用」的新方法，失败信息直接指向 Issue #51。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { PANEL_MANIFEST } from "./lib/index.js";

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

// ── 载入浏览器束 ──────────────────────────────────────────────────────────
const source = readFileSync(process.argv[2] ?? fileURLToPath(new URL("./lib/client.js", import.meta.url)), "utf8");
let captured = null;
const sandbox = {
  console,
  document: { querySelector: () => null, createElement: () => ({ dataset: {}, textContent: "" }), head: { appendChild: () => {} } },
  localStorage: { getItem: () => null, setItem: () => {} },
  navigator: { clipboard: { writeText: async () => {} } },
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
  if (specifier === "@deepseek-ai/dsh-client-ui-primitives") {
    const icon = (props) => ({ __icon: true, props: props ?? {} });
    return new Proxy({}, { get: () => icon });
  }
  throw new Error("unexpected require: " + specifier);
};

const mod = captured.factory(requireStub);

// ── 桩宿主：只关心 $mount 拿到的东西 ──────────────────────────────────────
let contribution = null;
const dictionaries = new Map();
const ctx = {
  effect: (fn) => {
    const dispose = fn();
    return typeof dispose === "function" ? dispose : () => {};
  },
  get: (name) => (name === "layout" ? { selectPanel: () => {} } : undefined),
  on: () => () => {},
  locale: {
    register: (namespace, tables) => { dictionaries.set(namespace, tables); return () => {}; },
    bind: (namespace) => (key) => {
      const tables = dictionaries.get(namespace) ?? { zh: {} };
      return (tables.zh ?? tables)[key] ?? key;
    },
    subscribe: () => () => {},
    getSnapshot: () => ({ revision: 0 })
  },
  slots: { inject: (name, callback) => callback(), register: () => () => {} },
  remote: {
    $mount: async (value) => { contribution = value; },
    $on: () => () => {}
  }
};
mod.apply(ctx);

// ── 比对 ──────────────────────────────────────────────────────────────────
const signature = (descriptor) => {
  const params = (descriptor.parameters ?? []).map((param) => param.name + ":" + (param.source ?? "json")).join(",");
  return descriptor.namespace + "/" + descriptor.method + "(" + params + ") -> " + descriptor.result.typeSymbol;
};
const hostSignatures = new Map(PANEL_MANIFEST.invocations.map((invocation) => [invocation.method + "@" + invocation.namespace, signature(invocation)]));
const clientDescriptors = (contribution?.descriptors ?? []);
const clientSignatures = new Map(clientDescriptors.map((descriptor) => [descriptor.method + "@" + descriptor.namespace, signature(descriptor)]));

check("browser bundle mounts its Remote contribution on ctx.remote.$mount", () => {
  assert.ok(contribution, "$mount was never called");
  assert.equal(contribution.package, "dsh-skill-mcp-panel");
  assert.ok(Array.isArray(contribution.descriptors) && contribution.descriptors.length > 0);
});

check("every host manifest invocation is mounted by the client", () => {
  const missing = [];
  for (const [key, expected] of hostSignatures) {
    if (!clientSignatures.has(key)) missing.push(key);
    else if (clientSignatures.get(key) !== expected) {
      missing.push(key + " (signature differs: client " + clientSignatures.get(key) + " vs host " + expected + ")");
    }
  }
  assert.deepEqual(missing, [], "client contribution is missing / mismatched: " + missing.join("; "));
});

check("client does not mount methods the host never registered", () => {
  const extra = [...clientSignatures.keys()].filter((key) => !hostSignatures.has(key));
  assert.deepEqual(extra, [], "client mounts unknown methods (host would answer 404): " + extra.join("; "));
});

check("no duplicate endpoint in the contribution", () => {
  const seen = new Set();
  const dupes = [];
  for (const descriptor of clientDescriptors) {
    if (seen.has(descriptor.id)) dupes.push(descriptor.id);
    seen.add(descriptor.id);
  }
  assert.deepEqual(dupes, []);
});

// 点名 Issue #51 的 6 个方法（客户端真的会调用它们；oauthStatus 只给 CLI 用）
check("Issue #51: tools panel and OAuth buttons have mounted methods", () => {
  const required = ["listTools", "getToolFilter", "setToolFilter", "oauthStart", "oauthPoll", "oauthDisconnect"];
  const missing = required.filter((method) => !clientSignatures.has(method + "@mcpManager"));
  assert.deepEqual(missing, [], "missing mounted methods: " + missing.join(", "));
});

process.exit(failures === 0 ? 0 : 1);
