/**
 * dsh-skill-mcp-panel —— 技能启停 / 删除回归（「开关、删除总是失败」）。
 *
 * 复现环境：DSH 桌面版 0.2.2-rc.5 / 0.2.3-alpha.2 + @michengai/dsh-skills-manager。
 * 插件自带技能的只读（#90）已由上游修掉，这里覆盖剩下的四类故障：
 *   A. 提供方把模型与用户调用都关掉（管理器策略停用）的注册表行一律显示「已启用」。
 *   B. 注册表目录按 revision 缓存，面板写盘后没人让它失效 ⇒ 刷新回来还是旧状态，
 *      开关「弹回去」、删掉的行「又回来」，再点一次删除报 ENOENT / 「不存在」。
 *   C. SKILL.md 与 SKILL.md.disabled 并存（publisher-skill 每次启动补回 SKILL.md）⇒
 *      停用报「目标文件已存在」。
 *   D. 托管文件已启用、但被管理器策略停用：「启用」静默无效。
 *
 * 注册表用带缓存的最小实现（与 @deepseek-ai/dsh-skill 的 collectCache 同语义），
 * 提供方模拟技能管理器的覆盖行；全部落在临时目录，不触碰真实技能。
 */
import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PANEL_MANIFEST, SkillsViewerGateway } from "../lib/index.js";

const MANAGER = "dsh-skills-manager-external";
const ENABLED = { modelInvocable: true, userInvocable: true };
const DISABLED = { modelInvocable: false, userInvocable: false };

let passed = 0;
let failed = 0;
const check = async (label, fn) => {
  try {
    await fn();
    passed += 1;
    console.log("PASS  " + label);
  } catch (error) {
    failed += 1;
    console.log("FAIL  " + label + "\n      " + (error instanceof Error ? error.message : String(error)));
  }
};

const base = await mkdtemp(join(tmpdir(), "dsh-panel-hot-ops-"));
const previous = { home: process.env.DSH_HOME, agents: process.env.DSH_AGENTS_HOME };
process.env.DSH_HOME = join(base, ".dsh");
process.env.DSH_AGENTS_HOME = join(base, ".agents");
const agentsRoot = join(process.env.DSH_AGENTS_HOME, "skills");
const dshRoot = join(process.env.DSH_HOME, "skills");
const foreignRoot = join(base, ".codex", "skills");
const md = (name, tail = "") => "---\nname: " + name + "\ndescription: " + name + " skill\n---\nbody of " + name + tail + "\n";
const putSkill = async (root, name, file = "SKILL.md", tail = "") => {
  await mkdir(join(root, name), { recursive: true });
  await writeFile(join(root, name, file), md(name, tail));
};

/** 模拟技能管理器：给托管根与外部根里的技能各出一行覆盖候选；policyOff 里的名字 invocation 全关。 */
const policyOff = new Set();
const scanRoot = async (root, source, invocationOf) => {
  const names = existsSync(root) ? await readdir(root) : [];
  return names
    .filter((name) => existsSync(join(root, name, "SKILL.md")))
    .map((name) => ({ name, description: name + " skill", provider: MANAGER, source, path: join(root, name, "SKILL.md"), invocation: invocationOf(name) }));
};

/** 带缓存的最小注册表：目录一直缓存到 invalidate()。 */
const createRegistry = () => {
  let cache;
  const collect = async () => {
    cache ??= [
      ...(await scanRoot(agentsRoot, "agent-agents", (name) => (policyOff.has(name) ? DISABLED : ENABLED))),
      ...(await scanRoot(foreignRoot, "agent-codex", () => DISABLED))
    ];
    return cache;
  };
  const registry = {
    invalidations: 0,
    list: async () => collect(),
    get: async (name) => (await collect()).find((row) => row.name === name),
    invalidate: () => {
      registry.invalidations += 1;
      cache = undefined;
    }
  };
  return registry;
};

