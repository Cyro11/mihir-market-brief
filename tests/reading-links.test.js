import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("market watch renders price cards and keeps linked source data", async () => {
  const html = await fs.readFile("moves.html", "utf8");
  assert.match(html, /Market Watch/);
  assert.match(html, /SPY/);
  assert.match(html, /QQQ/);
  assert.match(html, /IWM/);
  assert.match(html, /GLD/);
  assert.match(html, /Oil/);
  assert.match(html, /Price source:/);
});
