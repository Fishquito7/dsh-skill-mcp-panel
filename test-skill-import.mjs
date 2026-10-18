/**
 * dsh-skill-mcp-panel —— 「添加技能」结构识别回归（bug fix 2.1.6）。
 *
 * 覆盖两类真实故障：
 *   1. 文件夹选择器丢掉被选中文件夹的名字 ⇒ 合法技能包被误报「缺少顶层 SKILL.md」；
 *   2. 技能包顶层的依赖 .md 被当成独立技能校验 ⇒ 误报「技能格式不符合要求」。
 *
 * 分两层：
 *   A. 分类器单元矩阵（lib/skill-import.js，纯路径）；
 *   B. 端到端：真的跑 `dsh-panel skill add`，验证落盘形态与部分成功回报。
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { strToU8, zipSync } from "fflate";
import { classifySkillImport, describeSkips, expandTopLevelZips } from "./lib/skill-import.js";

let passed = 0;
let failed = 0;
const check = (label, fn) => {
	try {
		fn();
		passed += 1;
		console.log("PASS  " + label);
	} catch (error) {
		failed += 1;
		console.log("FAIL  " + label + "\n      " + (error instanceof Error ? error.message : String(error)));
	}
};

const md = (name, description = name) => "---\nname: " + name + "\ndescription: " + description + "\n---\n# " + name + "\n";

// ── A. 分类器单元矩阵 ────────────────────────────────────────────────────

check("技能包：文件夹选择（SKILL.md + references/）识别为一个技能包", () => {
	const plan = classifySkillImport([
		{ path: "grill-with-docs/SKILL.md" },
		{ path: "grill-with-docs/references/ADR-FORMAT.md" },
		{ path: "grill-with-docs/references/GLOSSARY-FORMAT.md" }
	]);
	assert.equal(plan.candidates.length, 1);
	assert.equal(plan.candidates[0].kind, "bundle");
	assert.equal(plan.candidates[0].skillFile, "grill-with-docs/SKILL.md");
	assert.deepEqual(plan.candidates[0].files.map((file) => file.relative), ["SKILL.md", "references/ADR-FORMAT.md", "references/GLOSSARY-FORMAT.md"]);
	assert.deepEqual(plan.skipped, []);
});

check("技能包：顶层平铺依赖 .md 是载荷，不单独算技能", () => {
	const plan = classifySkillImport([
		{ path: "powerpoint/SKILL.md" },
		{ path: "powerpoint/editing.md" },
		{ path: "powerpoint/pptxgenjs.md" },
		{ path: "powerpoint/scripts/add_slide.py" }
	]);
	assert.equal(plan.candidates.length, 1);
	assert.equal(plan.candidates[0].kind, "bundle");
	const rels = plan.candidates[0].files.map((file) => file.relative);
	assert.ok(rels.includes("editing.md"), "editing.md 必须作为载荷随包复制");
	assert.ok(rels.includes("pptxgenjs.md"), "pptxgenjs.md 必须作为载荷随包复制");
	assert.ok(rels.includes("scripts/add_slide.py"));
	assert.deepEqual(plan.skipped, [], "依赖文档不该被当成技能校验");
});

check("技能包内部的子 SKILL.md 不再单独算技能", () => {
	const plan = classifySkillImport([{ path: "pack/SKILL.md" }, { path: "pack/sub/SKILL.md" }]);
	assert.equal(plan.candidates.length, 1);
	assert.ok(plan.candidates[0].files.some((file) => file.relative === "sub/SKILL.md"));
});

check("技能容器：直属子项是技能 ⇒ 全部发现并各自拍平", () => {
	const plan = classifySkillImport([
		{ path: "container/beta/SKILL.md" },
		{ path: "container/alpha/SKILL.md" },
		{ path: "container/gamma.md" },
		{ path: "container/notes.txt" }
	]);
	assert.deepEqual(plan.candidates.map((candidate) => [candidate.kind, candidate.source]), [
		["bundle", "container/alpha"],
		["bundle", "container/beta"],
		["flat", "gamma.md"]
	]);
	assert.equal(plan.candidates[2].skillFile, "container/gamma.md", "散装候选必须保留完整路径才能取到字节");
	assert.equal(plan.candidates[2].files[0].relative, "gamma.md");
	assert.equal(plan.skipped.length, 1);
	assert.equal(plan.skipped[0].name, "notes.txt");
});

check("散装文件选择：每个 .md 一个技能", () => {
	const plan = classifySkillImport([{ path: "a.md" }, { path: "b.md" }, { path: "notes.txt" }]);
	assert.deepEqual(plan.candidates.map((candidate) => candidate.kind), ["flat", "flat"]);
	assert.equal(plan.skipped.length, 1);
});

check("散装单个 SKILL.md：整体识别为一个技能包（不再报格式错）", () => {
	const plan = classifySkillImport([{ path: "SKILL.md" }]);
	assert.equal(plan.candidates.length, 1);
	assert.equal(plan.candidates[0].kind, "bundle");
	assert.deepEqual(plan.candidates[0].files.map((file) => file.relative), ["SKILL.md"]);
});

check("深层分类目录：递归发现（与列表扫描同一套规则）", () => {
	const plan = classifySkillImport([
		{ path: "backup/category/deep/skill-a/SKILL.md" },
		{ path: "backup/category/deep/skill-b/SKILL.md" }
	]);
	assert.deepEqual(plan.candidates.map((candidate) => candidate.source), ["backup/category/deep/skill-a", "backup/category/deep/skill-b"]);
});

check("隐藏目录与 node_modules 被跳过", () => {
	const plan = classifySkillImport([
		{ path: "root/.hidden/SKILL.md" },
		{ path: "root/node_modules/pkg/SKILL.md" },
		{ path: "root/real/SKILL.md" }
	]);
	assert.deepEqual(plan.candidates.map((candidate) => candidate.source), ["root/real"]);
});

check("递归深度上限：第 8 层内的技能包可见，第 9 层不可见", () => {
	const chain = (count) => Array.from({ length: count }, (_, index) => "n" + (index + 1)).join("/");
	const withFlat = (deep) => [{ path: "flat.md" }, { path: deep + "/SKILL.md" }];
	const found = classifySkillImport(withFlat(chain(8)));
	const beyond = classifySkillImport(withFlat(chain(9)));
	assert.equal(found.candidates.filter((candidate) => candidate.kind === "bundle").length, 1);
	assert.equal(beyond.candidates.filter((candidate) => candidate.kind === "bundle").length, 0);
});

check("顶层 zip 展开并过滤 __MACOSX；文件夹内的 zip 不展开", () => {
	const archive = zipSync({
		"my-skill/SKILL.md": strToU8(md("my-skill")),
		"my-skill/references/notes.md": strToU8("notes"),
		"__MACOSX/._junk": strToU8("junk")
	});
	const expanded = expandTopLevelZips([{ path: "s.zip", data: Buffer.from(archive) }]);
	assert.deepEqual(expanded.map((entry) => entry.path).sort(), ["my-skill/SKILL.md", "my-skill/references/notes.md"]);
	const plan = classifySkillImport(expanded);
	assert.deepEqual(plan.candidates.map((candidate) => candidate.kind), ["bundle"]);

	const nested = [{ path: "folder/asset.zip", data: Buffer.from(archive) }];
	assert.deepEqual(expandTopLevelZips(nested).map((entry) => entry.path), ["folder/asset.zip"]);
});

check("describeSkips 只展示前 3 条并汇总总数", () => {
	const text = describeSkips([
		{ name: "a", reason: "r1" },
		{ name: "b", reason: "r2" },
		{ name: "c", reason: "r3" },
		{ name: "d", reason: "r4" }
	]);
	assert.ok(text.includes("a（r1）") && text.includes("c（r3）") && !text.includes("d（r4）"));
	assert.ok(text.includes("共 4 项"));
});

// ── B. 端到端：真的跑 CLI ────────────────────────────────────────────────

const CLI_PATH = fileURLToPath(new URL("./lib/cli.js", import.meta.url));
const workdir = await mkdtemp(join(tmpdir(), "dsh-panel-import-"));
const source = join(workdir, "source");
const project = join(workdir, "project");
const home = join(workdir, "home");
const skillRoot = join(project, ".dsh", "skills");

async function writeSource(relative, content) {
	await mkdir(join(source, relative, ".."), { recursive: true });
	await writeFile(join(source, relative), content);
}

function runAdd(target) {
	return spawnSync(process.execPath, [CLI_PATH, "skill", "add", target, "--cwd", project, "--project"], {
		cwd: project,
		encoding: "utf8",
		env: { ...process.env, DSH_HOME: home, DSH_AGENTS_HOME: join(workdir, "agents") }
	});
}

/** 同一条命令但目标是**全局**根：用于跨作用域同名（工作区已有 / 目标为全局）。 */
function runAddGlobal(target) {
	return spawnSync(process.execPath, [CLI_PATH, "skill", "add", target, "--cwd", project], {
		cwd: project,
		encoding: "utf8",
		env: { ...process.env, DSH_HOME: home, DSH_AGENTS_HOME: join(workdir, "agents") }
	});
}

