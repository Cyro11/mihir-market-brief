import { absoluteUrl, normalizeText } from "./utils.js";

const dealPattern = /\b(merger|merge|acquisition|acquire|acquires|acquired|takeover|buyout|lbo|stake|activist|tender|spin-?off|spinoff|ipo|offering|sale process|auction|joint venture|venture|strategic partnership|partnership|fundraising|fund|secondaries|secondary|continuation fund|sponsor|private equity|private credit|direct lending|loan|refinanc|financing|debt|credit facility|restructur|bankruptcy|chapter 11)\b/i;
const hardDealPattern = /\b(merger|acquisition|acquire|acquires|acquired|takeover|buyout|lbo|tender|spin-?off|ipo|sale process|auction|joint venture|stake|activist)\b/i;
const financingPattern = /\b(financing|debt|loan|credit facility|direct lending|private credit|refinanc|offering|notes|fundraising|fund close|secondaries|continuation fund)\b/i;
const regulatorPattern = /\b(sec|filing|regulatory|approval|antitrust|ftc|doj|shareholder vote|proxy|13d|13g|schedule|tender)\b/i;
const impactPattern = /\b(\$\s?\d|billion|bn|million|record|largest|major|transformative|strategic|premium|all-cash|cash-and-stock|500 mw|data center|ai|google|blackstone|kkr|apollo|ares|blue owl)\b/i;
const staleOrPromotionalDealPattern = /\b(deep value stock to invest in now|apollo\s*&\s*blackstone.*anthropic ai deal|broadcom.*ai xpv platform)\b/i;

