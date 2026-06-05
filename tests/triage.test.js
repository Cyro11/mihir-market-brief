import test from "node:test";
import assert from "node:assert/strict";
import { freshnessStatus } from "../scripts/utils.js";
import { hasTrustedDomain, marketSignalScore, scoreCandidate, selectCandidates } from "../scripts/triage.js";

const themes = [
  { id: "rates", name: "Rates", keywords: ["fed", "yield", "inflation"] },
  { id: "deals", name: "Deals", keywords: ["merger", "activist"] }
];

test("freshness labels recent and background items", () => {
  const now = new Date("2026-05-29T14:00:00Z");
  assert.equal(freshnessStatus("2026-05-29T13:30:00Z", now), "LIVE");
  assert.equal(freshnessStatus("2026-05-29T08:30:00Z", now), "FRESH");
  assert.equal(freshnessStatus("2026-05-28T08:30:00Z", now), "BACKGROUND");
});

test("candidate scoring requires evidence and source trail", () => {
  const now = new Date("2026-05-29T14:00:00Z");
  const scored = scoreCandidate({
    id: "x",
    source: "BEA",
    sourceType: "official",
    title: "Inflation report moves rate expectations",
    url: "https://example.com/report",
    publishedAt: "2026-05-29T12:00:00Z",
    summary: "A sourced inflation report with enough detail to affect the rates setup and valuation assumptions.",
    facts: ["Inflation reports can affect yields."],
    topics: ["inflation", "rates"]
  }, themes, now);
  assert.equal(scored.eligible, true);
  assert.equal(scored.freshnessStatus, "FRESH");
  assert.ok(scored.scores.total > 0);
});

test("weak or missing-url items are excluded", () => {
  const scored = scoreCandidate({
    id: "weak",
    source: "Unknown",
    sourceType: "background",
    title: "Vague market chatter",
    url: "",
    publishedAt: "2026-05-29T12:00:00Z",
    summary: "Thin.",
    topics: ["markets"]
  }, themes, new Date("2026-05-29T14:00:00Z"));
  assert.equal(scored.eligible, false);
  assert.match(scored.exclusionReason, /missing source URL/);
});

test("background items are excluded from the main tape", () => {
  const scored = scoreCandidate({
    id: "old",
    source: "BEA",
    sourceType: "official",
    title: "Old inflation background",
    url: "https://example.com/old",
    publishedAt: "2026-05-28T12:00:00Z",
    summary: "A detailed source-backed item that is useful as context but too old for today's main tape.",
    facts: ["Fact"],
    topics: ["inflation", "rates"]
  }, themes, new Date("2026-05-30T14:00:00Z"));
  assert.equal(scored.eligible, false);
  assert.match(scored.exclusionReason, /background item/);
});

test("noise items are excluded even when finance-adjacent feeds label them broadly", () => {
  const scored = scoreCandidate({
    id: "noise",
    source: "Yahoo Finance / Private Credit Proxies",
    sourceType: "reputable",
    feedId: "private-credit-public-proxies",
    title: "A $720,000 Income Portfolio That Quietly Pays Like a Cash-Flowing Indianapolis Duplex Without the Tenant Calls",
    url: "https://247wallst.com/personal-finance/example",
    publishedAt: "2026-06-01T13:22:27.000Z",
    summary: "A retirement portfolio compares rental income with dividend securities for retirees.",
    facts: ["Fact one", "Fact two"],
    topics: ["private_markets", "private_credit", "credit", "markets"]
  }, themes, new Date("2026-06-01T17:30:00Z"));
  assert.equal(scored.eligible, false);
  assert.match(scored.exclusionReason, /weak market signal/);
});

test("market signal scoring keeps real deal items above generic conference promos", () => {
  assert.ok(marketSignalScore({
    title: "Yum Brands in talks to sell Pizza Hut to private equity firm",
    summary: "The reported sale would be a real sponsor transaction with deal implications.",
    url: "https://example.com/deal",
    facts: ["Fact one", "Fact two"],
    feedId: "private-equity-public-proxies"
  }) >= 2);
  assert.ok(marketSignalScore({
    title: "Route Revealed for Next Week's Hot Rod Power Tour",
    summary: "A press release about a car show celebration.",
    url: "https://example.com/promo",
    facts: ["Fact one"],
    feedId: "prnewswire-private-equity"
  }) < 2);
});

