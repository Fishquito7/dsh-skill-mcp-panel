import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PANEL_MANIFEST, SkillsViewerGateway } from "./lib/index.js";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const gateway = new SkillsViewerGateway(new Context());

// 面板管理的技能文件夹（用户根 + 工作区项目根）。
const roots = [
  { path: "/home/u/.dsh/skills" },
  { path: "/home/u/.agents/skills" },
  { path: "/work/proj/.dsh/skills" }
];

// 文件技能：官方 filesystem 提供方读的是这些根，面板能启停、能删除。
assert.equal(gateway.isPluginProvided({ provider: "filesystem", path: "/home/u/.dsh/skills/pdf/SKILL.md" }, roots), false);
assert.equal(gateway.isPluginProvided({ provider: "filesystem", path: "/work/proj/.dsh/skills/x/SKILL.md" }, roots), false);
// 本插件的嵌套提供方读的还是这些根里的文件，同样不是「插件自带」。
assert.equal(gateway.isPluginProvided({ provider: "nested", path: "/home/u/.agents/skills/lark/lark-approval/SKILL.md" }, roots), false);
pass("file-backed skills are not flagged as plugin-provided");

// 插件随包提供的技能：路径在包目录里，或者干脆没有路径。
assert.equal(gateway.isPluginProvided({ provider: "dsh-office", path: "/opt/dsh/resources/runtime/office-skills/docx/SKILL.md" }, roots), true);
assert.equal(gateway.isPluginProvided({ provider: "dsh-badge", source: "bundled" }, roots), true);
assert.equal(gateway.isPluginProvided({ provider: "some-plugin", path: "/home/u/.dsh/profiles/web/node_modules/some-plugin/skills/a/SKILL.md" }, roots), true);
pass("plugin-provided skills are flagged for the show/hide switch");

// list() 端到端：真扫一个临时 DSH_HOME，注册表行与文件行都要带上 pluginProvided，
// 并且整份 payload 必须过得了宿主边界的 strict codec。
const dir = await mkdtemp(join(tmpdir(), "dsh-panel-origin-"));
const previousHome = process.env.DSH_HOME;
const previousAgents = process.env.DSH_AGENTS_HOME;
process.env.DSH_HOME = join(dir, "home");
process.env.DSH_AGENTS_HOME = join(dir, "agents");
try {
  const skillFile = join(process.env.DSH_HOME, "skills", "local-skill", "SKILL.md");
  await mkdir(join(process.env.DSH_HOME, "skills", "local-skill"), { recursive: true });
  await writeFile(skillFile, "---\nname: local-skill\ndescription: a local skill\n---\n\nbody\n");
  const ctx = new Context();
  ctx.provide("skills", {
    list: async () => [
      { name: "local-skill", description: "a local skill", provider: "filesystem", source: "user-dsh", path: skillFile, invocation: { modelInvocable: true, userInvocable: true } },
      { name: "office-docx", description: "bundled office workflow", provider: "dsh-office", source: "bundled", invocation: { modelInvocable: true, userInvocable: true } }
    ]
  });
  ctx.provide("sessions", { list: () => [], get: () => undefined });
  const full = new SkillsViewerGateway(ctx);
  const result = await full.list(undefined);
  const byName = new Map(result.skills.map((skill) => [skill.name, skill]));
  assert.equal(byName.get("local-skill").pluginProvided, false, "a file skill must stay visible through the switch");
  assert.equal(byName.get("office-docx").pluginProvided, true, "a bundled plugin skill must be flaggable");
  const listInvocation = PANEL_MANIFEST.invocations.find((item) => item.id === "dsh-skill-mcp-panel#skillsViewer/list");
  assert.ok(listInvocation, "list invocation must be registered");
  assert.doesNotThrow(() => listInvocation.result.create().parse(result), "the payload must pass the strict wire codec");
  pass("list() tags every row and still satisfies the strict wire codec");
} finally {
  if (previousHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previousHome;
  if (previousAgents === undefined) delete process.env.DSH_AGENTS_HOME;
  else process.env.DSH_AGENTS_HOME = previousAgents;
  await rm(dir, { recursive: true, force: true });
}

console.log("\n" + passed + " passed, 0 failed");
console.log("ALL SKILL ORIGIN TESTS PASSED");
