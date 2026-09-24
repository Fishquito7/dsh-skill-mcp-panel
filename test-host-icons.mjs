/**
 * 回归守卫：客户端束引用的宿主 primitives 符号必须能在真实宿主上解析。
 *
 * 背景
 *   宿主 @deepseek-ai/dsh-client-ui-primitives 在 0.1.7-alpha.1 把图标的像素后缀换成了
 *   描边档位，尺寸改由 size prop 传：
 *     IconSearchOutline16        -> IconSearchOutlineRegular        （1px，size 默认仍是 16）
 *     IconChevronDownOutline14   -> IconChevronDownOutlineRegular   （1px）
 *   两代命名**没有交集**。实测导出表：0.1.0-rc.6 / 0.1.3-alpha.2 / 0.1.6-alpha.2 只有旧名；
 *   0.1.7-alpha.1 / 0.1.7-rc.1 只有新名（…OutlineRegular / …OutlineMedium / …OutlineArtwork
 *   以及裸 …Outline）。所以「直接换成新名」会让 0.1.6 及更早的用户反向打不开。
 *
 *   本插件技能半区此前直接引用旧名 6 处，在 0.1.7 上取到 undefined，React 抛
 *   "Element type is invalid: expected a string or a class/function but got: undefined"；
 *   插槽渲染器对 keyed 条目的崩溃做 abdicate，把那一格 retire 掉，于是整页消失
 *   （PR #28）。修复：加 primitiveIcon(cur, legacy) 做「新名优先、旧名回退」。
 *
 * 为什么既有的 13 个套件抓不到
 *   test-panel-slots.mjs 把宿主 primitives 桩成空对象（return {}），且只渲染侧栏那两个
 *   字形、从不渲染技能页正文 —— 坏的构建上 13 个套件全绿。
 *
 * 本测试锁住三件事
 *   1. 静态：束里不允许直接引用宿主图标，必须走 primitiveIcon；直连只放行跨代稳定的
 *      非图标绑定（Menu）；
 *   2. 静态：每个回退对两侧必须指向同一个图标，且分别符合两代命名规则（防复制粘贴串行）；
 *   3. 动态：能定位到宿主包时，用它的**真实导出表**逐个验证「至少一侧可解析」——
 *      宿主下次再改名、而这里没跟上时，红的就是这条。定位不到时降级 SKIP，不制造假红。
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
// Menu 是跨代都导出的稳定绑定；图标一律必须走 primitiveIcon 回退解析。
const DIRECT_ALLOW = new Set(["Menu"]);
const direct = [...new Set([...source.matchAll(/primitives\.([A-Za-z0-9_]+)/g)].map((hit) => hit[1]))];
check("束里引用了宿主 primitives（不是空跑）", direct.length > 0);
const directOffenders = direct.filter((name) => !DIRECT_ALLOW.has(name));
check("没有直接引用宿主图标（必须走 primitiveIcon）—— 违规: " + JSON.stringify(directOffenders), directOffenders.length === 0);

// ── 2. 回退对自洽 ─────────────────────────────────────────────────────────
const pairs = [...source.matchAll(/primitiveIcon\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g)].map((hit) => [hit[1], hit[2]]);
check("存在 primitiveIcon 回退对", pairs.length > 0);
console.log("      直连=" + direct.length + "  回退对=" + pairs.length);

// 两代命名规则（取自宿主导出表）：
//   旧代 <= 0.1.6-alpha.2：…Outline<像素>，例如 IconSkillOutline16 / IconChevronDownOutline14
//   新代 >= 0.1.7-alpha.1：…OutlineRegular / …OutlineMedium / …OutlineArtwork / 裸 …Outline
const LEGACY_NAME = /^Icon[A-Za-z0-9]+Outline\d+$/;
const CURRENT_NAME = /^Icon[A-Za-z0-9]+Outline(?:Regular|Medium|Artwork)?$/;
const stemOf = (name) => name.replace(/Outline(?:Regular|Medium|Artwork)?$/, "Outline").replace(/Outline\d+$/, "Outline");

const badCurrent = pairs.filter((pair) => !CURRENT_NAME.test(pair[0])).map((pair) => pair[0]);
const badLegacy = pairs.filter((pair) => !LEGACY_NAME.test(pair[1])).map((pair) => pair[1]);
const mismatched = pairs.filter((pair) => stemOf(pair[0]) !== stemOf(pair[1])).map((pair) => pair.join(" / "));
check("回退对的新名都是 0.1.7 命名 —— 违规: " + JSON.stringify(badCurrent), badCurrent.length === 0);
check("回退对的旧名都是像素后缀命名 —— 违规: " + JSON.stringify(badLegacy), badLegacy.length === 0);
check("回退对两侧指向同一个图标 —— 违规: " + JSON.stringify(mismatched), mismatched.length === 0);

// ── 3. 真实宿主导出表 ─────────────────────────────────────────────────────
/** 解析宿主 primitives 索引里的 export { ... } 名单。 */
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
	for (const pair of pairs) {
		check("primitiveIcon(" + pair[0] + ", " + pair[1] + ") 至少一侧可解析", hostExports.has(pair[0]) || hostExports.has(pair[1]));
	}
}

console.log(failures === 0 ? "ALL HOST ICON CONTRACT TESTS PASSED" : failures + " FAILURES");
process.exit(failures === 0 ? 0 : 1);
