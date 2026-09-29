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
console.log("\n1 passed, 0 failed");
console.log("ALL MCP NAMING TESTS PASSED");
