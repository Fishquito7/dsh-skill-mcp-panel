import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectSkillEntries } from "./lib/skill-files.js";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const dir = await mkdtemp(join(tmpdir(), "dsh-panel-nested-"));
try {
  const md = (name, description = name) => `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`;
  const writeSkillBundle = async (rel, name) => {
    const root = join(dir, rel);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "SKILL.md"), md(name));
  };
  await writeSkillBundle("category-alpha/alpha", "alpha");
  await writeSkillBundle("category-beta/beta", "beta");
  await writeSkillBundle("package-with-nested", "package");
  await writeSkillBundle("package-with-nested/sub-skill", "sub-skill");
  await writeFile(join(dir, "root-flat.md"), md("root-flat"));
  await writeFile(join(dir, "root-disabled.md.disabled"), md("root-disabled"));
  await writeSkillBundle("node_modules/skipped", "skipped");
  await mkdir(join(dir, ".hidden", "skill"), { recursive: true });
  await writeFile(join(dir, ".hidden", "skill", "SKILL.md"), md("hidden"));

  const entries = await collectSkillEntries([{ path: dir, source: "user-dsh", projectRoot: undefined }]);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  assert.equal(byName.get("alpha")?.rel, "category-alpha/alpha");
  assert.equal(byName.get("beta")?.rel, "category-beta/beta");
  assert.equal(byName.get("root-flat")?.rel, "");
  assert.equal(byName.get("root-disabled")?.rel, "");
  assert.equal(byName.get("root-disabled")?.enabled, false);
  assert.equal(byName.has("package"), true, "package root with SKILL.md must be listed");
  assert.equal(byName.has("sub-skill"), false, "nested SKILL.md inside a package must not be listed");
  assert.equal(byName.has("skipped"), false, "node_modules must be skipped");
  assert.equal(byName.has("hidden"), false, "hidden directories must be skipped");
  pass("recursive discovery finds nested skills with rel and skips protected dirs");

  // Nested category disabled bundle is discovered as disabled
  await mkdir(join(dir, "category-alpha", "disabled"), { recursive: true });
  await writeFile(join(dir, "category-alpha", "disabled", "SKILL.md.disabled"), md("disabled-nested"));
  const entries2 = await collectSkillEntries([{ path: dir, source: "user-dsh", projectRoot: undefined }]);
  const disabledNested = entries2.find((entry) => entry.name === "disabled-nested");
  assert.equal(disabledNested?.rel, "category-alpha/disabled");
  assert.equal(disabledNested?.enabled, false);
  pass("nested disabled bundles are discovered as disabled");
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log("\n" + passed + " passed, 0 failed");
console.log("ALL NESTED DISCOVERY TESTS PASSED");
