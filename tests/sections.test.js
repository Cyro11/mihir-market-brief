import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { bankerAnalysis, editorialLaneFor, privateMarketSegmentFor, selectLaneItems, selectMainCandidates } from "../scripts/build-edition.js";

test("editorial lane classification separates macro, markets, deals, and private markets", () => {
  assert.equal(editorialLaneFor({
    title: "Personal Income and Outlays, April 2026",
    summary: "PCE and rates are back in focus after the latest official release.",
    topics: ["macro", "inflation"]
  }), "macro");

  assert.equal(editorialLaneFor({
    title: "Dell shares jump after AI server demand",
    summary: "A public equity move with sector read-through.",
    topics: ["markets", "companies"]
  }), "markets");

  assert.equal(editorialLaneFor({
    title: "Activist builds stake amid acquisition",
    summary: "Deal certainty and shareholder pressure changed.",
    topics: ["companies"]
  }), "deals");

  assert.equal(editorialLaneFor({
    title: "Private credit supports sponsor refinancing",
    summary: "Private equity exit window and secondaries are in focus.",
    topics: ["credit"]
  }), "private_markets");
});

test("private market segment classification separates equity and credit", () => {
  assert.equal(privateMarketSegmentFor({
    title: "KKR signs platform acquisition",
    summary: "Sponsor buyout deal tests private equity exit window.",
    topics: ["private_markets", "private_equity"]
  }), "private_equity");

  assert.equal(privateMarketSegmentFor({
    title: "Blue Owl direct lending originations rise",
    summary: "Private credit spreads and refinancing demand are in focus.",
    topics: ["private_markets", "private_credit"]
  }), "private_credit");
});

test("section buckets cap each lane and private-market segment", () => {
  const analyses = [
    ...Array.from({ length: 4 }, (_, index) => ({ id: `x-${index}`, editorialLane: "macro" })),
    ...Array.from({ length: 4 }, (_, index) => ({ id: `m-${index}`, editorialLane: "markets" })),
    ...Array.from({ length: 4 }, (_, index) => ({ id: `d-${index}`, editorialLane: "deals" })),
    ...Array.from({ length: 4 }, (_, index) => ({ id: `p-${index}`, editorialLane: "private_markets", privateMarketSegment: index % 2 ? "private_credit" : "private_equity" }))
  ];
  const sections = selectLaneItems(analyses, 3);
  assert.equal(sections.macro.items.length, 3);
  assert.equal(sections.markets.items.length, 3);
  assert.equal(sections.deals.items.length, 3);
  assert.equal(sections.privateMarkets.items.length, 3);
  assert.equal(sections.privateMarkets.segments.privateEquity.items.length, 2);
  assert.equal(sections.privateMarkets.segments.privateCredit.items.length, 2);
});

test("rendered edition includes first-class section tabs and empty-state language", async () => {
  const html = await fs.readFile("index.html", "utf8");
  assert.match(html, /macro\.html/);
  assert.match(html, /markets\.html/);
  assert.match(html, /deals\.html/);
  assert.match(html, /private-markets\.html/);
  assert.match(html, /Section Tape/);

  const macroHtml = await fs.readFile("macro.html", "utf8");
  assert.match(macroHtml, /Macro Environment/);
  assert.match(macroHtml, /Economic Calendar/);
  assert.match(macroHtml, /Latest Event|No fresh macro release/);
  // Quiet macro days can render without expandable stories.
  assert.match(macroHtml, /Read full analysis|Hide full analysis|No fresh macro release/);
  assert.match(macroHtml, /Plain-English takeaway|No fresh macro release/);

  const privateHtml = await fs.readFile("private-markets.html", "utf8");
  assert.match(privateHtml, /Private Market Signals/);
  assert.match(privateHtml, /Private Equity/);
  assert.match(privateHtml, /Private Credit/);
  assert.match(privateHtml, /No strong signal today|KKR|Blue Owl|direct lending|Private markets watch/);
  assert.match(privateHtml, /What the public signal is actually telling us|How to read the sponsor or exit implication|How to interpret the financing signal/);
});

test("main tape remains cross-section after private-market expansion", async () => {
  const edition = JSON.parse(await fs.readFile("data/editions/2026-05-29.json", "utf8"));
  const counts = edition.moves.reduce((acc, move) => {
    acc[move.editorialLane] = (acc[move.editorialLane] || 0) + 1;
    return acc;
  }, {});
  assert.ok((counts.private_markets || 0) <= 2);
});

