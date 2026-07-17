import { sourceQuality, topicBankerWeights } from "./config.js";
import { absoluteUrl, freshnessStatus, normalizeText } from "./utils.js";
import { isInternalDerivedItem } from "./story-clusters.js";

const positiveSignalPattern = /\b(pce|cpi|ppi|gdp|payrolls|employment|unemployment|fomc|fed|treasury|yield|inflation|earnings|guidance|revenue|margin|shares?|stock|stocks|index|indices|s&p|nasdaq|russell|dow|gold|oil|crude|spread|spreads|credit|direct lending|asset-?based finance|refinanc|financing|debt|mega-?deal|chip deal|default|non-accrual|lbo|buyout|merger|acquisition|acquire|sells?|stake|activist|ipo|spin-?off|sale process|asset sale|auction|restructur|bankruptcy|filing|offering|fundraising|rais(?:e|es|ed|ing)|secondaries|continuation fund|sponsor)\b/i;
const strongProxySignalPattern = /\b(acquire|acquisition|buyout|stake|activist|sale|sold|sells|ipo|earnings|originations|direct lending|asset-?based finance|loan|loans|credit|refinanc|default|write-?down|non-accrual|spread|fundraising|rais(?:e|es|ed|ing)|secondaries|continuation fund|merger|financing|notes offering|debt offering|equity offering|share offering|stock offering|public offering|offering priced)\b/i;
const noisePattern = /\b(route revealed|power tour|celebrates|duplex|tenant calls|retirement portfolio|retirees|dividend stocks to buy|oversold dividend growth stocks|stocks to buy|top insider picks|insider picks|deep value stock to invest in now|don't buy it|do not buy it|price recommendation|price target|hold rating|buy rating|sell rating|turns more cautious|analyst upgrades?|analyst downgrades?|leadership appointment|conference|forum|watch highlights|podcast|sessions|bringing|launches|reveals new look|creative space|investigates|5 facts|how a digital agency transformed|fitness experience|data incident|law group|contribution limits|racing|balanced plan|present at|to present at|announces key leadership|declares .*distribution|not a handout|claw back|your share of the ai wealth|congress goes on summer break|double bubble|next crash|here's why|opinion|personal finance|financial freedom|gen z-?ers?|old ideas they'?re leaving behind|stable job and a nice home|irs tax liens?|consumer advocate says|you are missing the bond deal|guaranteed to beat inflation|hellonation|debt settlement|credit recovery)\b/i;
const trustedDomainPattern = /\b(sec\.gov|bea\.gov|federalreserve\.gov|fred\.stlouisfed\.org|reuters\.com|cnbc\.com|finance\.yahoo\.com|marketwatch\.com|apnews\.com|investors\.com|kkr\.com|blueowl\.com|arescapitalcorp\.com|investor\.)\b/i;
const majorBreakingPattern = /\b(ipo|initial public offering|record (?:raise|offering|ipo)|priced|debut|starts trading|begins trading|nasdaq debut|nyse debut|valuation|raises? \$?\d|\$\d+(?:\.\d+)?\s*(?:billion|bn|trillion|tn)|public debut)\b/i;

export function isEditorialNoise(item) {
  return noisePattern.test(normalizeText(`${item.title} ${item.summary}`));
}

export function themeMatches(item, themes) {
  const haystack = normalizeText(`${item.title} ${item.summary} ${(item.topics || []).join(" ")}`).toLowerCase();
  return themes
    .map((theme) => {
      const hits = (theme.keywords || []).filter((keyword) => {
        const normalized = keyword.toLowerCase();
        if (normalized.length <= 3) {
          return new RegExp(`(^|[^a-z0-9])${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(haystack);
        }
        return haystack.includes(normalized);
      });
      return hits.length ? { id: theme.id, name: theme.name, hits } : null;
    })
    .filter(Boolean);
}

export function marketSignalScore(item) {
  const text = normalizeText(`${item.title} ${item.summary}`).toLowerCase();
  const url = absoluteUrl(item.url) || "";
  const feedId = item.feedId || "";
  let score = 0;

  if (positiveSignalPattern.test(text)) score += 2;
  if ((item.facts || []).length >= 2) score += 1;
  if (/(reuters|cnbc|apnews|sec\.gov|bea\.gov|federalreserve\.gov|fred\.stlouisfed\.org|kkr\.com|blueowl\.com|arescapitalcorp\.com|investor)/i.test(url)) score += 1;
  if (isEditorialNoise(item)) score -= 3;
  if (/^(private-equity-public-proxies|private-credit-public-proxies|prnewswire-private-equity)$/.test(feedId) && !strongProxySignalPattern.test(text)) {
    score -= 3;
  }

  return score;
}

export function hasTrustedDomain(item) {
  return trustedDomainPattern.test(absoluteUrl(item.url) || "");
}

export function isMajorBreakingEvent(item) {
  const text = normalizeText(`${item.title} ${item.summary} ${(item.topics || []).join(" ")}`);
  const trusted = hasTrustedDomain(item) || ["official", "reputable", "company"].includes(item.sourceType);
  const seededBreaking = (item.topics || []).includes("breaking") || Boolean(item.forceBreaking);
  return trusted && (seededBreaking || majorBreakingPattern.test(text)) && /\b(ipo|debut|starts trading|begins trading|priced|record|valuation|raise|offering)\b/i.test(text);
}

export function scoreCandidate(item, themes, now = new Date()) {
  const cleanTitle = normalizeText(item.title);
  const malformedTitle = cleanTitle.length > 220
    || /\b(skip to main content|toggle navigation|main navigation|official website of the united states government)\b/i.test(cleanTitle);
  const status = freshnessStatus(item.publishedAt, now);
  const freshnessScore = { LIVE: 5, FRESH: 4, TODAY: 3, BACKGROUND: 1, FUTURE: 0, INVALID: 0 }[status] ?? 0;
  const qualityScore = sourceQuality[item.sourceType] ?? 2;
  const topicScore = [...new Set(item.topics || [])].reduce((sum, topic) => sum + (topicBankerWeights[topic] ?? 1), 0);
  const matches = themeMatches(item, themes);
  const signalScore = marketSignalScore(item);
  const trustedDomain = hasTrustedDomain(item);
  const majorBreakingEvent = isMajorBreakingEvent(item);
  const internalDerived = isInternalDerivedItem(item);
  const factualEvidenceCount = internalDerived ? 0 : (item.facts || []).length;
  const evidenceScore = [
    absoluteUrl(item.url) ? 2 : 0,
    item.publishedAt ? 1 : 0,
    !internalDerived && normalizeText(item.summary).length > 60 ? 2 : 0,
    factualEvidenceCount ? 1 : 0
  ].reduce((a, b) => a + b, 0);
  const total = freshnessScore * 2 + qualityScore * 2 + topicScore + matches.length * 3 + evidenceScore + signalScore * 2;

  const mainTapeFreshEnough = freshnessScore >= 3;
  const strongEnoughSignal = signalScore >= 2;
  const trustedEnough = trustedDomain || item.sourceType === "official";
  const eligibleByEvidence = evidenceScore >= 4;
  const eligibleByMajorBreaking = !internalDerived && majorBreakingEvent && trustedEnough && evidenceScore >= 3;

  return {
    ...item,
    freshnessStatus: status,
    matchedThemes: matches,
    scores: {
      freshness: freshnessScore,
      sourceQuality: qualityScore,
      topicBankerWeight: topicScore,
      themeRelevance: matches.length * 3,
      evidence: evidenceScore,
      marketSignal: signalScore,
      factualEvidence: factualEvidenceCount,
      internalDerived: internalDerived ? 1 : 0,
      trustedDomain: trustedDomain ? 1 : 0,
      majorBreakingEvent: majorBreakingEvent ? 1 : 0,
      total
    },
    eligible: !malformedTitle && Boolean(absoluteUrl(item.url)) && item.publishedAt && (eligibleByEvidence || eligibleByMajorBreaking) && mainTapeFreshEnough && strongEnoughSignal && trustedEnough,
    exclusionReason: malformedTitle
      ? "malformed source title"
      : !absoluteUrl(item.url)
        ? "missing source URL"
        : !item.publishedAt
          ? "missing published timestamp"
          : !(eligibleByEvidence || eligibleByMajorBreaking)
            ? "insufficient factual support"
            : !mainTapeFreshEnough
              ? "background item; not eligible for main tape"
              : !strongEnoughSignal
                ? "weak market signal"
                : !trustedEnough
                  ? "source domain is outside the trusted publication set"
                  : ""
  };
}

export function selectCandidates(scoredItems, limit = 5) {
  const minimumSelectionScore = 30;
  const sorted = [...scoredItems].sort((a, b) => b.scores.total - a.scores.total);
  const selected = [];
  const seenTopics = new Set();

  for (const item of sorted) {
    if (!item.eligible) continue;
    if (item.scores.total < minimumSelectionScore) continue;
    const primaryTopic = item.topics?.[0] || "general";
    if (seenTopics.has(primaryTopic) && selected.length >= 3) continue;
    selected.push(item);
    seenTopics.add(primaryTopic);
    if (selected.length === limit) break;
  }

  return selected.length > 3 ? selected.slice(0, 5) : selected;
}