/** 网关接上注册表的 invalidate，与 apply() 里接嵌套提供方登记拿到的 control.invalidate 同形。 */
const createGateway = (registry) => {
  const ctx = new Context();
  ctx.provide("skills", registry);
  ctx.provide("sessions", { list: () => [], get: () => undefined });
  return new SkillsViewerGateway(ctx, () => registry.invalidate());
};
const rowsOf = async (gateway) => new Map((await gateway.list(undefined)).skills.map((skill) => [skill.name, skill]));
const rejects = async (run, pattern) => {
  await assert.rejects(run, (error) => {
    assert.match(error.message, pattern);
    return true;
  });
};

try {
  await putSkill(agentsRoot, "docx");
  await putSkill(agentsRoot, "pdf");
  await putSkill(foreignRoot, "codex-log-manager");
  await putSkill(dshRoot, "publisher");
  await putSkill(dshRoot, "publisher", "SKILL.md.disabled");
  await putSkill(dshRoot, "edited");
  await putSkill(dshRoot, "edited", "SKILL.md.disabled", "\nlocal edits");

  const registry = createRegistry();
  const gateway = createGateway(registry);

  await check("A. 管理器策略停用的外部来源行：显示已停用（不是「已启用」），且通过 strict codec", async () => {
    const result = await gateway.list(undefined);
    const row = result.skills.find((skill) => skill.name === "codex-log-manager");
    assert.equal(row.enabled, false, "invocation 全关的行不能显示为启用");
    assert.equal(row.pluginProvided, true);
    const listInvocation = PANEL_MANIFEST.invocations.find((item) => item.id === "dsh-skill-mcp-panel#skillsViewer/list");
    assert.doesNotThrow(() => listInvocation.result.create().parse(result));
  });

  await check("B. 停用写盘后立即让注册表失效，刷新看到的就是已停用", async () => {
    const before = registry.invalidations;
    await gateway.setEnabled("docx", undefined, false, "global");
    assert.ok(registry.invalidations > before, "setEnabled 之后没有让注册表失效");
    const row = (await rowsOf(gateway)).get("docx");
    assert.equal(row.enabled, false, "刷新后开关弹回了启用");
    await gateway.setEnabled("docx", undefined, true, "global");
    assert.equal((await rowsOf(gateway)).get("docx").enabled, true);
  });

  await check("B. 删除写盘后立即让注册表失效，行不会「又回来」", async () => {
    const before = registry.invalidations;
    await gateway.deleteSkill("docx", undefined, "global");
    assert.ok(registry.invalidations > before, "deleteSkill 之后没有让注册表失效");
    assert.equal((await rowsOf(gateway)).has("docx"), false, "删掉的技能刷新后又出现了");
    await putSkill(agentsRoot, "docx");
    registry.invalidate();
  });

  await check("C. SKILL.md 与内容相同的 SKILL.md.disabled 并存：停用成功，只留一份", async () => {
    await gateway.setEnabled("publisher", undefined, false, "global");
    assert.deepEqual(readdirSync(join(dshRoot, "publisher")), ["SKILL.md.disabled"]);
  });

  await check("C. 并存副本内容不同：拒绝覆盖，两份都保留", async () => {
    await rejects(() => gateway.setEnabled("edited", undefined, false, "global"), /内容不同/);
    assert.deepEqual(readdirSync(join(dshRoot, "edited")).sort(), ["SKILL.md", "SKILL.md.disabled"]);
  });

  await check("D. 托管文件被管理器策略停用：显示已停用，「启用」明确报错而不是静默无效", async () => {
    policyOff.add("pdf");
    registry.invalidate();
    assert.equal((await rowsOf(gateway)).get("pdf").enabled, false);
    await rejects(() => gateway.setEnabled("pdf", undefined, true, "global"), /仍把它标为不可调用/);
    assert.ok(existsSync(join(agentsRoot, "pdf", "SKILL.md")), "策略停用的技能文件不应被改名");
  });
} finally {
  if (previous.home === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previous.home;
  if (previous.agents === undefined) delete process.env.DSH_AGENTS_HOME;
  else process.env.DSH_AGENTS_HOME = previous.agents;
  await rm(base, { recursive: true, force: true });
}

console.log("\n" + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
console.log("ALL SKILL HOT-OPS TESTS PASSED");
