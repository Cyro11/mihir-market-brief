import path from "node:path";
import { dataDir, sourceFeeds, sourcesDir } from "./config.js";
import { absoluteUrl, editionDate, ensureDir, hashKey, normalizeText, readJson, slugify, writeJson } from "./utils.js";

function parseRss(xml, feed, fetchedAt) {
  const items = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)];
  return items.map((match) => {
    const block = match[0];
    const pick = (tag) => normalizeText(block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] ?? "");
    const title = pick("title");
    const url = absoluteUrl(pick("link"));
    const publishedAt = new Date(pick("pubDate") || pick("dc:date") || fetchedAt).toISOString();
    const summary = pick("description");
    return {
      id: `${feed.id}-${hashKey(`${title}${url}`)}`,
      source: feed.name,
      sourceType: feed.sourceType,
      title,
      url,
      publishedAt,
      fetchedAt,
      summary,
      facts: summary ? [summary] : [],
      tickers: [],
      topics: feed.topics,
      feedId: feed.id
    };
  })
    .filter((item) => item.title && item.url)
    .filter((item) => {
      if (!feed.requiredTextPattern) return true;
      return feed.requiredTextPattern.test(`${item.title} ${item.summary} ${item.url}`);
    })
    .slice(0, 12);
}

function parseMonthDate(value, fallbackYear = new Date().getFullYear()) {
  const parsed = new Date(`${value} ${fallbackYear} 12:00:00 GMT-0400`);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function absoluteFrom(base, href) {
  try {
    return new URL(href, base).href;
  } catch {
    return "";
  }
}

function parseSecPressPage(html, feed, fetchedAt) {
  const year = new Date().getFullYear();
  const rows = [...html.matchAll(/([A-Z][a-z]+ \d{1,2}, \d{4})\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*([0-9]{4}-[0-9]+)/g)];
  return rows.slice(0, 10).map((row) => {
    const [, dateText, href, rawTitle, releaseNo] = row;
    const title = normalizeText(rawTitle);
    return {
      id: `${feed.id}-${slugify(releaseNo || title)}`,
      source: feed.name,
      sourceType: feed.sourceType,
      title,
      url: absoluteFrom(feed.url, href),
      publishedAt: new Date(`${dateText} 12:00:00 GMT-0400`).toISOString(),
      fetchedAt,
      summary: `${title}. SEC release ${releaseNo}.`,
      facts: [`SEC release ${releaseNo}: ${title}.`],
      tickers: [],
      topics: feed.topics,
      feedId: feed.id
    };
  }).filter((item) => item.title && item.url);
}

function parseBeaCurrentReleases(html, feed, fetchedAt) {
  const rows = [...html.matchAll(/<tr\b[^>]*class="[^"]*release-row[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi)];
  const seen = new Set();
  return rows.map((row) => {
    const block = row[1];
    const link = block.match(/<td[^>]*headers="view-title-table-column"[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const time = block.match(/<time[^>]+datetime="([^"]+)"[^>]*>([\s\S]*?)<\/time>/i);
    if (!link || !time) return null;

    const [, href, rawTitle] = link;
    if (!/^\/news\/20\d{2}\//.test(href)) return null;

    const title = normalizeText(rawTitle);
    if (!title || seen.has(title) || !/(GDP|Personal Income|Outlays|PCE|Trade|Profits|Industry|International|Regional)/i.test(title)) return null;
    seen.add(title);
    const publishedAt = new Date(time[1]);
    return {
      id: `${feed.id}-${slugify(title)}`,
      source: feed.name,
      sourceType: feed.sourceType,
      title,
      url: absoluteFrom(feed.url, href),
      publishedAt: Number.isNaN(publishedAt.getTime()) ? fetchedAt : publishedAt.toISOString(),
      fetchedAt,
      summary: `${title}. BEA official economic release with potential macro, rate, valuation, and sector implications.`,
      facts: [`BEA official release: ${title}.`],
      tickers: [],
      topics: feed.topics,
      feedId: feed.id
    };
  }).filter(Boolean).slice(0, 10);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFeed(feed) {
  const fetchedAt = new Date().toISOString();
  const response = await fetchWithTimeout(feed.url, {
    headers: {
      "user-agent": "TheOpeningLedger/0.1 public educational market brief",
      "accept": "application/rss+xml, application/xml, text/html, */*"
    }
  });
  if (!response.ok) throw new Error(`${feed.name} returned ${response.status}`);
  const text = await response.text();
  if (feed.mode === "sec-press-page") return parseSecPressPage(text, feed, fetchedAt);
  if (feed.mode === "bea-current-releases") return parseBeaCurrentReleases(text, feed, fetchedAt);
  return parseRss(text, feed, fetchedAt);
}

async function main() {
  const runDate = process.env.BRIEF_DATE || editionDate();
  const cutoff = new Date(process.env.BRIEF_NOW || `${runDate}T23:59:59-04:00`);
  const historicalOnly = process.env.BRIEF_HISTORICAL_ONLY === "1";
  await ensureDir(sourcesDir);
  const seedItems = await readJson(path.join(dataDir, "seed-items.json"), []);
  const historicalSeedItems = await readJson(path.join(dataDir, "historical-seeds", `${runDate}.json`), []);
  const fetched = [];
  const failures = [];

  if (!historicalOnly) {
    for (const feed of sourceFeeds) {
      try {
        fetched.push(...await fetchFeed(feed));
      } catch (error) {
        failures.push({ feed: feed.id, message: error.message });
      }
    }
  }

  const fetchedAt = new Date().toISOString();
  const items = [...fetched, ...seedItems, ...historicalSeedItems]
    .map((item) => ({ ...item, fetchedAt: item.fetchedAt || fetchedAt }))
    .filter((item) => {
      const published = new Date(item.publishedAt || fetchedAt);
      return Number.isFinite(published.getTime()) && published <= cutoff;
    });
  const byUrl = new Map();
  for (const item of items) {
    const key = item.url || item.id;
    if (!byUrl.has(key)) byUrl.set(key, item);
  }

  const payload = {
    runDate,
    fetchedAt,
    sourceCount: byUrl.size,
    failures,
    items: [...byUrl.values()]
  };

  await writeJson(path.join(sourcesDir, `${runDate}.json`), payload);
  await writeJson(path.join(sourcesDir, "latest.json"), payload);
  console.log(`Fetched ${payload.sourceCount} source items for ${runDate}; failures: ${failures.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
