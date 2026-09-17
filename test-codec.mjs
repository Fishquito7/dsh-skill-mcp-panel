/**
 * 回归守卫：Typert strict codec 必须同时满足两代 harness 契约。
 *
 * 背景
 *   上游 commit e459e32637（perf(typert): materialize generated schemas on first use）
 *   把 strict codec 从"直接持有 schema"改成"持有 schema 工厂 create()"，并随
 *   @deepseek-ai/dsh-typert-registry@0.1.6-alpha.2 发布。
 *
 *   本插件此前手写 43 处 { mode: "strict", typeSymbol, schema } 字面量，在 alpha.2 上
 *   注册即抛 "strict codec has no create() factory" —— 插件树加载失败，dsh 直接退出
 *   （Issue #20）。而 0.1.5-rc.2 及更早（含 0.1.6-alpha.1）仍要求 schema.parse。
 *
 * 修复
 *   每个 codec 同时携带 schema 与 create（见 src/codec.ts）。两代实现都只做 typeof
 *   检查、都不拒绝多余属性，因此一份构建同时通过两边，无需版本探测。
 *
 * 本测试锁住该契约：
 *   1. 运行时遍历 PANEL_MANIFEST 的每一个 codec，跑两代 harness 的真实校验谓词；
 *   2. 静态校验浏览器束 lib/client.js —— 它是自包含束、不能 import，无法复用
 *      strictCodec，必须与 helper 同形。
 *
 * 下面的谓词逐字抄自已发布的 harness 实现，来源已标注行号。
 */
import { readFileSync } from "node:fs";
import { PANEL_MANIFEST } from "./lib/index.js";

let failures = 0;
const check = (label, cond) => {
  console.log((cond ? "PASS" : "FAIL") + "  " + label);
  if (!cond) failures++;
};

// ── 两代 harness 的真实校验谓词（逐字抄录）────────────────────────────────
const validateNonempty = (subject, value) => {
  if (typeof value !== "string" || value.length === 0) throw new Error("typert: " + subject + " must be a non-empty string");
};

/** 0.1.5-rc.2 dsh-typert-registry/lib/types/service.js:578-585 */
const oldRegistryValidateCodec = (codec, subject) => {
  if (codec.mode === "src-json") return;
  validateNonempty(subject + " type symbol", codec.typeSymbol);
  if (typeof codec.schema.parse !== "function") {
    throw new Error("typert: " + subject + " strict codec has no parse() method");
  }
};

/** 0.1.5-rc.2 dsh-typert-loader/lib/index.js:206-211 */
const oldLoaderRequireStrictCodec = (pkgName, codec, subject) => {
  if (codec.mode !== "strict") throw new Error("typert-loader: " + pkgName + " " + subject + " must use a strict codec");
  validateNonempty("typeSymbol", codec.typeSymbol);
  if (typeof codec.schema !== "object" || codec.schema === null || !("_zod" in codec.schema) || typeof codec.schema.parse !== "function") {
    throw new Error("typert-loader: " + pkgName + " " + subject + " is not backed by a zod v4 schema");
  }
};

/** 0.1.6-alpha.2 dsh-typert-registry/lib/types/service.js:591-598 */
const newRegistryValidateCodec = (codec, subject) => {
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

const oldRegistryFailures = [];
const oldLoaderFailures = [];
const newRegistryFailures = [];
const shapeFailures = [];
const parseFailures = [];

for (const [subject, codec] of codecs) {
  try { oldRegistryValidateCodec(codec, subject); } catch (error) { oldRegistryFailures.push(subject + ": " + error.message); }
  try { oldLoaderRequireStrictCodec(PANEL_MANIFEST.package, codec, subject); } catch (error) { oldLoaderFailures.push(subject + ": " + error.message); }
  try { newRegistryValidateCodec(codec, subject); } catch (error) { newRegistryFailures.push(subject + ": " + error.message); }
  // create() 必须可重复调用且返回同一个 schema（新运行时用 record.value ??= create() 缓存）
  if (typeof codec.create !== "function") { shapeFailures.push(subject); continue; }
  const first = codec.create();
  if (first !== codec.create()) shapeFailures.push(subject + ": create() 非幂等");
  if (first !== codec.schema) shapeFailures.push(subject + ": create() 返回值与 schema 不一致");
  if (typeof first?.parse !== "function") parseFailures.push(subject);
}

check("旧 registry 校验通过（0.1.5-rc.2 / 0.1.6-alpha.1）", oldRegistryFailures.length === 0);
check("旧 loader 校验通过（要求真实 zod v4 schema）", oldLoaderFailures.length === 0);
check("新 registry 校验通过（0.1.6-alpha.2+）", newRegistryFailures.length === 0);
check("create() 幂等且与 schema 同源", shapeFailures.length === 0);
check("create() 返回值可 parse", parseFailures.length === 0);
for (const list of [oldRegistryFailures, oldLoaderFailures, newRegistryFailures, shapeFailures, parseFailures]) {
  for (const line of list.slice(0, 5)) console.log("      - " + line);
}

// contribution 级 schemas：新运行时要求 create() 工厂（旧运行时要求 schema）
const schemaEntries = PANEL_MANIFEST.schemas ?? [];
check("contribution schemas 同时满足两代契约", schemaEntries.every((entry) =>
  typeof entry.create === "function" && typeof entry.schema?._zod === "object"));
console.log("      contribution schemas=" + schemaEntries.length);

// ── 2. 浏览器束 lib/client.js（自包含，无法 import strictCodec）──────────
const clientSource = readFileSync(new URL("./lib/client.js", import.meta.url), "utf8");
const literals = [];
for (let index = clientSource.indexOf('mode: "strict"'); index !== -1; index = clientSource.indexOf('mode: "strict"', index + 1)) {
  literals.push(clientSource.slice(index, index + 240));
}
check("client 束存在 strict codec 字面量", literals.length > 0);
check("client 束每个 codec 同时带 schema 与 create", literals.length > 0 && literals.every((window) => window.includes("schema:") && /create:\s*\(/.test(window)));

console.log(failures === 0 ? "ALL CODEC CONTRACT TESTS PASSED" : failures + " FAILURES");
process.exit(failures === 0 ? 0 : 1);