const listStray = () => (existsSync(skillRoot) ? readdirSync(skillRoot).filter((name) => name.startsWith(".dsh-skill-staging-")) : []);

try {
	mkdirSync(join(project, ".git"), { recursive: true });
	mkdirSync(source, { recursive: true });

	// 形状 1：技能包 + references/（grill-with-docs 真实形状）
	await writeSource("grill-with-docs/SKILL.md", md("grill-with-docs"));
	await writeSource("grill-with-docs/references/ADR-FORMAT.md", "# ADR");
	// 形状 2：技能包 + 顶层平铺依赖 .md（powerpoint 真实形状）
	await writeSource("powerpoint/SKILL.md", md("powerpoint"));
	await writeSource("powerpoint/editing.md", "# Editing\n\n没有 frontmatter 的依赖文档。");
	await writeSource("powerpoint/pptxgenjs.md", "# PptxGenJS\n\n没有 frontmatter 的依赖文档。");
	await writeSource("powerpoint/scripts/add_slide.py", "print('hi')\n");
	// 形状 3：技能容器（三个技能平铺）
	await writeSource("bundle/alpha/SKILL.md", md("alpha"));
	await writeSource("bundle/beta/SKILL.md", md("beta"));
	await writeSource("bundle/gamma.md", md("gamma"));
	await writeSource("bundle/notes.txt", "not a skill\n");

	check("CLI：添加技能包（含 references/）成功落盘为目录束", () => {
		const run = runAdd(join(source, "grill-with-docs"));
		assert.equal(run.status, 0, run.stderr);
		assert.ok(existsSync(join(skillRoot, "grill-with-docs", "SKILL.md")), "SKILL.md 应在技能目录里");
		assert.ok(existsSync(join(skillRoot, "grill-with-docs", "references", "ADR-FORMAT.md")));
		assert.ok(!existsSync(join(skillRoot, "SKILL.md")), "不该在技能根写散装 SKILL.md");
	});

	check("CLI：技能包顶层的依赖 .md 作为载荷随包复制，不报格式错", () => {
		const run = runAdd(join(source, "powerpoint"));
		assert.equal(run.status, 0, run.stderr);
		assert.ok(!run.stdout.includes("技能格式不符合要求"), run.stdout);
		assert.ok(existsSync(join(skillRoot, "powerpoint", "SKILL.md")));
		assert.ok(existsSync(join(skillRoot, "powerpoint", "editing.md")));
		assert.ok(existsSync(join(skillRoot, "powerpoint", "pptxgenjs.md")));
		assert.ok(existsSync(join(skillRoot, "powerpoint", "scripts", "add_slide.py")));
	});

	check("CLI：技能容器批量添加，三个技能拍平到第一层并报告跳过项", () => {
		const run = runAdd(join(source, "bundle"));
		assert.equal(run.status, 0, run.stderr);
		assert.ok(existsSync(join(skillRoot, "alpha", "SKILL.md")));
		assert.ok(existsSync(join(skillRoot, "beta", "SKILL.md")));
		assert.ok(existsSync(join(skillRoot, "gamma.md")), "容器里的散装 .md 应落为单文件技能");
		assert.ok(!existsSync(join(skillRoot, "notes.txt")), "非 .md 文件必须被跳过");
		assert.ok(run.stdout.includes('已跳过 "notes.txt"'), run.stdout);
		assert.ok(!existsSync(join(skillRoot, "bundle")), "容器本身不该落盘");
	});

	check("CLI：同一作用域内重复添加全部跳过时报错（一个都没成功），已有技能不受影响", () => {
		const before = readdirSync(skillRoot).filter((name) => !name.startsWith(".dsh-skill-staging-")).sort();
		const run = runAdd(join(source, "bundle"));
		assert.equal(run.status, 1, "一个都没添加成功时必须报错");
		assert.ok((run.stdout + run.stderr).includes("已存在于目标作用域"), run.stdout + run.stderr);
		assert.deepEqual(readdirSync(skillRoot).filter((name) => !name.startsWith(".dsh-skill-staging-")).sort(), before);
	});

	// 跨作用域同名是合法状态：DSH 按根优先级裁决，别的作用域不在本会话的发现链上。
	check("CLI：跨作用域同名不再拒绝——工作区已有 alpha/beta/gamma，仍可添加到全局并回报提示", () => {
		const run = runAddGlobal(join(source, "bundle"));
		assert.equal(run.status, 0, run.stdout + run.stderr);
		assert.ok(run.stdout.includes('已添加技能 "alpha"'), run.stdout);
		assert.ok(run.stdout.includes("同名技能已存在于其他作用域"), run.stdout);
		assert.ok(existsSync(join(home, "skills", "alpha", "SKILL.md")), "全局根应落盘");
		assert.ok(existsSync(join(skillRoot, "alpha", "SKILL.md")), "工作区里那一份必须原样保留");
	});

	check("CLI：同一作用域内同名仍然是硬冲突（全局再加一遍会全部跳过）", () => {
		const globalRoot = join(home, "skills");
		const before = readdirSync(globalRoot).filter((name) => !name.startsWith(".dsh-skill-staging-")).sort();
		const run = runAddGlobal(join(source, "bundle"));
		assert.equal(run.status, 1, "同一作用域重名必须一个都添加不了");
		assert.ok((run.stdout + run.stderr).includes("已存在于目标作用域"), run.stdout + run.stderr);
		assert.deepEqual(readdirSync(globalRoot).filter((name) => !name.startsWith(".dsh-skill-staging-")).sort(), before);
	});

	check("CLI：全程不残留暂存目录", () => {
		assert.deepEqual(listStray(), []);
		const globalRoot = join(home, "skills");
		assert.deepEqual(existsSync(globalRoot) ? readdirSync(globalRoot).filter((name) => name.startsWith(".dsh-skill-staging-")) : [], []);
	});
} finally {
	await rm(workdir, { recursive: true, force: true });
}

