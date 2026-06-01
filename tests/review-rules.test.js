import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("Dell preview parallel names specific companies", async () => {
  const items = JSON.parse(await fs.readFile("data/seed-items.json", "utf8"));
  const dell = items.find((item) => item.id === "seed-dell-ai-servers");
  assert.match(dell.analysis.parallel.precedent, /Amazon AWS/);
  assert.match(dell.analysis.parallel.precedent, /Microsoft Azure/);
  assert.match(dell.analysis.parallel.precedent, /Arista Networks/);
  assert.match(dell.analysis.parallel.precedent, /Equinix/);
});
