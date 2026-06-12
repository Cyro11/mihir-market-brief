import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { analysisDir, calendarDir, candidatesDir, dataDir, editionsDir, marketDataDir, sourcesDir } from "./config.js";
import { editionDate, ensureDir, freshnessStatus, readJson, writeJson } from "./utils.js";
import { scoreCandidate, selectCandidates } from "./triage.js";
import { buildDealTape } from "./deal-tape.js";

function storylineFor(item) {
  const text = `${item.title} ${item.summary} ${(item.tickers || []).join(" ")} ${(item.topics || []).join(" ")}`.toLowerCase();
  if (/\bdell\b|ai server|ai infrastructure|nvidia|data center|capex/.test(text)) {
    return {
      id: "ai-infrastructure-dell-servers",
      name: "AI infrastructure buildout",
      threshold: 2
    };
  }
  if (/\bmccormick\b|unilever foods|toms capital|activist/.test(text)) {
    return {
      id: "mccormick-unilever-activist",
      name: "McCormick / Unilever Foods deal watch",
      threshold: 2
    };
  }
  if (/\bpce\b|inflation|fed|treasury|rates|yield/.test(text)) {
    return {
      id: "rates-inflation-cost-of-capital",
      name: "Rates and cost of capital",
      threshold: 3
    };
  }
  return null;
}

function developmentScore(current, previous) {
  const currentTokens = new Set(`${current.title} ${current.whatHappened} ${current.whyItMoved}`.toLowerCase().match(/[a-z0-9$%.]+/g) || []);
  const previousTokens = new Set(`${previous.title} ${previous.whatHappened} ${previous.whyItMoved}`.toLowerCase().match(/[a-z0-9$%.]+/g) || []);
  const newTokens = [...currentTokens].filter((token) => token.length > 3 && !previousTokens.has(token));
  const hasNewSource = (current.sourceTrail || []).some((source) => !(previous.sourceTrail || []).some((old) => old.url === source.url));
  const hasNumber = /\d|%|\$/.test(`${current.whatHappened} ${current.whyItMoved}`);
  return newTokens.length + (hasNewSource ? 3 : 0) + (hasNumber ? 1 : 0);
}

function continuityText(current, previous, previousDate) {
  return {
    previousDate,
    previousTitle: previous.title,
    previousUrl: `issues/${previousDate}.html`,
    whatChanged: `This updates the ${current.storyline.name.toLowerCase()} thread from ${previousDate}. The new item adds fresh source evidence and shifts the read toward today's specific market/deal question.`,
    priorRead: previous.whyItMoved || previous.whatHappened,
    updatedRead: current.whyItMoved,
    status: current.confidence === "High" ? "Stronger evidence" : "Developing"
  };
}

async function priorEditions(runDate) {
  const files = await fs.readdir(editionsDir).catch(() => []);
  const dated = files
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file) && file.slice(0, 10) < runDate)
    .sort()
    .reverse()
    .slice(0, 20);
  const editions = [];
  for (const file of dated) {
    const edition = await readJson(path.join(editionsDir, file), null);
    if (edition) editions.push({ date: file.slice(0, 10), edition });
  }
  return editions;
}

function attachContinuity(analyses, prior) {
  return analyses.map((analysis) => {
    if (!analysis.storyline) return analysis;
    for (const { date, edition } of prior) {
      const previous = (edition.moves || []).find((move) => move.storyline?.id === analysis.storyline.id);
      if (!previous) continue;
      const score = developmentScore(analysis, previous);
      if (score >= analysis.storyline.threshold) {
        return { ...analysis, continuity: continuityText(analysis, previous, date) };
      }
    }
    return analysis;
  });
}

export function editorialLaneFor(item) {
  const text = `${item.title} ${item.summary} ${(item.tickers || []).join(" ")} ${(item.topics || []).join(" ")}`.toLowerCase();
  const topics = new Set(item.topics || []);
  if (topics.has("breaking") || /\b(record\s+(?:ipo|raise|offering)|priced\s+.*\bipo\b|\bipo\b.*\bpriced\b|\bstarts trading\b|\bbegins trading\b|\bpublic debut\b|\bnasdaq debut\b|\bnyse debut\b|\bvaluation\b.*\b(?:ipo|debut|offering)\b)/.test(text)) {
    return "breaking";
  }
  const privateTagged = topics.has("private_markets") || topics.has("private_credit") || topics.has("private_equity");
  const explicitTapeStory = /\bequity futures\b|\bpre-?bell\b|\bchip stocks? rebound\b|\bstock market today\b/.test(text)
    || (/\bs&p 500\b|\bnasdaq composite\b|\bdow jones\b/.test(text) && /\bgain\b|\bsurge\b|\brally\b|\brebound\b|\bclose[sd]? higher\b|\btape\b/.test(text));
  if (explicitTapeStory && !privateTagged) {
    return "markets";
  }
  if (privateTagged) {
    return "private_markets";
  }
  if (
    topics.has("macro")
    || topics.has("rates")
    || topics.has("inflation")
    || topics.has("fed")
    || /\bpce\b|\bcpi\b|\bppi\b|\bgdp\b|\bfomc\b|\btreasury\b|\byield\b|\binflation\b|\bpayrolls\b|\bemployment situation\b|\bunemployment\b/.test(text)
  ) {
    return "macro";
  }
  if (
    topics.has("private_markets")
    || /\bprivate equity\b|\bprivate credit\b|\bventure\b|\bvc\b|\bfundraising\b|\bsecondaries\b|\bsecondary\b|\bsponsor\b|\bleveraged buyout\b|\blbo\b|\bipo pipeline\b/.test(text)
  ) {
    return "private_markets";
  }
  if (
    topics.has("deals")
    || topics.has("filings")
    || /\bmerger\b|\bacquisition\b|\bdeal\b|\bactivist\b|\bstake\b|\btakeover\b|\bspin-?off\b|\bipo\b|\btender\b|\bbuyout\b/.test(text)
  ) {
    return "deals";
  }
  return "markets";
}

export function privateMarketSegmentFor(item) {
  const text = `${item.title} ${item.summary} ${(item.tickers || []).join(" ")} ${(item.topics || []).join(" ")}`.toLowerCase();
  const topics = new Set(item.topics || []);
  if (
    topics.has("private_credit")
    || /\bprivate credit\b|\bdirect lending\b|\bdirect-lending\b|\bnon-accrual\b|\borigination\b|\bbdc\b|\bcredit spread\b|\bspread\b|\brefinanc|\bdebt\b|\bloan\b|\blender\b|\blending\b|\bnotes\b|\bcovenant\b/.test(text)
  ) {
    return "private_credit";
  }
  if (
    topics.has("private_equity")
    || /\bprivate equity\b|\bsponsor\b|\bbuyout\b|\blbo\b|\bplatform\b|\bportfolio company\b|\bsecondar|\bcontinuation fund\b|\bexit\b/.test(text)
  ) {
    return "private_equity";
  }
  return "private_markets";
}

function storyText(item) {
  return `${item.title || ""} ${item.summary || ""} ${(item.tickers || []).join(" ")} ${(item.topics || []).join(" ")} ${item.source || ""}`.toLowerCase();
}

