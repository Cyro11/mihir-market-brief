import test from "node:test";
import assert from "node:assert/strict";
import { sourceFeeds } from "../scripts/config.js";
import { parseBlsReleasePage } from "../scripts/fetch-sources.js";

const cpiHtml = `
<html><body>
  <h1>Consumer Price Index Summary</h1>
  <nav>Skip to Content An official website of the United States government Release Calendar Search button</nav>
  <div>Transmission of material in this release is embargoed until 8:30 a.m. (ET) Wednesday, June 10, 2026</div>
  <pre>
CONSUMER PRICE INDEX - MAY 2026
The Consumer Price Index for All Urban Consumers (CPI-U) increased 0.5 percent on a seasonally adjusted basis in May, after rising 0.6 percent in April, the U.S. Bureau of Labor Statistics reported today. Over the last 12 months, the all items index increased 4.2 percent before seasonal adjustment.
The index for energy rose 3.9 percent in May, after rising 3.8 percent in April and 10.9 percent in March. The energy index accounted for over sixty percent of the monthly all items increase.
The index for all items less food and energy rose 0.2 percent in May.
The all items less food and energy index rose 2.9 percent over the last 12 months.
  </pre>
</body></html>`;

test("BLS current-release parser turns official CPI page into eligible macro source facts", () => {
  const [item] = parseBlsReleasePage(cpiHtml, {
    id: "bls-cpi",
    name: "BLS CPI",
    sourceType: "official",
    url: "https://www.bls.gov/news.release/cpi.nr0.htm",
    topics: ["macro", "inflation", "rates", "fed"]
  }, "2026-06-10T13:00:00.000Z");

  assert.equal(item.id, "bls-cpi-consumer-price-index-summary");
  assert.equal(item.source, "BLS CPI");
  assert.equal(item.sourceType, "official");
  assert.equal(item.url, "https://www.bls.gov/news.release/cpi.nr0.htm");
  assert.equal(item.publishedAt, "2026-06-10T12:30:00.000Z");
  assert.match(item.title, /Consumer Price Index/);
  assert.match(item.summary, /CPI-U\) increased 0\.5 percent/);
  assert.match(item.summary, /all items index increased 4\.2 percent/);
  assert.match(item.summary, /energy rose 3\.9 percent/);
  assert.doesNotMatch(item.summary, /Skip to Content|official website|Release Calendar|Search button/i);
  assert.ok(item.facts.length >= 3);
  assert.deepEqual(item.topics, ["macro", "inflation", "rates", "fed"]);
});

test("source config has first-class BLS macro release pages instead of only the calendar", () => {
  const blsReleaseFeeds = sourceFeeds.filter((feed) => feed.mode === "bls-release-page");
  assert.ok(blsReleaseFeeds.some((feed) => feed.id === "bls-cpi" && /cpi\.nr0\.htm/.test(feed.url)));
  assert.ok(blsReleaseFeeds.some((feed) => feed.id === "bls-ppi" && /ppi\.nr0\.htm/.test(feed.url)));
  assert.ok(blsReleaseFeeds.some((feed) => feed.id === "bls-employment" && /empsit\.nr0\.htm/.test(feed.url)));
  assert.ok(blsReleaseFeeds.every((feed) => feed.sourceType === "official"));
});
