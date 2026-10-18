/**
 * 回归守卫：Typert strict codec 必须满足 **0.2.x 起的宿主契约**。
 *
 * 背景
 *   上游 commit e459e32637（perf(typert): materialize generated schemas on first use）
 *   把 strict codec 从「直接持有 schema」改成「持有 schema 工厂 create()」，
 *   宿主 registry / loader / gateway 一律读 `create()` 并在边界执行 `create().parse()`。
 *   0.1.x 时代我们额外挂过一个 `schema` 字段来兼容更老的宿主；2026-10-18 起本插件的
 *   最低支持宿主是 **0.2.0**，那个字段已删除（见 src/codec.ts）。
 *
 * 本测试锁住该契约：
 *   1. 运行时遍历 PANEL_MANIFEST 的每一个 codec，跑 0.2.x registry 的真实校验谓词；
 *   2. create() 幂等、返回值可 parse；
 *   3. 静态校验浏览器束 lib/client.js —— 它是自包含束、不能 import，必须与 helper 同形
 *      （只许带 mode/typeSymbol/create，不许再出现历史包袱 `schema`）。
 */
import { readFileSync } from "node:fs";
import { PANEL_MANIFEST } from "./lib/index.js";

let failures = 0;
const check = (label, cond) => {
  console.log((cond ? "PASS" : "FAIL") + "  " + label);
  if (!cond) failures++;
};

const validateNonempty = (subject, value) => {
  if (typeof value !== "string" || value.length === 0) throw new Error("typert: " + subject + " must be a non-empty string");
};

/** 0.2.x dsh-typert-registry/lib/index.js 的 validateCodec（逐字同义） */
const registryValidateCodec = (codec, subject) => {
  if (codec.mode === "src-json") return;
  validateNonempty(subject + " type symbol", codec.typeSymbol);
  if (typeof codec.create !== "function") {
    throw new Error("typert: " + subject + " strict codec has no create() factory");
  }
};

// ── 1. 运行时遍历 PANEL_MANIFEST 的每一个 codec ──────────────────────────
const codecs = [];
for (const invocation of PANEL_MANIFEST.invocations) {
  if (invocation.result) codecs.push([invocation.id + " result", invocation.result]);
  for (const parameter of invocation.parameters ?? []) {
    codecs.push([invocation.id + " parameter " + parameter.name, parameter.codec]);
  }
  if (invocation.invocation?.kind === "context" && invocation.invocation.codec) {
    codecs.push([invocation.id + " Context", invocation.invocation.codec]);
  }
}

check("manifest 含有 invocation（不是空跑）", PANEL_MANIFEST.invocations.length > 0 && codecs.length > 0);
console.log("      invocation=" + PANEL_MANIFEST.invocations.length + "  codec=" + codecs.length);

const registryFailures = [];
const shapeFailures = [];
const parseFailures = [];
const baggage = [];

for (const [subject, codec] of codecs) {
  try { registryValidateCodec(codec, subject); } catch (error) { registryFailures.push(subject + ": " + error.message); }
  if (Object.hasOwn(codec, "schema")) baggage.push(subject);
  if (typeof codec.create !== "function") { shapeFailures.push(subject); continue; }
  const first = codec.create();
  if (first !== codec.create()) shapeFailures.push(subject + ": create() 非幂等");
  if (typeof first?.parse !== "function") parseFailures.push(subject);
}

check("0.2.x registry 校验通过（需要 create() 工厂）", registryFailures.length === 0);
check("create() 幂等", shapeFailures.length === 0);
check("create() 返回值可 parse", parseFailures.length === 0);
check("codec 不再携带历史包袱 schema 字段", baggage.length === 0);
for (const list of [registryFailures, shapeFailures, parseFailures, baggage]) {
  for (const line of list.slice(0, 5)) console.log("      - " + line);
}

// ── 2. contribution schemas ─────────────────────────────────────────────
const schemaEntries = PANEL_MANIFEST.schemas ?? [];
check("contribution schemas 都是 create() 工厂", schemaEntries.every((entry) => typeof entry.create === "function"));
console.log("      contribution schemas=" + schemaEntries.length);

// ── 3. 浏览器束里的字面量也必须同形 ─────────────────────────────────────
const bundle = readFileSync(new URL("./lib/client.js", import.meta.url), "utf8");
const literals = [...bundle.matchAll(/mode:\s*"strict"/g)].length;
check("浏览器束里存在 strict codec 字面量（不是空跑）", literals > 0);
check("浏览器束里没有残留的 schema 字段写法", !/mode:\s*"strict"[\s\S]{0,80}?schema:/.test(bundle));
console.log("      bundle strict literals=" + literals);

console.log(failures === 0 ? "ALL CODEC CONTRACT TESTS PASSED" : failures + " FAILURES");
process.exit(failures === 0 ? 0 : 1);
