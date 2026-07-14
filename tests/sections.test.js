import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { scoreCandidate } from "../scripts/triage.js";
import { bankerAnalysis, backfillWeekdaySections, buildOvernightSection, editorialLaneFor, overnightCandidates, privateMarketSegmentFor, selectLaneItems, selectMainCandidates, weekdaySectionBackfillCandidates } from "../scripts/build-edition.js";

test("editorial lane classification separates macro, markets, deals, and private markets", () => {
  assert.equal(editorialLaneFor({
    title: "SpaceX prices record IPO before Nasdaq debut",
    summary: "Reuters says SpaceX priced a record IPO with a valuation read-through.",
    topics: ["breaking", "ipo", "deals", "private_markets", "markets"]
  }), "breaking");

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
    title: "Trump says Iran called to make a deal after U.S. strikes; adds it's unclear if war is back on",
    summary: "A geopolitical headline affects risk appetite and oil, not transaction deal certainty.",
    topics: ["markets", "companies"]
  }), "markets");

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
  assert.deepEqual(sections.overnight.items, []);
  assert.ok(sections.breaking);
  assert.equal(sections.macro.items.length, 3);
  assert.equal(sections.markets.items.length, 3);
  assert.equal(sections.deals.items.length, 3);
  assert.equal(sections.privateMarkets.items.length, 3);
  assert.equal(sections.privateMarkets.segments.privateEquity.items.length, 2);
  assert.equal(sections.privateMarkets.segments.privateCredit.items.length, 2);
});

test("overnight tab selects source-backed high-impact stories from the overnight window", () => {
  const now = new Date("2026-06-09T08:00:00-04:00");
  const overnight = {
    id: "overnight-ai",
    title: "Nasdaq futures rise as chip stocks rally before the open",
    summary: "A source-backed overnight market story with enough detail to analyze index futures, chip leadership, and risk appetite before the U.S. open.",
    source: "CNBC",
    sourceType: "reputable",
    url: "https://www.cnbc.com/2026/06/09/stock-market-today-live-updates.html",
    publishedAt: "2026-06-09T10:30:00.000Z",
    freshnessStatus: "FRESH",
    topics: ["markets", "companies", "ai"],
    matchedThemes: [],
    scores: { evidence: 5, marketSignal: 3, trustedDomain: 1, total: 38 }
  };
  const stale = {
    ...overnight,
    id: "stale",
    title: "Old market story",
    publishedAt: "2026-06-08T12:00:00.000Z",
    scores: { evidence: 5, marketSignal: 3, trustedDomain: 1, total: 40 }
  };
  const weak = {
    ...overnight,
    id: "weak",
    title: "Lifestyle item",
    scores: { evidence: 5, marketSignal: 1, trustedDomain: 1, total: 50 }
  };

  assert.deepEqual(overnightCandidates([stale, weak, overnight], now).map((item) => item.id), ["overnight-ai"]);
  const section = buildOvernightSection([overnight], { series: [] }, now);
  assert.equal(section.items.length, 1);
  assert.equal(section.items[0].overnightSignal, true);
  assert.match(section.items[0].valuationImpact, /valuation|multiples|earnings|cash flows|discount rate|revenue|margin|growth/i);
});

test("weekday section backfill keeps macro, markets, and deals tabs from showing no signal on trading days", () => {
  const scored = [
    {
      id: "macro-backfill",
      title: "Fed rate path stays in focus as Treasury yields rise",
      summary: "A source-backed macro read with rates, Treasury yields, inflation expectations, and financing implications for the market.",
      source: "Yahoo Finance",
      sourceType: "reputable",
      url: "https://finance.yahoo.com/news/fed-rate-path-example",
      publishedAt: "2026-06-08T15:47:00.000Z",
      fetchedAt: "2026-06-08T20:00:00.000Z",
      freshnessStatus: "LIVE",
      topics: ["macro", "rates", "fed"],
      matchedThemes: [],
      scores: { evidence: 3, total: 31 }
    },
    {
      id: "markets-backfill",
      title: "Stock market today: S&P 500 and Nasdaq surge as chip stocks rebound",
      summary: "The public-market tape moved as AI and semiconductor leadership came back into focus after Friday's weakness.",
      source: "CNBC",
      sourceType: "reputable",
      url: "https://www.cnbc.com/2026/06/07/stock-market-today-live-updates.html",
      publishedAt: "2026-06-08T20:30:00.000Z",
      fetchedAt: "2026-06-08T20:31:00.000Z",
      freshnessStatus: "LIVE",
      topics: ["markets", "companies", "ai"],
      matchedThemes: [],
      scores: { evidence: 3, total: 30 }
    },
    {
      id: "deals-backfill",
      title: "J&J to buy cancer drug technology developer Firefly Bio for $1 billion",
      summary: "A Reuters-reported acquisition gives the deals desk a source-backed read on strategic pharma M&A and transaction appetite.",
      source: "Reuters",
      sourceType: "reputable",
      url: "https://www.reuters.com/markets/deals/jj-buy-cancer-drug-technology-developer-firefly-bio-1-billion-2026-06-08/",
      publishedAt: "2026-06-08T14:00:00.000Z",
      fetchedAt: "2026-06-08T20:01:00.000Z",
      freshnessStatus: "LIVE",
      topics: ["deals", "companies"],
      matchedThemes: [],
      scores: { evidence: 3, total: 33 }
    }
  ];

  assert.equal(editorialLaneFor(scored[1]), "markets");
  assert.equal(weekdaySectionBackfillCandidates(scored, "markets", "2026-06-08")[0].id, "markets-backfill");

  const sections = backfillWeekdaySections(selectLaneItems([], 3), scored, { series: [] }, "2026-06-08");
  assert.equal(sections.macro.items.length, 1);
  assert.equal(sections.markets.items.length, 1);
  assert.equal(sections.deals.items.length, 1);
  assert.equal(sections.macro.items[0].sectionBackfill, true);
});

