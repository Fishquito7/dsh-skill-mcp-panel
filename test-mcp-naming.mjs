import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// 客户端 bundle 只能 require 外壳种子词（react / jsx-runtime / primitives），无法 import
// 宿主侧模块，所以服务名规则在 src/mcp/model.ts 与 src/client.ts 各写一份字面量。
// 这个守卫保证两份不会漂移 —— 漂移的后果是 UI 放行、网关边界报「天书」。
const LITERAL = "/^[A-Za-z0-9_-]{1,32}$/";

const model = await readFile(new URL("./lib/mcp/model.js", import.meta.url), "utf8");
const client = await readFile(new URL("./lib/client.js", import.meta.url), "utf8");

assert.ok(model.includes(LITERAL), "lib/mcp/model.js 必须用规范字面量声明 SERVER_NAME_RE");
assert.ok(client.includes(LITERAL), "lib/client.js 必须携带同一份名称规则用于即时校验");

console.log("PASS  client/server MCP name rule literals agree");
// !!js 前缀同样是两侧各一份字面量：宿主（model.ts）负责把标签写进 cordis.patch.yml，
// 客户端（client.ts）负责解析表单输入。两边必须认同同一个前缀，否则用户在页面上
// 写的东西和实际落盘的东西会对不上。
assert.ok(model.includes('JS_EXPR_PREFIX = "!!js"'), "lib/mcp/model.js 必须声明 !!js 前缀常量");
assert.ok(client.includes('MCP_JS_EXPR_PREFIX = "!!js"'), "lib/client.js 必须认同同一个 !!js 前缀");
console.log("PASS  client/server !!js prefix literals agree");
// ${NAME} 直觉写法的正则同样是两侧各一份字面量（宿主 model.ts / 客户端 client.ts）。
// 漂移的后果：面板把值当成表达式落盘，而 CLI 或另一侧当成普通字符串。
const ENV_REF_LITERAL = "/\\$\\{\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*\\}/g";
assert.ok(model.includes(ENV_REF_LITERAL), "lib/mcp/model.js 必须声明 ENV_REF_RE 字面量");
assert.ok(client.includes(ENV_REF_LITERAL), "lib/client.js 必须携带同一份 ${NAME} 规则");
console.log("PASS  client/server ${NAME} reference literals agree");
console.log("\n3 passed, 0 failed");
console.log("ALL MCP NAMING TESTS PASSED");
