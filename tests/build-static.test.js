import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const run = promisify(execFile);

test("static build publishes the first-class overnight page", async () => {
  await run(process.execPath, ["scripts/build-static.js"]);
  const [rootHtml, distHtml] = await Promise.all([
    fs.readFile("overnight.html", "utf8"),
    fs.readFile("dist/overnight.html", "utf8")
  ]);

  assert.equal(distHtml, rootHtml);
  assert.match(distHtml, /Big News Before The Open/);
});