test("weekday section backfill stays off on weekends", () => {
  const scored = [{
    id: "markets-backfill",
    title: "Stock market today: S&P 500 moves",
    summary: "A source-backed markets read with enough support.",
    source: "CNBC",
    sourceType: "reputable",
    url: "https://www.cnbc.com/example",
    publishedAt: "2026-06-06T14:00:00.000Z",
    freshnessStatus: "LIVE",
    topics: ["markets", "companies"],
    matchedThemes: [],
    scores: { evidence: 3, total: 31 }
  }];

  const sections = backfillWeekdaySections(selectLaneItems([], 3), scored, { series: [] }, "2026-06-06");
  assert.equal(sections.markets.items.length, 0);
});


test("major trusted IPO headlines can surface as breaking without lowering evidence threshold globally", () => {
  const now = new Date("2026-06-12T13:30:00Z");
  const themes = [];
  const titleOnlyTrustedIpo = scoreCandidate({
    id: "spacex-title-only",
    title: "SpaceX prices record IPO before Nasdaq debut",
    summary: "",
    source: "Yahoo Finance",
    sourceType: "reputable",
    url: "https://finance.yahoo.com/news/spacex-prices-record-ipo",
    publishedAt: "2026-06-12T12:00:00Z",
    topics: ["breaking", "ipo", "deals", "private_markets", "markets"]
  }, themes, now);
  assert.equal(titleOnlyTrustedIpo.scores.evidence, 3);
  assert.equal(titleOnlyTrustedIpo.scores.majorBreakingEvent, 1);
  assert.equal(titleOnlyTrustedIpo.eligible, true);
  assert.equal(editorialLaneFor(titleOnlyTrustedIpo), "breaking");

  const titleOnlyOrdinary = scoreCandidate({
    ...titleOnlyTrustedIpo,
    id: "ordinary-title-only",
    title: "Analyst turns cautious on dividend stock",
    topics: ["companies"]
  }, themes, now);
  assert.equal(titleOnlyOrdinary.scores.majorBreakingEvent, 0);
  assert.equal(titleOnlyOrdinary.eligible, false);
});

