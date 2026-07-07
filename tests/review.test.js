import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { deterministicReview, composeReview } from "../scripts/review-edition.js";

function longBody(topic, extra = "") {
  return `${topic} Acme Robotics and Federal Reserve data give the desk a concrete public signal, including 12% order growth and $4 billion of capacity context. ${extra} The point for readers is to connect the named source to financing capacity, valuation sensitivity, and what would confirm the move next.`;
}

function validMove(overrides = {}) {
  return {
    id: "acme-orders",
    title: "Acme Robotics shares rise 12% after order update",
    editorialLane: "markets",
    freshnessStatus: "FRESH",
    sourceTrail: [
      { source: "Acme Robotics Investor Relations", url: "https://example.com/acme-orders", type: "company" },
      { source: "Federal Reserve", url: "https://www.federalreserve.gov/releases/example.htm", type: "official" }
    ],
    summary: "Acme Robotics said orders rose 12%, giving the markets lane a named company catalyst with enough numerical detail to discuss demand, margins, and financing capacity.",
    whatHappened: "Acme Robotics said orders rose 12% in its public update, creating a company-specific catalyst rather than a generic market headline.",
    whatMoved: "The move is the named order update, because investors can connect the 12% growth signal to near-term revenue and backlog expectations.",
    whyItMoved: "The detail matters because a measured order increase gives investors a concrete way to underwrite demand, margin leverage, and cash conversion.",
    valuationImpact: "A stronger order book can support a higher multiple if margins hold, but the valuation case weakens if conversion costs absorb the growth.",
    financingImplication: "For bankers, the order update matters because demand visibility can support debt capacity, acquisition currency, and working-capital planning.",
    sectorReadThrough: "The read-through is strongest for automation suppliers with similar backlog exposure and customers delaying large capital projects.",
    watchNext: "Watch Acme Robotics backlog conversion, margin guidance, customer concentration, and whether follow-on orders confirm the 12% signal.",
    editorialArticle: {
      question: "Does Acme Robotics' order update change the underwriting case, or is the market just reacting to one good number?",
      dek: "Acme Robotics reported 12% order growth, which gives readers a concrete demand signal to test against margins, backlog conversion, and financing capacity.",
      body: [
        "Acme Robotics reported 12% order growth in its public update. That is useful because it gives investors a named company, a number, and a demand signal instead of another generic industrial headline.",
        "The analysis should turn on conversion. If Acme can turn orders into profitable revenue, the stock has a cleaner argument for a higher multiple and better debt capacity. If margins absorb the growth, the rally is much less useful.",
        "For banking prep, this is a valuation and financing story. Better demand visibility can support acquisition currency, debt capacity, and working-capital planning, but only if backlog quality and customer concentration hold up."
      ],
      bankerSidebar: {
        interviewUse: "Say Acme gives a concrete order-growth signal, then connect that to backlog conversion, margins, debt capacity, and M&A currency.",
        watchNext: "Watch backlog conversion, margin guidance, customer concentration, and whether follow-on orders confirm the 12% signal."
      }
    },
    parallel: {
      precedent: "Rockwell Automation and Emerson Electric have both shown how named automation backlogs can reset investor expectations when demand improves.",
      outcome: "Those updates helped investors separate company-specific backlog quality from generic industrial sentiment during uneven cycles.",
      whatRhymes: "The common thread is that backlog and orders create a more concrete demand signal than broad market commentary.",
      whatDiffers: "Acme Robotics still needs conversion evidence, so the read should be tested against margins, cancellations, and customer concentration.",
      soWhat: "Use the order update as a catalyst, then check whether revenue conversion and margins justify the valuation move.",
      sourceTrail: [{ source: "Acme Robotics Investor Relations", url: "https://example.com/acme-orders" }]
    },
    longform: {
      sections: [
        { id: "takeaway", heading: "Plain-English takeaway", body: longBody("Acme Robotics reported the order update in its investor materials.", "That makes the story specific enough to discuss without leaning on generic industrial sentiment.") },
        { id: "signal", heading: "What changed", body: longBody("The company-specific signal is the 12% order growth from Acme Robotics.", "That datapoint gives readers a number to track against backlog conversion and revenue guidance.") },
        { id: "valuation", heading: "Valuation read", body: longBody("The valuation read depends on whether Acme Robotics turns the $4 billion capacity context into profitable revenue.", "A higher multiple needs margin evidence, not just a positive headline.") },
        { id: "financing", heading: "Financing angle", body: longBody("For financing work, Acme Robotics' named update can influence debt capacity and M&A currency.", "The relevant diligence is customer quality, cancellation risk, and working-capital intensity.") },
        { id: "watch", heading: "What to watch", body: longBody("The next check is whether Acme Robotics confirms the 12% order signal in margins and cash conversion.", "If the update fades, the market should treat the rally as a single-catalyst move.") }
      ]
    },
    ...overrides
  };
}

function editionWithMoves(moves) {
  return { runDate: "2026-06-02", title: "Opening Ledger", dek: "A source-backed market brief.", moves, sections: {} };
}

