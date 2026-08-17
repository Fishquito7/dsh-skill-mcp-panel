import assert from "node:assert/strict";
import { compareVersions, fetchUpdateCheck } from "./lib/version.js";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

async function withFetch(response, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => response;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

// 1. successful latest release
const ok = await withFetch({
  status: 200,
  ok: true,
  body: { cancel: async () => {} },
  json: async () => ({ tag_name: "v9.9.9" })
}, () => fetchUpdateCheck());
assert.deepEqual(ok, { latest: "9.9.9", updateAvailable: true, rateLimited: false });
pass("GitHub API success parses tag_name and reports update");

// 2. rate limited
const limited = await withFetch({
  status: 403,
  ok: false,
  body: { cancel: async () => {} },
  json: async () => ({})
}, () => fetchUpdateCheck());
assert.equal(limited.rateLimited, true);
assert.equal(limited.latest, null);
assert.equal(limited.updateAvailable, false);
pass("GitHub API 403 reports rateLimited instead of up-to-date");

// 3. 404
const missing = await withFetch({
  status: 404,
  ok: false,
  body: { cancel: async () => {} },
  json: async () => ({})
}, () => fetchUpdateCheck());
assert.equal(missing.latest, null);
assert.match(missing.error ?? "", /404/);
pass("GitHub API 404 reports error");

// 4. malformed body
const malformed = await withFetch({
  status: 200,
  ok: true,
  body: { cancel: async () => {} },
  json: async () => ({})
}, () => fetchUpdateCheck());
assert.equal(malformed.latest, null);
assert.match(malformed.error ?? "", /tag_name/);
pass("missing tag_name reports error");

// 5. compareVersions
assert.ok(compareVersions("2.0.0", "1.9.9") > 0);
assert.ok(compareVersions("v2", "2") === 0);
assert.ok(compareVersions("2.0", "2.0.0") === 0);
assert.ok(compareVersions("2.0.0-rc.1", "2.0.0") > 0); // known limitation: no prerelease semantics
pass("compareVersions keeps legacy numeric-segment semantics");

console.log("\n" + passed + " passed, 0 failed");
console.log("ALL VERSION TESTS PASSED");