test("generic financial-sector proxy-feed articles do not clear private-market signal", () => {
  const scored = scoreCandidate({
    id: "generic-financials",
    source: "Yahoo Finance / Public PE Managers",
    sourceType: "reputable",
    feedId: "private-equity-public-proxies",
    title: "3 Financials Stocks That Concern Us",
    url: "https://finance.yahoo.com/markets/stocks/articles/3-financials-stocks-concern-us-134414521.html",
    publishedAt: "2026-06-05T13:44:14.000Z",
    summary: "Financial institutions play a critical role, offering everything from consumer banking to wealth management and specialized financial solutions. But uncertainty about fiscal and monetary policy has tempered enthusiasm.",
    facts: ["Financial institutions play a critical role."],
    topics: ["private_markets", "private_equity", "markets", "companies"]
  }, themes, new Date("2026-06-05T16:39:00Z"));

  assert.equal(scored.eligible, false);
  assert.match(scored.exclusionReason, /weak market signal/);
});

test("proxy-feed analyst-rating listicles do not clear private-market signal", () => {
  const scored = scoreCandidate({
    id: "generic-carlyle-rating",
    source: "Yahoo Finance / Public PE Managers",
    sourceType: "reputable",
    feedId: "private-equity-public-proxies",
    title: "TD Cowen Turns More Cautious on Carlyle Group (CG) After Q1 Results",
    url: "https://finance.yahoo.com/markets/stocks/articles/td-cowen-turns-more-cautious-021351334.html",
    publishedAt: "2026-06-05T02:13:51.000Z",
    summary: "The Carlyle Group Inc. is included among the 10 Oversold Dividend Growth Stocks to Buy. TD Cowen reduced its price recommendation and reiterated a Hold rating on the stock after first-quarter earnings reports.",
    facts: ["TD Cowen reduced its price recommendation."],
    topics: ["private_markets", "private_equity", "markets", "companies"]
  }, themes, new Date("2026-06-05T16:39:00Z"));

  assert.equal(scored.eligible, false);
  assert.match(scored.exclusionReason, /weak market signal/);
});

test("trusted-domain gate excludes syndicated or promotional domains outside the source set", () => {
  assert.equal(hasTrustedDomain({ url: "https://finance.yahoo.com/markets/stocks/articles/kkr-present-morgan-stanley-us-201500545.html" }), true);
  assert.equal(hasTrustedDomain({ url: "https://247wallst.com/investing/example" }), false);
  assert.equal(hasTrustedDomain({ url: "https://www.prnewswire.com/news-releases/example.html" }), false);
});

test("selection caps the edition instead of stuffing it", () => {
  const now = new Date("2026-05-29T14:00:00Z");
  const items = Array.from({ length: 8 }, (_, index) => scoreCandidate({
    id: `item-${index}`,
    source: "BEA",
    sourceType: "official",
    title: `Fed yield inflation item ${index}`,
    url: `https://example.com/${index}`,
    publishedAt: "2026-05-29T12:00:00Z",
    summary: "A detailed source-backed item with enough factual support for banker analysis and market implications.",
    facts: ["Fact"],
    topics: [index % 2 ? "rates" : "deals"]
  }, themes, now));
  assert.ok(selectCandidates(items, 5).length <= 5);
});

test("selection skips low-score filler even when fresh", () => {
  const selected = selectCandidates([
    {
      id: "filler",
      eligible: true,
      topics: ["regulation"],
      scores: { total: 26 }
    }
  ], 5);
  assert.equal(selected.length, 0);
});

test("short theme keywords match whole terms only", () => {
  const scored = scoreCandidate({
    id: "climate",
    source: "SEC",
    sourceType: "official",
    title: "Climate-related disclosure rules",
    url: "https://example.com/sec",
    publishedAt: "2026-05-29T12:00:00Z",
    summary: "A regulation item with no standalone artificial intelligence term.",
    facts: ["Fact"],
    topics: ["regulation"]
  }, [{ id: "ai", name: "AI", keywords: ["ai"] }], new Date("2026-05-29T14:00:00Z"));
  assert.equal(scored.matchedThemes.length, 0);
});