// ── C. 宿主 addSkill 端到端（面板真正调用的那条路）───────────────────────

const checkAsync = async (label, fn) => {
	try {
		await fn();
		passed += 1;
		console.log("PASS  " + label);
	} catch (error) {
		failed += 1;
		console.log("FAIL  " + label + "\n      " + (error instanceof Error ? error.message : String(error)));
	}
};

const hostWork = await mkdtemp(join(tmpdir(), "dsh-panel-host-add-"));
const hostHome = join(hostWork, "home");
const hostRoot = join(hostHome, "skills");
process.env.DSH_HOME = hostHome;
process.env.DSH_AGENTS_HOME = join(hostWork, "agents");
let gateway = null;
let gatewaySkip = "";
try {
	const { Context } = await import("@deepseek-ai/cordis");
	const { SkillsViewerGateway } = await import("./lib/index.js");
	const { collectSkillEntries } = await import("./lib/skill-files.js");
	const readEntries = () => collectSkillEntries([{ path: hostRoot, source: "user-dsh", projectRoot: undefined }]);
	const ctx = new Context();
	ctx.provide("skills", {
		async list() {
			return (await readEntries()).map((entry) => ({ name: entry.name, description: entry.description, invocation: { modelInvocable: true, userInvocable: true }, path: entry.file }));
		},
		async get(name) {
			const hit = (await readEntries()).find((entry) => entry.name === name);
			return hit === undefined ? undefined : { name: hit.name, description: hit.description, path: hit.file };
		}
	});
	const candidate = new SkillsViewerGateway(ctx);
	// 安全阀：确认宿主真的把技能根解析到临时目录，绝不碰真实 ~/.dsh/skills。
	if (resolve(candidate.homes().dshHome) === resolve(hostHome)) gateway = candidate;
	else gatewaySkip = "无法把 DSH_HOME 指向临时目录（" + candidate.homes().dshHome + "）";
} catch (error) {
	gatewaySkip = error instanceof Error ? error.message : String(error);
}