test("review command is present and node can load it", () => {
  const result = spawnSync(process.execPath, ["--check", "scripts/review-edition.js"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("deterministic review blocks robotic public pipeline language and thin specificity", () => {
  const badMove = validMove({
    title: "Market update",
    sourceTrail: [{ source: "Newswire", url: "https://example.com/rss" }],
    summary: "Current reputable-market headline with source URL, timestamp, and market-moving public-tape keywords; use as a thin RSS item only when the headline itself identifies the market move.",
    whatHappened: "This was selected because it links market news to themes and has enough source support to analyze rather than merely mention.",
    editorialArticle: {
      question: "What changed today: why did this pass?",
      dek: "Current reputable-market headline with source URL, timestamp, and market-moving public-tape keywords.",
      body: [
        "This was selected because it links market news to themes and has enough source support to analyze rather than merely mention.",
        "Plain-English takeaway: the fresh fact changes sector leadership without saying anything specific.",
        "Editorial thesis: this is filler copy with no real analysis."
      ],
      bankerSidebar: { interviewUse: "The new read is generic.", watchNext: "Watch nothing." }
    },
    longform: { sections: validMove().longform.sections.map((section) => ({ ...section, body: "Generic market commentary without source facts or named entities stays broad and undifferentiated for readers across the issue. ".repeat(2) })) }
  });
  const review = deterministicReview(editionWithMoves([badMove]));
  assert.match(review.blockers.join("\n"), /internal pipeline phrase/);
  assert.match(review.blockers.join("\n"), /top move lacks a concrete number|longform needs source-specific facts|one non-primary\/non-official source/);
});

test("repeated robotic issue phrases are caught", () => {
  const first = validMove({
    id: "first",
    title: "Acme Robotics shares rise 12% after order update",
    summary: `${validMove().summary} The main move is the order signal.`,
    editorialArticle: { ...validMove().editorialArticle, body: validMove().editorialArticle.body.map((body) => `${body} The main move is the order signal.`) }
  });
  const second = validMove({
    id: "second",
    title: "Beta Motors shares rise 9% after delivery update",
    summary: "Beta Motors said deliveries rose 9%, giving the markets lane a named company catalyst with enough detail to discuss demand and financing. The main move is the delivery signal.",
    sourceTrail: [
      { source: "Beta Motors Investor Relations", url: "https://example.com/beta-deliveries", type: "company" },
      { source: "SEC", url: "https://www.sec.gov/example", type: "official" }
    ],
    editorialArticle: { ...validMove().editorialArticle, body: validMove().editorialArticle.body.map((body) => `${body} The main move is the delivery signal.`) }
  });
  const review = deterministicReview(editionWithMoves([first, second]));
  assert.match(review.blockers.join("\n"), /repeats robotic phrase "The main move is"/);
});

test("review blocks headline-question, repeated source summary, and sidebar question echo", () => {
  const repeated = validMove({
    title: "SpaceX’s two lead underwriters have a $1 trillion chasm in their valuation as quiet period ends",
    sourceTrail: [{ source: "MarketWatch Top Stories", url: "https://www.marketwatch.com/example" }],
    summary: "The two lead underwriters on SpaceX’s IPO, Goldman Sachs and Morgan Stanley, have a valuation gap of more than $1 trillion as they both initiated coverage at buy.",
    whatHappened: "The two lead underwriters on SpaceX’s IPO, Goldman Sachs and Morgan Stanley, have a valuation gap of more than $1 trillion as they both initiated coverage at buy.",
    editorialArticle: {
      question: "Does SpaceX’s two lead underwriters have a $1 trillion chasm in their valuation as quiet period ends change the deal math?",
      dek: "The two lead underwriters on SpaceX’s IPO, Goldman Sachs and Morgan Stanley, have a valuation gap of more than $1 trillion as they both initiated coverage at buy. The transaction story is worth reading only if it changes what you would underwrite.",
      body: [
        "The two lead underwriters on SpaceX’s IPO, Goldman Sachs and Morgan Stanley, have a valuation gap of more than $1 trillion as they both initiated coverage at buy. The real test is whether the transaction can survive full underwriting.",
        "For banking prep, do not stop at the market move. Ask whether the story changes the issuance window, peer multiples, or investor appetite for adjacent companies.",
        "One caveat: this is still a one-source story. Treat the read as a working thesis until another source confirms it."
      ],
      bankerSidebar: {
        interviewUse: "Say it this way: Does SpaceX’s two lead underwriters have a $1 trillion chasm in their valuation as quiet period ends change the deal math? Then tie the answer to valuation.",
        watchNext: "Watch analyst revisions and price action."
      }
    }
  });
  const review = deterministicReview(editionWithMoves([repeated]));
  const blockers = review.blockers.join("\n");
  assert.match(blockers, /worth reading only if|Say it this way/);
  assert.match(blockers, /editorial paragraph 1 repeats|editorial dek repeats/);
  assert.match(blockers, /headline turned into a question|banker sidebar repeats/);
});

test("skipped OpenAI review blocks only when explicitly required", () => {
  const local = { blockers: [], warnings: [] };
  assert.equal(composeReview("2026-06-02", local, null, { requireAiReview: false }).status, "APPROVED");
  const required = composeReview("2026-06-02", local, null, { requireAiReview: true });
  assert.equal(required.status, "BLOCKED");
  assert.match(required.blockers.join("\n"), /OpenAI review was required/);
});