function textFor(item) {
  return normalizeText(`${item.title || ""} ${item.summary || ""} ${(item.topics || []).join(" ")} ${(item.tickers || []).join(" ")}`);
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function labelFor(score) {
  if (score >= 70) return "High";
  if (score >= 50) return "Medium";
  return "Developing";
}

function daysOld(item, now) {
  const published = Date.parse(item.publishedAt || "");
  if (!Number.isFinite(published)) return 999;
  return Math.max(0, (now.getTime() - published) / 86_400_000);
}

function entityKey(item) {
  const tickers = (item.tickers || []).map((ticker) => ticker.toUpperCase()).filter(Boolean).sort();
  if (tickers.length) return `tickers:${tickers.slice(0, 3).join("-")}`;
  const text = textFor(item).toLowerCase();
  const known = text.match(/\b(blackstone|google|kkr|apollo|ares|blue owl|dell|mccormick|unilever|nvidia|openai|anthropic|broadcom|tesla|disney|warner|paramount|skydance)\b/g);
  if (known?.length) return `names:${[...new Set(known)].slice(0, 3).join("-")}`;
  const tokens = (item.title || "")
    .toLowerCase()
    .replace(/[^a-z0-9$ ]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 3 && !/^(with|from|that|this|after|amid|into|about|market|markets|stock|stocks|shares)$/.test(token));
  return `title:${tokens.slice(0, 5).join("-") || item.id}`;
}

export function scoreDealCandidate(item, now = new Date()) {
  const text = textFor(item);
  const topics = new Set(item.topics || []);
  const sourceTotal = item.scores?.total || 0;
  const age = daysOld(item, now);
  const isDealLike = dealPattern.test(text) || topics.has("deals") || topics.has("private_markets") || topics.has("private_credit") || topics.has("private_equity");
  if (staleOrPromotionalDealPattern.test(text)) return null;
  if (!isDealLike || !absoluteUrl(item.url)) return null;

  let dealStrengthScore = 15;
  if (hardDealPattern.test(text)) dealStrengthScore += 28;
  if (financingPattern.test(text)) dealStrengthScore += 16;
  if (impactPattern.test(text)) dealStrengthScore += 24;
  if (regulatorPattern.test(text)) dealStrengthScore += 10;
  if (topics.has("deals")) dealStrengthScore += 10;
  if (topics.has("private_markets") || topics.has("private_credit") || topics.has("private_equity")) dealStrengthScore += 8;
  dealStrengthScore += Math.min(15, Math.max(0, sourceTotal - 25) * 0.4);

  let updateStrengthScore = age <= 1 ? 28 : age <= 7 ? 20 : age <= 30 ? 12 : 5;
  if (item.freshnessStatus === "LIVE" || item.freshnessStatus === "FRESH") updateStrengthScore += 12;
  if (regulatorPattern.test(text)) updateStrengthScore += 10;
  if ((item.facts || []).length >= 2) updateStrengthScore += 5;
  if (item.sourceType === "official") updateStrengthScore += 7;

  const dealStrength = clamp(dealStrengthScore);
  const updateStrength = clamp(updateStrengthScore);
  const total = Math.round((dealStrength * 0.68) + (updateStrength * 0.22) + Math.min(sourceTotal, 60) * 0.10);

  return {
    item,
    key: entityKey(item),
    total,
    dealStrength,
    dealStrengthLabel: labelFor(dealStrength),
    updateStrength,
    updateStrengthLabel: labelFor(updateStrength),
    sourceTotal,
    age
  };
}

function sourceTrailFor(items) {
  const seen = new Set();
  return items.map((item) => ({
    source: item.source || "Source",
    url: item.url,
    publishedAt: item.publishedAt,
    fetchedAt: item.fetchedAt
  })).filter((source) => {
    if (!source.url || seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  });
}

function whyItRanks(top, clusterSize) {
  const parts = [];
  if (top.dealStrengthLabel === "High") parts.push("large or strategically important transaction signal");
  if (top.updateStrengthLabel === "High") parts.push("fresh/official update strength");
  if (clusterSize > 1) parts.push(`${clusterSize} related source items clustered together`);
  if (!parts.length) parts.push("deal relevance and source support cleared the tape threshold");
  return `Ranks here because it has ${parts.join(", ")}.`;
}

function watchNextFor(top) {
  const text = textFor(top.item).toLowerCase();
  if (/activist|stake|13d|proxy/.test(text)) return "Watch ownership filings, the investor's ask, board response, and whether the campaign changes deal timing or valuation.";
  if (/ipo|offering/.test(text)) return "Watch filing updates, valuation range, cornerstone demand, and whether peer multiples support the proposed price.";
  if (/private credit|direct lending|loan|refinanc|debt|financing/.test(text)) return "Watch lender terms, spreads, covenants, refinancing timing, and whether financing availability changes sponsor math.";
  if (/merger|acquisition|takeover|buyout|tender/.test(text)) return "Watch financing details, regulatory path, shareholder vote, timing, and any change in price or certainty.";
  return "Watch filings, financing terms, counterparties, approvals, and the next disclosed fact that changes certainty or value.";
}

export function buildDealTape(scoredItems, { now = new Date(), limit = 8, minimumScore = 38 } = {}) {
  const scoredDeals = scoredItems
    .map((item) => scoreDealCandidate(item, now))
    .filter(Boolean)
    .filter((deal) => deal.total >= minimumScore);

  const clusters = new Map();
  for (const deal of scoredDeals) {
    const current = clusters.get(deal.key) || [];
    current.push(deal);
    clusters.set(deal.key, current);
  }

  return [...clusters.values()]
    .map((cluster) => {
      const ranked = cluster.sort((a, b) => b.total - a.total || a.age - b.age);
      const top = ranked[0];
      const items = ranked.map((entry) => entry.item);
      const score = Math.round(Math.min(100, top.total + Math.min(8, (cluster.length - 1) * 3)));
      return {
        id: `deal-${top.key.replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "")}`,
        title: top.item.title,
        summary: top.item.summary || top.item.title,
        primaryLane: top.item.editorialLane || null,
        rankScore: score,
        dealStrength: { score: top.dealStrength, label: top.dealStrengthLabel },
        updateStrength: { score: top.updateStrength, label: top.updateStrengthLabel },
        whyItRanks: whyItRanks(top, cluster.length),
        sourceTrail: sourceTrailFor(items),
        watchNext: watchNextFor(top),
        clusteredItemCount: cluster.length,
        relatedItemIds: items.map((item) => item.id),
        freshnessStatus: top.item.freshnessStatus,
        publishedAt: top.item.publishedAt
      };
    })
    .sort((a, b) => b.rankScore - a.rankScore || (b.sourceTrail.length - a.sourceTrail.length))
    .slice(0, limit)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}
