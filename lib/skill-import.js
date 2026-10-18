/**
 * dsh-skill-mcp-panel —— 「添加技能」的结构识别（宿主、CLI 与测试共用一份实现）。
 *
 * 识别规则镜像 DSH 自己的发现逻辑（@deepseek-ai/dsh-skill-filesystem 的
 * discoverRoot 只 readdir 一层）以及本插件 NestedSkillProvider 的嵌套发现：
 *
 *   技能根
 *   ├── <技能名>/SKILL.md      技能包：整棵树是一个技能，内部不再下钻
 *   ├── <技能名>.md            单文件技能
 *   └── <分类目录>/…           不含 SKILL.md 的目录：继续下钻
 *
 * 选择范围（selection）指用户一次选中的东西：一个文件夹，或者若干散装文件
 * 构成的虚拟根。判定顺序：
 *
 *   1. 选择范围内**直接**存在 SKILL.md ⇒ 整个选择范围就是「一个技能包」；
 *   2. 否则按上面的规则遍历，找到的每个技能都**拍平到目标技能根第一层**
 *      （`<根>/<技能名>/` 或 `<根>/<文件名>.md`）——原生 DSH 只认一层，
 *      拍平后即使卸载本插件技能依然可见。
 *
 * 本模块只做**结构判定**，不读文件内容：frontmatter 校验与落盘由调用方按
 * path 取字节完成，因此面板（内存 base64）与 CLI（磁盘路径）能共用同一份
 * 分类结果，不需要各写一套。
 */
import { unzipSync } from "fflate";
import { MAX_RECURSE_DEPTH, SKIP_DIR_NAMES } from "./skill-files.js";
/** 上传/读盘路径归一：反斜杠转正斜杠、去掉开头的 "./" 与结尾的 "/"。 */
export function normalizeImportPath(path) {
    return String(path).replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
}
function isHidden(name) {
    return name.startsWith(".");
}
function isVisibleDir(name) {
    return !isHidden(name) && !SKIP_DIR_NAMES.has(name);
}
function emptyNode() {
    return { dirs: new Map(), files: new Map() };
}
function buildTree(entries) {
    const root = emptyNode();
    for (const entry of entries) {
        const segments = normalizeImportPath(entry.path).split("/").filter((segment) => segment !== "");
        if (segments.length === 0)
            continue;
        let node = root;
        for (let index = 0; index < segments.length - 1; index++) {
            const name = segments[index];
            let next = node.dirs.get(name);
            if (next === undefined) {
                next = emptyNode();
                node.dirs.set(name, next);
            }
            node = next;
        }
        node.files.set(segments[segments.length - 1], normalizeImportPath(entry.path));
    }
    return root;
}
/** 收集一棵子树里的全部文件（含隐藏文件：它们是技能包的载荷，必须原样复制）。 */
function flattenFiles(node, prefix, out) {
    for (const name of [...node.files.keys()].sort()) {
        out.push({ path: node.files.get(name), relative: prefix === "" ? name : prefix + "/" + name });
    }
    for (const name of [...node.dirs.keys()].sort()) {
        flattenFiles(node.dirs.get(name), prefix === "" ? name : prefix + "/" + name, out);
    }
}
function pushBundle(node, prefix, candidates) {
    const files = [];
    flattenFiles(node, "", files);
    candidates.push({
        kind: "bundle",
        source: prefix === "" ? "SKILL.md" : prefix,
        skillFile: prefix === "" ? "SKILL.md" : prefix + "/SKILL.md",
        files
    });
}
/**
 * 遍历一层：目录含 SKILL.md ⇒ 技能包（不下钻）；否则继续下钻。
 * 只有**选择范围本身**那一层的散装 .md 才算单文件技能（与扫描器一致，
 * 更深的 .md 属于所在技能包的载荷）。
 */