function storySpecificPrivateRead(item, segment) {
  const text = storyText(item);
  if (/\banthropic\b|\bgoogle\b|\btpu\b|\bdata[ -]?center\b|\bai infrastructure\b|\bcompute\b/.test(text)) {
    return {
      kind: "ai_compute_infrastructure",
      summaryTail: "The banking read is not simply 'AI demand is large'; it is whether contracted compute demand can be packaged into financeable infrastructure cash flows without leaving lenders exposed to chip obsolescence, power constraints, or one-customer concentration.",
      plainEnglish: "In plain English, this is an infrastructure-finance story wearing an AI headline: the key question is who owns the expensive compute assets, who guarantees enough usage to service debt, and whether the collateral still has value if model economics or chip cycles shift.",
      publicSignal: "The public signal is the named counterparties and asset type. Anthropic/Google/TPU language points to real compute demand; Blackstone or other private-capital involvement points to a financing stack trying to turn that demand into durable, underwritable infrastructure exposure.",
      interpretation: "Read the structure like a project-finance underwrite: contracted usage and creditworthy customers support leverage, but residual value, power availability, depreciation, and replacement-cycle risk decide how much debt is actually safe.",
      evidence: "The strongest evidence would be disclosed commitment size, duration, collateral package, customer concentration, and lender protections. The weaker evidence is a broad AI partnership headline that does not show who bears utilization, technology, and refinancing risk.",
      watch: "Watch for disclosed facility terms, lease or offtake duration, power commitments, utilization guarantees, lender group composition, and whether similar TPU/data-center financings clear at tighter or wider economics.",
      parallel: {
        precedent: "DigitalBridge, Equinix, and hyperscale data-center financings showed that infrastructure investors will fund compute-adjacent assets when cash flows look contracted and repeatable.",
        outcome: "Those transactions attracted infrastructure capital, but valuation and leverage depended on tenant quality, power access, utilization visibility, and confidence that the asset would not become obsolete too quickly.",
        whatRhymes: "The rhyme is the attempt to convert explosive cloud or AI demand into long-duration infrastructure cash flows that private capital can own or lend against.",
        whatDiffers: "TPU and frontier-model infrastructure carry faster technology-cycle risk than a generic leased data center, so lenders need stronger contracts, collateral discipline, or sponsor support.",
        soWhat: "Treat the story as a test of whether private capital can finance the AI buildout prudently, not as proof that every AI infrastructure asset deserves infrastructure multiples."
      }
    };
  }
  if (segment === "private_credit" && /\bstructured note\b|\bstructured notes\b|\bprivate credit\b|\bdirect lending\b|\basset-backed\b|\babs\b|\bcollateral\b|\bcovenant\b|\bnon-accrual\b|\brefinanc|\bnotes\b/.test(text)) {
    return {
      kind: "private_credit_structured_notes",
      summaryTail: "The credit read is whether investors are being paid for actual collateral and downside protection, or merely accepting complexity to reach for private-credit yield.",
      plainEnglish: "In plain English, private credit is not automatically safer because it is private. The issue is whether the cash flows, collateral, covenants, and seniority are strong enough to justify the coupon after fees and illiquidity.",
      publicSignal: "The public signal is indirect: note issuance, BDC/manager commentary, spread proxies, repayment activity, and credit-performance language show whether capital is still available and on what terms.",
      interpretation: "Interpret the financing signal by splitting price from protection. A high coupon helps only if underwriting losses stay contained; looser covenants, weak collateral, or payment-in-kind features can turn yield into delayed loss recognition.",
      evidence: "Strong evidence means disclosed advance rates, loan-to-value, attachment point, non-accrual trends, realized losses, repayment pace, and manager marks. Generic demand for private credit is weaker because it says little about underwriting quality.",
      watch: "Watch non-accruals, amendment activity, repayments, dividend recaps, spread levels, PIK usage, and whether new notes are backed by granular collateral or by aggressive sponsor refinancings.",
      parallel: {
        precedent: "Business-development companies such as Ares Capital and Blue Owl Capital Corp became useful public proxies for private-credit cycles after direct lending took share from broadly syndicated loans.",
        outcome: "The managers benefited from demand for floating-rate private loans, but investors watched non-accruals, realized losses, funding costs, and portfolio marks to separate durable income from credit drift.",
        whatRhymes: "Today's structured-note or direct-lending signal still has the same core tradeoff: attractive yield can support demand, while weak collateral or rising losses can erase the premium quickly.",
        whatDiffers: "Structured notes add tranche, collateral, and liquidity complexity, so headline coupon is less informative than attachment point, collateral pool quality, and who keeps first-loss risk.",
        soWhat: "Use the item to underwrite terms and credit protection, not to conclude that private-credit appetite alone validates valuations."
      }
    };
  }
  if (segment === "private_equity" && /\bsponsor\b|\bexit\b|\bipo\b|\bsecondary\b|\bsecondaries\b|\bcontinuation fund\b|\bsale process\b|\bacquisition\b|\bmajority stake\b|\bstrategic acquisitions\b|\bcarlyle\b|\bblackstone\b|\bkkr\b|\bapollo\b/.test(text)) {
    return {
      kind: "sponsor_exits",
      summaryTail: "The sponsor read is whether the headline opens a monetization path at a real clearing price, or just postpones the valuation reckoning through another private-market structure.",
      plainEnglish: "In plain English, sponsors need exits to return cash to LPs. The important question is whether this event creates a true buyer at a supportable valuation, or merely gives the owner another way to hold the asset longer.",
      publicSignal: "The public signal is the exit route: IPO filing, strategic sale, secondary, continuation fund, dividend recap, or refinancing. Each route says something different about valuation confidence and buyer demand.",
      interpretation: "Read sponsor exits through three gates: public comps set the valuation ceiling, financing costs set buyer capacity, and LP liquidity pressure sets how willing the sponsor is to accept a lower but real price.",
      evidence: "Strong evidence includes a named buyer, filed S-1, announced price, debt package, tender results, or disclosed secondary terms. Weak evidence is broad talk of an exit window without a transaction, price, or financing path.",
      watch: "Watch public-comp multiples, IPO filing updates, lender commitments, sale-process leaks followed by actual bids, LP secondary pricing, and whether sponsors choose full exits or continuation vehicles.",
      parallel: {
        precedent: "Private-equity sponsors used continuation funds and secondary sales heavily after the IPO window slowed in 2022 and 2023.",
        outcome: "Those tools created liquidity for some LPs but often deferred the final valuation test until public comps, financing costs, or strategic buyers improved.",
        whatRhymes: "The same exit math applies now: sponsors want distributions, but they need a buyer or financing market that can support a defensible mark.",
        whatDiffers: "Today the highest-quality assets may access IPO or strategic-sale routes sooner, while weaker holdings still need secondary or continuation structures.",
        soWhat: "Treat sponsor-exit headlines as evidence only when they reveal price, buyer depth, or financing capacity."
      }
    };
  }
  return null;
}

function leadThemeKey(item) {
  if (!item) return "";
  const storyline = item.storyline?.id || storylineFor(item)?.id;
  if (storyline) return storyline;
  const lane = item.editorialLane || editorialLaneFor(item);
  if (lane === "private_markets") return item.privateMarketSegment || privateMarketSegmentFor(item);
  return lane;
}

function recentLeadThemeKeys(prior, lookback = 3) {
  return new Set(
    prior
      .slice(0, lookback)
      .map(({ edition }) => leadThemeKey(edition.moves?.[0]))
      .filter(Boolean)
  );
}

function laneDisplayName(lane) {
  return {
    breaking: "Breaking",
    macro: "Macro Environment",
    markets: "Markets",
    deals: "Deals",
    private_markets: "Private Markets"
  }[lane] || "Markets";
}

export function selectLaneItems(analyses, limit = 3, privateSegmentLimit = 2) {
  const sections = {
    overnight: { label: "Overnight", items: [] },
    breaking: { label: "Breaking", items: [] },
    macro: { label: "Macro Environment", items: [], latestEvent: null, economicCalendar: [] },
    markets: { label: "Markets", items: [] },
    deals: { label: "Deals", items: [] },
    privateMarkets: {
      label: "Private Markets",
      items: [],
      segments: {
        privateEquity: { label: "Private Equity", items: [] },
        privateCredit: { label: "Private Credit", items: [] }
      }
    }
  };
  for (const item of analyses) {
    const key = item.editorialLane === "private_markets"
      ? "privateMarkets"
      : item.editorialLane === "breaking"
        ? "breaking"
      : item.editorialLane === "macro"
        ? "macro"
      : item.editorialLane === "deals"
        ? "deals"
        : "markets";
    if (sections[key].items.length < limit) sections[key].items.push(item);
    if (key === "privateMarkets") {
      const segmentKey = item.privateMarketSegment === "private_credit" ? "privateCredit" : "privateEquity";
      if (sections.privateMarkets.segments[segmentKey].items.length < privateSegmentLimit) {
        sections.privateMarkets.segments[segmentKey].items.push(item);
      }
    }
  }
  return sections;
}

function overnightWindow(now) {
  const end = new Date(now);
  const start = new Date(end.getTime() - 15 * 36e5);
  return { start, end };
}

