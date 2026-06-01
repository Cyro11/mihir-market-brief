import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("review command is present and node can load it", () => {
  const result = spawnSync(process.execPath, ["--check", "scripts/review-edition.js"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
