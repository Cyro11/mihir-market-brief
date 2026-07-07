import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("visual data and rendered visual cards are present", async () => {
  await execFileAsync("node", ["scripts/render-edition.js"], {
    env: { ...process.env, BRIEF_DATE: "2026-05-29" }
  });

  try {
    const marketData = JSON.parse(await fs.readFile("data/market-data/2026-05-29.json", "utf8"));
    assert.ok(marketData.series.length > 0);
    assert.ok(marketData.series.every((series) => series.source && series.url));
    assert.ok(marketData.series.every((series) => series.observations.length > 0));

    const movesHtml = await fs.readFile("moves.html", "utf8");
    assert.match(movesHtml, /Market Watch/);
    assert.match(movesHtml, /Index Tape and Macro Crosswinds/);
    assert.match(movesHtml, /SPY|QQQ|IWM|GLD|WTI/);
    assert.doesNotMatch(movesHtml, /Visual \//);

    const overviewHtml = await fs.readFile("index.html", "utf8");
    assert.match(overviewHtml, /Today’s Market Map/);
    assert.match(overviewHtml, /Equity leadership|Oil \/ geopolitics/);

    const dealsHtml = await fs.readFile("deals.html", "utf8");
    assert.match(dealsHtml, /Transaction path and risk map|Deal risk map/);
    assert.match(dealsHtml, /Why this visual fits:/);
    assert.match(dealsHtml, /Read article|Hide article|editorial-article/);

    const macroHtml = await fs.readFile("macro.html", "utf8");
    assert.match(macroHtml, /Yield stack and Fed-path pressure|Rate backdrop/);
    assert.match(macroHtml, /Economic Calendar/);
    assert.match(macroHtml, /Why this visual fits:/);
    assert.match(macroHtml, /Yield \/ policy rate \(%\)|Rate \(%\)/);
    assert.match(macroHtml, /The question|Hide article|editorial-article/);

    const marketsHtml = await fs.readFile("markets.html", "utf8");
    assert.match(marketsHtml, /Semiconductor rebound board|Stock reaction|AI infrastructure read-through/);
    assert.match(marketsHtml, /Latest daily change|Price/);
    assert.match(marketsHtml, /Why this visual fits:/);
    assert.doesNotMatch(marketsHtml, /Credit window proxy|Rate backdrop/);
    assert.match(marketsHtml, /The question|Hide article|editorial-article/);

    const privateHtml = await fs.readFile("private-markets.html", "utf8");
    assert.match(privateHtml, /Public sponsor proxies|Sponsor exit paths/);
    assert.match(privateHtml, /Direct-lending public proxies|Credit window proxy/);
    assert.doesNotMatch(privateHtml, /Private-market signal map/);
    assert.match(privateHtml, /Why this visual fits:/);
    assert.match(privateHtml, /The question|Hide article|editorial-article/);

    const deepDiveHtml = await fs.readFile("deep-dive.html", "utf8");
    assert.match(deepDiveHtml, /Visual \//);
    assert.match(deepDiveHtml, /Hide article|editorial-article/);

    const themesHtml = await fs.readFile("themes.html", "utf8");
    assert.match(themesHtml, /Theme tracker/);
    assert.match(themesHtml, /Latest signal:/);
  } finally {
    await execFileAsync("node", ["scripts/render-edition.js"]);
  }
});