export function overnightCandidates(scored, now = new Date(), limit = 5) {
  const { start, end } = overnightWindow(now);
  return [...scored]
    .filter((item) => item.url && item.publishedAt)
    .filter((item) => {
      const published = new Date(item.publishedAt);
      return !Number.isNaN(published.getTime()) && published >= start && published <= end;
    })
    .filter((item) => item.freshnessStatus !== "FUTURE" && item.freshnessStatus !== "INVALID" && item.freshnessStatus !== "BACKGROUND")
    .filter((item) => item.scores.evidence >= 4 && item.scores.marketSignal >= 2)
    .filter((item) => item.scores.trustedDomain || item.sourceType === "official")
    .filter((item) => item.scores.total >= 24)
    .sort((a, b) => b.scores.total - a.scores.total)
    .slice(0, limit);
}

export function buildOvernightSection(scored, marketData, now = new Date(), limit = 5) {
  const window = overnightWindow(now);
  return {
    label: "Overnight",
    window: {
      start: window.start.toISOString(),
      end: window.end.toISOString()
    },
    items: overnightCandidates(scored, now, limit).map((item) => ({
      ...bankerAnalysis(item, marketData),
      overnightSignal: true
    }))
  };
}

function visualFor(item, marketData) {
  const text = `${item.title} ${item.summary} ${(item.topics || []).join(" ")}`.toLowerCase();
  const editorialLane = editorialLaneFor(item);
  const privateMarketSegment = editorialLane === "private_markets" ? privateMarketSegmentFor(item) : null;
  const creditWindowStory = /\bspread\b|\bspreads\b|\bdirect lending\b|\bdirect-lending\b|\brefinanc|\borigination\b|\bfinancing appetite\b|\blender appetite\b|\bnon-accrual\b|\bbdc\b|\bdebt cost\b|\bcredit quality\b/.test(text);
  const marketSeriesById = (ids) => (
    marketData?.series?.filter((series) => ids.includes(series.id) && series.observations?.length) || []
  );
  const latestValue = (series) => series?.observations?.[series.observations.length - 1]?.value;
  const percentChange = (series) => {
    const first = series?.observations?.[0]?.value;
    const last = latestValue(series);
    if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return null;
    return ((last - first) / first) * 100;
  };
  const latestPercentChange = (series) => {
    const observations = series?.observations || [];
    const last = observations[observations.length - 1]?.value;
    const prior = observations[observations.length - 2]?.value;
    if (!Number.isFinite(prior) || !Number.isFinite(last) || prior === 0) return percentChange(series);
    return ((last - prior) / prior) * 100;
  };
  const comparisonItems = (ids, suffix = "%", changeFn = percentChange) => marketSeriesById(ids)
    .map((series) => ({
      id: series.id,
      label: series.label,
      value: changeFn(series),
      displayValue: changeFn(series),
      suffix,
      latestDate: series.observations?.[series.observations.length - 1]?.date || "",
      url: series.url
    }))
    .filter((entry) => Number.isFinite(entry.value));
  const baseSourceTrail = (item.relatedLinks?.length ? item.relatedLinks : item.sourceTrail || [])
    .map((link) => ({
      source: link.source || link.label || "Source",
      url: link.url
    }))
    .filter((link) => link.url);
  if (!baseSourceTrail.length && item.url) {
    baseSourceTrail.push({ source: item.source || "Source", url: item.url });
  }
  if (editorialLane === "macro") {
    let series = marketSeriesById(["DGS10", "DGS2", "FEDFUNDS"]);
    if (series.length < 2) series = marketSeriesById(["TNX", "IRX", "TYX", "FEDFUNDS"]);
    if (series.length >= 2) {
      return {
        type: "line-chart",
        title: "Yield stack and Fed-path pressure",
        subtitle: "Latest available public rate observations through the brief date; uses Yahoo Treasury proxies when FRED daily Treasury feeds are unavailable.",
        relevanceNote: "This chart fits because the story is about Fed-path repricing and the discount-rate stack that drives equity multiples, financing costs, and deal math.",
        allowedPages: ["macro", "deep-dive"],
        axisTitle: "Rate",
        axisSuffix: "%",
        visualSource: "Public rate data",
        series,
        sourceNote: marketData.marketSourceNote || marketData.sourceNote
      };
    }
  }
  if (editorialLane === "markets" && /\bsemi\b|\bsemis\b|\bsemiconductor\b|\bsemiconductors\b|\bchip\b|\bchips\b|\bchipmaker\b|\bchipmakers\b|\bnvidia\b|\bnasdaq\b/.test(text)) {
    const items = comparisonItems(["SOXX", "NVDA", "AVGO", "MU", "MRVL", "INTC"], "%", latestPercentChange);
    if (items.length >= 3) {
      return {
        type: "bar-chart",
        title: "Semiconductor rebound board",
        subtitle: "Latest daily move from public chart data for the chip basket tied to today's Nasdaq leadership story.",
        relevanceNote: "This replaces stale Dell/Nvidia infrastructure context because today's story is about semiconductor breadth, Nasdaq leadership, and whether the chip rebound is carrying risk appetite.",
        allowedPages: ["markets", "deep-dive"],
        axisTitle: "Latest daily change",
        visualSource: "Public market data",
        items,
        sourceTrail: items.map((entry) => ({ source: entry.label, url: entry.url })),
        sourceNote: marketData.marketSourceNote || "Public market-data visuals preserve source links and fetched timestamps."
      };
    }
  }
  if (editorialLane === "markets" && /\bindex\b|\bindexes\b|\bbreadth\b|\brisk appetite\b|\btape\b|\brotation\b/.test(text)) {
    const items = comparisonItems(["SPY", "QQQ", "IWM", "GLD"], "%");
    if (items.length >= 3) {
      return {
        type: "bar-chart",
        title: "Cross-asset reaction board",
        subtitle: "Three-month public market context across broad equity and real-asset proxies.",
        relevanceNote: "This snapshot fits because the story is about leadership and risk appetite across the tape, not just one stock in isolation.",
        allowedPages: ["markets", "deep-dive"],
        axisTitle: "3-month change",
        visualSource: "Public market data",
        items,
        sourceTrail: items.map((entry) => ({ source: entry.label, url: entry.url })),
        sourceNote: marketData.marketSourceNote || "Public market-data visuals preserve source links and fetched timestamps."
      };
    }
  }
  if (privateMarketSegment === "private_credit") {
    const managerItems = comparisonItems(["OWL", "ARCC", "BXSL", "BX"], "%");
    if (managerItems.length >= 3 && /\bblue owl\b|\bdirect lending\b|\bbdc\b|\bmanager\b|\bprivate credit\b/.test(text)) {
      return {
        type: "bar-chart",
        title: "Direct-lending public proxies",
        subtitle: "Three-month public market context for listed lenders and private-credit managers.",
        relevanceNote: "This board works here because the story is about how investors are marking the lenders themselves, not just what one spread series says.",
        allowedPages: ["private-markets", "deep-dive"],
        axisTitle: "3-month change",
        visualSource: "Public market data",
        items: managerItems,
        sourceTrail: managerItems.map((entry) => ({ source: entry.label, url: entry.url })),
        sourceNote: marketData.marketSourceNote || "Public market-data visuals preserve source links and fetched timestamps."
      };
    }
    const series = marketSeriesById(["BAMLH0A0HYM2"]);
    if (series.length && /\bspread\b|\bspreads\b|\bcredit quality\b|\brefinanc|\bfinancing appetite\b/.test(text)) {
      return {
        type: "line-chart",
        title: "Credit window proxy",
        subtitle: "Public spread data used as a proxy for private-market financing appetite.",
        relevanceNote: "This chart makes sense here because the read depends on whether lending conditions are getting easier or tighter.",
        allowedPages: ["private-markets", "deep-dive"],
        axisTitle: "Spread",
        axisSuffix: "%",
        visualSource: "FRED data",
        series,
        sourceNote: marketData.sourceNote
      };
    }
  }
  if (privateMarketSegment === "private_equity") {
    const sponsorItems = comparisonItems(["KKR", "BX", "APO"], "%");
    if (sponsorItems.length >= 2) {
      return {
        type: "bar-chart",
        title: "Public sponsor proxies",
        subtitle: "Three-month public market context for large alternative-asset managers tied to sponsor sentiment.",
        relevanceNote: "This board belongs here because public sponsor stocks often give the cleanest available read on how the market feels about exits, fundraising, and deployment.",
        allowedPages: ["private-markets", "deep-dive"],
        axisTitle: "3-month change",
        visualSource: "Public market data",
        items: sponsorItems,
        sourceTrail: sponsorItems.map((entry) => ({ source: entry.label, url: entry.url })),
        sourceNote: marketData.marketSourceNote || "Public market-data visuals preserve source links and fetched timestamps."
      };
    }
    return {
      type: "deal-timeline",
      title: "Sponsor exit paths",
      subtitle: "Public markers that shape whether sponsors can sell, refinance, or keep holding.",
      relevanceNote: "A path map fits because the useful question is how sponsors get from today's headline to an actual exit or reset.",
      allowedPages: ["private-markets", "deep-dive"],
      sourceTrail: baseSourceTrail,
      steps: [
        { label: "Portfolio event", detail: item.title },
        { label: "Comp backdrop", detail: "Public multiples set the range for any sale or IPO attempt" },
        { label: "Financing check", detail: "Debt costs shape buyer capacity and sponsor returns" },
        { label: "Exit path", detail: "Sale, secondary, continuation fund, or hold longer" },
        { label: "Outcome", detail: "Realization, delayed monetization, or reset valuation" }
      ]
    };
  }
  if (editorialLane === "private_markets" && /\banthropic\b|\btpu\b|\bchip deal\b|\bai infrastructure\b/.test(text)) {
    return {
      type: "deal-timeline",
      title: "AI financing stack",
      subtitle: "How infrastructure demand translates into capital structure and lender participation.",
      relevanceNote: "A capital map fits here because the story is really about who is funding the buildout and where the financing risk sits.",
      allowedPages: ["private-markets", "deep-dive"],
      sourceTrail: baseSourceTrail,
      steps: [
        { label: "Compute demand", detail: "AI usage drives the need for chips, servers, and power" },
        { label: "Asset package", detail: "Infrastructure cash flows are bundled into financeable collateral" },
        { label: "Lender syndicate", detail: "Apollo, Blackstone, and peers gauge risk, duration, and recovery" },
        { label: "Terms", detail: "Coupons, structure, and covenants decide whether the debt is workable" },
        { label: "Read-through", detail: "Successful execution points to deeper private capital support for AI buildout" }
      ]
    };
  }
  if (/dell|ai server|ai infrastructure|capex/.test(text)) {
    const stockSeries = marketSeriesById(["DELL", "NVDA"]);
    if (stockSeries.length) {
      return {
        type: "line-chart",
        title: "Stock reaction",
        subtitle: "Public market-data context for the company/peer move.",
        relevanceNote: "This chart belongs here because the core question is how the market repriced the company and its closest read-through peer.",
        allowedPages: ["markets", "deep-dive"],
        axisTitle: "Price",
        axisSuffix: "",
        visualSource: "Public market data",
        series: stockSeries,
        sourceNote: marketData.marketSourceNote || "Public market-data visuals preserve source links and fetched timestamps."
      };
    }
    return {
      type: "value-chain-map",
      title: "AI infrastructure read-through",
      subtitle: "Source-backed structure map; not a price chart.",
      relevanceNote: "A structure map works better than a chart here because the point is where demand is moving across the stack.",
      allowedPages: ["markets", "deep-dive"],
      sourceTrail: baseSourceTrail,
      nodes: [
        { label: "First-order winner", detail: "Nvidia / accelerators" },
        { label: "Systems", detail: "Dell AI servers" },
        { label: "Network", detail: "Arista / Broadcom" },
        { label: "Facilities", detail: "Equinix / data centers" },
        { label: "Financing", detail: "Capex, project finance, M&A" }
      ]
    };
  }
  if (editorialLane === "deals" || /\bdeal\b|\bdeals\b|\bm&a\b|\bacquisition\b|\bto buy\b|\bbuyout\b|\bsale process\b|\bmerger\b|\btransaction\b/.test(text)) {
    return {
      type: "deal-timeline",
      title: "Transaction path and risk map",
      subtitle: "Story-specific transaction map showing where today's deal can create or lose certainty.",
      relevanceNote: "This visual fits because the useful question is how the transaction moves from strategic logic to signed terms, approvals, financing discipline, and closing certainty.",
      allowedPages: ["deals", "deep-dive"],
      sourceTrail: baseSourceTrail,
      steps: [
        { label: "Strategic rationale", detail: item.title },
        { label: "Valuation / consideration", detail: "Check whether price, structure, and expected synergies justify the buyer's capital allocation." },
        { label: "Regulatory path", detail: "Confirm antitrust, sector, shareholder, and other approval gates before treating the deal as done." },
        { label: "Financing discipline", detail: "Watch leverage, cash use, dilution, and whether market conditions change the economics before close." },
        { label: "Closing certainty", detail: "The read improves if approvals, financing, and integration risk remain contained; it breaks if any gate gets harder." }
      ]
    };
  }
  return null;
}

