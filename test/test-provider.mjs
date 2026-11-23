import assert from "node:assert/strict";
import { mkdtemp, mkdir, rename, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NestedSkillProvider } from "../lib/provider.js";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

// 用临时 DSH_HOME / DSH_AGENTS_HOME 隔离 homes()，不触碰真实技能树。
const base = await mkdtemp(join(tmpdir(), "dsh-panel-provider-"));
process.env.DSH_HOME = join(base, ".dsh");
process.env.DSH_AGENTS_HOME = join(base, ".agents");
const agentsSkills = join(process.env.DSH_AGENTS_HOME, "skills");
const dshSkills = join(process.env.DSH_HOME, "skills");
// 提供方会真的挂上监听器：无论断言成败都要 abort，否则进程不退出。
const listing = new AbortController();
const watching = new AbortController();

try {
  const md = (name, description = name, extra = "") =>
    `---\nname: ${name}\ndescription: ${description}${extra}\n---\n# ${name}\nbody of ${name}\n`;
  const writeSkill = async (rel, name, extra) => {
    const root = join(agentsSkills, rel);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "SKILL.md"), md(name, name, extra));
  };

  await mkdir(agentsSkills, { recursive: true });
  await mkdir(dshSkills, { recursive: true });
  await writeSkill("lark-cli/lark-approval", "lark-approval");
  await writeSkill("mattpocock/grilling", "grilling");
  await writeSkill("category/model-locked", "model-locked", "\ndisable-model-invocation: true");
  await writeSkill("top-skill", "top-skill"); // 深度 1：归官方扁平加载器，provider 不收
  await mkdir(join(agentsSkills, "lark-cli", "disabled-skill"), { recursive: true });
  await writeFile(join(agentsSkills, "lark-cli", "disabled-skill", "SKILL.md.disabled"), md("disabled-skill"));
  await writeFile(join(agentsSkills, "flat-note.md"), md("flat-note"));

  const provider = new NestedSkillProvider(300, listing.signal, () => {});
  const candidates = await provider.list({});

  const names = candidates.map((c) => c.name).sort();
  assert.deepEqual(names, ["grilling", "lark-approval", "model-locked"], "只收深度>=2 且启用的嵌套技能");
  pass("list(): 深度>=2 收集，深度1/停用/扁平/单文件被排除");

  const approval = candidates.find((c) => c.name === "lark-approval");
  assert.equal(approval.rank, 300);
  assert.equal(approval.provider, "nested");
  assert.equal(approval.locator.directory, join(agentsSkills, "lark-cli", "lark-approval"));
  assert.equal(approval.source, "user-agents");
  pass("list(): 候选字段（rank/provider/locator/source）");

  const locked = candidates.find((c) => c.name === "model-locked");
  assert.equal(locked.invocation.modelInvocable, false, "disable-model-invocation: true → 模型不可调用");
  assert.equal(locked.invocation.userInvocable, true);
  pass("list(): invocation 策略来自 frontmatter");

  const skill = await provider.get(approval, {});
  assert.equal(skill.content, "# lark-approval\nbody of lark-approval");
  assert.equal(skill.provider, "nested");
  assert.equal(skill.path, approval.locator.path);
  pass("get(): 返回完整定义（content/body）");

  // 监听回归：根本身就在点目录里（与真实 ~/.agents、~/.dsh 同形）。旧的 ignored 判据按绝对路径
  // 逐段判断，".agents" 一段就让整棵树被忽略，嵌套技能停用/删除后注册表永远不失效。
  const WATCH_READY_MS = 800;
  const WATCH_TIMEOUT_MS = 4000;
  const WATCH_POLL_MS = 100;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let invalidations = 0;
  new NestedSkillProvider(300, watching.signal, () => { invalidations += 1; });
  await sleep(WATCH_READY_MS);
  const watchedFile = join(agentsSkills, "mattpocock", "grilling", "SKILL.md");
  await rename(watchedFile, watchedFile + ".disabled");
  for (let waited = 0; invalidations === 0 && waited < WATCH_TIMEOUT_MS; waited += WATCH_POLL_MS) await sleep(WATCH_POLL_MS);
  assert.ok(invalidations > 0, "点目录根下的 SKILL.md 改名没有触发 invalidate");
  pass("watcher: ~/.agents 这类点目录根下的改动也会让注册表失效");

  console.log(`\nprovider tests: ${passed} passed`);
} finally {
  listing.abort();
  watching.abort();
  await rm(base, { recursive: true, force: true });
}
