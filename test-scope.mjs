/**
 * test-scope.mjs — entity-model scope engine tests (0.3.0).
 *
 * Exercises lib/scope.js against real directories in a temp root:
 * migrateEntry (move/copy, bundle/flat/disabled), batch migration with
 * per-item failure, duplicate guards, workspace normalization.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  batchMigrateEntries,
  migrateEntry,
  normalizeWorkspace,
  scopeRootOf,
  workspaceSkillRoot,
  workspaceTitleMap
} from "./lib/scope.js";
import { collectSkillEntries, pathExists } from "./lib/skill-files.js";

let passed = 0;
let failed = 0;
function check(cond, label) {
  if (cond) {
    passed += 1;
    console.log("PASS  " + label);
  } else {
    failed += 1;
    console.log("FAIL  " + label);
  }
}
async function rejects(promise, label) {
  try {
    await promise;
    failed += 1;
    console.log("FAIL  " + label + " (did not throw)");
  } catch {
    passed += 1;
    console.log("PASS  " + label + " (threw as expected)");
  }
}

const root = join(tmpdir(), "dsh-skill-scope-test-" + process.pid);
const home = join(root, "home");
const wsA = join(root, "wsA");
const wsB = join(root, "wsB");
const homeSkills = join(home, "skills");
const wsASkills = workspaceSkillRoot(wsA);
const wsBSkills = workspaceSkillRoot(wsB);

async function makeBundle(dir, name, desc, disabled) {
  const d = join(dir, name);
  await mkdir(join(d, "assets"), { recursive: true });
  await writeFile(join(d, "SKILL" + (disabled ? ".md.disabled" : ".md")),
    "---\nname: " + name + "\ndescription: " + desc + "\n---\n\n# " + name + "\n");
  await writeFile(join(d, "assets", "note.txt"), "asset-of-" + name + "\n");
  return d;
}

async function main() {
  await rm(root, { recursive: true, force: true });
  await mkdir(homeSkills, { recursive: true });
  await mkdir(join(wsA), { recursive: true });
  await mkdir(join(wsB), { recursive: true });

  // 1) move a global bundle into workspace A
  await makeBundle(homeSkills, "demo-move", "move test");
  const entries1 = await collectSkillEntries([{ path: homeSkills, source: "user-dsh" }]);
  const demoMove = entries1.find((e) => e.name === "demo-move");
  await migrateEntry(demoMove, wsASkills, "move");
  check(await pathExists(join(wsASkills, "demo-move", "SKILL.md")), "bundle moved into workspace");
  check(await pathExists(join(wsASkills, "demo-move", "assets", "note.txt")), "bundle asset copied along");
  check(!(await pathExists(join(homeSkills, "demo-move"))), "source removed after move");
  check((await readFile(join(wsASkills, "demo-move", "assets", "note.txt"), "utf8")).includes("asset-of-demo-move"), "content preserved");

  // 2) copy a global bundle into workspace A (source kept)
  await makeBundle(homeSkills, "demo-copy", "copy test");
  const entries2 = await collectSkillEntries([{ path: homeSkills, source: "user-dsh" }]);
  const demoCopy = entries2.find((e) => e.name === "demo-copy");
  await migrateEntry(demoCopy, wsASkills, "copy");
  check(await pathExists(join(wsASkills, "demo-copy", "SKILL.md")), "copy landed in workspace");
  check(await pathExists(join(homeSkills, "demo-copy", "SKILL.md")), "copy keeps the source");

  // 3) flat skill move (original file name preserved)
  const flatFile = join(homeSkills, "my-flat-skill.md");
  await writeFile(flatFile, "---\nname: flat-move\ndescription: flat test\n---\n\nbody\n");
  const entries3 = await collectSkillEntries([{ path: homeSkills, source: "user-dsh" }]);
  const flatEntry = entries3.find((e) => e.name === "flat-move");
  await migrateEntry(flatEntry, wsBSkills, "move");
  check(await pathExists(join(wsBSkills, "my-flat-skill.md")), "flat file moved with original name");
  check(!(await pathExists(flatFile)), "flat source removed");

  // 4) disabled bundle keeps its disabled state when moved
  await makeBundle(homeSkills, "demo-disabled", "disabled test", true);
  const entries4 = await collectSkillEntries([{ path: homeSkills, source: "user-dsh" }]);
  const disabledEntry = entries4.find((e) => e.name === "demo-disabled");
  await migrateEntry(disabledEntry, wsASkills, "move");
  check(await pathExists(join(wsASkills, "demo-disabled", "SKILL.md.disabled")), "disabled state preserved after move");
  check(!(await pathExists(join(wsASkills, "demo-disabled", "SKILL.md"))), "moved bundle is still disabled");

  // 5) duplicate at target → rejected, source intact
  await makeBundle(homeSkills, "demo-move", "move test duplicate");
  const entries5 = await collectSkillEntries([{ path: homeSkills, source: "user-dsh" }]);
  const dupEntry = entries5.find((e) => e.name === "demo-move");
  await rejects(migrateEntry(dupEntry, wsASkills, "move"), "duplicate target rejected");
  check(await pathExists(join(homeSkills, "demo-move", "SKILL.md")), "source intact after rejection");
  await rm(join(homeSkills, "demo-move"), { recursive: true, force: true });

  // 6) same-location no-op rejected
  const wsEntries = await collectSkillEntries([{ path: wsASkills, source: "project-dsh", projectRoot: wsA }]);
  const sameEntry = wsEntries.find((e) => e.name === "demo-copy");
  await rejects(migrateEntry(sameEntry, wsASkills, "move"), "same-location move rejected");

  // 7) batch: one ok, one conflict, one ok — conflict does not abort the rest
  await makeBundle(wsBSkills, "batch-conflict", "already in target");
  await makeBundle(homeSkills, "batch-conflict", "conflict source copy");
  await makeBundle(homeSkills, "batch-ok-1", "batch one");
  await makeBundle(homeSkills, "batch-ok-2", "batch two");
  const homeEntries = await collectSkillEntries([{ path: homeSkills, source: "user-dsh" }]);
  const batchItems = ["batch-ok-1", "batch-conflict", "batch-ok-2"].map((n) => homeEntries.find((e) => e.name === n)).filter(Boolean);
  const results = await batchMigrateEntries(batchItems, wsBSkills, "move");
  check(results.length === 3, "batch returns one result per item");
  check(results[0].ok === true && results[2].ok === true, "batch ok items migrated");
  check(results[1].ok === false && typeof results[1].error === "string", "batch conflict item failed with message");
  check(await pathExists(join(wsBSkills, "batch-ok-1", "SKILL.md")) && await pathExists(join(wsBSkills, "batch-ok-2", "SKILL.md")), "batch ok items landed");
  check(!(await pathExists(join(homeSkills, "batch-ok-1"))) && !(await pathExists(join(homeSkills, "batch-ok-2"))), "batch ok sources removed");
  check(await pathExists(join(homeSkills, "batch-conflict", "SKILL.md")), "conflict source untouched");

  // 8) move back workspace → global
  const backEntry = (await collectSkillEntries([{ path: wsBSkills, source: "project-dsh", projectRoot: wsB }])).find((e) => e.name === "flat-move");
  await migrateEntry(backEntry, homeSkills, "move");
  check(await pathExists(join(homeSkills, "my-flat-skill.md")), "moved back to global root");
  check(!(await pathExists(join(wsBSkills, "my-flat-skill.md"))), "workspace copy removed after move back");

  // 9) scope roots
  check(resolve(scopeRootOf(null, home)) === resolve(homeSkills), "scopeRootOf(null) = user root");
  check(resolve(scopeRootOf(wsA, home)) === resolve(wsASkills), "scopeRootOf(path) = workspace .dsh/skills");

  // 10) workspace normalization
  await rejects(normalizeWorkspace(join(root, "missing-dir")), "normalizeWorkspace rejects missing dir");
  await mkdir(join(wsA, ".git"), { recursive: true });
  await mkdir(join(wsA, "sub"), { recursive: true });
  const norm = await normalizeWorkspace(join(wsA, "sub"));
  check(resolve(norm) === resolve(wsA), "workspace resolves to its git project root");

  // 11) workspaceTitleMap：DSH 注册表的工作区名称优先于文件夹名
  const fakeHome = join(root, "fake-home");
  await mkdir(join(fakeHome, "storages"), { recursive: true });
  await writeFile(join(fakeHome, "storages", "workspace.json"), JSON.stringify({
    tables: { workspaces: { wid: { path: join(wsA, "sub"), title: "改名后的工作区" } } }
  }));
  const titleMap = await workspaceTitleMap(fakeHome);
  const keyA = process.platform === "win32" ? resolve(wsA).toLowerCase() : resolve(wsA);
  check(titleMap.get(keyA) === "改名后的工作区", "workspaceTitleMap uses registry title over folder name");
  await writeFile(join(fakeHome, "storages", "workspace.json"), "{ broken json");
  check((await workspaceTitleMap(fakeHome)).size === 0, "workspaceTitleMap tolerates broken registry file");

  await rm(root, { recursive: true, force: true });
  console.log("---");
  console.log(passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
  console.log("ALL TESTS PASSED");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
