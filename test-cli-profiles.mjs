/**
 * 回归守卫：dsh-panel 的 profile 契约。
 *
 * 背景
 *   dsh-panel 是全局单例 shim（%APPDATA%/npm/dsh-panel.cmd），内容指向**最后启动的那
 *   个 profile** 的 lib/cli.js。而每个 profile 各自装一份插件。于是「命令读到的版本」
 *   和「命令要操作的目标」是两个互相独立的量：
 *     - currentVersion() 读的是正在执行的那份副本（src/version.ts）
 *     - --profile 只决定 spawn 出去的 dsh plugin 参数（src/cli-skill.ts）
 *   旧实现拿前者去比 GitHub 最新版、用后者当唯一目标，默认还写死 web。结果：
 *   shim 指向 desktop 时，dsh-panel update 会拿 desktop 的版本判断 web 是否需要更新，
 *   两边一旦错位就静默跳过或重复安装。
 *
 *   另外 dsh plugin --profile <错名> 不会报错——它会 initProfile 出一个新 profile
 *   （dsh-plugin-manager/lib/types/operations.js 的 runPluginCommand）。所以错名必须由
 *   本插件在派发之前挡掉。
 *
 * 本测试锁住四件事
 *   1. 静态：mcp 子命令不再有默认 profile，缺 --profile 与错名都以退出码 2 拒绝，且拒绝时
 *      profiles 目录一个字节都不变（不新建 profile）；skill 不要求 --profile（技能按用户根 /
 *      工作区存放，不按 profile 分家），但给了错名同样拒绝；
 *   2. 动态：update 不带 --profile 会遍历全部 profile，对比基准是**每个 profile 自己
 *      已装的版本**，不是正在执行的那份副本；
 *   3. 动态：desktop（Electron 独占）在自动枚举时被跳过而不是拖垮整次更新，显式指定时
 *      以退出码 2 报错且不派发 dsh plugin；
 *   4. 静态 + 动态：package.json 声明的 DSH peer 区间真的能被 DSH 自己的
 *      evaluatePluginCompatibility 接受——这个函数是 profile 启动时的硬闸门，区间写错
 *      会让用户的 profile 直接起不来。
 *
 * 全程离线：GitHub API 用 --import 注入的 fetch 桩顶掉，dsh plugin 用一个记录 argv 的
 * 假 dsh 顶掉。定位不到 @deepseek-ai/dsh-app-boot 时第 4 部分降级 SKIP，不制造假红。
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

let failures = 0;
let passed = 0;
const check = (label, cond, detail) => {
	if (cond) {
		passed += 1;
		console.log("PASS  " + label);
	} else {
		failures += 1;
		console.log("FAIL  " + label + (detail === undefined ? "" : "  <- " + detail));
	}
};

const LATEST = "9.9.9";
const ENTRY_VERSION = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;
const CLI_PATH = fileURLToPath(new URL("./lib/cli.js", import.meta.url));

const base = join(tmpdir(), "dsh-panel-profiles-" + process.pid);
const home = join(base, "home");
const profilesDir = join(home, "profiles");
const binDir = join(base, "bin");
const callsLog = join(base, "dsh-calls.log");
const fetchStub = join(base, "fetch-stub.mjs");

/** 造一个 profile 目录；version 为 null 表示没装本插件。 */
function makeProfile(name, version, mounts) {
	const dir = join(profilesDir, name);
	mkdirSync(dir, { recursive: true });
	const dependencies = version === null ? {} : { "dsh-skill-mcp-panel": "github:Fishquito7/dsh-skill-mcp-panel#v" + version };
	const bundles = ["@deepseek-ai/dsh-base"];
	if (mounts) bundles.push("dsh-skill-mcp-panel");
	writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "dsh-profile-" + name, private: true, dependencies, dsh: { profile: { bundles } } }, null, 2));
	if (version !== null) {
		mkdirSync(join(dir, "node_modules", "dsh-skill-mcp-panel"), { recursive: true });
		writeFileSync(join(dir, "node_modules", "dsh-skill-mcp-panel", "package.json"), JSON.stringify({ name: "dsh-skill-mcp-panel", version }));
	}
}

function resetCalls() {
	writeFileSync(callsLog, "");
}
function readCalls() {
	try {
		return readFileSync(callsLog, "utf8").split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
	} catch {
		return [];
	}
}
function run(args, extraEnv = {}) {
	return spawnSync(process.execPath, [CLI_PATH, ...args], {
		cwd: base,
		encoding: "utf8",
		env: {
			...process.env,
			DSH_HOME: home,
			PATH: binDir + (process.platform === "win32" ? ";" : ":") + process.env.PATH,
			NODE_OPTIONS: "--import=" + pathToFileURL(fetchStub).href,
			...extraEnv
		}
	});
}
function profileDirNames() {
	return readdirSync(profilesDir).sort();
}

