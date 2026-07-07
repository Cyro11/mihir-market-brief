import test from "node:test";
import assert from "node:assert/strict";
import { clusterStories, representativeItemsFromClusters } from "../scripts/story-clusters.js";
import { scoreCandidate } from "../scripts/triage.js";
import { parseRss } from "../scripts/fetch-sources.js";

const themes = [
  { id: "deals", name: "Deals", keywords: ["acquisition", "merger", "ipo"] },
  { id: "rates", name: "Rates", keywords: ["fed", "rate", "inflation"] }
];
const now = new Date("2026-07-06T15:00:00Z");

function scored(overrides) {
  return scoreCandidate({
    id: overrides.id,
    source: overrides.source || "CNBC",
    sourceType: "reputable",
    title: overrides.title,
    url: overrides.url || `https://www.cnbc.com/${overrides.id}.html`,
    publishedAt: overrides.publishedAt || "2026-07-06T13:00:00Z",
    summary: overrides.summary || "A detailed source-backed market story with enough facts to support an editorial read for bankers and investors.",
    facts: overrides.facts || ["Fact one", "Fact two"],
    tickers: overrides.tickers || [],
    topics: overrides.topics || ["deals", "companies"],
    feedId: overrides.feedId || "cnbc-finance",
    ...overrides
  }, themes, now);
}

test("two articles on the same event cluster together and preserve source trail", () => {
  const items = [
    scored({
      id: "cnbc-alpha-beta",
      source: "CNBC",
      title: "Alpha Corp to acquire Beta Systems in $12 billion deal",
      url: "https://www.cnbc.com/2026/07/06/alpha-acquires-beta.html",
      tickers: ["ALPH", "BETA"]
    }),
    scored({
      id: "mw-alpha-beta",
      source: "MarketWatch",
      title: "Beta Systems shares jump after Alpha Corp announces $12 billion acquisition",
      url: "https://www.marketwatch.com/story/beta-systems-alpha-corp-acquisition",
      tickers: ["ALPH", "BETA"]
    })
  ];

  const clusters = clusterStories(items);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].coverageCount, 2);
  assert.equal(clusters[0].sourceDiversity, 2);
  assert.deepEqual(clusters[0].sourceTrail.map((entry) => entry.source).sort(), ["CNBC", "MarketWatch"]);
});

test("multi-source story cluster outranks a single thin headline", () => {
  const multiSource = [
    scored({
      id: "cnbc-fed",
      source: "CNBC",
      title: "Fed rate-cut odds shift after inflation report",
      url: "https://www.cnbc.com/2026/07/06/fed-rate-cut-inflation.html",
      topics: ["macro", "rates", "inflation"]
    }),
    scored({
      id: "mw-fed",
      source: "MarketWatch",
      title: "Treasury yields fall as Fed rate-cut bets shift after inflation data",
      url: "https://www.marketwatch.com/story/fed-rate-cut-inflation-yields",
      topics: ["macro", "rates", "inflation"]
    })
  ];
  const single = scored({
    id: "single-ipo",
    source: "CNBC",
    title: "Small software IPO priced above range",
    url: "https://www.cnbc.com/2026/07/06/software-ipo.html",
    topics: ["ipo", "deals"]
  });

  const representatives = representativeItemsFromClusters(clusterStories([...multiSource, single]));
  assert.equal(representatives[0].storyCluster.coverageCount, 2);
  assert.match(representatives[0].title, /Fed|Treasury|inflation|rate/i);
  assert.ok(representatives[0].scores.total > single.scores.total);
});

test("derived thin RSS summary is tagged internal and cannot qualify as strong evidence alone", () => {
  const xml = `
    <rss><channel><item>
      <title>Stocks jump as IPO and acquisition headlines lift market</title>
      <link>https://finance.yahoo.com/news/stocks-jump-ipo-acquisition-123000000.html</link>
      <pubDate>Mon, 06 Jul 2026 13:00:00 GMT</pubDate>
    </item></channel></rss>`;
  const [item] = parseRss(xml, {
    id: "yahoo-finance-news",
    name: "Yahoo Finance",
    sourceType: "reputable",
    url: "https://finance.yahoo.com/news/rssindex",
    topics: ["markets", "companies"]
  }, "2026-07-06T13:05:00.000Z");

  assert.equal(item.internalDerivedSummary, true);
  assert.equal(item.evidenceType, "internal_derived");
  const scoredItem = scoreCandidate(item, themes, now);
  assert.equal(scoredItem.scores.internalDerived, 1);
  assert.equal(scoredItem.scores.factualEvidence, 0);
  assert.ok(scoredItem.scores.evidence < 4);
  assert.equal(scoredItem.eligible, false);
});
