import path from "node:path";
import { calendarDir } from "./config.js";
import { absoluteUrl, editionDate, ensureDir, normalizeText, slugify, writeJson } from "./utils.js";

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function easternIso(dateText, timeText = "08:30 AM") {
  const normalized = `${dateText} ${timeText}`.replace(/\./g, "");
  const parsed = new Date(`${normalized} GMT-0400`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function significanceFor(title) {
  const text = title.toLowerCase();
  if (/employment situation|consumer price index|personal income and outlays|gdp|fomc/.test(text)) return "high";
  if (/producer price index|job openings|trade|minutes/.test(text)) return "medium";
  return "medium";
}

function parseIcs(text) {
  return text.split("BEGIN:VEVENT").slice(1).map((block) => {
    const summary = normalizeText(block.match(/SUMMARY:(.+)/)?.[1] || "");
    const start = block.match(/DTSTART(?:;TZID=US-Eastern)?:([0-9T]+)/)?.[1] || "";
    const dateText = start
      ? `${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6, 8)}T${start.slice(9, 11) || "00"}:${start.slice(11, 13) || "00"}:00`
      : "";
    const scheduledFor = dateText ? new Date(`${dateText}-04:00`).toISOString() : null;
    return { summary, scheduledFor };
  }).filter((event) => event.summary && event.scheduledFor);
}

function parseBlsCalendar(text, fetchedAt) {
  return parseIcs(text)
    .filter((event) => /Employment Situation|Consumer Price Index|Producer Price Index|Job Openings and Labor Turnover Survey/i.test(event.summary))
    .map((event) => ({
      id: `bls-${slugify(event.summary)}-${event.scheduledFor.slice(0, 10)}`,
      source: "BLS",
      url: "https://www.bls.gov/schedule/news_release/bls.ics",
      title: event.summary,
      category: /Employment Situation/i.test(event.summary) ? "employment" : /Consumer Price Index/i.test(event.summary) ? "inflation" : "macro",
      significance: significanceFor(event.summary),
      scheduledFor: event.scheduledFor,
      scheduledDate: event.scheduledFor.slice(0, 10),
      fetchedAt
    }));
}

function parseBeaSchedule(html, fetchedAt) {
  const yearMatch = html.match(/Release ScheduleYear\s+(\d{4})/i);
  const year = yearMatch?.[1] || String(new Date().getFullYear());
  const rows = [...html.matchAll(/<tr class="scheduled-releases-type-[^"]+">[\s\S]*?<div class="release-date">([^<]+)<\/div>[\s\S]*?<small class="text-muted">([^<]+)<\/small>[\s\S]*?<td class="release-title[\s\S]*?">([\s\S]*?)<\/td>/gi)];
  return rows.map((row) => {
    const [, dateText, timeText, rawTitle] = row;
    const title = normalizeText(rawTitle);
    if (!/Personal Income and Outlays|GDP|International Trade/i.test(title)) return null;
    const scheduledFor = easternIso(`${dateText}, ${year}`, timeText);
    if (!scheduledFor) return null;
    return {
      id: `bea-${slugify(title)}-${scheduledFor.slice(0, 10)}`,
      source: "BEA",
      url: "https://www.bea.gov/news/schedule",
      title,
      category: /Personal Income and Outlays/i.test(title) ? "inflation" : /GDP/i.test(title) ? "growth" : "macro",
      significance: significanceFor(title),
      scheduledFor,
      scheduledDate: scheduledFor.slice(0, 10),
      fetchedAt
    };
  }).filter(Boolean);
}

function parseFedCalendar(html, fetchedAt) {
  const start = html.indexOf("2026 FOMC Meetings");
  const end = html.indexOf("2025 FOMC Meetings");
  const yearBlock = start >= 0 && end > start ? html.slice(start, end) : "";
  const rows = [...yearBlock.matchAll(/fomc-meeting__month[^>]*>\s*<strong>([^<]+)<\/strong><\/div>\s*<div class="fomc-meeting__date[^"]*">([^<]+)<\/div>/gi)];
  return rows.map((row) => {
    const [, rawMonth, rawRange] = row;
    const month = normalizeText(rawMonth);
    const dateRange = normalizeText(rawRange);
    if (!month || !dateRange) return null;
    const cleanRange = normalizeText(dateRange).replace(/\*/g, "");
    const lastDay = cleanRange.split("-").at(-1);
    const scheduledFor = easternIso(`${month} ${lastDay}, 2026`, "02:00 PM");
    if (!scheduledFor) return null;
    return {
      id: `fed-fomc-${slugify(month)}-${scheduledFor.slice(0, 10)}`,
      source: "Federal Reserve",
      url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
      title: `FOMC meeting (${month} ${cleanRange})`,
      category: "fed",
      significance: "high",
      scheduledFor,
      scheduledDate: scheduledFor.slice(0, 10),
      fetchedAt
    };
  }).filter(Boolean);
}

async function fetchCalendarSource(url) {
  const response = await fetchWithTimeout(url, {
    headers: {
      "user-agent": "TheOpeningLedger/0.1 public educational market brief",
      "accept": "text/calendar, text/html, application/xhtml+xml, */*"
    }
  });
  if (!response.ok) throw new Error(`Calendar source returned ${response.status}`);
  return response.text();
}

async function main() {
  const runDate = process.env.BRIEF_DATE || editionDate();
  await ensureDir(calendarDir);

  const fetchedAt = new Date().toISOString();
  const failures = [];
  const events = [];

  for (const source of [
    { id: "bls", url: "https://www.bls.gov/schedule/news_release/bls.ics", parser: parseBlsCalendar },
    { id: "bea", url: "https://www.bea.gov/news/schedule", parser: parseBeaSchedule },
    { id: "fed", url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", parser: parseFedCalendar }
  ]) {
    try {
      const text = await fetchCalendarSource(source.url);
      events.push(...source.parser(text, fetchedAt));
    } catch (error) {
      failures.push({ source: source.id, message: error.message });
    }
  }

  const unique = new Map();
  for (const event of events) {
    if (!absoluteUrl(event.url)) continue;
    unique.set(event.id, event);
  }

  const payload = {
    runDate,
    fetchedAt,
    failures,
    eventCount: unique.size,
    events: [...unique.values()].sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))
  };

  await writeJson(path.join(calendarDir, `${runDate}.json`), payload);
  await writeJson(path.join(calendarDir, "latest.json"), payload);
  console.log(`Fetched ${payload.eventCount} calendar events for ${runDate}; failures: ${failures.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
