import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("rendered Market Watch page exposes live quote hooks and stale-data placeholders", async () => {
  const html = await fs.readFile("moves.html", "utf8");
  assert.match(html, /data-market-watch/);
  assert.match(html, /assets\/market-watch-live\.js/);
  assert.match(html, /data-market-watch-status/);
  assert.match(html, /data-market-price/);
  assert.match(html, /data-market-change/);
  assert.match(html, /data-market-timestamp/);
  assert.match(html, /data-market-source/);
  assert.match(html, /data-market-symbol="USO"/);
  assert.match(html, /Oil proxy \(USO ETF\)/);
});

test("live Market Watch client prefers Yahoo chart data and has visible failure states", async () => {
  const script = await fs.readFile("assets/market-watch-live.js", "utf8");
  assert.match(script, /query1\.finance\.yahoo\.com\/v8\/finance\/chart/);
  assert.match(script, /DOMContentLoaded/);
  assert.match(script, /setInterval\(refreshMarketWatch/);
  assert.match(script, /Live quote source blocked or unavailable/);
  assert.match(script, /dataset\.marketLive/);
});