function summaryFor(item, lane, segment, storyRead = null) {
  const sourceBlurb = cleanSourceBlurb(item);
  if (storyRead?.summaryTail) {
    return `${sourceBlurb} ${storyRead.summaryTail}`;
  }
  if (lane === "breaking") {
    return `${sourceBlurb} The key question is how quickly this first-order headline changes valuation marks, financing windows, investor demand, and the broader capital-markets read.`;
  }
  if (lane === "macro") {
    return `${sourceBlurb} The practical question is how that changes the rate path and the market's comfort with the current valuation backdrop.`;
  }
  if (lane === "deals") {
    return `${sourceBlurb} What matters most is whether the transaction logic, financing, and approval path still hold together under scrutiny.`;
  }
  if (lane === "private_markets" && segment === "private_credit") {
    return `${sourceBlurb} The useful read is what this says about credit availability, lender appetite, underwriting protection, and refinancing capacity.`;
  }
  if (lane === "private_markets") {
    return `${sourceBlurb} The useful read is what this says about sponsor activity, valuation discipline, true exit liquidity, and financing conditions.`;
  }
  return `${sourceBlurb} The useful question is what the move reveals about how the market is repricing the story, not just that the headline happened.`;
}

function cleanSourceBlurb(item) {
  const summary = String(item.summary || "").trim();
  if (!summary) return item.title;
  const looksTruncated = summary.length > 240 && !/[.!?]["')\]]?$/.test(summary);
  const hasPageChrome = /\b(skip to main content|toggle navigation|main navigation|official website of the united states government)\b/i.test(summary);
  return looksTruncated || hasPageChrome ? item.title : summary;
}

function buildLongformSections({
  lane,
  segment,
  item,
  whatHappened,
  whatMoved,
  whyItMoved,
  valuationImpact,
  financingImplication,
  sectorReadThrough,
  parallel,
  watchNext,
  storyRead = null
}) {
  const parallelText = `A useful parallel is ${parallel.precedent} In that earlier setup, ${parallel.outcome.toLowerCase()} What rhymes is ${parallel.whatRhymes.toLowerCase()} What is different this time is ${parallel.whatDiffers.toLowerCase()} The bottom line is ${parallel.soWhat.toLowerCase()}`;
  if (lane === "breaking") {
    return [
      { id: "takeaway", heading: "Plain-English takeaway", body: `${whyItMoved} A breaking capital-markets headline can reset the comparable set before slower private-market marks, banker pitches, and follow-on financing plans catch up.` },
      { id: "facts", heading: "What the sources say", body: `${whatMoved} The source facts matter because they create a hard public reference point: deal size, IPO price, valuation, allocation, and order-book demand. Anchor the read to those named facts first, then separate direct evidence from valuation and deal-market implications.` },
      { id: "market-mechanism", heading: "Why the market may care immediately", body: `${valuationImpact} ${sectorReadThrough} A large fresh price, valuation, order-book, or trading reference becomes a new public benchmark investors can compare against prior private marks and peer multiples.` },
      { id: "deal-financing-read", heading: "Capital-markets and deal read-through", body: `${financingImplication} The read-through is strongest when the event shows investors are willing to fund a story at a specific price, size, and timetable.` },
      { id: "parallel", heading: "Relevant comparison", body: parallelText },
      { id: "watch-next", heading: "What would confirm or weaken the read", body: `${watchNext} Confirmation should come from trading performance, allocation details, follow-on issuance, comparable repricing, or whether other IPO-ready companies accelerate plans.` }
    ];
  }
  if (lane === "macro") {
    return [
      {
        id: "takeaway",
        heading: "Plain-English takeaway",
        body: `${whyItMoved} In plain English, this is a story about whether the market can keep assuming easier policy and low enough discount rates to support current asset prices.`
      },
      {
        id: "release",
        heading: "What the release actually said",
        body: "Do not read the release as one headline number. Split it into three buckets: the headline print, the core trend, and the components doing the work underneath. The headline tells you how much inflation pressure households and bond traders feel, core tells you whether the Fed has a persistence problem, and the component mix tells you whether Treasury yields should treat the move as isolated noise or policy-relevant inflation."
      },
      {
        id: "mechanism",
        heading: "How the transmission works",
        body: `${whatMoved} ${valuationImpact} When inflation, growth, or labor data changes, the market immediately reruns the likely Fed path, the Treasury path, and the acceptable multiple on long-duration assets.`
      },
      {
        id: "market-read",
        heading: "How the market may read it",
        body: `${sectorReadThrough} A lot of confusion in macro stories comes from treating one release as a final verdict. In reality, the market is asking whether this data point confirms an existing trend or simply interrupts it for a day.`
      },
      {
        id: "watch-next",
        heading: "What would confirm or break the read",
        body: `${watchNext} If the next releases line up with this one, the current interpretation hardens. If they contradict it, the market can reverse quickly because the mechanism is expectation-driven and confidence in the current macro read can disappear fast.`
      }
    ];
  }
  if (lane === "markets") {
    return [
      {
        id: "takeaway",
        heading: "Plain-English takeaway",
        body: `${whyItMoved} The deeper question is what the move says about what investors are willing to believe about future revenue, margins, and durability.`
      },
      {
        id: "tape",
        heading: "What moved and what it suggests",
        body: `${whatMoved} The tape read matters when leadership, breadth, and risk appetite point in the same direction rather than merely producing a one-day bounce. Source detail: ${whatHappened}`
      },
      {
        id: "mechanism",
        heading: "Mechanism behind the move",
        body: `${valuationImpact} ${sectorReadThrough} The market is not just reacting to the fact pattern itself; it is deciding whether the story deserves a better multiple, a higher confidence level, or a narrower margin for disappointment.`
      },
      {
        id: "interpretation",
        heading: "What the market may be pricing in right or wrong",
        body: `${financingImplication} Sometimes the market is right to move quickly because the new fact changes the range of possible outcomes. Sometimes it over-credits a headline before checking whether the economics are durable, repeatable, and profitable.`
      },
      {
        id: "parallel",
        heading: "Relevant comparison",
        body: parallelText
      },
      {
        id: "watch-next",
        heading: "What to watch next",
        body: `${watchNext} The point of this checklist is to separate a one-day stock reaction from evidence that the market's new interpretation is actually becoming durable.`
      }
    ];
  }
  if (lane === "deals") {
    return [
      {
        id: "takeaway",
        heading: "Plain-English takeaway",
        body: `${whyItMoved} This is the kind of story where the headline matters less than whether the deal logic survives pressure from lenders, shareholders, and the approval process.`
      },
      {
        id: "transaction",
        heading: "What is happening in the transaction",
        body: `${whatMoved} In deals, the useful question is what changed in certainty, strategic need, financing tolerance, or the board's room to maneuver. Source detail: ${whatHappened}`
      },
      {
        id: "deal-read",
        heading: "Why the deal is being read this way",
        body: `${valuationImpact} ${financingImplication} Market participants are effectively rerunning the transaction math: what price still works, how much debt still works, and whether the strategic case is strong enough to absorb friction.`
      },
      {
        id: "precedent",
        heading: "Relevant precedent",
        body: parallelText
      },
      {
        id: "watch-next",
        heading: "What would change the outcome",
        body: `${watchNext} The next disclosed fact can change the whole read if it affects financing certainty, regulatory path, or the amount of value the buyer still expects to capture from the transaction.`
      }
    ];
  }
  if (segment === "private_credit") {
    return [
      {
        id: "takeaway",
        heading: "Plain-English takeaway",
        body: storyRead?.plainEnglish || `${whyItMoved} The important point is not just that private credit is active, but whether it is active on terms that still make transactions and refinancings workable after fees, covenants, and downside risk.`
      },
      {
        id: "signal",
        heading: "What the public signal is actually telling us",
        body: storyRead?.publicSignal || `${whatHappened} Public updates in private credit are always indirect, so the job is to translate them into a read on origination appetite, underwriting discipline, pricing, covenant protection, and whether lenders are stretching or pulling back.`
      },
      {
        id: "interpretation",
        heading: "How to interpret the financing signal",
        body: storyRead?.interpretation || `${valuationImpact} ${financingImplication} For learning purposes, the key mechanism is simple: if private debt stays available on protected terms, more assets can refinance or transact; if spreads widen, covenants weaken, or losses rise, equity checks grow and valuations have to adjust.`
      },
      {
        id: "evidence",
        heading: "Where the evidence is strong versus indirect",
        body: storyRead?.evidence || `${sectorReadThrough} This kind of story is strongest when it points to actual originations, repayments, spreads, credit performance, collateral, covenants, or lender commentary. It is weaker when it only gestures at appetite without showing how terms are changing.`
      },
      {
        id: "parallel",
        heading: "Relevant comparison",
        body: parallelText
      },
      {
        id: "watch-next",
        heading: "What would confirm or weaken the read",
        body: `${storyRead?.watch || watchNext} Those follow-up datapoints matter because private-credit stories are only useful when they show whether capital is still available on terms that can support real transactions and refinancings without hiding credit deterioration.`
      }
    ];
  }
  return [
    {
      id: "takeaway",
      heading: "Plain-English takeaway",
      body: storyRead?.plainEnglish || `${whyItMoved} The real learning value is understanding what this public signal says about sponsor behavior, exit routes, buyer depth, and valuation discipline rather than treating it as gossip about private marks.`
    },
    {
      id: "signal",
      heading: "What the public signal is actually telling us",
      body: storyRead?.publicSignal || `${whatHappened} ${whatMoved} In private markets, the cleanest public clues usually come from named transactions, financings, filings, or issuer commentary rather than from broad claims about sentiment.`
    },
    {
      id: "interpretation",
      heading: "How to read the sponsor or exit implication",
      body: storyRead?.interpretation || `${valuationImpact} ${financingImplication} The practical question is whether buyers and sellers can still agree on value, whether financing still supports that value, and whether the exit path is open enough to justify underwriting risk today.`
    },
    {
      id: "evidence",
      heading: "Where the evidence is strong versus indirect",
      body: storyRead?.evidence || `${sectorReadThrough} Private markets are less transparent than public ones, so the reader should separate direct evidence from inferred mood. That is what keeps the analysis grounded instead of speculative.`
    },
    {
      id: "parallel",
      heading: "Relevant comparison",
      body: parallelText
    },
    {
      id: "watch-next",
      heading: "What would confirm or weaken the read",
      body: `${storyRead?.watch || watchNext} Those follow-up datapoints matter because private-market stories are strongest when they lead to observable changes in financing, exits, sale processes, or valuation discipline instead of staying at the level of narrative alone.`
    }
  ];
}

export function bankerAnalysis(item, marketData = { series: [] }) {
  const editorialLane = editorialLaneFor(item);
  const privateMarketSegment = editorialLane === "private_markets" ? privateMarketSegmentFor(item) : null;
  const theme = item.matchedThemes?.[0]?.name || "Market discipline";
  const topic = item.topics?.[0] || "markets";
  const isMacro = editorialLane === "macro" || ["macro", "rates", "inflation", "fed"].some((t) => item.topics?.includes(t));
  const isBreaking = editorialLane === "breaking";
  const isPrivate = editorialLane === "private_markets";
  const isDeal = !isPrivate && (isBreaking || editorialLane === "deals" || ["deals", "filings", "credit", "ipo"].some((t) => item.topics?.includes(t)));
  const isPrivateCredit = privateMarketSegment === "private_credit";
  const isPrivateEquity = privateMarketSegment === "private_equity";
  const isCompany = ["companies", "ai", "capex", "consumer"].some((t) => item.topics?.includes(t));
  const storyRead = isPrivate ? storySpecificPrivateRead(item, privateMarketSegment) : null;

  const valuationImpact = isBreaking
    ? "Treat this as a live valuation mark: the price, size, allocation, order book, and first trading sessions show whether public investors validate or discount the private-market story."
    : isMacro
    ? "Treat this as a rates story first. Higher or stickier rates make future cash flows worth less today and make deal returns harder to underwrite."
    : isPrivateCredit
      ? "Read this as a financing-capacity signal: lender appetite, credit quality, spreads, and whether sponsor math still works with private debt."
    : isPrivateEquity
      ? "Read the item as a private-market valuation signal: exit timing, sponsor marks, private-credit appetite, and whether public comps still support the last private round."
    : isCompany
      ? "Focus on whether the news improves revenue durability, margin quality, or confidence in the growth story."
      : "Use the item to test whether the transaction still works at today's public multiples and financing costs.";

  const financingImplication = isBreaking
    ? "A strong debut would tell bankers that very large IPO supply can clear when issuer scarcity and demand are broad; weak trading would warn that order-book size is not durable aftermarket support."
    : isDeal
    ? "Check debt capacity, required equity, regulatory timing, and whether lenders would still finance the same structure today."
    : isPrivateCredit
      ? "Translate the item into direct-lending capacity, refinancing risk, debt cost, and whether lenders are still willing to finance sponsor-owned companies."
    : isPrivateEquity
      ? "Translate the signal into exit windows, refinancing options, sponsor willingness to transact, and whether private credit can still underwrite the risk."
    : isMacro
      ? "Translate the macro signal into borrowing costs, refinancing risk, and whether the capital markets window is open or tightening."
      : "Watch whether the story improves access to capital or makes funding harder for weaker peers.";

  const fallbackParallel = storyRead?.parallel
    ? { ...storyRead.parallel, sourceTrail: [{ source: item.source, url: item.url }] }
    : isBreaking
    ? { precedent: "Alibaba's 2014 IPO, Meta Platforms' 2012 IPO, and Arm's 2023 IPO became large technology debut benchmarks.", outcome: "Large IPOs can clear when issuers are scarce and high quality, but the lasting read depends on aftermarket trading, lock-up supply, profitability, and whether follow-on issuers share the same scarcity value.", whatRhymes: "A mega-IPO creates a public trading reference and demand signal that can influence other IPO candidates.", whatDiffers: "SpaceX has a unique mix of launch, satellite, communications, and defense-adjacent exposure, so one-company scarcity may not equal a broad reopening.", soWhat: "Treat the debut as a benchmark, not proof that every late-stage private mark is money-good.", sourceTrail: [{ source: item.source, url: item.url }] }
    : isMacro
    ? {
        precedent: "Past inflation scares where stocks held up for a while even as rates made financing harder.",
        outcome: "Valuations and leverage became less forgiving even when the equity market still looked constructive.",
        whatRhymes: "The useful comparison is how rates flow into valuation and deal math.",
        whatDiffers: "This setup depends on the inflation mix, the Fed's reaction, and the shape of the Treasury curve.",
        soWhat: "Use the precedent to stress-test rates and financing, not to predict the next index move.",
        sourceTrail: [{ source: item.source, url: item.url }]
      }
    : isDeal
      ? {
          precedent: "Activist pressure around pending strategic deals.",
          outcome: "Past cases often forced companies to explain synergies, timing, and capital allocation more clearly.",
          whatRhymes: "The deal window becomes a pressure point for proving the math.",
          whatDiffers: "The strength of the parallel depends on the activist's actual ask and ownership level.",
          soWhat: "Treat it as a deal-risk lens until more facts are public.",
          sourceTrail: [{ source: item.source, url: item.url }]
        }
      : isPrivateCredit
        ? {
            precedent: "The post-2022 shift toward private credit, when sponsors used direct lenders more often as syndicated loan markets became less predictable.",
            outcome: "Private credit helped deals close, but higher coupons and tighter covenants made sponsor math more demanding.",
            whatRhymes: "The same tradeoff matters now: available private debt can keep deal activity alive, but it does not make leverage cheap.",
            whatDiffers: "Public manager results and news items are proxies, not a complete view of private credit. Confirm the read with spreads, originations, and credit performance.",
            soWhat: "Use private-credit signals to judge financing capacity, but still underwrite downside cases and refinancing risk separately.",
            sourceTrail: [{ source: item.source, url: item.url }]
          }
      : isPrivateEquity
        ? {
            precedent: "Earlier private-market slowdowns where IPO windows narrowed and sponsors leaned harder on continuation funds, secondaries, and private credit.",
            outcome: "Companies with clean growth and public-market comparables could still exit; weaker stories stayed private longer or accepted lower marks.",
            whatRhymes: "The useful comparison is whether today's public-market signal improves or limits exit routes for private owners.",
            whatDiffers: "Private-market data is less transparent, so public filings, announced financings, and issuer commentary matter more than rumors.",
            soWhat: "Use the signal to judge exit timing and financing appetite, not to guess private marks without evidence.",
            sourceTrail: [{ source: item.source, url: item.url }]
          }
      : {
          precedent: "Earlier capex cycles where demand moved from the obvious winners into suppliers and infrastructure.",
          outcome: "Companies with backlog, margin, and durable customers earned more lasting credit than commodity suppliers.",
          whatRhymes: "The current story shows demand spreading across the value chain.",
          whatDiffers: "Revenue growth alone does not prove margin quality or durable economics.",
          soWhat: "Use the precedent to test whether demand turns into profit and cash flow.",
          sourceTrail: [{ source: item.source, url: item.url }]
        };

  const sourceBlurb = cleanSourceBlurb(item);

  return {
    id: item.id,
    title: item.title,
    editorialLane,
    editorialLaneLabel: laneDisplayName(editorialLane),
    privateMarketSegment,
    sourceTrail: [{ source: item.source, url: item.url, publishedAt: item.publishedAt, fetchedAt: item.fetchedAt }],
    freshnessStatus: item.freshnessStatus,
    confidence: item.sourceType === "official" ? "High" : "Medium",
    summary: summaryFor(item, editorialLane, privateMarketSegment, storyRead),
    whatHappened: sourceBlurb,
    whatMoved: item.analysis?.whatMoved || (isBreaking
      ? "The main move is that private-market narrative now has a public IPO price, trading date, allocation structure, and aftermarket test."
      : isMacro
      ? "The main move is in rates, inflation expectations, and the cost of capital."
      : isDeal
        ? "The main move is in deal certainty, shareholder pressure, and whether the financing still works."
        : isPrivateCredit
          ? "The main move is in private-credit capacity: whether direct lenders are still funding sponsor deals and refinancings at workable terms."
        : isPrivateEquity
          ? "The main move is in sponsor activity: whether private-equity buyers, sellers, and exit routes are becoming more active or more selective."
        : "The main move is in sector leadership, company valuation, and what the news says about peers."),
    whyItMoved: item.analysis?.whyItMoved || (isBreaking
      ? "Breaking IPO news matters because it turns private-market narrative into observable public-market evidence: price, size, allocation, demand, and trading performance."
      : isPrivateCredit
      ? "Private credit matters because it is now a major source of buyout and refinancing capital. The signal is whether lenders are still open, selective, or pulling back."
      : isPrivateEquity
        ? "Private equity matters when a named sponsor, asset, or exit route shows whether buyers and sellers can agree on valuation despite higher financing costs."
        : `This was selected because it links ${topic} news to ${theme} and has enough source support to analyze rather than merely mention.`),
    valuationImpact: item.analysis?.valuationImpact || valuationImpact,
    financingImplication: item.analysis?.financingImplication || financingImplication,
    sectorReadThrough: item.analysis?.sectorReadThrough || (isBreaking
      ? "Read-through is strongest for late-stage venture-backed companies, IPO-ready private issuers, crossover funds, retail allocation strategies, and sponsors waiting for proof that the IPO window can absorb large deals."
      : isPrivateCredit
      ? "Read-through is strongest for sponsor-backed companies, BDCs, direct lenders, and businesses facing refinancings."
      : isPrivateEquity
        ? "Read-through is strongest for sponsor-owned assets, auction candidates, continuation funds, and IPO-ready private companies."
        : item.matchedThemes?.length
      ? `Connects to ${item.matchedThemes.map((match) => match.name).join(", ")}.`
      : "No tracked theme has a strong enough fresh signal; treat as general context."),
    parallel: item.analysis?.parallel || fallbackParallel,
    watchNext: item.analysis?.watchNext || (isBreaking
      ? "Watch the opening print, first-day close versus the IPO price, stabilization activity, allocation disclosures, lock-up details, and whether other late-stage issuers accelerate filing plans."
      : isMacro
      ? "Watch the next official release, Treasury yields, and whether equity multiples can absorb the rate signal."
      : isDeal
        ? "Watch filings, financing details, shareholder reaction, and any change to timing or deal terms."
        : isPrivateCredit
          ? "Watch direct-lending originations, non-accruals, repayments, private-credit spreads, dividend recaps, and whether lenders finance new sponsor deals."
        : isPrivateEquity
          ? "Watch IPO filings, sponsor exits, secondaries, private-credit spreads, and whether public comps support new transactions."
        : "Watch follow-through in peer stocks, guidance, order/backlog commentary, and capital-markets activity."),
    longform: {
      sections: buildLongformSections({
        lane: editorialLane,
        segment: privateMarketSegment,
        item,
        whatHappened: sourceBlurb,
        whatMoved: item.analysis?.whatMoved || (isBreaking
          ? "The main move is that private-market narrative now has a public IPO price, trading date, allocation structure, and aftermarket test."
          : isMacro
          ? "The main move is in rates, inflation expectations, and the cost of capital."
          : isDeal
            ? "The main move is in deal certainty, shareholder pressure, and whether the financing still works."
            : isPrivateCredit
              ? "The main move is in private-credit capacity: whether direct lenders are still funding sponsor deals and refinancings at workable terms."
              : isPrivateEquity
                ? "The main move is in sponsor activity: whether private-equity buyers, sellers, and exit routes are becoming more active or more selective."
                : "The main move is in sector leadership, company valuation, and what the news says about peers."),
        whyItMoved: item.analysis?.whyItMoved || (isPrivateCredit
          ? "Private credit matters because it is now a major source of buyout and refinancing capital. The signal is whether lenders are still open, selective, or pulling back."
          : isPrivateEquity
            ? "Private equity matters when a named sponsor, asset, or exit route shows whether buyers and sellers can agree on valuation despite higher financing costs."
            : `This was selected because it links ${topic} news to ${theme} and has enough source support to analyze rather than merely mention.`),
        valuationImpact: item.analysis?.valuationImpact || valuationImpact,
        financingImplication: item.analysis?.financingImplication || financingImplication,
        sectorReadThrough: item.analysis?.sectorReadThrough || (isPrivateCredit
          ? "Read-through is strongest for sponsor-backed companies, BDCs, direct lenders, and businesses facing refinancings."
          : isPrivateEquity
            ? "Read-through is strongest for sponsor-owned assets, auction candidates, continuation funds, and IPO-ready private companies."
            : item.matchedThemes?.length
              ? `Connects to ${item.matchedThemes.map((match) => match.name).join(", ")}.`
              : "No tracked theme has a strong enough fresh signal; treat as general context."),
        parallel: item.analysis?.parallel || fallbackParallel,
        watchNext: item.analysis?.watchNext || (isMacro
          ? "Watch the next official release, Treasury yields, and whether equity multiples can absorb the rate signal."
          : isDeal
            ? "Watch filings, financing details, shareholder reaction, and any change to timing or deal terms."
            : isPrivateCredit
              ? "Watch direct-lending originations, non-accruals, repayments, private-credit spreads, dividend recaps, and whether lenders finance new sponsor deals."
              : isPrivateEquity
                ? "Watch IPO filings, sponsor exits, secondaries, private-credit spreads, and whether public comps support new transactions."
                : "Watch follow-through in peer stocks, guidance, order/backlog commentary, and capital-markets activity."),
        storyRead
      })
    },
    visual: visualFor(item, marketData),
    relatedLinks: item.relatedLinks || [],
    storyline: storylineFor(item),
    concepts: item.matchedThemes?.flatMap((match) => match.hits).slice(0, 5) || []
  };
}

function eligibleSectionCandidates(scored) {
  return [...scored]
    .filter((item) => item.eligible && item.scores.total >= 30)
    .sort((a, b) => b.scores.total - a.scores.total);
}

function isWeekendRun(runDate) {
  const day = new Date(`${runDate}T12:00:00-04:00`).getDay();
  return day === 0 || day === 6;
}

export function weekdaySectionBackfillCandidates(scored, lane, runDate) {
  if (isWeekendRun(runDate)) return [];
  return [...scored]
    .filter((item) => editorialLaneFor(item) === lane)
    .filter((item) => item.url && item.publishedAt)
    .filter((item) => item.scores.evidence >= 3)
    .filter((item) => item.freshnessStatus !== "FUTURE" && item.freshnessStatus !== "INVALID")
    .filter((item) => item.freshnessStatus !== "BACKGROUND")
    .filter((item) => item.scores.total >= 24)
    .sort((a, b) => b.scores.total - a.scores.total);
}

export function backfillWeekdaySections(sections, scored, marketData, runDate) {
  if (isWeekendRun(runDate)) return sections;
  for (const lane of ["macro", "markets", "deals"]) {
    if (sections[lane].items.length) continue;
    const item = weekdaySectionBackfillCandidates(scored, lane, runDate)[0];
    if (!item) continue;
    sections[lane].items.push({
      ...bankerAnalysis(item, marketData),
      sectionBackfill: true,
      confidence: item.sourceType === "official" ? "High" : "Medium"
    });
  }
  return sections;
}

function matchCalendarEvent(move, events, runDate) {
  const title = `${move.title} ${move.whatHappened}`.toLowerCase();
  const upcomingEvents = events.filter((event) => event.scheduledDate >= runDate);
  const preferred = upcomingEvents.filter((event) => {
    const eventTitle = event.title.toLowerCase();
    if (/personal income and outlays/.test(title)) return /personal income and outlays/.test(eventTitle);
    if (/\bpce\b|\binflation\b/.test(title)) return /personal income and outlays|consumer price index|producer price index/.test(eventTitle);
    if (/\bgdp\b/.test(title)) return /\bgdp\b/.test(eventTitle);
    if (/\bfed\b|\bfomc\b|\brates\b/.test(title)) return /fomc/.test(eventTitle);
    if (/\bemployment\b|\bpayrolls\b/.test(title)) return /employment situation/.test(eventTitle);
    return false;
  });
  return preferred[0] || null;
}

function attachMacroCalendar(sections, analyses, calendarPayload, runDate) {
  const events = [...(calendarPayload?.events || [])].sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
  const latestMove = analyses.find((item) => item.editorialLane === "macro") || null;
  const latestEvent = latestMove
    ? {
        title: latestMove.title,
        happenedAt: latestMove.sourceTrail?.[0]?.publishedAt || runDate,
        whatHappened: latestMove.whatHappened,
        whyItMatters: latestMove.whyItMoved,
        watchNext: latestMove.watchNext,
        sourceTrail: latestMove.sourceTrail,
        scheduledEvent: matchCalendarEvent(latestMove, events, runDate)
      }
    : null;

  const upcoming = events
    .filter((event) => event.scheduledDate >= runDate && event.significance === "high")
    .slice(0, 8);

  sections.macro.latestEvent = latestEvent;
  sections.macro.economicCalendar = upcoming;
  return sections;
}

export function selectMainCandidates(scored, limit = 5, prior = []) {
  const selected = [];
  const laneCounts = new Map();
  const candidates = selectCandidates(scored, 10);
  const recentLeadKeys = recentLeadThemeKeys(prior);
  const firstFreshLead = candidates.find((item) => !recentLeadKeys.has(leadThemeKey(item)));
  const topCandidate = candidates[0];
  const repeatedLeadIsClearlyBest = topCandidate
    && firstFreshLead
    && recentLeadKeys.has(leadThemeKey(topCandidate))
    && topCandidate.scores.total >= firstFreshLead.scores.total + 8;
  const lead = repeatedLeadIsClearlyBest ? topCandidate : (firstFreshLead || topCandidate);
  const ordered = lead ? [lead, ...candidates.filter((item) => item !== lead)] : candidates;

  for (const item of ordered) {
    const lane = editorialLaneFor(item);
    const count = laneCounts.get(lane) || 0;
    if (count >= 2) continue;
    selected.push(item);
    laneCounts.set(lane, count + 1);
    if (selected.length === limit) break;
  }
  return selected;
}

function latestSeriesPoint(series) {
  const observations = series?.observations || [];
  const latest = observations[observations.length - 1] || null;
  const previous = observations[observations.length - 2] || null;
  if (!latest || !previous) return null;
  const change = latest.value - previous.value;
  const percentChange = previous.value ? (change / previous.value) * 100 : 0;
  return { latest, previous, change, percentChange };
}

function shortReason(id, point, analyses) {
  const macro = analyses.find((item) => item.editorialLane === "macro");
  const markets = analyses.find((item) => item.editorialLane === "markets");
  const privateCredit = analyses.find((item) => item.privateMarketSegment === "private_credit");
  const direction = point.percentChange > 0.2 ? "up" : point.percentChange < -0.2 ? "down" : "flat";

  if (id === "SPY") {
    if (macro) {
      return direction === "up"
        ? "SPY leaned on the macro read: the core inflation detail looked less alarming even though headline PCE still kept rate cuts from becoming a one-way trade."
        : "SPY was held back by the macro read: headline inflation stayed sticky enough to keep the cost-of-capital discussion alive.";
    }
    return "SPY moved with the broad tape; no separate S&P-specific headline cleared the brief beyond the macro backdrop.";
  }
  if (id === "QQQ") {
    if (markets && /dell|ai/i.test(markets.title)) {
      return direction === "up"
        ? "QQQ was helped by the AI infrastructure read-through after Dell reinforced that demand is spreading beyond the first chip winners."
        : "QQQ felt the tug-of-war between AI enthusiasm and the higher-rate backdrop that still matters for long-duration growth.";
    }
    return "QQQ mostly tracked large-cap growth sentiment; no cleaner tech-wide catalyst cleared the tape than the stories already in the brief.";
  }
  if (id === "IWM") {
    if (macro || privateCredit) {
      return "Small caps stay more sensitive to financing and refinancing conditions, so IWM is reading through the rate backdrop and the credit-window discussion faster than mega-cap tech.";
    }
    return "IWM moved on financing sensitivity more than on a single company headline in this edition.";
  }
  if (id === "GLD") {
    return macro
      ? "Gold is trading against the same inflation-and-Fed uncertainty in the macro tab: sticky inflation can support defensive demand, but higher real rates can lean the other way."
      : "Gold moved with the broader inflation and policy backdrop; no gold-specific story cleared the brief.";
  }
  if (id === "USO" || id === "DCOILWTICO") {
    return "Oil is mostly reading through growth and inflation expectations here. No separate energy headline cleared the brief, so treat this as macro context rather than an oil thesis.";
  }
  return "This move reflects the day’s broader market backdrop more than a standalone story in the brief.";
}

function buildMarketWatch(marketData, analyses) {
  const watchList = [
    { id: "SPY", label: "SPY", display: "S&P 500" },
    { id: "QQQ", label: "QQQ", display: "Nasdaq 100" },
    { id: "IWM", label: "IWM", display: "Russell 2000" },
    { id: "GLD", label: "GLD", display: "Gold" },
    { id: "USO", label: "USO", display: "Oil proxy (USO ETF)" },
    { id: "DCOILWTICO", fallbackId: "USO", label: "WTI", display: "Oil" }
  ];
  const rows = watchList.map((target) => {
    const series = marketData?.series?.find((item) => item.id === target.id)
      || marketData?.series?.find((item) => item.id === target.fallbackId);
    const point = latestSeriesPoint(series);
    if (!series || !point) return null;
    return {
      id: target.id,
      symbol: target.label,
      name: target.display,
      source: series.source,
      sourceUrl: series.url,
      fetchedAt: series.fetchedAt,
      latestDate: point.latest.date,
      price: point.latest.value,
      change: point.change,
      percentChange: point.percentChange,
      whyItMoved: shortReason(target.id, point, analyses)
    };
  }).filter(Boolean);
  return rows.some((item) => item.id === "USO")
    ? rows.filter((item) => item.id !== "DCOILWTICO")
    : rows;
}

function buildOpenBbMarketPack(marketData) {
  const pack = marketData?.openbbMarketPack;
  if (!pack || typeof pack !== "object") return null;
  const topRows = (rows = [], field = "oneDayPct", limit = 6) => rows
    .filter((row) => Number.isFinite(row?.[field]))
    .sort((a, b) => Math.abs(b[field]) - Math.abs(a[field]))
    .slice(0, limit);

  return {
    runDate: pack.runDate,
    fetchedAt: pack.fetchedAt,
    provider: pack.provider,
    sourceNote: pack.sourceNote,
    sourceTrail: pack.sourceTrail || [],
    summary: pack.summary || {},
    indices: pack.indices || [],
    sectors: topRows(pack.sectors, "oneDayPct", 6),
    watchlist: topRows(pack.watchlist, "oneDayPct", 8),
    failures: pack.failures || []
  };
}

async function main() {
  const runDate = process.env.BRIEF_DATE || editionDate();
  const now = new Date(process.env.BRIEF_NOW || new Date().toISOString());
  await Promise.all([ensureDir(candidatesDir), ensureDir(analysisDir), ensureDir(editionsDir)]);

  const sourcePayload = await readJson(path.join(sourcesDir, `${runDate}.json`), null)
    || await readJson(path.join(sourcesDir, "latest.json"));
  const marketData = await readJson(path.join(marketDataDir, `${runDate}.json`), null)
    || await readJson(path.join(marketDataDir, "latest.json"), { series: [], failures: [] });
  const calendarPayload = await readJson(path.join(calendarDir, `${runDate}.json`), null)
    || await readJson(path.join(calendarDir, "latest.json"), { events: [], failures: [] });
  const themes = await readJson(path.join(dataDir, "themes.json"), []);
  const scored = sourcePayload.items.map((item) => scoreCandidate(item, themes, now));
  const prior = await priorEditions(runDate);
  const selected = selectMainCandidates(scored, 5, prior);
  const analyses = attachContinuity(selected.map((item) => bankerAnalysis(item, marketData)), prior);
  const sectionAnalyses = attachContinuity(eligibleSectionCandidates(scored).map((item) => bankerAnalysis(item, marketData)), prior);
  const sections = attachMacroCalendar(backfillWeekdaySections(selectLaneItems(sectionAnalyses, 3), scored, marketData, runDate), analyses, calendarPayload, runDate);
  sections.overnight = buildOvernightSection(scored, marketData, now, 3);
  const dealTape = buildDealTape(scored, { now, limit: 8 });
  const marketWatch = buildMarketWatch(marketData, analyses);
  const openbbMarketPack = buildOpenBbMarketPack(marketData);
  const themePulse = themes
    .map((theme) => ({
      id: theme.id,
      name: theme.name,
      freshItems: scored.filter((item) => item.matchedThemes.some((match) => match.id === theme.id) && item.freshnessStatus !== "BACKGROUND").length,
      openQuestions: theme.openQuestions || []
    }))
    .filter((theme) => theme.freshItems > 0);

  const candidatePayload = {
    runDate,
    generatedAt: new Date().toISOString(),
    window: "Latest fetched source set; main tape excludes weak or unsupported items.",
    candidates: scored
  };
  const analysisPayload = {
    runDate,
    generatedAt: new Date().toISOString(),
    selectedCount: analyses.length,
    quietDay: analyses.length < 3,
    analyses
  };
  const sourceRunAt = sourcePayload.fetchedAt;
  const sourceRunDate = new Date(sourceRunAt);
  const sourceFreshnessAt = Number.isNaN(sourceRunDate.getTime()) || sourceRunDate <= now ? sourceRunAt : now.toISOString();

  const edition = {
    runDate,
    title: analyses[0]?.title || "Quiet Tape, Clean Sources",
    dek: analyses.length
      ? "A selective banker-grade read of the few fresh items with enough evidence to support real analysis."
      : "No source-backed item cleared the evidence bar; the system is intentionally holding the main tape quiet.",
    generatedAt: new Date().toISOString(),
    sourceRunAt,
    freshnessStatus: freshnessStatus(sourceFreshnessAt, now),
    moves: analyses,
    sections,
    dealTape,
    marketWatch,
    openbbMarketPack,
    deepDive: analyses[0] || null,
    continuingStories: analyses.filter((item) => item.continuity),
    themePulse,
    watchNext: analyses.map((item) => item.watchNext).slice(0, 4),
    sourceFailures: sourcePayload.failures || [],
    visualDataFailures: marketData.failures || [],
    calendarFailures: calendarPayload.failures || [],
    review: { status: "PENDING" }
  };

  await writeJson(path.join(candidatesDir, `${runDate}.json`), candidatePayload);
  await writeJson(path.join(analysisDir, `${runDate}.json`), analysisPayload);
  await writeJson(path.join(editionsDir, `${runDate}.json`), edition);
  await writeJson(path.join(editionsDir, "latest.json"), edition);
  console.log(`Built edition ${runDate} with ${analyses.length} selected items from ${scored.length} candidates.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
