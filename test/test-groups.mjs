/**
 * test-groups.mjs —— 分组显示配置模块测试。
 *
 * 覆盖：加载/保存、成员归属、重名与空名校验、按作用域更新成员、删除、
 * 文件损坏回退为空配置。
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deleteGroup, groupsFile, groupsForSkill, loadGroups, upsertGroup } from "../lib/groups.js";

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

const home = join(tmpdir(), "dsh-skill-groups-test-" + process.pid);

async function main() {
  await rm(home, { recursive: true, force: true });
  await mkdir(join(home, "skills"), { recursive: true });

  // 1) 空配置
  const empty = await loadGroups(home);
  check(Object.keys(empty).length === 0, "missing file loads as empty");

  // 2) 新建分组（全局成员）
  const id1 = await upsertGroup(home, undefined, "工作相关", "global", ["skill-a", "skill-b"]);
  check(typeof id1 === "string" && id1.length > 0, "upsert creates an id");
  const loaded1 = await loadGroups(home);
  check(loaded1[id1]?.name === "工作相关", "name persisted");
  check(JSON.stringify(loaded1[id1].scopes.global) === JSON.stringify(["skill-a", "skill-b"]), "global members persisted");
  check(JSON.stringify(groupsForSkill(loaded1, "global", "skill-a")) === JSON.stringify(["工作相关"]), "membership lookup by (scope, name)");
  check(groupsForSkill(loaded1, "global", "skill-x").length === 0, "non-member not matched");
  check(groupsForSkill(loaded1, "C:\\other", "skill-a").length === 0, "different scope not matched");

  // 3) 更新：改名 + 增加工作区成员
  await upsertGroup(home, id1, "工作相关V2", "C:\\ws", ["skill-c"]);
  const loaded2 = await loadGroups(home);
  check(loaded2[id1].name === "工作相关V2", "rename persisted");
  check(JSON.stringify(loaded2[id1].scopes.global) === JSON.stringify(["skill-a", "skill-b"]), "other scope members untouched");
  check(JSON.stringify(loaded2[id1].scopes["C:\\ws"]) === JSON.stringify(["skill-c"]), "workspace members persisted");

  // 4) 重名拒绝（忽略大小写）
  await rejects(upsertGroup(home, undefined, "工作相关v2", "global", ["x"]), "duplicate name rejected (case-insensitive)");

  // 5) 空名拒绝
  await rejects(upsertGroup(home, undefined, "   ", "global", ["x"]), "blank name rejected");

  // 6) 清空某作用域成员 → 删除该作用域条目
  await upsertGroup(home, id1, "工作相关V2", "global", []);
  const loaded3 = await loadGroups(home);
  check(loaded3[id1].scopes.global === undefined, "empty member list clears the scope entry");

  // 7) 删除分组
  const deleted = await deleteGroup(home, id1);
  check(deleted === true, "deleteGroup reports true");
  check(Object.keys(await loadGroups(home)).length === 0, "group removed from config");
  check((await deleteGroup(home, id1)) === false, "deleting unknown id reports false");

  // 8) 文件损坏 → 空配置
  await writeFile(groupsFile(home), "{ not json !!!", "utf8");
  check(Object.keys(await loadGroups(home)).length === 0, "corrupted file loads as empty");

  await rm(home, { recursive: true, force: true });
  console.log("---");
  console.log(passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
  console.log("ALL TESTS PASSED");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