mkdirSync(profilesDir, { recursive: true });
mkdirSync(binDir, { recursive: true });
makeProfile("web", "9.9.9", true);      // 已是最新：update 不该动它
makeProfile("desktop", "2.1.0", true);  // Electron 独占
makeProfile("stale", "2.1.0", true);    // 唯一真正需要更新的
makeProfile("bare", null, false);       // 没装本插件
// 只有 cordis.patch.yml、没有 package.json 的目录不是一个能启动的 profile。
mkdirSync(join(profilesDir, "notinit"), { recursive: true });
writeFileSync(join(profilesDir, "notinit", "cordis.patch.yml"), "[]\n");

// GitHub API 桩：任何 fetch 都回 v9.9.9，测试全程离线。
writeFileSync(fetchStub, "globalThis.fetch = async () => new Response(JSON.stringify({ tag_name: \"v" + LATEST + "\" }), { status: 200, headers: { \"content-type\": \"application/json\" } });\n");

// dsh 桩：把 argv 记进 callsLog 后成功退出，绝不真的装包。
writeFileSync(join(binDir, "dsh.cmd"), "@echo off\r\n>> \"" + callsLog + "\" echo %*\r\nexit /b 0\r\n");
writeFileSync(join(binDir, "dsh"), "#!/bin/sh\necho \"$@\" >> \"" + callsLog + "\"\nexit 0\n", { mode: 0o755 });
resetCalls();