function scanLevel(node, prefix, depth, isScopeRoot, candidates, skipped) {
    for (const name of [...node.dirs.keys()].filter(isVisibleDir).sort()) {
        const child = node.dirs.get(name);
        const childPrefix = prefix === "" ? name : prefix + "/" + name;
        if (child.files.has("SKILL.md")) {
            pushBundle(child, childPrefix, candidates);
            continue;
        }
        if (depth + 1 < MAX_RECURSE_DEPTH)
            scanLevel(child, childPrefix, depth + 1, false, candidates, skipped);
    }
    if (!isScopeRoot)
        return;
    for (const name of [...node.files.keys()].filter((entry) => !isHidden(entry)).sort()) {
        if (name === "SKILL.md")
            continue; // 选择范围自己就是技能包，上面已处理
        const fullPath = prefix === "" ? name : prefix + "/" + name;
        if (!name.toLowerCase().endsWith(".md")) {
            skipped.push({ name, reason: "不是 .md 文件（技能只能是 .md 或含 SKILL.md 的文件夹）" });
            continue;
        }
        candidates.push({ kind: "flat", source: name, skillFile: fullPath, files: [{ path: fullPath, relative: name }] });
    }
}
/**
 * 把一次选择的全部文件路径分类成待添加技能。
 * @param entries - 相对路径列表（正斜杠；文件夹选择带顶层文件夹名）。
 */
export function classifySkillImport(entries) {
    const tree = buildTree(entries);
    const candidates = [];
    const skipped = [];
    const topDirs = [...tree.dirs.keys()].filter(isVisibleDir);
    const topFiles = [...tree.files.keys()].filter((name) => !isHidden(name));
    // 全部文件同属一个顶层文件夹 ⇒ 选择范围就是那个文件夹；否则是散装/多个顶层项。
    const singleFolder = topDirs.length === 1 && topFiles.length === 0;
    const scope = singleFolder ? tree.dirs.get(topDirs[0]) : tree;
    const scopePrefix = singleFolder ? topDirs[0] : "";
    if (scope.files.has("SKILL.md")) {
        // 选择范围自己就是一个技能包：整棵树都是它的载荷（references/、scripts/、
        // 平铺的依赖 .md、甚至里面的子 SKILL.md 目录，都不再单独算技能）。
        pushBundle(scope, scopePrefix, candidates);
        return { candidates, skipped };
    }
    scanLevel(scope, scopePrefix, 0, true, candidates, skipped);
    return { candidates, skipped };
}
/** 把逐条跳过原因压成一行（最多 3 条），用于「一个都没成功」时的报错。 */
export function describeSkips(skipped) {
    const shown = skipped.slice(0, 3).map((item) => item.name + "（" + item.reason + "）").join("；");
    return shown + (skipped.length > 3 ? "；…共 " + skipped.length + " 项" : "");
}
/**
 * 展开选择范围**顶层**的 .zip（面板的「添加文件夹/zip」与拖放 zip 都走这里）。
 * 压缩包内的路径原样合并进选择范围，因此「zip 里是一个技能文件夹」与
 * 「zip 里就是 SKILL.md + references/」两种打包方式都能被识别。
 * 文件夹内部的 zip 属于载荷，不展开。
 */
export function expandTopLevelZips(entries) {
    const out = [];
    for (const entry of entries) {
        const path = normalizeImportPath(entry.path);
        if (path.includes("/") || !path.toLowerCase().endsWith(".zip")) {
            out.push({ path, data: entry.data });
            continue;
        }
        let zipEntries;
        try {
            zipEntries = unzipSync(new Uint8Array(entry.data));
        }
        catch (error) {
            throw new Error("无法解析压缩包 " + entry.path + "：" + (error instanceof Error ? error.message : String(error)));
        }
        for (const name of Object.keys(zipEntries)) {
            if (name === "" || name.endsWith("/"))
                continue; // 目录条目
            if (name.startsWith("__MACOSX/") || name.split("/").includes("__MACOSX"))
                continue; // macOS 打包垃圾
            out.push({ path: normalizeImportPath(name), data: Buffer.from(zipEntries[name]) });
        }
    }
    return out;
}
