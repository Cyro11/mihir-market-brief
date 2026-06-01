import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("rendered brief includes highlight notes and Ask AI prompt feature", async () => {
  const notesHtml = await fs.readFile("notes.html", "utf8");
  const movesHtml = await fs.readFile("moves.html", "utf8");
  const marketsHtml = await fs.readFile("markets.html", "utf8");
  assert.match(notesHtml, /Notes \/ Questions/);
  assert.match(notesHtml, /opening-ledger-notes-v1/);
  assert.match(notesHtml, /window\.name/);
  assert.match(notesHtml, /Full story context/);
  assert.match(notesHtml, /Detailed analysis from the brief/);
  assert.match(notesHtml, /Historical\/market parallel from the brief/);
  assert.match(notesHtml, /Ask AI/);
  assert.match(notesHtml, /Copy prompt/);
  assert.match(notesHtml, /execCommand\("copy"\)/);
  assert.match(notesHtml, /Copied to clipboard/);
  assert.match(notesHtml, /Highlight any passage/);
  assert.match(movesHtml, /data-context/);
  assert.match(movesHtml, /&quot;valuation&quot;/);
  assert.match(marketsHtml, /&quot;longform&quot;/);
});