try {
	// ── 1. profiles 子命令 ────────────────────────────────────────────────────
	const listed = run(["profiles"]);
	check("dsh-panel profiles 退出码 0", listed.status === 0, listed.stderr);
	check("profiles 打印当前入口路径（shim 指向的那份副本）", listed.stdout.includes(CLI_PATH), listed.stdout);
	check("profiles 列出全部 4 个 profile", ["web", "desktop", "stale", "bare"].every((name) => listed.stdout.includes(name)), listed.stdout);
	check("profiles 标出 desktop 是 Electron 独占", listed.stdout.includes("desktop（Electron 独占）"), listed.stdout);
	check("profiles 标出 bare 未挂载 bundles", /bare\t-\t未挂载/.test(listed.stdout), listed.stdout);
	check("profiles 显示每个 profile 自己的已装版本", /stale\t2\.1\.0\t/.test(listed.stdout) && /web\t9\.9\.9\t/.test(listed.stdout), listed.stdout);
	check("没初始化的目录（无 package.json）不算 profile", !listed.stdout.includes("notinit"), listed.stdout);
	const notInit = run(["mcp", "list", "--profile", "notinit"]);
	check("未初始化的目录名同样以退出码 2 拒绝", notInit.status === 2, "status=" + notInit.status + " stderr=" + notInit.stderr);

	// ── 2. 缺 --profile / 错名一律拒绝，且不新建 profile ──────────────────────
	const before = profileDirNames();
	// mcp 配置是 per-profile 的数据，必须显式指定目标。
	const mcpNoProfile = run(["mcp", "list"]);
	check("mcp 缺 --profile 以退出码 2 拒绝", mcpNoProfile.status === 2, "status=" + mcpNoProfile.status + " stderr=" + mcpNoProfile.stderr);
	check("mcp 缺 --profile 提示必须指定 --profile", mcpNoProfile.stderr.includes("必须用 --profile"), mcpNoProfile.stderr);

	// 技能文件全局共享（~/.dsh/skills 与 <工作区>/.dsh/skills），不按 profile 分家，
	// 所以 skill 子命令不带 --profile 必须照常工作。
	const skillNoProfile = run(["skill", "list"]);
	check("skill 不带 --profile 照常工作", skillNoProfile.status === 0, "status=" + skillNoProfile.status + " stderr=" + skillNoProfile.stderr);
	check("skill 不带 --profile 时没有 profile 上下文，不产生 bundles 警告", !skillNoProfile.stderr.includes("bundles"), skillNoProfile.stderr);
	const skillDisableNoProfile = run(["skill", "disable", "whatever"]);
	check("skill disable 不带 --profile 走到「技能不存在」而不是用法错误", skillDisableNoProfile.status !== 2, "status=" + skillDisableNoProfile.status + " stderr=" + skillDisableNoProfile.stderr);

	const badNameCases = [
		[["mcp", "list", "--profile", "nope"], "mcp"],
		[["skill", "list", "--profile", "nope"], "skill"],
		[["update", "--profile", "nope"], "update"]
	];
	for (const [args, label] of badNameCases) {
		const result = run(args);
		check(label + " 错名以退出码 2 拒绝", result.status === 2, "status=" + result.status + " stderr=" + result.stderr);
		check(label + " 错名报错列出有效 profile", result.stderr.includes("不存在") && result.stderr.includes("web"), result.stderr);
		check("dsh-panel " + label + " 拒绝时没有派发 dsh plugin", readCalls().length === 0, JSON.stringify(readCalls()));
	}
	check("错名/缺名之后 profiles 目录没有多出任何 profile", JSON.stringify(profileDirNames()) === JSON.stringify(before), JSON.stringify(profileDirNames()));

	// 路径分隔符也要挡掉（否则就等于让 dsh 去解析任意路径）
	const traversal = run(["mcp", "list", "--profile", "../web"]);
	check("含路径分隔符的 profile 名被拒绝", traversal.status === 2, "status=" + traversal.status);
	check("路径穿越之后 profiles 目录仍然不变", JSON.stringify(profileDirNames()) === JSON.stringify(before), JSON.stringify(profileDirNames()));

	// ── 3. skill 在没挂载 bundles 的 profile 上给出提示 ────────────────────────
	const bare = run(["skill", "list", "--profile", "bare"]);
	check("skill list --profile bare 退出码 0（技能是全局共享的）", bare.status === 0, bare.stderr);
	check("skill list --profile bare 提示该 profile 没挂载 bundles", bare.stderr.includes("bundles") && bare.stderr.includes("bare"), bare.stderr);
	const web = run(["skill", "list", "--profile", "web"]);
	check("skill list --profile web 退出码 0", web.status === 0, web.stderr);
	check("已挂载的 profile 不产生 bundles 警告", !web.stderr.includes("bundles 里没有"), web.stderr);

	// ── 4. update 显式指定 desktop：报错且不派发 ──────────────────────────────
	resetCalls();
	const desktop = run(["update", "--yes", "--profile", "desktop"]);
	check("update --profile desktop 以退出码 2 拒绝", desktop.status === 2, "status=" + desktop.status + " stderr=" + desktop.stderr);
	check("update --profile desktop 说明该 profile 由桌面应用独占", desktop.stderr.includes("独占") && desktop.stderr.includes("Electron"), desktop.stderr);
	check("update --profile desktop 给出替代做法", desktop.stderr.includes("插件管理面板"), desktop.stderr);
	check("update --profile desktop 没有派发 dsh plugin", readCalls().length === 0, JSON.stringify(readCalls()));

	// ── 5. update 不带 --profile：遍历全部，对比基准是各 profile 自己的版本 ────
	resetCalls();
	const all = run(["update", "--yes"]);
	check("update（全部）退出码 0", all.status === 0, "stderr=" + all.stderr + " stdout=" + all.stdout);
	check("update（全部）只派发一次 dsh plugin", readCalls().length === 1, JSON.stringify(readCalls()));
	check("update（全部）派发的是 stale（唯一落后的 profile），不是运行入口所在的 web", readCalls()[0] === "plugin --profile stale add github:Fishquito7/dsh-skill-mcp-panel#v" + LATEST, JSON.stringify(readCalls()));
	check("update（全部）把已经是最新的 web 判为已是最新", /web\t已是最新/.test(all.stdout), all.stdout);
	check("update（全部）跳过 desktop 而不是整体失败", all.stdout.includes("跳过 desktop"), all.stdout);
	check("update（全部）跳过未安装的 bare", /跳过 bare\t未安装本插件/.test(all.stdout), all.stdout);

	// 核心回归：运行入口版本比最新版旧，旧实现会据此认为「有更新」，并把它硬编码的
	// 默认目标 web 重装一遍；新实现的基准是 web 自己的 9.9.9，所以一次派发都不该有。
	resetCalls();
	const explicitLatest = run(["update", "--yes", "--profile", "web"]);
	check("update --profile web 退出码 0", explicitLatest.status === 0, explicitLatest.stderr);
	check("已是最新的 profile 不会被重新安装（旧实现会）", readCalls().length === 0, JSON.stringify(readCalls()));
	check("已是最新时打印「全部已是最新版本」", explicitLatest.stdout.includes("全部已是最新版本"), explicitLatest.stdout);
	check("运行入口版本确实比最新版旧（保证上一条不是空跑）", ENTRY_VERSION !== LATEST && ENTRY_VERSION.localeCompare(LATEST) < 0, ENTRY_VERSION + " vs " + LATEST);

	// ── 6. update --profile <没装的>：显式指定就安装 ──────────────────────────
	resetCalls();
	const installBare = run(["update", "--yes", "--profile", "bare"]);
	check("update --profile bare 退出码 0", installBare.status === 0, installBare.stderr);
	check("未安装的 profile 被计划为安装", /未安装 → 将安装 v/.test(installBare.stdout), installBare.stdout);
	check("显式指定时按该 profile 派发安装", readCalls()[0] === "plugin --profile bare add github:Fishquito7/dsh-skill-mcp-panel#v" + LATEST, JSON.stringify(readCalls()));

	// ── 7. peerDependencies：DSH 自己的闸门必须接受本插件 ─────────────────────
	function appBootPaths() {
		const paths = [];
		try {
			const resolved = createRequire(import.meta.url).resolve("@deepseek-ai/dsh-app-boot/package.json");
			paths.push(join(dirname(resolved), "lib", "index.js"));
		} catch {}
		const globalRoots = [
			process.env.APPDATA && join(process.env.APPDATA, "npm", "node_modules"),
			join(dirname(process.execPath), "..", "lib", "node_modules"),
			join(dirname(process.execPath), "node_modules")
		].filter((root) => typeof root === "string");
		for (const root of globalRoots) {
			paths.push(join(root, "@deepseek-ai", "dsh", "node_modules", "@deepseek-ai", "dsh-app-boot", "lib", "index.js"));
			paths.push(join(root, "@deepseek-ai", "dsh-app-boot", "lib", "index.js"));
		}
		return paths;
	}

	const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
	check("声明了 @deepseek-ai/dsh 的 peerDependencies", typeof manifest.peerDependencies?.["@deepseek-ai/dsh"] === "string", JSON.stringify(manifest.peerDependencies));
	check("peer 标成 optional（宿主自带，不让 pnpm 报 unmet peer）", manifest.peerDependenciesMeta?.["@deepseek-ai/dsh"]?.optional === true, JSON.stringify(manifest.peerDependenciesMeta));

	let evaluate;
	for (const candidate of appBootPaths()) {
		try {
			const mod = await import(pathToFileURL(candidate).href);
			if (typeof mod.evaluatePluginCompatibility === "function") {
				evaluate = mod.evaluatePluginCompatibility;
				console.log("      使用宿主校验器  <-  " + candidate);
				break;
			}
		} catch {}
	}

	if (evaluate === undefined) {
		console.log("SKIP  未能定位 @deepseek-ai/dsh-app-boot，跳过 DSH 版本闸门校验");
	} else {
		// 没有 peerDependencies 时闸门直接放行——这正是 0.1.7-rc.1 那次断裂能静默发生的原因。
		check("无 peerDependencies 的 manifest 会被闸门直接放行（说明该字段才是开关）", evaluate({ name: manifest.name, version: manifest.version }) === undefined);
		check("当前运行的 DSH 接受本插件（否则 profile 起不来）", evaluate(manifest) === undefined, JSON.stringify(evaluate(manifest)));
		// README 兼容矩阵里承诺支持的版本必须全部通过（区间写窄了会让 profile 起不来）
		for (const version of ["0.1.5-rc.0", "0.1.6-alpha.1", "0.1.6-alpha.2", "0.1.7-alpha.1", "0.1.7-rc.1", "0.1.8"]) {
			check("区间接受 " + version, evaluate(manifest, {}, version) === undefined, JSON.stringify(evaluate(manifest, {}, version)));
		}
		// 区间外必须拒绝：低于下限没验证过；0.2.x 是未验证的新次版本号，
		// includePrerelease 会让 <0.2.0 把 0.2.0-rc.1 也放进来，所以上界必须写 <0.2.0-0。
		for (const version of ["0.1.4-rc.1", "0.2.0-0", "0.2.0-rc.1", "0.2.0", "0.2.1"]) {
			check("区间拒绝 " + version, evaluate(manifest, {}, version) !== undefined);
		}
		const exempted = evaluate(manifest, { [manifest.name + "@" + manifest.version]: ["0.1.4-rc.1"] }, "0.1.4-rc.1");
		check("精确版本豁免可以放行（用户的逃生门）", exempted !== undefined && exempted.exempted === true);
	}
} finally {
	rmSync(base, { recursive: true, force: true });
}

console.log("\n" + passed + " passed, " + failures + " failed");
console.log(failures === 0 ? "ALL CLI PROFILE TESTS PASSED" : failures + " FAILURES");
process.exit(failures === 0 ? 0 : 1);
