import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, lstat, readlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  loadBindings, saveBindings, scopeSkill, normalizeWorkspaces, ensureJunction,
  removeJunction, deleteScopedSkill, scopedEnabled, setScopedEnabled, scopedContent,
  storeRoot, userBundleDir, workspaceLink, pruneStaleWorkspaces
} from "./lib/scope.js";
import { collectSkillEntries, buildRoots } from "./lib/skill-files.js";

const base = await mkdtemp(join(tmpdir(), "skv-test-"));
const dshHome = join(base, "home");
const ws = join(base, "workspace");
await mkdir(join(dshHome, "skills"), { recursive: true });
await mkdir(ws, { recursive: true });

const failures = [];
function check(label, cond) {
  console.log((cond ? "PASS" : "FAIL") + "  " + label);
  if (!cond) failures.push(label);
}

// 1) a global bundle skill
const skillName = "demo-skill";
const skillBody = "---\nname: demo-skill\ndescription: 演示技能\n---\n\n# body\n";
await mkdir(join(dshHome, "skills", skillName), { recursive: true });
await writeFile(join(dshHome, "skills", skillName, "SKILL.md"), skillBody, "utf8");

// 2) scope to one workspace
const entry = { file: join(dshHome, "skills", skillName, "SKILL.md"), dirBundle: true, enabled: true, source: "user-dsh" };
await scopeSkill(dshHome, skillName, [ws], entry);
check("store dir exists after scoping", await (async () => { try { await lstat(storeRoot(dshHome) + "/" + skillName); return true; } catch { return false; } })());
check("user root dir moved away", !(await (async () => { try { await lstat(userBundleDir(dshHome, skillName)); return true; } catch { return false; } })()));
check("junction created in workspace", await (async () => { try { const st = await lstat(workspaceLink(ws, skillName)); return st.isSymbolicLink(); } catch { return false; } })());
const viaLink = await readFile(join(ws, ".dsh", "skills", skillName, "SKILL.md"), "utf8");
check("content readable through junction", viaLink.includes("demo-skill"));
const bindings = await loadBindings(dshHome);
check("binding recorded", bindings[skillName]?.workspaces?.includes(ws));

// 3) discovery simulation: collectSkillEntries over project roots of ws
const roots = await buildRoots(ws, { dshHome: join(base, "agents-home"), agentsHome: join(base, "agents-home-2") });
const found = await collectSkillEntries(roots);
check("provider-style scan finds it under project root", found.some((e) => e.name === skillName && e.enabled));

// 4) enable/disable in store
await setScopedEnabled(dshHome, skillName, false);
check("scopedEnabled false after disable", !(await scopedEnabled(dshHome, skillName)));
await setScopedEnabled(dshHome, skillName, true);
check("scopedEnabled true after enable", await scopedEnabled(dshHome, skillName));

// 5) content
check("scopedContent reads body", (await scopedContent(dshHome, skillName))?.includes("# body"));

// 6) back to global
await scopeSkill(dshHome, skillName, null);
check("restored to user root", await (async () => { try { await lstat(join(dshHome, "skills", skillName, "SKILL.md")); return true; } catch { return false; } })());
check("junction removed", !(await (async () => { try { await lstat(workspaceLink(ws, skillName)); return true; } catch { return false; } })()));
check("binding removed", (await loadBindings(dshHome))[skillName] === undefined);

// 7) flat skill scoping + fileName restore
await writeFile(join(dshHome, "skills", "my-flat.md"), "---\nname: my-flat\ndescription: 平铺技能\n---\n\nflat body\n", "utf8");
await scopeSkill(dshHome, "my-flat", [ws], { file: join(dshHome, "skills", "my-flat.md"), dirBundle: false, enabled: true, source: "user-dsh" });
check("flat stored as SKILL.md bundle", await (async () => { try { await lstat(join(storeRoot(dshHome), "my-flat", "SKILL.md")); return true; } catch { return false; } })());
await scopeSkill(dshHome, "my-flat", null);
check("flat restored with original file name", await (async () => { try { await lstat(join(dshHome, "skills", "my-flat.md")); return true; } catch { return false; } })());
check("flat store cleaned", !(await (async () => { try { await lstat(join(storeRoot(dshHome), "my-flat")); return true; } catch { return false; } })()));

// 8) workspace deletion pruning
await scopeSkill(dshHome, skillName, [ws], { file: join(dshHome, "skills", skillName, "SKILL.md"), dirBundle: true, enabled: true, source: "user-dsh" });
await rm(ws, { recursive: true, force: true });
const b2 = await loadBindings(dshHome);
await pruneStaleWorkspaces(dshHome, b2);
check("stale workspace pruned", b2[skillName]?.workspaces?.length === 0);
check("skill itself retained in store", await (async () => { try { await lstat(join(storeRoot(dshHome), skillName)); return true; } catch { return false; } })());

// 9) normalizeWorkspaces errors on missing dir
let threw = false;
try { await normalizeWorkspaces([join(base, "nope")]); } catch { threw = true; }
check("normalizeWorkspaces rejects missing dir", threw);

// 10) deleteScopedSkill
await deleteScopedSkill(dshHome, skillName);
check("deleteScopedSkill removes store", !(await (async () => { try { await lstat(join(storeRoot(dshHome), skillName)); return true; } catch { return false; } })()));
check("deleteScopedSkill removes binding", (await loadBindings(dshHome))[skillName] === undefined);

await rm(base, { recursive: true, force: true }).catch(() => {});
console.log(failures.length === 0 ? "ALL TESTS PASSED" : failures.length + " FAILURES: " + failures.join(" | "));
process.exit(failures.length === 0 ? 0 : 1);