test("rendered edition includes first-class section tabs and empty-state language", async () => {
  const html = await fs.readFile("index.html", "utf8");
  assert.match(html, /overnight\.html\?v=\d{4}-\d{2}-\d{2}/);
  assert.match(html, /macro\.html\?v=\d{4}-\d{2}-\d{2}/);
  assert.match(html, /markets\.html\?v=\d{4}-\d{2}-\d{2}/);
  assert.match(html, /deals\.html\?v=\d{4}-\d{2}-\d{2}/);
  assert.match(html, /private-markets\.html\?v=\d{4}-\d{2}-\d{2}/);
  assert.match(html, /private-markets\.html\?v=\d{4}-\d{2}-\d{2}#private(?:Credit|Equity)-1/);
  assert.match(html, /Section Tape/);

  const macroHtml = await fs.readFile("macro.html", "utf8");
  const breakingHtml = await fs.readFile("breaking.html", "utf8");
  assert.match(breakingHtml, /Breaking Tape/);
  assert.match(breakingHtml, /Read article|Hide article|editorial-article|No strong signal today/);

  const overnightHtml = await fs.readFile("overnight.html", "utf8");
  assert.match(overnightHtml, /Big News Before The Open/);
  assert.match(overnightHtml, /market impact|No major overnight signal/i);
  assert.match(overnightHtml, /Valuation|No major overnight signal/);
  assert.match(macroHtml, /Macro Environment/);
  assert.match(macroHtml, /Economic Calendar/);
  assert.match(macroHtml, /Latest Event|No fresh macro release/);
  // Quiet macro days can render without expandable stories.
  assert.match(macroHtml, /Read article|Hide article|editorial-article|No fresh macro release/);
  assert.match(macroHtml, /Plain-English takeaway|editorial-article|No fresh macro release/);

  const privateHtml = await fs.readFile("private-markets.html", "utf8");
  assert.match(privateHtml, /Private Market Signals/);
  assert.match(privateHtml, /Private Equity/);
  assert.match(privateHtml, /Private Credit/);
  assert.match(privateHtml, /No strong signal today|KKR|Blue Owl|direct lending|Private markets watch/);
  assert.match(privateHtml, /The question|Hide article|editorial-article/);
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

test("banker analysis exposes reader-facing editorial fields without pipeline rationale", () => {
  const analysis = bankerAnalysis(fixture({
    title: "Nasdaq rises as AI software shares rally on stronger bookings",
    summary: "Nasdaq rises as AI software shares rally on stronger bookings. Current reputable-market headline with source URL, timestamp, and market-moving public-tape keywords; use as a thin RSS item only when the headline itself identifies the market move.",
    topics: ["markets", "ai", "companies"]
  }));
  const publicBlob = JSON.stringify({
    readerSummary: analysis.readerSummary,
    readerDek: analysis.readerDek,
    editorialArticle: analysis.editorialArticle,
    ibAngle: analysis.ibAngle,
    interviewLine: analysis.interviewLine,
    bankerQuestion: analysis.bankerQuestion
  });

  assert.match(analysis.readerDek, /read-through runs through/i);
  assert.match(analysis.editorialArticle.question, /\?/);
  assert.ok(analysis.editorialArticle.body.length >= 3);
  assert.match(analysis.editorialArticle.bankerSidebar.interviewUse, /valuation|financing|issuance|underwriting/i);
  assert.match(analysis.ibAngle, /IB interview|IB Angle|who pays|finances/i);
  assert.match(analysis.interviewLine, /Lead with the fact|Watch next/i);
  assert.match(analysis.bankerQuestion, /diligence/i);
  assert.doesNotMatch(publicBlob, /Current reputable-market headline|thin RSS item|source URL, timestamp|selected because|evidence bar|What changed today|Editorial thesis|Plain-English takeaway|The fresh fact|The new read is/i);
});

test("rendered overview is reader-facing and includes editor brief and article questions", async () => {
  const html = await fs.readFile("index.html", "utf8");
  const edition = JSON.parse(await fs.readFile("data/editions/2026-05-29.json", "utf8"));
  const publicEditionBlob = JSON.stringify({
    dek: edition.dek,
    editorsBrief: edition.editorsBrief,
    moves: edition.moves.map((move) => ({
      summary: move.summary,
      readerSummary: move.readerSummary,
      readerDek: move.readerDek,
      editorialThesis: move.editorialThesis,
      ibAngle: move.ibAngle,
      interviewLine: move.interviewLine,
      bankerQuestion: move.bankerQuestion,
      whatChangedToday: move.whatChangedToday,
      whyItMoved: move.whyItMoved,
      longform: move.longform
    }))
  });

  assert.match(html, /Editor's Brief/);
  assert.match(html, /30-second read/);
  assert.match(html, /The question/);
  assert.match(html, /Story 1/);
  assert.doesNotMatch(`${html}\n${publicEditionBlob}`, /Current reputable-market headline|thin RSS item|source URL, timestamp|selected because|evidence bar|Generated edition/i);
});

function testSeries(id, label, values, latestDate = "2026-06-08") {
  return {
    id,
    label,
    source: "Yahoo Finance public chart data",
    url: `https://query1.finance.yahoo.com/v8/finance/chart/${id}?range=3mo&interval=1d`,
    observations: values.map((value, index) => ({
      date: index === values.length - 1 ? latestDate : `2026-06-${String(index + 1).padStart(2, "0")}`,
      value
    }))
  };
}

test("markets visual routing replaces stale Dell/Nvidia chart for semiconductor rebound stories", () => {
  const analysis = bankerAnalysis({
    title: "S&P 500 and Nasdaq gain as chipmakers rebound from rout, Iran halts Israel attacks",
    summary: "The Nasdaq led as semiconductor shares including Nvidia, Broadcom, Micron, Marvell, Intel and SOXX rebounded from Friday's rout.",
    source: "CNBC",
    sourceType: "reputable",
    url: "https://www.cnbc.com/example",
    topics: ["markets", "semiconductors", "ai"],
    matchedThemes: [],
    scores: { evidence: 3, total: 35 }
  }, {
    marketSourceNote: "Recent public Yahoo Finance chart data with fetched timestamps.",
    series: [
      testSeries("SOXX", "iShares Semiconductor ETF", [100, 102, 106]),
      testSeries("NVDA", "Nvidia", [100, 104, 111]),
      testSeries("AVGO", "Broadcom", [100, 99, 108]),
      testSeries("MU", "Micron", [100, 101, 109]),
      testSeries("MRVL", "Marvell", [100, 98, 104]),
      testSeries("INTC", "Intel", [100, 97, 103]),
      testSeries("DELL", "Dell Technologies", [100, 150, 400])
    ]
  });

  assert.equal(analysis.visual.type, "bar-chart");
  assert.equal(analysis.visual.title, "Semiconductor rebound board");
  assert.deepEqual(analysis.visual.items.map((item) => item.id), ["SOXX", "NVDA", "AVGO", "MU", "MRVL", "INTC"]);
  assert.doesNotMatch(JSON.stringify(analysis.visual), /Dell Technologies|DELL/);
  assert.match(analysis.visual.subtitle, /latest daily move/i);
});

test("macro release longform adds analysis instead of repeating source summary", () => {
  const item = {
    id: "bls-cpi",
    title: "Consumer Price Index Summary",
    source: "BLS CPI",
    sourceType: "official",
    url: "https://www.bls.gov/news.release/cpi.nr0.htm",
    publishedAt: "2026-06-10T12:30:00.000Z",
    fetchedAt: "2026-06-10T13:00:00.000Z",
    summary: "The Consumer Price Index for All Urban Consumers increased 0.5 percent in May, while energy rose 3.9 percent and core CPI rose 0.2 percent.",
    facts: ["CPI-U increased 0.5 percent in May.", "Energy rose 3.9 percent.", "Core CPI rose 0.2 percent."],
    topics: ["macro", "inflation", "rates", "fed"],
    matchedThemes: [],
    freshnessStatus: "FRESH",
    scores: { evidence: 6, marketSignal: 3, trustedDomain: 1, total: 44 }
  };

  const analysis = bankerAnalysis(item, { series: [] });
  const releaseSection = analysis.longform.sections.find((section) => section.id === "release");
  assert.ok(releaseSection);
  assert.doesNotMatch(releaseSection.body, /The Consumer Price Index for All Urban Consumers increased 0\.5 percent in May, while energy rose 3\.9 percent and core CPI rose 0\.2 percent\./);
  assert.match(releaseSection.body, /headline|core|components|Fed|Treasury/i);
});

test("macro visual routing uses current yield stack for Fed path stories", () => {
  const analysis = bankerAnalysis({
    title: "Markets reprice Fed path toward higher-for-longer rates",
    summary: "Treasury yields rose as investors priced no Fed cuts and possible hikes.",
    source: "Yahoo Finance",
    sourceType: "reputable",
    url: "https://finance.yahoo.com/example",
    topics: ["macro", "rates", "fed"],
    matchedThemes: [],
    scores: { evidence: 3, total: 35 }
  }, {
    sourceNote: "Recent FRED observations.",
    series: [
      testSeries("DGS10", "10-Year Treasury Yield", [4.3, 4.4, 4.46]),
      testSeries("DGS2", "2-Year Treasury Yield", [3.8, 3.9, 4.0]),
      testSeries("FEDFUNDS", "Effective Federal Funds Rate", [3.63, 3.63, 3.63])
    ]
  });

  assert.equal(analysis.visual.type, "line-chart");
  assert.equal(analysis.visual.title, "Yield stack and Fed-path pressure");
  assert.deepEqual(analysis.visual.series.map((series) => series.id), ["DGS10", "DGS2", "FEDFUNDS"]);
});

test("deal visual routing uses transaction map instead of old activist deal template", () => {
  const analysis = bankerAnalysis({
    title: "J&J to buy cancer drug technology developer Firefly Bio for $1 billion",
    summary: "Reuters reported Johnson & Johnson agreed to buy Firefly Bio in a strategic oncology acquisition.",
    source: "Reuters",
    sourceType: "reputable",
    url: "https://www.reuters.com/example",
    topics: ["deals", "healthcare", "m&a"],
    matchedThemes: [],
    scores: { evidence: 3, total: 35 }
  }, { series: [] });

  assert.equal(analysis.visual.type, "deal-timeline");
  assert.equal(analysis.visual.title, "Transaction path and risk map");
  assert.match(JSON.stringify(analysis.visual.steps), /Strategic rationale|Regulatory path|Closing certainty/);
  assert.doesNotMatch(JSON.stringify(analysis.visual.steps), /Activist overlay|Toms Capital/);
});
