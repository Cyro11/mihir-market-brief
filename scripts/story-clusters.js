import { absoluteUrl, hashKey, normalizeText, slugify } from "./utils.js";

const stopWords = new Set([
  "the", "and", "for", "with", "from", "that", "this", "into", "over", "under", "after", "before",
  "says", "said", "report", "reports", "new", "news", "update", "updates", "today", "market",
  "markets", "stock", "stocks", "shares", "company", "companies", "business", "finance", "wall", "street",
  "could", "would", "will", "may", "its", "their", "about", "amid", "while", "when", "where", "what",
  "why", "how", "more", "less", "top", "latest", "live", "watch", "brief", "analysis"
]);

const importancePattern = /\b(\$\s?\d+(?:\.\d+)?\s?(?:billion|bn|trillion|tn|million|mn)|\d+(?:\.\d+)?\s?%|acquisition|acquire|merger|takeover|buyout|lbo|stake|activist|ipo|initial public offering|priced|debut|files? for|offering|fed|fomc|rate|rates|yield|treasury|inflation|cpi|ppi|pce|payrolls|employment|gdp|bankruptcy|restructur|default)\b/i;
const recruitingPattern = /\b(ipo|m&a|merger|acquisition|buyout|lbo|private equity|private credit|direct lending|leveraged finance|debt|financing|refinanc|credit|rates|fed|inflation|valuation|sponsor|secondaries|continuation fund|activist|filing|offering|capital markets)\b/i;
const entityPattern = /\b(?:[A-Z][A-Za-z0-9&.'-]+(?:\s+[A-Z][A-Za-z0-9&.'-]+){0,3}|[A-Z]{2,5})\b/g;
const eventWords = new Set(["acquire", "acquisition", "merger", "ipo", "priced", "files", "filed", "fed", "rate", "rates", "cpi", "ppi", "pce", "payrolls", "inflation", "default", "bankruptcy", "activist"]);