test("main tape avoids repeating the same recent lead unless it is clearly strongest", () => {
  const privateCredit = {
    title: "Blue Owl direct lending keeps private credit in focus",
    summary: "Private credit direct lending originations and refinancing demand remain relevant.",
    topics: ["private_markets", "private_credit", "credit"],
    eligible: true,
    scores: { total: 45 }
  };
  const markets = {
    title: "Semiconductor shares lead the tape higher",
    summary: "Markets repriced a public equity leadership move with broad sector read-through.",
    topics: ["markets", "companies"],
    eligible: true,
    scores: { total: 40 }
  };
  const macro = {
    title: "Inflation report changes the rate path",
    summary: "Macro and inflation data shifted the market's interpretation of rates.",
    topics: ["macro", "inflation"],
    eligible: true,
    scores: { total: 38 }
  };
  const prior = [
    { edition: { moves: [{ title: "Blue Owl direct lending update", summary: "Private credit was the lead.", topics: ["private_markets", "private_credit"] }] } }
  ];

  const selected = selectMainCandidates([privateCredit, markets, macro], 3, prior);
  assert.equal(selected[0].title, markets.title);
});

test("lead-repeat discipline applies to any topic, not only private credit", () => {
  const macroRepeat = {
    title: "Inflation report keeps rates in focus",
    summary: "Macro inflation data remained important for the rate path and broad market pricing.",
    topics: ["macro", "inflation", "rates"],
    eligible: true,
    scores: { total: 44 }
  };
  const dealFresh = {
    title: "Activist stake changes deal-certainty read",
    summary: "A new shareholder situation shifted the market's view of transaction risk and governance.",
    topics: ["deals", "companies"],
    eligible: true,
    scores: { total: 41 }
  };
  const marketsFresh = {
    title: "AI infrastructure suppliers lead public equities",
    summary: "Markets repriced a public equity leadership move with broad sector implications.",
    topics: ["markets", "companies", "ai"],
    eligible: true,
    scores: { total: 39 }
  };
  const prior = [
    { edition: { moves: [{ title: "PCE keeps rates in focus", summary: "Macro inflation led the issue.", topics: ["macro", "inflation"] }] } }
  ];

  const selected = selectMainCandidates([macroRepeat, dealFresh, marketsFresh], 3, prior);
  assert.equal(selected[0].title, dealFresh.title);
});

test("edition stories now carry summary and longform teaching sections", async () => {
  const edition = JSON.parse(await fs.readFile("data/editions/2026-05-29.json", "utf8"));
  for (const move of edition.moves) {
    assert.ok(move.summary && move.summary.length > 80);
    assert.ok(Array.isArray(move.longform?.sections));
    assert.ok(move.longform.sections.length >= 5);
    assert.ok(move.longform.sections.every((section) => section.heading && section.body && section.body.length > 120));
  }
});

function fixture(overrides) {
  return {
    id: "fixture",
    title: "Fixture",
    summary: "A fresh source-backed fixture with enough detail to support deterministic analysis.",
    source: "Reuters",
    url: "https://www.reuters.com/markets/deals/example",
    sourceType: "news",
    freshnessStatus: "FRESH",
    topics: ["private_markets"],
    matchedThemes: [],
    ...overrides
  };
}

test("private-market AI infrastructure stories get TPU/data-center-specific analysis instead of generic sponsor copy", () => {
  const analysis = bankerAnalysis(fixture({
    title: "Blackstone weighs financing tied to Google TPU capacity for Anthropic",
    summary: "Blackstone, Google and Anthropic are tied to a possible TPU and data-center financing package.",
    topics: ["private_markets", "private_equity", "ai"]
  }));
  const bodies = analysis.longform.sections.map((section) => section.body).join("\n");
  assert.match(analysis.summary, /contracted compute demand|chip obsolescence|power constraints/);
  assert.match(bodies, /infrastructure-finance story wearing an AI headline/);
  assert.match(bodies, /TPU|data-center|power|collateral|utilization/);
  assert.doesNotMatch(bodies, /gossip about private marks/);
});

test("private credit structured-note stories analyze collateral, seniority, and losses", () => {
  const analysis = bankerAnalysis(fixture({
    title: "Private credit structured notes draw demand from yield buyers",
    summary: "A direct-lending manager is marketing structured notes backed by private credit collateral.",
    topics: ["private_markets", "private_credit", "credit"]
  }));
  const bodies = analysis.longform.sections.map((section) => section.body).join("\n");
  assert.match(analysis.summary, /collateral and downside protection/);
  assert.match(bodies, /cash flows, collateral, covenants, and seniority/);
  assert.match(bodies, /non-accrual|advance rates|attachment point|PIK/);
});

test("sponsor-exit stories separate real liquidity from continuation-style deferral", () => {
  const analysis = bankerAnalysis(fixture({
    title: "KKR sponsor exit talks test secondaries and IPO window",
    summary: "A sponsor-owned company is evaluating an exit through a sale process, secondary deal, or IPO.",
    topics: ["private_markets", "private_equity"]
  }));
  const bodies = analysis.longform.sections.map((section) => section.body).join("\n");
  assert.match(analysis.summary, /monetization path|valuation reckoning/);
  assert.match(bodies, /return cash to LPs|true buyer|hold the asset longer/);
  assert.match(bodies, /public comps set the valuation ceiling|LP liquidity pressure/);
});
