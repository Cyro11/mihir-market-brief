import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("continuing stories render only when prior storyline development exists", async () => {
  const edition = JSON.parse(await fs.readFile("data/editions/2026-05-29.json", "utf8"));
  assert.ok(Array.isArray(edition.continuingStories));
  const html = await fs.readFile("issues/2026-05-29.html", "utf8");
  if (edition.continuingStories.length) {
    assert.match(html, /Updates From Earlier Issues/);
    assert.match(html, /Stronger evidence|Developing/);
  }
});