function hostName(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function isInternalDerivedItem(item) {
  return Boolean(item.internalDerivedSummary || item.evidenceType === "internal_derived" || item.evidenceStrength === "thin_internal");
}

function tokensFor(item) {
  const text = normalizeText(item.title || "");
  const lowerTokens = text
    .toLowerCase()
    .match(/[a-z0-9$%.]+/g) || [];
  const entities = text.match(entityPattern) || [];
  const tickerTokens = (item.tickers || []).map((ticker) => String(ticker).toLowerCase());
  return new Set([
    ...tickerTokens,
    ...entities.map((entity) => entity.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()).filter(Boolean),
    ...lowerTokens.filter((token) => token.length > 2 && !stopWords.has(token))
  ]);
}

function canonicalKey(item) {
  const tokens = [...tokensFor(item)]
    .filter((token) => !/^\d+$/.test(token))
    .sort((a, b) => {
      const entityishA = /\s|\$|%|\d/.test(a) ? 1 : 0;
      const entityishB = /\s|\$|%|\d/.test(b) ? 1 : 0;
      return entityishB - entityishA || b.length - a.length || a.localeCompare(b);
    })
    .slice(0, 5);
  return slugify(tokens.join(" ")) || hashKey(item.title || item.id || item.url || "story");
}

function overlapRatio(a, b) {
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / Math.min(a.size, b.size);
}

function shouldCluster(item, cluster) {
  const itemTokens = tokensFor(item);
  const tokenOverlap = overlapRatio(itemTokens, cluster.tokenSet);
  const exactTicker = (item.tickers || []).some((ticker) => cluster.tickers.has(String(ticker).toLowerCase()));
  const sameDealNumber = /\$\s?\d|\d+(?:\.\d+)?\s?%/.test(item.title || "")
    && [...itemTokens].some((token) => /\$|%|\d/.test(token) && cluster.tokenSet.has(token));
  const sameEventVerb = [...itemTokens].some((token) => eventWords.has(token) && cluster.tokenSet.has(token));
  return tokenOverlap >= 0.45 || (tokenOverlap >= 0.28 && (exactTicker || sameDealNumber || sameEventVerb));
}

function sourceTrailFor(items) {
  const seen = new Set();
  return items
    .map((item) => ({
      source: item.source || hostName(item.url) || "Source",
      url: absoluteUrl(item.url),
      publishedAt: item.publishedAt,
      fetchedAt: item.fetchedAt,
      feedId: item.feedId,
      evidenceType: isInternalDerivedItem(item) ? "internal_derived" : (item.evidenceType || "reported")
    }))
    .filter((entry) => entry.url)
    .filter((entry) => {
      const key = entry.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function scoreStoryCluster(cluster) {
  const strongItems = cluster.items.filter((item) => !isInternalDerivedItem(item));
  const sourceDiversity = new Set(cluster.items.map((item) => item.source || hostName(item.url)).filter(Boolean)).size;
  const coverageCount = cluster.items.length;
  const text = normalizeText(cluster.items.map((item) => `${item.title} ${item.summary} ${(item.topics || []).join(" ")}`).join(" "));
  const importanceCues = (text.match(importancePattern) || []).length;
  const recruitingRelevance = recruitingPattern.test(text) ? 2 : 0;
  const evidenceSourceCount = strongItems.length;
  const readerValue = Math.min(6, importanceCues * 2 + recruitingRelevance + Math.min(sourceDiversity, 3));
  const topItemScore = Math.max(...cluster.items.map((item) => item.scores?.total ?? 0), 0);
  const sourceDiversityScore = Math.max(0, sourceDiversity - 1) * 4;
  const coverageScore = Math.max(0, coverageCount - 1) * 2;
  const internalOnlyPenalty = evidenceSourceCount === 0 ? 8 : 0;
  const editorialBonus = coverageCount > 1 ? importanceCues * 2 + recruitingRelevance + readerValue : Math.min(readerValue, 2);
  const total = topItemScore + sourceDiversityScore + coverageScore + editorialBonus - internalOnlyPenalty;
  return {
    sourceDiversity,
    coverageCount,
    evidenceSourceCount,
    importanceCues,
    recruitingRelevance,
    readerValue,
    total
  };
}

export function clusterStories(items, { includeIneligible = false } = {}) {
  const clusters = [];
  const candidates = items.filter((item) => includeIneligible || item.eligible);
  for (const item of candidates) {
    let cluster = clusters.find((candidate) => shouldCluster(item, candidate));
    if (!cluster) {
      cluster = {
        id: `story-${canonicalKey(item)}`,
        title: normalizeText(item.title),
        tokenSet: new Set(),
        tickers: new Set(),
        items: []
      };
      clusters.push(cluster);
    }
    cluster.items.push(item);
    for (const token of tokensFor(item)) cluster.tokenSet.add(token);
    for (const ticker of item.tickers || []) cluster.tickers.add(String(ticker).toLowerCase());
    cluster.items.sort((a, b) => (b.scores?.total ?? 0) - (a.scores?.total ?? 0));
    cluster.title = cluster.items[0]?.title || cluster.title;
  }

  return clusters.map((cluster) => {
    const storyScores = scoreStoryCluster(cluster);
    const sourceTrail = sourceTrailFor(cluster.items);
    return {
      id: cluster.id,
      title: cluster.title,
      items: cluster.items,
      leadItem: cluster.items[0],
      sourceTrail,
      scores: storyScores,
      sourceDiversity: storyScores.sourceDiversity,
      coverageCount: storyScores.coverageCount,
      evidenceSourceCount: storyScores.evidenceSourceCount,
      importanceCues: storyScores.importanceCues,
      recruitingRelevance: storyScores.recruitingRelevance,
      readerValue: storyScores.readerValue
    };
  }).sort((a, b) => b.scores.total - a.scores.total || b.sourceDiversity - a.sourceDiversity || b.coverageCount - a.coverageCount);
}

export function representativeItemsFromClusters(clusters) {
  return clusters.map((cluster) => ({
    ...cluster.leadItem,
    storyCluster: {
      id: cluster.id,
      title: cluster.title,
      sourceDiversity: cluster.sourceDiversity,
      coverageCount: cluster.coverageCount,
      evidenceSourceCount: cluster.evidenceSourceCount,
      importanceCues: cluster.importanceCues,
      recruitingRelevance: cluster.recruitingRelevance,
      readerValue: cluster.readerValue,
      score: cluster.scores.total
    },
    sourceTrail: cluster.sourceTrail,
    relatedLinks: cluster.sourceTrail.filter((entry) => entry.url !== absoluteUrl(cluster.leadItem.url)).map((entry) => ({
      source: entry.source,
      url: entry.url,
      publishedAt: entry.publishedAt,
      fetchedAt: entry.fetchedAt
    })),
    scores: {
      ...(cluster.leadItem.scores || {}),
      story: cluster.scores,
      sourceItemTotal: cluster.leadItem.scores?.total ?? 0,
      total: Math.max(cluster.leadItem.scores?.total ?? 0, cluster.scores.total)
    }
  }));
}
