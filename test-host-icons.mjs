/**
 * 回归守卫：客户端束引用的宿主 primitives 图标必须都能在 0.2.x 宿主上解析。
 *
 * 背景
 *   宿主 @deepseek-ai/dsh-client-ui-primitives 在 0.1.7 把图标的像素后缀换成了描边档位
 *   （…Outline16 → …OutlineRegular，尺寸改由 size prop 传）。插件曾经为了同时兼容两代
 *   做过「新名优先、旧名回退」；2026-10-18 起最低支持宿主是 **0.2.0**，旧名回退已删除
 *   （见 src/client.ts 的 primitiveIcon）。
 *
 *   当年那次事故的教训仍然有效：直接引用一个宿主不存在的图标会让 React 抛
 *   "Element type is invalid … got: undefined"，插槽渲染器 keyed 条目崩溃即 retire，
 *   整页消失，而当时 13 个套件全绿。
 *
 * 本测试锁住三件事
 *   1. 静态：束里不允许直接引用宿主图标，必须走 primitiveIcon；直连只放行跨版本稳定的
 *      非图标绑定（Menu）；
 *   2. 静态：所有图标名必须符合 0.2.x 命名（…OutlineRegular / …OutlineMedium /
 *      …OutlineArtwork / 裸 …Outline），出现像素后缀旧名即红；
 *   3. 动态：能定位到宿主包时，用它的**真实导出表**逐个验证图标存在；定位不到时 SKIP。
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

let failures = 0;
const check = (label, cond) => {
	console.log((cond ? "PASS" : "FAIL") + "  " + label);
	if (!cond) failures++;
};

const source = readFileSync(new URL("./lib/client.js", import.meta.url), "utf8");

// ── 1. 直连白名单 ─────────────────────────────────────────────────────────
const DIRECT_ALLOW = new Set(["Menu"]);
const direct = [...new Set([...source.matchAll(/primitives\.([A-Za-z0-9_]+)/g)].map((hit) => hit[1]))];
check("束里引用了宿主 primitives（不是空跑）", direct.length > 0);
const directOffenders = direct.filter((name) => !DIRECT_ALLOW.has(name));
check("没有直接引用宿主图标（必须走 primitiveIcon）—— 违规: " + JSON.stringify(directOffenders), directOffenders.length === 0);

// ── 2. 图标名全部是 0.2.x 命名 ───────────────────────────────────────────
const icons = [...new Set([...source.matchAll(/primitiveIcon\(\s*"([^"]+)"\s*\)/g)].map((hit) => hit[1]))];
check("存在 primitiveIcon 图标引用", icons.length > 0);
console.log("      直连=" + direct.length + "  图标=" + icons.length);

const CURRENT_NAME = /^Icon[A-Za-z0-9]+Outline(?:Regular|Medium|Artwork)?$/;
const LEGACY_NAME = /^Icon[A-Za-z0-9]+Outline\d+$/;
const badNames = icons.filter((name) => !CURRENT_NAME.test(name));
const legacyNames = icons.filter((name) => LEGACY_NAME.test(name));
check("图标名符合 0.2.x 命名 —— 违规: " + JSON.stringify(badNames), badNames.length === 0);
check("没有残留像素后缀旧名（历史包袱已删）—— 违规: " + JSON.stringify(legacyNames), legacyNames.length === 0);
check("primitiveIcon 只接受一个参数（没有回退入参）", !/primitiveIcon\([^)]*,[^)]*\)/.test(source));

// ── 3. 真实宿主导出表 ─────────────────────────────────────────────────────
function exportNamesOf(indexPath) {
	const names = new Set();
	for (const block of readFileSync(indexPath, "utf8").matchAll(/export\s*\{([\s\S]*?)\}/g)) {
		for (let part of block[1].split(",")) {
			part = part.trim();
			if (part === "") continue;
			if (part.includes(" as ")) part = part.split(" as ").pop().trim();
			names.add(part);
		}
	}
	return names;
}

/** 候选索引位置：显式覆盖 -> 本仓库可解析 -> 全局 npm 的 dsh 自带副本。 */
function hostIndexPaths() {
	const paths = [];
	if (process.env.DSH_UI_PRIMITIVES) paths.push(join(process.env.DSH_UI_PRIMITIVES, "lib", "index.js"));
	try {
		const resolved = createRequire(import.meta.url).resolve("@deepseek-ai/dsh-client-ui-primitives/package.json");
		paths.push(join(dirname(resolved), "lib", "index.js"));
	} catch {}
	const globalRoots = [
		process.env.APPDATA && join(process.env.APPDATA, "npm", "node_modules"),
		join(dirname(process.execPath), "..", "lib", "node_modules"),
		join(dirname(process.execPath), "node_modules")
	].filter((root) => typeof root === "string");
	for (const root of globalRoots) {
		paths.push(join(root, "@deepseek-ai", "dsh-client-ui-primitives", "lib", "index.js"));
		paths.push(join(root, "@deepseek-ai", "dsh", "node_modules", "@deepseek-ai", "dsh-client-ui-primitives", "lib", "index.js"));
	}
	return paths;
}

let hostExports;
for (const indexPath of hostIndexPaths()) {
	if (!existsSync(indexPath)) continue;
	const names = exportNamesOf(indexPath);
	if (names.size > 0) {
		hostExports = names;
		console.log("      宿主导出表=" + names.size + " 个符号  <-  " + indexPath);
		break;
	}
}

if (hostExports === undefined) {
	console.log("SKIP  未能定位 @deepseek-ai/dsh-client-ui-primitives（可用 DSH_UI_PRIMITIVES 显式指定其目录），跳过真实导出表校验");
} else {
	check("宿主导出表可解析（不是空表）", hostExports.size > 0);
	for (const name of direct) {
		check("primitives." + name + " 在宿主导出表中存在", hostExports.has(name));
	}
	for (const name of icons) {
		check("primitiveIcon(" + name + ") 在宿主导出表中存在", hostExports.has(name));
	}
}

console.log(failures === 0 ? "ALL HOST ICON CONTRACT TESTS PASSED" : failures + " FAILURES");
process.exit(failures === 0 ? 0 : 1);
