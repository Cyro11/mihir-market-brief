import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { buildDealTape, scoreDealCandidate } from "../scripts/deal-tape.js";

const now = new Date("2026-06-02T12:00:00.000Z");

function item(overrides = {}) {
  return {
    id: overrides.id || "item-1",
    source: overrides.source || "Reuters",
    sourceType: overrides.sourceType || "trusted",
    title: overrides.title || "Blackstone and Google form $5 billion AI data center joint venture",
    summary: overrides.summary || "A strategic joint venture includes a $5 billion equity commitment, data center capacity, financing implications, and sponsor read-through.",
    url: overrides.url || `https://www.reuters.com/${overrides.id || "item-1"}`,
    publishedAt: overrides.publishedAt || "2026-06-02T09:00:00.000Z",
    fetchedAt: "2026-06-02T10:00:00.000Z",
    topics: overrides.topics || ["private_markets", "deals"],
    tickers: overrides.tickers || ["BX"],
    facts: overrides.facts || ["$5 billion commitment", "joint venture"],
    freshnessStatus: overrides.freshnessStatus || "FRESH",
    scores: overrides.scores || { total: 52 },
    ...overrides
  };
}

test("deal scoring accepts older high-impact deal items instead of only today's generic deal lane", () => {
  const olderMajorDeal = item({
    id: "older-major",
    title: "Blackstone closes record $13 billion Asia private equity fund and data center venture",
    summary: "The record fund close and strategic venture are older than today but still reshape sponsor capacity and deal financing read-through.",
    publishedAt: "2026-05-18T12:00:00.000Z",
    freshnessStatus: "BACKGROUND",
    topics: ["private_markets", "private_equity"],
    scores: { total: 48 }
  });

  const score = scoreDealCandidate(olderMajorDeal, now);
  assert.ok(score);
  assert.ok(score.dealStrength > score.updateStrength);

  const tape = buildDealTape([olderMajorDeal], { now, minimumScore: 30 });
  assert.equal(tape.length, 1);
  assert.equal(tape[0].title, olderMajorDeal.title);
  assert.equal(tape[0].dealStrength.label, "High");
});

test("deal tape ranks stronger transaction above fresher weak financing mention", () => {
  const major = item({
    id: "major",
    title: "Blackstone and Google form $5 billion AI data center joint venture",
    publishedAt: "2026-05-25T12:00:00.000Z",
    freshnessStatus: "BACKGROUND",
    scores: { total: 55 }
  });
  const weakFresh = item({
    id: "weak-fresh",
    title: "Company comments on routine debt refinancing update",
    summary: "A routine refinancing update with limited valuation or control implications.",
    publishedAt: "2026-06-02T10:30:00.000Z",
    freshnessStatus: "LIVE",
    topics: ["credit"],
    tickers: ["ABC"],
    scores: { total: 32 }
  });

  const tape = buildDealTape([weakFresh, major], { now, minimumScore: 20 });
  assert.equal(tape[0].title, major.title);
  assert.ok(tape[0].rankScore > tape[1].rankScore);
});

test("deal tape clusters related source items and preserves source trail", () => {
  const first = item({ id: "source-a", source: "Reuters", url: "https://www.reuters.com/a", tickers: ["BX"] });
  const second = item({ id: "source-b", source: "Yahoo Finance", url: "https://finance.yahoo.com/b", tickers: ["BX"], publishedAt: "2026-06-01T12:00:00.000Z" });

  const tape = buildDealTape([first, second], { now, minimumScore: 20 });
  assert.equal(tape.length, 1);
  assert.equal(tape[0].clusteredItemCount, 2);
  assert.deepEqual(tape[0].relatedItemIds.sort(), ["source-a", "source-b"]);
  assert.equal(tape[0].sourceTrail.length, 2);
});

test("deal tape rejects promotional certification courses without a transaction fact", () => {
  const promo = item({
    id: "certification-promo",
    title: "AI Coalition officially opens the Free AI for Social Impact Certification Program",
    summary: "Free course content trains practitioners through a product-agnostic certification program.",
    topics: ["private_markets"],
    tickers: []
  });

  assert.equal(scoreDealCandidate(promo, now), null);
});

test("deal tape rejects dividend-stock listicles with incidental acquisition language", () => {
  const listicle = item({
    id: "blackstone-dividend-listicle",
    title: "Is Blackstone Inc. One of the Best Dividend Stocks to Invest in According to a Hedge Fund?",
    summary: "The stock screen calls Blackstone a top dividend stock and incidentally recaps an older acquisition by one of its funds.",
    publishedAt: "2026-06-01T13:33:00.000Z",
    topics: ["private_markets", "private_equity", "markets"]
  });

  assert.equal(scoreDealCandidate(listicle, now), null);
});

test("rendered deals page uses ranked deal tape language and fields", async () => {
  const html = await fs.readFile("deals.html", "utf8");
  assert.match(html, /Ranked Deal Tape|No ranked deal tape yet/);
  assert.match(html, /Deal strength|No ranked deal tape yet/);
  assert.match(html, /Update strength|No ranked deal tape yet/);
  assert.match(html, /Why it ranks|No ranked deal tape yet/);
  assert.match(html, /Source trail|No ranked deal tape yet/);
});