const payload = (entries) => entries.map(([path, text]) => ({ path, base64: Buffer.from(text).toString("base64") }));

try {
	if (gateway === null) {
		console.log("SKIP  宿主 addSkill 端到端（" + gatewaySkip + "）");
	} else {
		await checkAsync("宿主 addSkill：技能包（文件夹选择路径）落盘为一个技能包", async () => {
			const result = await gateway.addSkill(undefined, {
				kind: "auto",
				files: payload([
					["grill-with-docs/SKILL.md", md("grill-with-docs")],
					["grill-with-docs/references/ADR-FORMAT.md", "# ADR"]
				]),
				workspace: null
			});
			assert.deepEqual(result.added.map((item) => item.name), ["grill-with-docs"]);
			assert.equal(result.skipped.length, 0);
			assert.ok(existsSync(join(hostRoot, "grill-with-docs", "SKILL.md")));
			assert.ok(existsSync(join(hostRoot, "grill-with-docs", "references", "ADR-FORMAT.md")));
		});

		await checkAsync("宿主 addSkill：顶层平铺依赖 .md 随包落盘、不报格式错", async () => {
			const result = await gateway.addSkill(undefined, {
				kind: "auto",
				files: payload([
					["powerpoint/SKILL.md", md("powerpoint")],
					["powerpoint/editing.md", "# Editing（无 frontmatter）"],
					["powerpoint/pptxgenjs.md", "# PptxGenJS（无 frontmatter）"]
				]),
				workspace: null
			});
			assert.deepEqual(result.added.map((item) => item.name), ["powerpoint"]);
			assert.equal(result.skipped.length, 0);
			assert.ok(existsSync(join(hostRoot, "powerpoint", "editing.md")));
			assert.ok(existsSync(join(hostRoot, "powerpoint", "pptxgenjs.md")));
		});

		await checkAsync("宿主 addSkill：容器批量添加 + 部分成功（非法技能只跳过自己）", async () => {
			const result = await gateway.addSkill(undefined, {
				kind: "auto",
				files: payload([
					["bundle/alpha/SKILL.md", md("alpha")],
					["bundle/beta/SKILL.md", "---\nname: beta\n---\n缺 description"],
					["bundle/gamma/SKILL.md", md("gamma")],
					["bundle/notes.txt", "not a skill"]
				]),
				workspace: null
			});
			assert.deepEqual(result.added.map((item) => item.name).sort(), ["alpha", "gamma"]);
			assert.equal(result.skipped.length, 2, JSON.stringify(result.skipped));
			assert.ok(result.skipped.some((item) => item.name === "bundle/beta" && item.reason.includes("技能格式不符合要求")));
			assert.ok(result.skipped.some((item) => item.name === "notes.txt"));
			assert.ok(existsSync(join(hostRoot, "alpha", "SKILL.md")));
			assert.ok(existsSync(join(hostRoot, "gamma", "SKILL.md")));
			assert.ok(!existsSync(join(hostRoot, "beta")));
			assert.ok(!existsSync(join(hostRoot, "bundle")), "容器本身不该落盘");
		});

		await checkAsync("宿主 addSkill：全部重复时报错且不留下任何暂存目录", async () => {
			await assert.rejects(
				() => gateway.addSkill(undefined, { kind: "auto", files: payload([["bundle/alpha/SKILL.md", md("alpha")]]), workspace: null }),
				/没有可添加的技能/
			);
			assert.deepEqual(readdirSync(hostRoot).filter((name) => name.startsWith(".dsh-skill-staging-")), []);
		});
	}
} finally {
	await rm(hostWork, { recursive: true, force: true });
}

console.log("\n" + passed + " passed, " + failed + " failed");
console.log(failed === 0 ? "ALL SKILL IMPORT TESTS PASSED" : "SKILL IMPORT TESTS FAILED");
process.exit(failed === 0 ? 0 : 1);