import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { editionsDir, issuesDir, reviewsDir, rootDir } from "./config.js";
import { editionDate, ensureDir, escapeHtml, readJson } from "./utils.js";

const pages = [
  ["overview", "Overview", "index.html"],
  ["breaking", "Breaking", "breaking.html"],
  ["overnight", "Overnight", "overnight.html"],
  ["moves", "Market Watch", "moves.html"],
  ["macro", "Macro Environment", "macro.html"],
  ["markets", "Markets", "markets.html"],
  ["deals", "Deals", "deals.html"],
  ["private-markets", "Private Markets", "private-markets.html"],
  ["deep-dive", "Deep Dive", "deep-dive.html"],
  ["themes", "Themes", "themes.html"],
  ["sources", "Sources", "sources.html"],
  ["archive", "Archive", "archive.html"],
  ["notes", "Notes / Questions", "notes.html"]
];
const mainNavPageIds = new Set(["overview", "breaking", "overnight", "moves", "macro", "markets", "deals", "private-markets"]);
const sectionMenuGroups = [
  {
    label: "Read",
    items: [
      ["overview", "Overview", "index.html"],
      ["breaking", "Breaking", "breaking.html"],
      ["overnight", "Overnight", "overnight.html"],
      ["deep-dive", "Deep Dive", "deep-dive.html"],
      ["themes", "Themes", "themes.html"]
    ]
  },
  {
    label: "Markets",
    items: [
      ["moves", "Market Watch", "moves.html"],
      ["macro", "Macro Environment", "macro.html"],
      ["markets", "Markets", "markets.html"],
      ["deals", "Deals", "deals.html"],
      ["private-markets", "Private Markets", "private-markets.html"]
    ]
  },
  {
    label: "Research",
    items: [
      ["sources", "Sources", "sources.html"],
      ["archive", "Archive", "archive.html"],
      ["notes", "Notes / Questions", "notes.html"]
    ]
  }
];

function issueHref(runDate, base = "") {
  return base === "../" ? `${runDate}.html` : `${base}issues/${runDate}.html`;
}

function latestIssueHref(base = "") {
  return base === "../" ? "latest.html" : `${base}issues/latest.html`;
}

function assetHref(base, file) {
  return `${base}assets/${file}`;
}

function sourceLinks(move) {
  return move.sourceTrail
    .map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.source)}</a>`)
    .join(", ");
}

function searchLink(label, baseUrl, query) {
  return `<a href="${baseUrl}${encodeURIComponent(query)}" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function furtherReading(move) {
  const topic = `${move.title} ${move.concepts?.join(" ") || ""}`.trim();
  const related = (move.relatedLinks || [])
    .map((link) => `<a href="${escapeHtml(link.url)}" rel="noreferrer">${escapeHtml(link.label)}${link.type ? ` <span>${escapeHtml(link.type)}</span>` : ""}</a>`)
    .join("");
  return `<div class="read-more">
    <b>Read More On This Topic</b>
    <span>Curated links go to related company/data pages. Search links open the topic already filled in so you can find deeper articles, posts, and threads.</span>
    ${related ? `<div class="related-grid">${related}</div>` : ""}
    <div class="link-row" aria-label="Search this topic">
      ${searchLink("Google", "https://www.google.com/search?q=", topic)}
      ${searchLink("WSJ", "https://www.wsj.com/search?query=", topic)}
      ${searchLink("FT", "https://www.ft.com/search?q=", topic)}
      ${searchLink("NYT", "https://www.nytimes.com/search?query=", topic)}
      ${searchLink("TradingView", "https://www.tradingview.com/search/?query=", topic)}
      ${searchLink("X", "https://x.com/search?q=", topic)}
    </div>
  </div>`;
}

function parallelCard(parallel) {
  if (!parallel || typeof parallel === "string") {
    return `<p>${escapeHtml(parallel || "No sourced parallel available.")}</p>`;
  }
  const sources = (parallel.sourceTrail || [])
    .map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.source)}</a>`)
    .join(", ");
  return `<div class="parallel-detail">
    <p><strong>Past example:</strong> ${escapeHtml(parallel.precedent)}</p>
    <p><strong>What happened then:</strong> ${escapeHtml(parallel.outcome)}</p>
    <p><strong>What looks similar:</strong> ${escapeHtml(parallel.whatRhymes)}</p>
    <p><strong>What is different now:</strong> ${escapeHtml(parallel.whatDiffers)}</p>
    <p><strong>Bottom line:</strong> ${escapeHtml(parallel.soWhat)}</p>
    <p class="source-line"><strong>Parallel sources:</strong> ${sources || "none"}</p>
  </div>`;
}

function sparklinePath(points, width, height, scale, pad = { left: 62, right: 18, top: 20, bottom: 48 }) {
  if (!points.length) return "";
  const min = scale.min;
  const max = scale.max;
  const span = max - min || 1;
  return points.map((point, index) => {
    const x = pad.left + (index / Math.max(points.length - 1, 1)) * (width - pad.left - pad.right);
    const y = height - pad.bottom - ((point.value - min) / span) * (height - pad.top - pad.bottom);
    return `${index ? "L" : "M"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

function chartScale(series) {
  const observations = series.flatMap((item) => item.observations || []);
  const values = observations.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max((max - min) * 0.12, 0.25);
  return {
    min: Number.isFinite(min) ? min - padding : 0,
    max: Number.isFinite(max) ? max + padding : 1,
    firstDate: observations[0]?.date || "",
    lastDate: observations[observations.length - 1]?.date || ""
  };
}

function visualCard(visual) {
  if (!visual) return "";
  if (visual.type === "bar-chart") {
    const items = (visual.items || []).filter((item) => Number.isFinite(item.value));
    if (!items.length) return "";
    const maxAbs = Math.max(...items.map((item) => Math.abs(item.value)), 1);
    return `<section class="visual-card">
      <div class="visual-head"><div><span class="meta">Visual / ${escapeHtml(visual.visualSource || "Public market data")}</span><h3>${escapeHtml(visual.title)}</h3></div><span>${escapeHtml(visual.subtitle)}</span></div>
      ${visual.relevanceNote ? `<p class="visual-why"><strong>Why this visual fits:</strong> ${escapeHtml(visual.relevanceNote)}</p>` : ""}
      <div class="bar-board">
        ${items.map((item) => {
          const width = Math.max((Math.abs(item.value) / maxAbs) * 100, 8);
          const sign = item.value >= 0 ? "+" : "";
          return `<div class="bar-row">
            <div class="bar-label"><b>${escapeHtml(item.id)}</b><span>${escapeHtml(item.label)}</span></div>
            <div class="bar-track"><i class="${item.value >= 0 ? "up" : "down"}" style="width:${width}%"></i></div>
            <div class="bar-value"><b>${sign}${item.displayValue.toFixed(1)}${escapeHtml(item.suffix || "")}</b><span>${escapeHtml(item.latestDate || "")}</span></div>
          </div>`;
        }).join("")}
      </div>
      <p class="source-line">${escapeHtml(visual.sourceNote || "")} ${items.map((item) => `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.id)}</a>`).join(", ")}</p>
    </section>`;
  }
  if (visual.type === "line-chart") {
    const width = 760;
    const height = 240;
    const pad = { left: 62, right: 18, top: 20, bottom: 48 };
    const scale = chartScale(visual.series || []);
    const axisBottom = height - pad.bottom;
    const yTop = pad.top;
    const yMid = yTop + ((axisBottom - yTop) / 2);
    const midValue = (scale.min + scale.max) / 2;
    const colors = ["#b5121b", "#111111", "#6b6358"];
    const axisTitle = visual.axisTitle || "Rate";
    const axisSuffix = visual.axisSuffix ?? "%";
    const visualSource = visual.visualSource || "FRED data";
    const paths = (visual.series || []).map((series, index) => {
      const observations = series.observations || [];
      const last = observations[observations.length - 1];
      const first = observations[0];
      return {
        series,
        path: sparklinePath(observations, width, height, scale, pad),
        color: colors[index % colors.length],
        first,
        last
      };
    });
    return `<section class="visual-card">
      <div class="visual-head"><div><span class="meta">Visual / ${escapeHtml(visualSource)}</span><h3>${escapeHtml(visual.title)}</h3></div><span>${escapeHtml(visual.subtitle)}</span></div>
      ${visual.relevanceNote ? `<p class="visual-why"><strong>Why this visual fits:</strong> ${escapeHtml(visual.relevanceNote)}</p>` : ""}
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(visual.title)}">
        <rect x="0" y="0" width="${width}" height="${height}" fill="#f7f4ec"></rect>
        <line x1="${pad.left}" y1="${axisBottom}" x2="${width - pad.right}" y2="${axisBottom}" stroke="#9d9488"></line>
        <line x1="${pad.left}" y1="${yTop}" x2="${pad.left}" y2="${axisBottom}" stroke="#9d9488"></line>
        <line x1="${pad.left}" y1="${yTop}" x2="${width - pad.right}" y2="${yTop}" stroke="#d5cec3" stroke-dasharray="4 6"></line>
        <line x1="${pad.left}" y1="${yMid}" x2="${width - pad.right}" y2="${yMid}" stroke="#d5cec3" stroke-dasharray="4 6"></line>
        <text x="16" y="${yTop + 4}" class="axis-label">${scale.max.toFixed(1)}${escapeHtml(axisSuffix)}</text>
        <text x="16" y="${yMid + 4}" class="axis-label">${midValue.toFixed(1)}${escapeHtml(axisSuffix)}</text>
        <text x="16" y="${axisBottom + 4}" class="axis-label">${scale.min.toFixed(1)}${escapeHtml(axisSuffix)}</text>
        <text x="${pad.left}" y="${height - 18}" class="axis-label">${escapeHtml(scale.firstDate)}</text>
        <text x="${width - pad.right}" y="${height - 18}" class="axis-label axis-right">${escapeHtml(scale.lastDate)}</text>
        <text x="${width / 2}" y="${height - 6}" class="axis-title axis-center">Date</text>
        <text x="13" y="${height / 2}" transform="rotate(-90 13 ${height / 2})" class="axis-title axis-center">${escapeHtml(axisTitle)}${axisSuffix ? ` (${escapeHtml(axisSuffix)})` : ""}</text>
        ${paths.map((item) => `<path d="${item.path}" fill="none" stroke="${item.color}" stroke-width="4" stroke-linecap="square"></path>`).join("")}
      </svg>
      <div class="legend-grid">
        ${paths.map((item) => `<div><i style="background:${item.color}"></i><b>${escapeHtml(item.series.label)}</b><span>${item.last ? `${item.last.value.toFixed(2)} on ${item.last.date}` : "No observation"}</span></div>`).join("")}
      </div>
      <p class="source-line">${escapeHtml(visual.sourceNote || "")} ${paths.map((item) => `<a href="${escapeHtml(item.series.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.series.id)}</a>`).join(", ")}</p>
    </section>`;
  }
  if (visual.type === "value-chain-map") {
    const sources = (visual.sourceTrail || [])
      .map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.source || source.label || "Source")}</a>`)
      .join(", ");
    return `<section class="visual-card">
      <div class="visual-head"><div><span class="meta">Visual / Structure map</span><h3>${escapeHtml(visual.title)}</h3></div><span>${escapeHtml(visual.subtitle)}</span></div>
      ${visual.relevanceNote ? `<p class="visual-why"><strong>Why this visual fits:</strong> ${escapeHtml(visual.relevanceNote)}</p>` : ""}
      <div class="chain-map">
        ${visual.nodes.map((node, index) => `<div class="chain-node"><span>${String(index + 1).padStart(2, "0")}</span><b>${escapeHtml(node.label)}</b><p>${escapeHtml(node.detail)}</p></div>`).join("")}
      </div>
      <p class="source-line"><strong>Visual sources:</strong> ${sources || "source trail unavailable"}</p>
    </section>`;
  }
  if (visual.type === "deal-timeline") {
    const sources = (visual.sourceTrail || [])
      .map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.source || source.label || "Source")}</a>`)
      .join(", ");
    const meta = /private/i.test(visual.title || "") ? "Signal map" : "Deal map";
    return `<section class="visual-card">
      <div class="visual-head"><div><span class="meta">Visual / ${escapeHtml(meta)}</span><h3>${escapeHtml(visual.title)}</h3></div><span>${escapeHtml(visual.subtitle)}</span></div>
      ${visual.relevanceNote ? `<p class="visual-why"><strong>Why this visual fits:</strong> ${escapeHtml(visual.relevanceNote)}</p>` : ""}
      <div class="deal-map">
        ${visual.steps.map((step) => `<div><b>${escapeHtml(step.label)}</b><span>${escapeHtml(step.detail)}</span></div>`).join("")}
      </div>
      <p class="source-line"><strong>Visual sources:</strong> ${sources || "source trail unavailable"}</p>
    </section>`;
  }
  return "";
}

function insightGrid(move) {
  return `<div class="insight-grid">
    <div><b>Valuation</b><span>${escapeHtml(move.valuationImpact)}</span></div>
    <div><b>Financing / Deals</b><span>${escapeHtml(move.financingImplication)}</span></div>
    <div><b>Company Read</b><span>${escapeHtml(move.sectorReadThrough)}</span></div>
  </div>`;
}

function continuityBlock(move, base = "") {
  if (!move.continuity) return "";
  const continuity = move.continuity;
  return `<section class="continuity-block">
    <div class="meta">Continuing Story / ${escapeHtml(continuity.status)}</div>
    <h3>What changed since ${escapeHtml(continuity.previousDate)}</h3>
    <p>${escapeHtml(continuity.whatChanged)}</p>
    <p><strong>Prior read:</strong> ${escapeHtml(continuity.priorRead)}</p>
    <p><strong>Updated read:</strong> ${escapeHtml(continuity.updatedRead)}</p>
    <p class="source-line"><a href="${escapeHtml(issueHref(continuity.previousDate, base))}">Previous coverage: ${escapeHtml(continuity.previousDate)}</a></p>
  </section>`;
}

function moveContext(move) {
  return {
    title: move.title,
    editorialLane: move.editorialLane,
    privateMarketSegment: move.privateMarketSegment || null,
    summary: move.editorialArticle?.dek || move.readerSummary || move.summary || "",
    editorialArticle: move.editorialArticle || null,
    continuity: move.continuity || null,
    primarySources: move.sourceTrail,
    relatedLinks: move.relatedLinks || []
  };
}

function pageForMove(edition, move) {
  if (move.editorialLane === "breaking") {
    const index = edition.sections?.breaking?.items?.findIndex((item) => item.id === move.id) ?? -1;
    return index >= 0 ? `breaking.html#breaking-${index + 1}` : "breaking.html";
  }
  if (move.editorialLane === "macro") {
    const index = edition.sections?.macro?.items?.findIndex((item) => item.id === move.id) ?? -1;
    return index >= 0 ? `macro.html#macro-${index + 1}` : "macro.html";
  }
  if (move.editorialLane === "markets") {
    const index = edition.sections?.markets?.items?.findIndex((item) => item.id === move.id) ?? -1;
    return index >= 0 ? `markets.html#markets-${index + 1}` : "markets.html";
  }
  if (move.editorialLane === "deals") {
    const index = edition.sections?.deals?.items?.findIndex((item) => item.id === move.id) ?? -1;
    return index >= 0 ? `deals.html#deals-${index + 1}` : "deals.html";
  }
  if (move.editorialLane === "private_markets") {
    const segments = edition.sections?.privateMarkets?.segments || {};
    for (const key of ["privateEquity", "privateCredit"]) {
      const index = segments[key]?.items?.findIndex((item) => item.id === move.id) ?? -1;
      if (index >= 0) return `private-markets.html#${key}-${index + 1}`;
    }
    return "private-markets.html";
  }
  return "index.html";
}

function internalHref(target, edition, base = "") {
  const [file, hash = ""] = target.split("#");
  const separator = file.includes("?") ? "&" : "?";
  const cacheBust = edition?.runDate ? `${separator}v=${encodeURIComponent(edition.runDate)}` : "";
  return `${base}${file}${cacheBust}${hash ? `#${hash}` : ""}`;
}

function liveWatchSymbol(item) {
  return item.id === "DCOILWTICO" || item.symbol === "WTI" ? "USO" : item.symbol;
}

function liveWatchName(item) {
  return liveWatchSymbol(item) === "USO" ? "Oil proxy (USO ETF)" : item.name;
}

function watchCard(item) {
  const price = item.id === "DCOILWTICO" ? item.price.toFixed(2) : item.price.toFixed(2);
  const changePrefix = item.change >= 0 ? "+" : "";
  const percentPrefix = item.percentChange >= 0 ? "+" : "";
  const liveSymbol = liveWatchSymbol(item);
  const liveName = liveWatchName(item);
  const staleNote = liveSymbol === "USO" ? "Rendered WTI/FRED oil data can lag; page-open refresh uses USO as a timely oil proxy." : "Rendered value is refreshed with delayed intraday Yahoo data when the page opens.";
  const context = {
    title: `${liveName} (${liveSymbol})`,
    editorialLane: "market_watch",
    summary: item.whyItMoved,
    whatHappened: `${liveSymbol} last printed at ${price} on ${item.latestDate}.`,
    whyItMatters: item.whyItMoved,
    whatChanged: `${changePrefix}${item.change.toFixed(2)} / ${percentPrefix}${item.percentChange.toFixed(2)}% versus the prior observation.`,
    valuation: "Use this tape as context for risk appetite, discount rates, and which part of the market is carrying leadership.",
    financingDeals: "The watchboard is a quick temperature check for financing conditions rather than a full underwriting view.",
    companyRead: "Cross-check any single-stock story against the broader tape before over-reading it.",
    primarySources: [{ source: item.source, url: item.sourceUrl }]
  };
  return `<article class="move-card watch-card" data-market-symbol="${escapeHtml(liveSymbol)}" data-context="${escapeHtml(JSON.stringify(context))}">
    <div class="meta"><span data-market-label>${escapeHtml(liveName)}</span> / Rendered ${escapeHtml(item.latestDate)}</div>
    <h2>${escapeHtml(liveName)}</h2>
    <div class="watch-price-row">
      <b data-market-price>${item.id === "DCOILWTICO" ? `$${price}` : `$${price}`}</b>
      <span data-market-change class="${item.change >= 0 ? "up" : "down"}">${changePrefix}${item.change.toFixed(2)} / ${percentPrefix}${item.percentChange.toFixed(2)}%</span>
    </div>
    <p><strong>Why it moved:</strong> ${escapeHtml(item.whyItMoved)}</p>
    <p class="source-line"><strong>Timestamp:</strong> <span data-market-timestamp>Rendered ${escapeHtml(item.latestDate)}. ${escapeHtml(staleNote)}</span></p>
    <p class="source-line"><strong>Price source:</strong> <a data-market-source href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(item.source)}</a></p>
  </article>`;
}


function editorialArticleBlock(move) {
  const article = move.editorialArticle;
  if (!article?.body?.length) return "";
  return `<section class="editorial-article">
    <p class="article-question">${escapeHtml(article.question || "Why this matters")}</p>
    ${article.body.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
    ${article.bankerSidebar ? `<aside class="banker-sidebar">
      <b>How to use it</b>
      <p>${escapeHtml(article.bankerSidebar.interviewUse || "Tie the story to valuation, financing, or deal risk.")}</p>
      <p><strong>Watch:</strong> ${escapeHtml(article.bankerSidebar.watchNext || move.watchNext || "the next confirming source.")}</p>
    </aside>` : ""}
  </section>`;
}

function moveCard(move, index, options = {}) {
  const activePage = options.activePage || "";
  const base = options.base || "";
  const allowVisual = Boolean(
    move.visual
    && !options.forceHideVisual
    && (!move.visual.allowedPages?.length || move.visual.allowedPages.includes(activePage))
  );
  const expanded = options.expanded ?? index === 0;
  const article = editorialArticleBlock(move);
  return `<article class="move-card" data-context="${escapeHtml(JSON.stringify(moveContext(move)))}">
    <div class="meta">Story ${index + 1} / ${escapeHtml(move.editorialLaneLabel || "Markets")} / ${escapeHtml(move.freshnessStatus)}</div>
    <h2>${escapeHtml(move.title)}</h2>
    <p class="story-summary">${escapeHtml(move.editorialArticle?.dek || move.readerDek || move.readerSummary || move.summary || move.whyItMoved)}</p>
    <details class="story-details"${expanded ? " open" : ""}>
      <summary>${expanded ? "Hide article" : "Read article"}</summary>
      <div class="story-detail-body">
        ${allowVisual ? visualCard(move.visual) : ""}
        ${continuityBlock(move, base)}
        ${article || `<section class="editorial-article"><p>${escapeHtml(move.summary || move.whyItMoved || "No article copy available.")}</p></section>`}
      </div>
    </details>
    <p class="source-line"><strong>Sources:</strong> ${sourceLinks(move)}</p>
    ${options.includeReading === false ? "" : furtherReading(move)}
  </article>`;
}

function dedupeVisualTitles(items, activePage, base = "") {
  const seen = new Set();
  return items.map((move, index) => {
    const title = move.visual?.title || "";
    const forceHideVisual = Boolean(title && seen.has(title));
    if (title) seen.add(title);
    return `<div id="${activePage}-${index + 1}">${moveCard(move, index, { activePage, forceHideVisual, base })}</div>`;
  }).join("");
}

function nav(active, edition, base = "") {
  const isUtilityPage = !mainNavPageIds.has(active);
  return `<nav class="tabs" aria-label="Brief pages">
    ${pages.filter(([id]) => mainNavPageIds.has(id)).map(([id, label, file]) => `<a class="${id === active ? "active" : ""}" href="${internalHref(file, edition, base)}">${label}</a>`).join("")}
    <div class="section-menu${isUtilityPage ? " is-open" : ""}" data-section-menu>
      <button class="section-menu-trigger" type="button" aria-expanded="${isUtilityPage ? "true" : "false"}">All Sections</button>
      <div class="section-menu-panel"${isUtilityPage ? "" : " hidden"}>
        ${sectionMenuGroups.map((group) => `<section>
          <b>${escapeHtml(group.label)}</b>
          ${group.items.map(([id, label, file]) => `<a class="${id === active ? "active" : ""}" href="${internalHref(file, edition, base)}">${escapeHtml(label)}</a>`).join("")}
        </section>`).join("")}
      </div>
    </div>
  </nav>`;
}


function publicFallbackText(value, fallback = "This story needs a reader-safe editorial summary before publication.") {
  const text = String(value || "").trim();
  if (!text) return fallback;
  if (/this was selected because|current reputable-market headline|thin rss item|source url, timestamp|market-moving public-tape keywords|evidence bar|cleared the source|cleared the evidence/i.test(text)) {
    return fallback;
  }
  return text;
}

function fallbackEditorsBrief(edition) {
  const bullets = [];
  for (const move of edition.moves || []) {
    bullets.push(`${move.title}: ${publicFallbackText(move.readerDek || move.readerSummary || move.ibAngle || move.summary, "Use this story to connect the reported fact to valuation, financing, and deal implications.")}`);
    if (bullets.length >= 2) break;
  }
  const topDeal = edition.dealTape?.[0];
  if (topDeal) bullets.push(`Deal tape: ${topDeal.title} is the transaction to underwrite for price, certainty, approvals, and financing.`);
  const indexMove = edition.openbbMarketPack?.indices?.[0];
  const sectorMove = edition.openbbMarketPack?.sectors?.[0];
  if (indexMove || sectorMove) {
    const indexText = indexMove ? `${indexMove.symbol || indexMove.label} ${formatPct(indexMove.oneDayPct)}` : "index tape mixed";
    const sectorText = sectorMove ? `${sectorMove.symbol || sectorMove.label} ${formatPct(sectorMove.oneDayPct)}` : "sector leadership unclear";
    bullets.push(`Market context: ${indexText}; ${sectorText}. Use the tape to frame risk appetite, not as a stand-alone thesis.`);
  }
  if (!bullets.length) bullets.push("No main story warranted a full lead today; the useful read is that discipline matters more than filling space.");
  return {
    dek: "The 30-second read for readers who need the point before the details.",
    bullets: bullets.slice(0, 4)
  };
}

function editorsBriefCard(edition) {
  const brief = edition.editorsBrief?.bullets?.length ? edition.editorsBrief : fallbackEditorsBrief(edition);
  if (!brief?.bullets?.length) return "";
  return `<section class="panel compact">
    <div class="panel-head"><div><span class="eyebrow">Editor's Brief</span><h2>30-second read</h2></div></div>
    <p class="lede">${escapeHtml(brief.dek || "The fastest way into today's issue.")}</p>
    <div class="summary-grid">
      ${brief.bullets.map((bullet, index) => `<div class="summary-card"><span class="meta">Read ${index + 1}</span><p>${escapeHtml(bullet)}</p></div>`).join("")}
    </div>
  </section>`;
}

function overview(edition, base = "") {
  const cards = edition.moves.length
    ? edition.moves.map((move, index) => `<a class="summary-card" href="${internalHref(pageForMove(edition, move), edition, base)}">
        <span class="meta">Story ${index + 1}</span>
        <b>${escapeHtml(move.title)}</b>
        <p>${escapeHtml(publicFallbackText(move.editorialArticle?.dek || move.readerDek || move.readerSummary || move.summary, "Use this story to connect the reported fact to valuation, financing, and deal implications."))}</p>
        <p><strong>The question:</strong> ${escapeHtml(move.editorialArticle?.question || "Does this change the underwriting case?")}</p>
        <p>${escapeHtml(move.editorialArticle?.bankerSidebar?.interviewUse || move.ibAngle || "Tie the story to valuation, financing, or deal risk.")}</p>
      </a>`).join("")
    : `<div class="summary-card"><b>No forced main tape</b><p>No fresh source-backed item was strong enough for the main tape today. The brief stayed quiet instead of filling space.</p></div>`;

  return `<section class="panel">
    <div class="panel-head"><div><span class="eyebrow">Today at a glance</span><h1>${escapeHtml(edition.title)}</h1></div><span class="chip">${edition.moves.length} stories</span></div>
    <p class="lede">${escapeHtml(edition.dek)}</p>
    <div class="summary-grid">${cards}</div>
  </section>
  ${editorsBriefCard(edition)}
  ${sectionSummaryPagelet(edition, base)}
  ${todayMarketMap(edition)}
  ${openbbMarketPackCard(edition.openbbMarketPack)}
  ${continuingStoriesPagelet(edition, base)}
  <section class="panel compact">
    <div class="panel-head"><div><span class="eyebrow">How to read it</span><h2>Simple Rule</h2></div></div>
    <p>The brief should help you answer three questions: what changed, why it matters, and what it means for valuation, financing, or deals.</p>
  </section>`;
}

function sectionSummaryPagelet(edition, base = "") {
  const sections = [
    ["breaking", "Breaking", "breaking.html", "Major source-backed headlines that can reset the market or capital-markets read."],
    ["overnight", "Overnight", "overnight.html", "Big source-backed stories that hit before the U.S. open and what they change."],
    ["macro", "Macro Environment", "macro.html", "Rates, inflation, GDP, jobs, and the cost-of-capital backdrop."],
    ["markets", "Markets", "markets.html", "Public-market moves and cross-asset signals."],
    ["deals", "Deals", "deals.html", "M&A, activism, IPOs, and financing updates."],
    ["privateMarkets", "Private Markets", "private-markets.html", "Private-credit, sponsor, fundraising, and exit-window signals."]
  ];
  return `<section class="panel compact">
    <div class="panel-head"><div><span class="eyebrow">Section Tape</span><h2>Breaking, Overnight, Macro, Markets, Deals, Private Markets</h2></div></div>
    <div class="summary-grid">
      ${sections.map(([key, label, file, description]) => {
        const count = key === "deals" ? (edition.dealTape?.length || 0) : (edition.sections?.[key]?.items?.length || 0);
        const first = key === "deals" ? edition.dealTape?.[0] : edition.sections?.[key]?.items?.[0];
        const href = key === "privateMarkets" && first
          ? pageForMove(edition, first)
          : file;
        return `<a class="summary-card" href="${internalHref(href, edition, base)}">
          <span class="meta">${count} ${key === "deals" ? "ranked" : "stories"}</span>
          <b>${escapeHtml(label)}</b>
          <p>${escapeHtml(publicFallbackText(first?.readerDek || first?.ibAngle || first?.whyItRanks, description))}</p>
        </a>`;
      }).join("")}
    </div>
  </section>`;
}

function continuingStoriesPagelet(edition, base = "") {
  if (!edition.continuingStories?.length) return "";
  return `<section class="panel compact">
    <div class="panel-head"><div><span class="eyebrow">Continuing Stories</span><h2>Updates From Earlier Issues</h2></div></div>
    <div class="summary-grid">
      ${edition.continuingStories.map((move) => `<a class="summary-card" href="${internalHref(pageForMove(edition, move), edition, base)}">
        <span class="meta">${escapeHtml(move.continuity.status)}</span>
        <b>${escapeHtml(move.storyline.name)}</b>
        <p>${escapeHtml(move.continuity.whatChanged)}</p>
      </a>`).join("")}
    </div>
  </section>`;
}

function formatPct(value) {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%` : "n.a.";
}

function openbbMarketPackCard(pack) {
  if (!pack) return "";
  const metricRow = (row) => `<tr>
    <td><a href="${escapeHtml(row.url || "#")}" target="_blank" rel="noreferrer"><strong>${escapeHtml(row.symbol)}</strong></a><span>${escapeHtml(row.label || "")}</span></td>
    <td>${formatPct(row.oneDayPct)}</td>
    <td>${formatPct(row.fiveDayPct)}</td>
    <td>${formatPct(row.oneMonthPct)}</td>
    <td>${formatPct(row.ytdPct)}</td>
  </tr>`;
  const indexRows = (pack.indices || []).map(metricRow).join("");
  const sectorRows = (pack.sectors || []).map(metricRow).join("");
  const watchRows = (pack.watchlist || []).map((row) => `<tr>
    <td><a href="${escapeHtml(row.url || "#")}" target="_blank" rel="noreferrer"><strong>${escapeHtml(row.symbol)}</strong></a><span>${escapeHtml(row.label || "")}</span></td>
    <td>${formatPct(row.oneDayPct)}</td>
    <td>${formatPct(row.fiveDayPct)}</td>
    <td>${formatPct(row.oneMonthPct)}</td>
    <td>${row.volumeVs20DayAvg ? `${row.volumeVs20DayAvg.toFixed(2)}x` : "n.a."}</td>
  </tr>`).join("");
  const sources = (pack.sourceTrail || [])
    .map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.source)}</a>`)
    .join(", ");
  return `<section class="panel compact data-pack">
    <div class="panel-head"><div><span class="eyebrow">OpenBB Market Pack</span><h2>Indices, Sectors, and Watchlist Movers</h2></div><span class="chip">${escapeHtml(pack.runDate || "latest")}</span></div>
    <p class="lede">${escapeHtml(pack.summary?.headline || "OpenBB-backed market context for today's tape.")}</p>
    <div class="data-pack-grid">
      <article class="move-card data-table-card"><h3>Index board</h3><table><thead><tr><th>Name</th><th>1D</th><th>5D</th><th>1M</th><th>YTD</th></tr></thead><tbody>${indexRows}</tbody></table></article>
      <article class="move-card data-table-card"><h3>Sector extremes</h3><table><thead><tr><th>Name</th><th>1D</th><th>5D</th><th>1M</th><th>YTD</th></tr></thead><tbody>${sectorRows}</tbody></table></article>
      <article class="move-card data-table-card"><h3>Watchlist movers</h3><table><thead><tr><th>Name</th><th>1D</th><th>5D</th><th>1M</th><th>Vol / 20D</th></tr></thead><tbody>${watchRows}</tbody></table></article>
    </div>
    <p><strong>Read:</strong> ${escapeHtml(pack.summary?.riskTone || "")}</p>
    <p><strong>Watch next:</strong> ${escapeHtml(pack.summary?.watchNext || "")}</p>
    <p class="source-line">${escapeHtml(pack.sourceNote || "")} ${sources}</p>
  </section>`;
}

function todayMarketMap(edition) {
  const watch = edition.marketWatch || [];
  const bySymbol = new Map(watch.map((item) => [liveWatchSymbol(item), item]));
  const tile = (label, symbols, read) => {
    const rows = symbols.map((symbol) => bySymbol.get(symbol)).filter(Boolean);
    if (!rows.length) return "";
    const avg = rows.reduce((sum, row) => sum + (Number(row.percentChange) || 0), 0) / rows.length;
    const sign = avg >= 0 ? "+" : "";
    return `<article class="theme-card market-map-tile">
      <span class="meta">Today’s market map</span>
      <h2>${escapeHtml(label)}</h2>
      <p><strong>${sign}${avg.toFixed(2)}%</strong> average rendered move across ${rows.map((row) => escapeHtml(liveWatchSymbol(row))).join(" / ")}.</p>
      <p>${escapeHtml(read)}</p>
    </article>`;
  };
  const tiles = [
    tile("Equity leadership", ["SPY", "QQQ", "IWM"], "Shows whether the current story is broad risk appetite or narrow mega-cap/tech leadership."),
    tile("Risk hedge", ["GLD"], "Gold gives a quick cross-check on whether investors are still paying for downside/geopolitical protection."),
    tile("Oil / geopolitics", ["USO"], "Oil pressure is the cleanest recurring proxy when geopolitical headlines affect inflation and risk appetite."),
    tile("Rate-sensitive tape", ["IWM", "GLD"], "Small caps and gold help frame how rates and real yields are feeding through the broader tape.")
  ].filter(Boolean).join("");
  if (!tiles) return "";
  return `<section class="panel compact">
    <div class="panel-head"><div><span class="eyebrow">Visual Dashboard</span><h2>Today’s Market Map</h2></div><span class="chip">recent data</span></div>
    <p class="lede">A compact, story-aware read of the live issue’s market context. It uses the same recent market-data feed as the section visuals, so stale one-off charts do not carry forward by default.</p>
    <div class="theme-grid">${tiles}</div>
  </section>`;
}

function overnightPage(edition, base = "") {
  const section = edition.sections?.overnight || { items: [], window: null };
  const items = section.items || [];
  const windowText = section.window?.start && section.window?.end
    ? `${new Date(section.window.start).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET to ${new Date(section.window.end).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET`
    : "latest overnight source window";
  const body = items.length
    ? items.map((move, index) => `<div id="overnight-${index + 1}">
        ${moveCard(move, index, { activePage: "overnight", base, expanded: index < 2 })}
        ${insightGrid(move)}
      </div>`).join("")
    : `<article class="move-card"><h2>No major overnight signal</h2><p>No source-backed overnight story was strong enough for the market-impact cutoff. The tab stays quiet instead of filling with generic headlines.</p></article>`;
  return `<section class="panel">
    <div class="panel-head"><div><span class="eyebrow">Overnight</span><h1>Big News Before The Open</h1></div><span class="chip">${items.length} stories</span></div>
    <p class="lede">The biggest source-backed headlines from the overnight window, analyzed for market impact, valuation read-through, financing conditions, and deal implications.</p>
    <p class="source-line"><strong>Window:</strong> ${escapeHtml(windowText)}</p>
    ${body}
  </section>`;
}

function movesPage(edition) {
  const items = edition.marketWatch || [];
  const strip = items.length
    ? `<div class="watch-strip">${items.map((item) => {
        const percentPrefix = item.percentChange >= 0 ? "+" : "";
        const liveSymbol = liveWatchSymbol(item);
        return `<div class="watch-quote" data-market-symbol="${escapeHtml(liveSymbol)}">
          <span>${escapeHtml(liveSymbol)}</span>
          <b data-market-price>$${item.price.toFixed(2)}</b>
          <i data-market-change class="${item.change >= 0 ? "up" : "down"}">${percentPrefix}${item.percentChange.toFixed(2)}%</i>
        </div>`;
      }).join("")}</div>`
    : "";
  const body = items.length
    ? items.map((item) => watchCard(item)).join("")
    : `<article class="move-card"><h2>No market watch data</h2><p>The public market-data feed did not return the watchlist series for this run.</p></article>`;
  return `<section class="panel" data-market-watch>
    <div class="panel-head"><div><span class="eyebrow">Market Watch</span><h1>Index Tape and Macro Crosswinds</h1></div></div>
    <p class="lede">A quick read on the broad tape: where the major index and real-asset proxies last printed, and the most useful reason they are moving today. Quotes refresh only when this page is opened, then periodically while it remains open.</p>
    <p class="source-line market-watch-status" data-market-watch-status>Showing rendered market data until the page-open quote refresh completes.</p>
    ${strip}
    <div class="summary-grid watch-grid">${body}</div>
  </section>
  ${openbbMarketPackCard(edition.openbbMarketPack)}`;
}

function dealTapeCard(deal) {
  const sources = (deal.sourceTrail || [])
    .map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.source)}</a>`)
    .join(", ");
  return `<article class="deal-tape-card">
    <div class="deal-rank"><span>#${escapeHtml(String(deal.rank))}</span><b>${escapeHtml(String(deal.rankScore))}</b></div>
    <div class="deal-body">
      <div class="meta">Deal Tape / ${escapeHtml(deal.freshnessStatus || "BACKGROUND")} / ${escapeHtml(deal.clusteredItemCount > 1 ? `${deal.clusteredItemCount} clustered items` : "single source item")}</div>
      <h2>${escapeHtml(deal.title)}</h2>
      <p class="story-summary">${escapeHtml(deal.summary)}</p>
      <div class="deal-score-grid">
        <div><b>Deal strength</b><span>${escapeHtml(deal.dealStrength?.label || "Developing")} / ${escapeHtml(String(deal.dealStrength?.score ?? ""))}</span></div>
        <div><b>Update strength</b><span>${escapeHtml(deal.updateStrength?.label || "Developing")} / ${escapeHtml(String(deal.updateStrength?.score ?? ""))}</span></div>
      </div>
      <p><strong>Why it ranks:</strong> ${escapeHtml(deal.whyItRanks)}</p>
      <p><strong>Watch next:</strong> ${escapeHtml(deal.watchNext)}</p>
      <p class="source-line"><strong>Source trail:</strong> ${sources || "source trail unavailable"}</p>
    </div>
  </article>`;
}

function dealsPage(edition, base = "") {
  const items = edition.dealTape || [];
  const laneItems = edition.sections?.deals?.items || [];
  const body = items.length
    ? items.map((deal) => dealTapeCard(deal)).join("")
    : `<article class="move-card"><h2>No ranked deal tape yet</h2><p>No transaction, financing, activist, IPO, or sponsor update was strong enough for the deal tape today. The page stays quiet instead of filling with generic deal copy.</p></article>`;
  const analysisBody = laneItems.length
    ? `<section class="panel compact"><div class="panel-head"><div><span class="eyebrow">Deal Analysis</span><h2>Source-backed deal stories</h2></div><span class="chip">${laneItems.length} stories</span></div>${dedupeVisualTitles(laneItems, "deals", base)}</section>`
    : "";
  return `<section class="panel">
    <div class="panel-head"><div><span class="eyebrow">Deals</span><h1>Ranked Deal Tape</h1></div><span class="chip">${items.length} ranked</span></div>
    <p class="lede">High-impact transaction and financing updates ranked from the full candidate set, not only the generic deals lane. Older but important items can rank when the deal strength outweighs freshness.</p>
    ${body}
  </section>
  ${analysisBody}`;
}

function lanePage(edition, key, eyebrow, title, dek, base = "") {
  const items = edition.sections?.[key]?.items || [];
  const body = items.length
    ? dedupeVisualTitles(items, key, base)
    : `<article class="move-card"><h2>No strong signal today</h2><p>This lane stayed quiet because no fresh, source-backed item warranted a full write-up. If an older major story has a real development, it will show here as a continuing story.</p></article>`;
  return `<section class="panel">
    <div class="panel-head"><div><span class="eyebrow">${escapeHtml(eyebrow)}</span><h1>${escapeHtml(title)}</h1></div><span class="chip">${items.length} stories</span></div>
    <p class="lede">${escapeHtml(dek)}</p>
    ${body}
  </section>`;
}

function macroLatestEvent(section) {
  const latest = section.latestEvent;
  if (!latest) {
    return `<section class="panel compact">
      <div class="panel-head"><div><span class="eyebrow">Latest Event</span><h2>No fresh macro release</h2></div></div>
      <p>The macro desk stays quiet when there is no new official release or no clean market read to make from it.</p>
    </section>`;
  }
  const scheduled = latest.scheduledEvent
    ? `<p class="source-line"><strong>Calendar match:</strong> <a href="${escapeHtml(latest.scheduledEvent.url)}" target="_blank" rel="noreferrer">${escapeHtml(latest.scheduledEvent.title)}</a> on ${escapeHtml(latest.scheduledEvent.scheduledDate)}</p>`
    : "";
  return `<section class="panel compact">
    <div class="panel-head"><div><span class="eyebrow">Latest Event</span><h2>${escapeHtml(latest.title)}</h2></div></div>
    <p><strong>What happened:</strong> ${escapeHtml(latest.whatHappened)}</p>
    <p><strong>What it means:</strong> ${escapeHtml(latest.whyItMatters)}</p>
    <p><strong>Watch next:</strong> ${escapeHtml(latest.watchNext)}</p>
    <p class="source-line"><strong>Primary sources:</strong> ${latest.sourceTrail?.map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.source)}</a>`).join(", ") || "none"}</p>
    ${scheduled}
  </section>`;
}

function economicCalendar(section) {
  const events = section.economicCalendar || [];
  const body = events.length
    ? events.map((event) => `<article class="theme-card calendar-card">
        <span class="meta">${escapeHtml(event.source)} / ${escapeHtml(event.significance.toUpperCase())}</span>
        <h2>${escapeHtml(event.title)}</h2>
        <p>${escapeHtml(event.scheduledDate)}</p>
        <p><a href="${escapeHtml(event.url)}" target="_blank" rel="noreferrer">Official schedule</a></p>
      </article>`).join("")
    : `<article class="theme-card"><h2>No calendar items loaded</h2><p>The official schedule feed did not return any upcoming major events for this run.</p></article>`;
  return `<section class="panel compact">
    <div class="panel-head"><div><span class="eyebrow">Economic Calendar</span><h2>Coming Up</h2></div></div>
    <div class="theme-grid">${body}</div>
  </section>`;
}

export function macroSpeakingPanel(edition) {
  const artifacts = edition.intelligence?.officialMacro?.artifacts || [];
  const editionEnd = new Date(`${edition.runDate || "1970-01-01"}T23:59:59Z`);
  const artifact = artifacts.find((candidate) => {
    const published = new Date(candidate?.sourceDocument?.publishedAt || 0);
    const ageMs = editionEnd.getTime() - published.getTime();
    return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= 7 * 864e5;
  });
  if (!artifact?.speakingLadder || !artifact?.brief) return "";
  const ladder = artifact.speakingLadder;
  const brief = artifact.brief;
  return `<section class="panel compact">
    <div class="panel-head"><div><span class="eyebrow">Know It Well Enough To Say It</span><h2>${escapeHtml(artifact.sourceDocument.title)}</h2></div><span class="chip">high-level speaking guide</span></div>
    <p><strong>The question:</strong> ${escapeHtml(brief.centralQuestion)}</p>
    <p><strong>In 20 seconds:</strong> ${escapeHtml(ladder.twentySecond)}</p>
    <details>
      <summary>Build the 60-second answer and handle the follow-up</summary>
      <p><strong>In 60 seconds:</strong> ${escapeHtml(ladder.sixtySecond)}</p>
      <p><strong>Likely challenge:</strong> ${escapeHtml(ladder.likelyChallenge)}</p>
      <p><strong>Defensible response:</strong> ${escapeHtml(ladder.defensibleResponse)}</p>
      <p><strong>Technical concept:</strong> ${escapeHtml(ladder.technicalConcept)}</p>
      <p><strong>What is still missing:</strong> ${escapeHtml(artifact.dossier.openQuestions.join(" "))}</p>
      <p class="source-line"><strong>Grounding:</strong> <a href="${escapeHtml(artifact.sourceDocument.canonicalUrl)}" target="_blank" rel="noreferrer">official release</a>, published ${escapeHtml(artifact.sourceDocument.publishedAt.slice(0, 10))}. Every reported fact in this guide is linked to an exact retained source assertion.</p>
    </details>
  </section>`;
}

function macroPage(edition, base = "") {
  const section = edition.sections?.macro || { items: [], latestEvent: null, economicCalendar: [] };
  const items = section.items || [];
  const body = items.length
    ? dedupeVisualTitles(items, "macro", base)
    : `<article class="move-card"><h2>No strong macro signal today</h2><p>No fresh official release or policy development warranted a full macro take. The desk stayed quiet instead of forcing one.</p></article>`;
  return `${macroLatestEvent(section)}
  ${macroSpeakingPanel(edition)}
  ${economicCalendar(section)}
  <section class="panel">
    <div class="panel-head"><div><span class="eyebrow">Macro Environment</span><h1>Rates, Inflation, and The Tape Behind The Tape</h1></div><span class="chip">${items.length} stories</span></div>
    <p class="lede">This is where the economic backdrop lives now: the latest official release, what it means for the market, and the next scheduled events that could change the read.</p>
    ${body}
  </section>`;
}

function privateMarketsPage(edition, base = "") {
  const section = edition.sections?.privateMarkets || { items: [], segments: {} };
  const segments = [
    ["privateEquity", "Private Equity", "Sponsor deals, exits, secondaries, and buyout signals."],
    ["privateCredit", "Private Credit", "Direct lending, BDCs, spreads, refinancings, and credit quality."]
  ];
  const seenVisualTitles = new Set();
  const segmentBlocks = segments.map(([key, label, description]) => {
    const items = section.segments?.[key]?.items || [];
    const body = items.length
      ? items.map((move, index) => {
          const visualTitle = move.visual?.title || "";
          const forceHideVisual = Boolean(visualTitle && seenVisualTitles.has(visualTitle));
          if (visualTitle) seenVisualTitles.add(visualTitle);
          return `<div id="${key}-${index + 1}">${moveCard(move, index, {
            activePage: "private-markets",
            forceHideVisual,
            base
          })}</div>`;
        }).join("")
      : `<article class="move-card"><h2>No strong ${escapeHtml(label.toLowerCase())} signal today</h2><p>${escapeHtml(description)} Nothing in this desk warranted a full source-backed write-up today.</p></article>`;
    return `<section class="segment-block">
      <div class="segment-head"><span class="meta">${items.length} stories</span><h2>${escapeHtml(label)}</h2><p>${escapeHtml(description)}</p></div>
      ${body}
    </section>`;
  }).join("");

  return `<section class="panel">
    <div class="panel-head"><div><span class="eyebrow">Private Markets</span><h1>Private Market Signals</h1></div><span class="chip">${section.items?.length || 0} stories</span></div>
    <p class="lede">Public-source reads from the two desks that matter most for banking: sponsor activity and private credit conditions. Each desk can stay quiet when there is no real signal.</p>
    ${segmentBlocks}
  </section>`;
}

function deepDivePage(edition, base = "") {
  const move = edition.deepDive;
  if (!move) return `<section class="panel"><h1>No Deep Dive Today</h1><p>The system did not force a memo without enough evidence.</p></section>`;
  return `<section class="panel">
    <div class="panel-head"><div><span class="eyebrow">Deep Dive</span><h1>${escapeHtml(move.title)}</h1></div></div>
    <p class="lede">This page gives the main story more room: the facts, the market read, the banker angle, the parallel, and what would change the view.</p>
    ${moveCard(move, 0, { activePage: "deep-dive", base })}
  </section>`;
}

function themesPage(edition) {
  const themeVisual = (theme) => {
    const fresh = Number(theme.freshItems || 0);
    const status = fresh >= 2 ? "heating" : fresh === 1 ? "active" : "watching";
    const statusText = status === "heating" ? "Heating" : status === "active" ? "Active" : "Watching";
    const latest = theme.latestItem?.title || theme.openQuestions?.[0] || "No linked current item recorded.";
    return `<article class="theme-card theme-tracker-card">
      <span class="meta">Theme tracker / ${escapeHtml(statusText)}</span>
      <h2>${escapeHtml(theme.name)}</h2>
      <p><strong>Latest signal:</strong> ${escapeHtml(latest)}</p>
      <p><strong>Confirming indicator:</strong> ${escapeHtml(theme.openQuestions?.[0] || "Need a fresh source-backed update before upgrading the theme.")}</p>
      <div class="bar-track"><i class="${fresh ? "up" : "down"}" style="width:${Math.min(100, Math.max(12, fresh * 34))}%"></i></div>
    </article>`;
  };
  const themes = edition.themePulse.length
    ? edition.themePulse.map(themeVisual).join("")
    : `<article class="theme-card"><h2>No fresh theme signal</h2><p>No tracked theme had enough evidence today.</p></article>`;
  return `<section class="panel"><div class="panel-head"><div><span class="eyebrow">Themes</span><h1>What Is Building Over Time</h1></div><span class="chip">visual tracker</span></div><p class="lede">Themes now render as a tracker board: status, latest linked signal, and the indicator that would confirm or break the read.</p><div class="theme-grid">${themes}</div></section>`;
}

function sourcesPage(edition, review) {
  const moveSources = edition.moves.map((move) => `<article class="source-card">
    <h2>${escapeHtml(move.title)}</h2>
    <p><strong>Primary sources:</strong> ${sourceLinks(move)}</p>
    ${furtherReading(move)}
  </article>`).join("");

  return `<section class="panel">
    <div class="panel-head"><div><span class="eyebrow">Sources</span><h1>Trust Checks and Reading List</h1></div></div>
    <p class="lede">Primary sources are used for factual claims. Read-more links are broader searches for commentary, market color, and deeper background.</p>
    <div class="review-box ${review.status === "APPROVED" ? "ok" : "blocked"}">
      <b>Review ${escapeHtml(review.status)}</b>
      <span>${review.blockers.length} blocker(s), ${review.warnings.length} warning(s)</span>
    </div>
    ${moveSources || "<p>No source-backed moves on the desk.</p>"}
    <section class="analysis-block">
      <h2>Source failures</h2>
      <p>${(edition.sourceFailures || []).map((failure) => escapeHtml(`${failure.feed}: ${failure.message}`)).join("; ") || "none"}</p>
    </section>
  </section>`;
}

function notesPage() {
  return `<section class="panel">
    <div class="panel-head"><div><span class="eyebrow">Notes / Questions</span><h1>Your Reading Questions</h1></div></div>
    <p class="lede">Highlight text anywhere in the brief, add your question, and it will appear here with the exact passage and page where it came from.</p>
    <div class="review-box ok">
      <b>Local notes</b>
      <span>Saved in this browser only</span>
    </div>
    <div id="notesApp" class="notes-app"></div>
  </section>`;
}

function archivePage(archiveEntries, base = "") {
  const entries = archiveEntries.filter((entry) => entry.runDate);
  const cards = entries.length
    ? entries.map((entry) => `<article class="source-card archive-card">
        <div class="archive-head">
          <div>
            <span class="meta">${escapeHtml(entry.runDate)}</span>
            <h2>${escapeHtml(entry.title)}</h2>
          </div>
          <a class="chip archive-open" href="${escapeHtml(issueHref(entry.runDate, base))}">Open issue</a>
        </div>
        <p>${escapeHtml(entry.dek)}</p>
        <p class="source-line"><strong>Lead:</strong> ${escapeHtml(entry.leadTitle || "Quiet tape")}</p>
        <p class="source-line"><strong>Coverage:</strong> ${escapeHtml(entry.lanes.join(", ") || "Quiet issue")}</p>
      </article>`).join("")
    : `<article class="source-card"><h2>No saved issues yet</h2><p>Once the daily runs stack up, this page will list them here for quick access.</p></article>`;
  return `<section class="panel">
    <div class="panel-head"><div><span class="eyebrow">Archive</span><h1>Past Issues</h1></div></div>
    <p class="lede">Jump straight into earlier editions, or use continuity links inside stories when a live thread carries forward.</p>
    ${cards}
  </section>`;
}

function pageContent(active, edition, review, archiveEntries, base = "") {
  if (active === "breaking") return lanePage(edition, "breaking", "Breaking", "Breaking Tape", "Source-backed major events that can quickly reset valuation marks, IPO windows, financing conditions, or sector leadership.", base);
  if (active === "overnight") return overnightPage(edition, base);
  if (active === "moves") return movesPage(edition);
  if (active === "macro") return macroPage(edition, base);
  if (active === "markets") return lanePage(edition, "markets", "Markets", "Public Market Tape", "Equities, sector moves, peer reactions, and company-specific market repricings that change the banker read.", base);
  if (active === "deals") return dealsPage(edition, base);
  if (active === "private-markets") return privateMarketsPage(edition, base);
  if (active === "deep-dive") return deepDivePage(edition, base);
  if (active === "themes") return themesPage(edition);
  if (active === "sources") return sourcesPage(edition, review);
  if (active === "archive") return archivePage(archiveEntries, base);
  if (active === "notes") return notesPage();
  return overview(edition, base);
}

function renderHtml(active, edition, review, archiveEntries, base = "") {
  const issueOptions = archiveEntries
    .map((entry) => `<option value="${escapeHtml(issueHref(entry.runDate, base))}"${entry.runDate === edition.runDate ? " selected" : ""}>${escapeHtml(entry.runDate)} - ${escapeHtml(entry.title)}</option>`)
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>The Opening Ledger - ${escapeHtml(edition.runDate)}</title>
  <style>
    :root { --bg:#121212; --paper:#eeeae1; --paper-2:#f7f4ec; --ink:#111111; --muted:#5e5a52; --line:#2a2a2a; --line-soft:#b8b0a4; --red:#b5121b; --red-dark:#730d14; --green:#0a6b3f; --soft:#e4ded3; --radius:0; }
    * { box-sizing:border-box; }
    body {
      margin:0;
      background:
        linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px) 0 0 / 48px 48px,
        linear-gradient(0deg, rgba(255,255,255,.025) 1px, transparent 1px) 0 0 / 48px 48px,
        radial-gradient(circle at 50% -10%, #2c2c2c 0, transparent 38%),
        var(--bg);
      color:var(--ink);
      font-family: Georgia, "Times New Roman", serif;
      line-height:1.5;
    }
    a { color:var(--red-dark); text-decoration-thickness:1px; text-underline-offset:3px; }
    .ticker {
      display:flex;
      justify-content:center;
      gap:34px;
      overflow:auto;
      padding:10px 18px;
      background:#050505;
      color:#f4f1ea;
      border-bottom:3px solid var(--red);
      font:700 12px Georgia, "Times New Roman", serif;
      white-space:nowrap;
    }
    .shell { width:min(1260px, calc(100% - 32px)); margin:0 auto; padding:26px 0 60px; }
    .topbar {
      display:flex;
      justify-content:space-between;
      gap:12px;
      align-items:center;
      margin-bottom:14px;
      padding:18px 20px;
      background:#0b0b0b;
      color:#f5f1ea;
      border:1px solid #3a3a3a;
      border-left:8px solid var(--red);
      box-shadow:8px 8px 0 rgba(0,0,0,.32);
    }
    .brand { font-weight:900; letter-spacing:.13em; text-transform:uppercase; }
    .topbar-tools { display:flex; align-items:center; gap:10px; flex-wrap:wrap; justify-content:flex-end; }
    .chip { display:inline-flex; align-items:center; border:1px solid #4a4a4a; border-radius:0; padding:7px 10px; background:#191919; color:#d8d2c8; font:800 11px Georgia, "Times New Roman", serif; text-transform:uppercase; }
    .issue-jump { min-width:250px; border:1px solid #4a4a4a; background:#191919; color:#f5f1ea; padding:8px 10px; font:700 12px Georgia, "Times New Roman", serif; }
    .workspace { display:block; }
    .tabs {
      position:sticky;
      top:0;
      z-index:20;
      display:flex;
      flex-wrap:nowrap;
      justify-content:center;
      gap:0;
      overflow:visible;
      margin-bottom:18px;
      padding:0;
      border:1px solid #3a3a3a;
      background:#171717;
      box-shadow:8px 8px 0 rgba(0,0,0,.28);
      font-family: Georgia, "Times New Roman", serif;
      scrollbar-width:thin;
    }
    .tabs a { flex:1 1 0; min-width:max-content; padding:12px 11px; border-right:1px solid #3a3a3a; color:#e9e3d8; font-size:13px; font-weight:900; text-align:center; text-decoration:none; white-space:nowrap; }
    .tabs a:last-child { border-right:0; }
    .tabs a.active, .tabs a:hover { background:var(--red); color:#fff; }
    .section-menu { position:relative; flex:0 0 auto; min-width:150px; border-right:1px solid #3a3a3a; }
    .section-menu-trigger {
      display:block;
      width:100%;
      height:100%;
      border:0;
      border-radius:0;
      background:transparent;
      cursor:pointer;
      padding:12px 15px;
      color:#f4eee3;
      font:900 13px Georgia, "Times New Roman", serif;
      text-align:center;
      white-space:nowrap;
    }
    .section-menu.is-open .section-menu-trigger, .section-menu-trigger:hover { background:var(--red); color:#fff; }
    .section-menu-panel {
      position:absolute;
      right:0;
      top:calc(100% + 8px);
      z-index:40;
      width:min(760px, calc(100vw - 40px));
      display:grid;
      grid-template-columns:1fr 1.3fr 1fr;
      gap:0;
      border:1px solid #3a3a3a;
      border-left:6px solid var(--red);
      background:#111;
      color:#f4eee3;
      box-shadow:10px 10px 0 rgba(0,0,0,.35);
      text-align:left;
    }
    .section-menu-panel[hidden] { display:none; }
    .section-menu-panel section { padding:16px; border-right:1px solid #3a3a3a; }
    .section-menu-panel section:last-child { border-right:0; }
    .section-menu-panel b { display:block; margin-bottom:10px; color:#cfc5b6; font:900 11px Georgia, "Times New Roman", serif; letter-spacing:.1em; text-transform:uppercase; }
    .section-menu-panel a { display:block; margin-top:8px; padding:9px 10px; border:1px solid #3a3a3a; background:#191919; color:#f4eee3; text-decoration:none; font-weight:800; }
    .section-menu-panel a.active, .section-menu-panel a:hover { background:var(--red); color:#fff; }
    .panel {
      position:relative;
      margin-bottom:22px;
      padding:28px;
      border:1px solid var(--line);
      border-top:6px solid #0b0b0b;
      background:
        linear-gradient(90deg, rgba(17,17,17,.035) 1px, transparent 1px) 0 0 / 36px 36px,
        var(--paper);
      box-shadow:10px 10px 0 rgba(0,0,0,.34);
    }
    .panel::before { content:""; position:absolute; inset:0; pointer-events:none; border-top:2px solid var(--red); opacity:.9; }
    .panel.compact { padding:20px 24px; }
    .panel-head { display:flex; justify-content:space-between; gap:14px; align-items:start; margin-bottom:12px; }
    .eyebrow, .meta { color:var(--red); font:900 11px Georgia, "Times New Roman", serif; letter-spacing:.11em; text-transform:uppercase; }
    h1 { margin:6px 0 10px; font-size:clamp(38px, 4.6vw, 68px); line-height:.95; letter-spacing:0; }
    h2 { margin:7px 0 9px; font-size:26px; line-height:1.12; }
    h3 { margin:0 0 8px; font-size:18px; }
    p { margin:10px 0; }
    .lede { max-width:850px; color:#37322e; font-size:19px; }
    .summary-grid, .theme-grid { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:12px; margin-top:18px; }
    .summary-card, .theme-card, .source-card, .analysis-block, .read-more, .insight-grid div {
      border:1px solid var(--line-soft);
      border-radius:0;
      background:var(--paper-2);
      padding:14px;
      box-shadow:4px 4px 0 rgba(17,17,17,.08);
    }
    .summary-card { color:inherit; text-decoration:none; min-height:170px; }
    .summary-card b { display:block; margin:7px 0; font-size:19px; line-height:1.15; }
    .watch-strip { display:grid; grid-template-columns:repeat(5, minmax(0, 1fr)); gap:10px; margin:16px 0 20px; }
    .watch-quote { padding:14px; border:1px solid var(--line); background:#111; color:#f4eee3; box-shadow:6px 6px 0 rgba(17,17,17,.2); }
    .watch-quote span, .watch-quote i { display:block; }
    .watch-quote span { color:#c8beb1; font:900 11px Georgia, "Times New Roman", serif; letter-spacing:.09em; text-transform:uppercase; }
    .watch-quote b { display:block; margin:8px 0 6px; font-size:28px; line-height:1; }
    .watch-quote i { font-style:normal; font-weight:900; }
    .watch-quote[data-market-live="failed"], .watch-card[data-market-live="failed"] { outline:2px solid var(--red); outline-offset:-2px; }
    .market-watch-status { margin:12px 0 0; padding:10px 12px; border:1px solid var(--line-soft); background:#f7f4ec; }
    .market-watch-status[data-status-kind="ok"] { border-color:var(--green); }
    .market-watch-status[data-status-kind="failed"], .market-watch-status[data-status-kind="partial"] { border-color:var(--red); }
    .watch-grid { grid-template-columns:repeat(2, minmax(0, 1fr)); }
    .data-pack { border-top-color:var(--red); }
    .data-pack-grid { display:grid; grid-template-columns:1fr; gap:14px; margin:16px 0; }
    .data-table-card { padding:16px; border:1px solid var(--line-soft); background:var(--paper-2); overflow:auto; }
    .data-table-card table { width:100%; border-collapse:collapse; font-size:14px; }
    .data-table-card th, .data-table-card td { padding:9px 8px; border-bottom:1px solid var(--line-soft); text-align:right; white-space:nowrap; }
    .data-table-card th:first-child, .data-table-card td:first-child { text-align:left; min-width:190px; }
    .data-table-card td span { display:block; color:var(--muted); font-size:12px; }
    .data-table-card a { color:inherit; text-decoration:none; }
    .data-table-card a:hover { color:var(--red); }
    .watch-card { min-height:100%; padding:0; border:1px solid var(--line-soft); background:var(--paper-2); box-shadow:4px 4px 0 rgba(17,17,17,.08); }
    .watch-card h2, .watch-card p, .watch-card .meta, .watch-card .source-line { padding-left:16px; padding-right:16px; }
    .watch-card .meta { padding-top:16px; }
    .watch-card .source-line { padding-bottom:16px; }
    .watch-price-row { display:flex; justify-content:space-between; align-items:end; gap:12px; padding:0 16px; margin:8px 0 4px; }
    .watch-price-row b { font-size:36px; line-height:1; }
    .watch-price-row span { font-weight:900; }
    .up { color:var(--green); }
    .down { color:var(--red); }
    .move-card { padding:22px 0; border-bottom:1px solid var(--line-soft); }
    .move-card:first-of-type { padding-top:0; }
    .move-card:last-child { border-bottom:0; padding-bottom:0; }
    .story-summary { font-size:19px; color:#28231f; }
    .story-details { margin:16px 0; border:1px solid var(--line-soft); background:var(--paper-2); box-shadow:4px 4px 0 rgba(17,17,17,.08); }
    .story-details summary { cursor:pointer; list-style:none; padding:14px 16px; font:900 12px Georgia, "Times New Roman", serif; letter-spacing:.05em; text-transform:uppercase; border-bottom:1px solid var(--line-soft); background:#f1ecdf; }
    .story-details summary::-webkit-details-marker { display:none; }
    .story-detail-body { padding:18px 16px 16px; }
    .editorial-article { max-width:880px; }
    .editorial-article p { font-size:18px; line-height:1.58; color:#24201d; }
    .article-question { font-size:21px !important; font-weight:900; color:#111 !important; }
    .banker-sidebar { margin:18px 0 0; padding:14px 16px; border-left:5px solid var(--red); background:#f7f4ec; }
    .banker-sidebar b { display:block; margin-bottom:6px; font:900 12px Georgia, "Times New Roman", serif; letter-spacing:.08em; text-transform:uppercase; }
    .banker-sidebar p { font-size:16px; margin:8px 0; }

    .narrative-stack { display:grid; gap:14px; }
    .narrative-section { padding:0 0 12px; border-bottom:1px solid var(--line-soft); }
    .narrative-section:last-child { border-bottom:0; padding-bottom:0; }
    .narrative-section h3 { margin:0 0 8px; font-size:18px; }
    .narrative-section p { margin:0; font-size:17px; color:#2d2824; }
    .segment-block { margin:22px 0; padding:18px; border:1px solid var(--line); border-left:6px solid var(--red); background:rgba(247,244,236,.66); box-shadow:6px 6px 0 rgba(17,17,17,.1); }
    .segment-head { margin-bottom:10px; border-bottom:1px solid var(--line-soft); }
    .segment-head h2 { margin:4px 0; font-size:30px; }
    .segment-head p { margin:0 0 12px; color:var(--muted); }
    .deal-tape-card { display:grid; grid-template-columns:96px minmax(0, 1fr); gap:16px; padding:20px 0; border-bottom:1px solid var(--line-soft); }
    .deal-tape-card:last-child { border-bottom:0; padding-bottom:0; }
    .deal-rank { display:grid; align-content:start; gap:6px; padding:12px; border:1px solid var(--line); background:#111; color:#f4eee3; text-align:center; box-shadow:4px 4px 0 rgba(17,17,17,.18); }
    .deal-rank span { color:#c8beb1; font:900 12px Georgia, "Times New Roman", serif; letter-spacing:.08em; text-transform:uppercase; }
    .deal-rank b { font-size:34px; line-height:1; }
    .deal-body { min-width:0; }
    .deal-score-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px; margin:14px 0; }
    .deal-score-grid div { padding:12px; border:1px solid var(--line-soft); background:var(--paper-2); box-shadow:3px 3px 0 rgba(17,17,17,.08); }
    .deal-score-grid b { display:block; margin-bottom:5px; color:#050505; font:900 12px Georgia, "Times New Roman", serif; letter-spacing:.04em; text-transform:uppercase; }
    .deal-score-grid span { color:#37322e; }
    .insight-grid { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:10px; margin:14px 0; }
    .insight-grid b, .read-more b { display:block; margin-bottom:5px; color:#050505; font:900 12px Georgia, "Times New Roman", serif; letter-spacing:.04em; text-transform:uppercase; }
    .insight-grid span, .source-line, .read-more span { color:#37322e; }
    .analysis-block { margin:14px 0; background:var(--paper-2); border-left:5px solid #111; }
    .continuity-block { margin:14px 0; padding:14px; border:1px solid var(--line); border-left:5px solid var(--red); background:#ede5d8; box-shadow:4px 4px 0 rgba(17,17,17,.1); }
    .visual-card { margin:16px 0; padding:16px; border:1px solid var(--line); border-left:5px solid var(--red); background:var(--paper-2); box-shadow:6px 6px 0 rgba(17,17,17,.12); }
    .visual-head { display:flex; justify-content:space-between; gap:14px; align-items:start; margin-bottom:10px; }
    .visual-head h3 { margin:3px 0 0; font-size:22px; }
    .visual-head span:last-child { max-width:360px; color:var(--muted); text-align:right; }
    .visual-why { margin:0 0 12px; color:#37322e; font-size:15px; }
    .bar-board { display:grid; gap:12px; margin:14px 0; }
    .bar-row { display:grid; grid-template-columns:minmax(0, 1.4fr) minmax(180px, 2fr) minmax(110px, .9fr); align-items:center; gap:14px; }
    .bar-label, .bar-value { display:grid; gap:3px; }
    .bar-label span, .bar-value span { color:var(--muted); font-size:12px; }
    .bar-track { height:16px; border:1px solid var(--line-soft); background:#efe8da; position:relative; }
    .bar-track i { display:block; height:100%; background:var(--red); }
    .bar-track i.down { background:#4f4a43; }
    .bar-value { text-align:right; }
    .visual-card svg { display:block; width:100%; height:auto; border:1px solid var(--line-soft); background:#f7f4ec; }
    .axis-label { fill:#514a43; font:700 12px Georgia, "Times New Roman", serif; }
    .axis-title { fill:#111; font:900 12px Georgia, "Times New Roman", serif; text-transform:uppercase; letter-spacing:0; }
    .axis-right { text-anchor:end; }
    .axis-center { text-anchor:middle; }
    .legend-grid { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:8px; margin-top:10px; }
    .legend-grid div { display:grid; grid-template-columns:14px 1fr; gap:5px 8px; align-items:center; padding:8px; border:1px solid var(--line-soft); background:#eee7dc; }
    .legend-grid i { width:12px; height:12px; display:block; }
    .legend-grid b { font-size:13px; }
    .legend-grid span { grid-column:2; color:var(--muted); font-size:12px; }
    .chain-map { display:grid; grid-template-columns:repeat(5, minmax(0, 1fr)); border:1px solid var(--line); }
    .chain-node { min-height:130px; padding:12px; border-right:1px solid var(--line); background:#ede5d8; }
    .chain-node:last-child { border-right:0; }
    .chain-node span { color:var(--red); font-weight:900; }
    .chain-node b { display:block; margin:8px 0 5px; }
    .deal-map { display:grid; grid-template-columns:repeat(5, minmax(0, 1fr)); gap:0; border:1px solid var(--line); }
    .deal-map div { min-height:110px; padding:12px; border-right:1px solid var(--line); background:#ede5d8; }
    .deal-map div:last-child { border-right:0; }
    .deal-map b { display:block; margin-bottom:6px; }
    .parallel-detail p { margin:8px 0; }
    .read-more { margin-top:14px; background:var(--soft); border-left:5px solid var(--red); }
    .archive-card { margin-top:14px; }
    .archive-head { display:flex; justify-content:space-between; gap:12px; align-items:start; }
    .archive-open { text-decoration:none; }
    .related-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:8px; margin-top:12px; }
    .related-grid a { display:flex; justify-content:space-between; gap:10px; padding:10px; border:1px solid var(--line-soft); border-radius:0; background:var(--paper-2); font:800 12px Georgia, "Times New Roman", serif; text-decoration:none; }
    .related-grid span { color:var(--muted); font-weight:700; }
    .link-row { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; font-family: Georgia, "Times New Roman", serif; }
    .link-row a { padding:7px 10px; border:1px solid var(--line); border-radius:0; background:#111; color:#f8f4ec; font-size:12px; font-weight:900; text-decoration:none; }
    .link-row a:hover { background:var(--red); }
    .review-box { display:flex; justify-content:space-between; gap:12px; padding:14px; margin:16px 0; border-radius:0; border:1px solid var(--line); background:var(--paper-2); font-family:Georgia, "Times New Roman", serif; }
    .review-box.ok b { color:var(--green); }
    .review-box.blocked b { color:var(--red); }
    .highlight-composer {
      position:fixed;
      z-index:100;
      width:min(380px, calc(100vw - 24px));
      padding:12px;
      border:1px solid #111;
      border-left:5px solid var(--red);
      background:var(--paper-2);
      box-shadow:8px 8px 0 rgba(0,0,0,.35);
    }
    .highlight-composer.hidden { display:none; }
    .highlight-composer b { display:block; margin-bottom:6px; font-size:13px; }
    .highlight-composer .quote { max-height:72px; overflow:auto; margin:0 0 8px; color:#34302b; font-size:14px; }
    .highlight-composer textarea, .prompt-box textarea {
      width:100%;
      min-height:78px;
      resize:vertical;
      padding:10px;
      border:1px solid #111;
      border-radius:0;
      background:#fffdf8;
      color:#111;
      font:16px Georgia, "Times New Roman", serif;
    }
    .composer-actions, .note-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; }
    .action-button {
      padding:8px 10px;
      border:1px solid #111;
      border-radius:0;
      background:#111;
      color:#fff;
      cursor:pointer;
      font:900 12px Georgia, "Times New Roman", serif;
      text-transform:uppercase;
    }
    .action-button.secondary { background:transparent; color:#111; }
    .action-button:hover { background:var(--red); color:#fff; }
    .note-card {
      margin:14px 0;
      padding:16px;
      border:1px solid var(--line);
      border-left:5px solid var(--red);
      background:var(--paper-2);
      box-shadow:5px 5px 0 rgba(17,17,17,.09);
    }
    .note-card blockquote {
      margin:10px 0;
      padding:10px 12px;
      border-left:4px solid #111;
      background:var(--soft);
    }
    .note-card .question { font-size:18px; }
    .empty-notes { padding:18px; border:1px dashed var(--line); background:var(--soft); }
    .prompt-box { margin-top:12px; }
    .prompt-box.hidden { display:none; }
    .copy-status { align-self:center; color:var(--green); font-size:13px; font-weight:900; }
    @media (max-width: 920px) { .tabs { position:static; justify-content:flex-start; } .tabs a { flex:0 0 auto; } .section-menu { flex:0 0 auto; } .section-menu-panel { left:auto; right:0; grid-template-columns:1fr; width:min(340px, calc(100vw - 24px)); } .section-menu-panel section { border-right:0; border-bottom:1px solid #3a3a3a; } .section-menu-panel section:last-child { border-bottom:0; } .summary-grid, .theme-grid, .insight-grid, .related-grid, .legend-grid, .chain-map, .deal-map, .deal-score-grid, .watch-strip, .watch-grid { grid-template-columns:1fr; } .deal-tape-card { grid-template-columns:1fr; } .deal-rank { text-align:left; } .chain-node, .deal-map div { border-right:0; border-bottom:1px solid var(--line); } .chain-node:last-child, .deal-map div:last-child { border-bottom:0; } .visual-head { flex-direction:column; } .visual-head span:last-child { text-align:left; } .watch-price-row { flex-direction:column; align-items:start; } .story-summary, .narrative-section p { font-size:16px; } .bar-row { grid-template-columns:1fr; } .bar-value { text-align:left; } }
    @media (max-width: 640px) { .shell { width:min(100% - 20px, 1240px); } .panel { padding:18px; } .topbar, .panel-head { flex-direction:column; } h1 { font-size:34px; } }
  </style>
</head>
<body>
  <div class="ticker">
    <span>Focused tape: 3-5 items max</span>
    <span>No source, no claim</span>
    <span>Freshness: ${escapeHtml(edition.freshnessStatus)}</span>
    <span>Review: ${escapeHtml(edition.review?.status || "PENDING")}</span>
  </div>
  <main class="shell">
    <div class="topbar">
      <div class="brand">The Opening Ledger</div>
      <div class="topbar-tools">
        <span class="chip">${escapeHtml(edition.runDate)}</span>
        <span class="chip">Opening Ledger edition</span>
        <a class="chip archive-open" href="${escapeHtml(internalHref("archive.html", edition, base))}">Archive</a>
        <select class="issue-jump" aria-label="Open past issue" onchange="if (this.value) location.href=this.value;">
          <option value="${escapeHtml(latestIssueHref(base))}">Latest issue</option>
          ${issueOptions}
        </select>
      </div>
    </div>
    ${nav(active, edition, base)}
    <div class="workspace">${pageContent(active, edition, review, archiveEntries, base)}</div>
  </main>
  <div id="highlightComposer" class="highlight-composer hidden" role="dialog" aria-label="Save highlighted question">
    <b>Add a question about this highlight</b>
    <p class="quote" id="highlightQuote"></p>
    <textarea id="highlightQuestion" placeholder="What do you want to understand better?"></textarea>
    <div class="composer-actions">
      <button class="action-button" type="button" id="saveHighlightNote">Save note</button>
      <button class="action-button secondary" type="button" id="cancelHighlightNote">Cancel</button>
    </div>
  </div>
  <script src="${assetHref(base, "market-watch-live.js")}" defer></script>
  <script>
    (() => {
      const storageKey = "opening-ledger-notes-v1";
      const composer = document.getElementById("highlightComposer");
      const quoteEl = document.getElementById("highlightQuote");
      const questionEl = document.getElementById("highlightQuestion");
      const saveButton = document.getElementById("saveHighlightNote");
      const cancelButton = document.getElementById("cancelHighlightNote");
      let activeSelection = null;

      document.querySelectorAll("[data-section-menu]").forEach((menu) => {
        const button = menu.querySelector(".section-menu-trigger");
        const panel = menu.querySelector(".section-menu-panel");
        if (!button || !panel) return;

        function setOpen(open) {
          menu.classList.toggle("is-open", open);
          button.setAttribute("aria-expanded", open ? "true" : "false");
          panel.hidden = !open;
        }

        setOpen(menu.classList.contains("is-open"));
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          setOpen(!menu.classList.contains("is-open"));
        });
        panel.addEventListener("click", (event) => event.stopPropagation());
        document.addEventListener("click", () => setOpen(false));
        document.addEventListener("keydown", (event) => {
          if (event.key === "Escape") setOpen(false);
        });
      });

      function fallbackState() {
        try { return JSON.parse(window.name || "{}"); }
        catch { return {}; }
      }

      function readStoredValue(key) {
        try {
          if (window.localStorage) return window.localStorage.getItem(key);
        } catch {}
        const state = fallbackState();
        return state[key] || null;
      }

      function writeStoredValue(key, value) {
        try {
          if (window.localStorage) {
            window.localStorage.setItem(key, value);
            return;
          }
        } catch {}
        const state = fallbackState();
        state[key] = value;
        window.name = JSON.stringify(state);
      }

      function readNotes() {
        try { return JSON.parse(readStoredValue(storageKey) || "[]"); }
        catch { return []; }
      }

      function writeNotes(notes) {
        writeStoredValue(storageKey, JSON.stringify(notes));
      }

      function contextTitle(node) {
        const card = node?.closest?.(".move-card, .panel, .source-card, .theme-card");
        return card?.querySelector?.("h1, h2")?.textContent?.trim()
          || document.querySelector("h1")?.textContent?.trim()
          || document.title;
      }

      function compactText(value, max = 1800) {
        return String(value || "").replace(/\\s+/g, " ").trim().slice(0, max);
      }

      function selectedContext(node) {
        const card = node?.closest?.(".move-card, .source-card, .theme-card, .panel");
        const moveCard = node?.closest?.(".move-card");
        let structured = null;
        if (moveCard?.dataset?.context) {
          try { structured = JSON.parse(moveCard.dataset.context); }
          catch { structured = null; }
        }
        return {
          structured,
          nearbyText: compactText(card?.innerText || document.querySelector(".panel")?.innerText || document.body.innerText, 2200)
        };
      }

      function escape(value) {
        return String(value || "").replace(/[&<>"']/g, (char) => ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;"
        }[char]));
      }

      function hideComposer() {
        composer.classList.add("hidden");
        activeSelection = null;
        questionEl.value = "";
      }

      function showComposer(selection) {
        const text = selection.toString().replace(/\\s+/g, " ").trim();
        if (text.length < 3) return;
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const node = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
          ? range.commonAncestorContainer.parentElement
          : range.commonAncestorContainer;
        activeSelection = {
          id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
          quote: text.slice(0, 1200),
          pageTitle: document.title,
          pageUrl: location.pathname + location.search,
          sectionTitle: contextTitle(node),
          context: selectedContext(node),
          createdAt: new Date().toISOString()
        };
        quoteEl.textContent = '"' + activeSelection.quote + '"';
        composer.style.left = Math.min(Math.max(12, rect.left), window.innerWidth - 392) + "px";
        composer.style.top = Math.min(rect.bottom + 12, window.innerHeight - 250) + "px";
        composer.classList.remove("hidden");
        questionEl.focus();
      }

      document.addEventListener("mouseup", () => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || composer.contains(selection.anchorNode)) return;
        window.setTimeout(() => showComposer(selection), 0);
      });

      saveButton.addEventListener("click", () => {
        if (!activeSelection) return;
        const question = questionEl.value.trim();
        if (!question) {
          questionEl.focus();
          return;
        }
        const notes = readNotes();
        notes.unshift({ ...activeSelection, question });
        writeNotes(notes);
        hideComposer();
        renderNotes();
      });

      cancelButton.addEventListener("click", hideComposer);
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") hideComposer();
      });

      function promptFor(note) {
        const structured = note.context?.structured;
        const contextLines = structured ? [
          "Full story context:",
          "- Topic/story: " + structured.title,
          "- What happened: " + structured.whatHappened,
          "- Summary: " + (structured.summary || ""),
          "- Why it matters: " + structured.whyItMatters,
          "- What changed: " + structured.whatChanged,
          "- Valuation angle: " + structured.valuation,
          "- Financing/deal angle: " + structured.financingDeals,
          "- Company/sector read: " + structured.companyRead,
          "- Watch next: " + structured.watchNext,
          structured.continuity ? "- Continuing story: " + structured.continuity.whatChanged : "",
          structured.continuity ? "- Prior read: " + structured.continuity.priorRead : "",
          structured.continuity ? "- Updated read: " + structured.continuity.updatedRead : "",
          "- Primary sources: " + (structured.primarySources || []).map((source) => source.source + " (" + source.url + ")").join("; "),
          "- Related links: " + (structured.relatedLinks || []).map((link) => link.label + " (" + link.url + ")").join("; "),
          "",
          "Detailed analysis from the brief:",
          ...(structured.longform?.sections || []).map((section) => "- " + section.heading + ": " + section.body),
          "",
          "Historical/market parallel from the brief:",
          structured.parallel && typeof structured.parallel === "object"
            ? [
                "- Past example: " + structured.parallel.precedent,
                "- What happened then: " + structured.parallel.outcome,
                "- What looks similar: " + structured.parallel.whatRhymes,
                "- What is different now: " + structured.parallel.whatDiffers,
                "- Bottom line: " + structured.parallel.soWhat,
                "- Parallel sources: " + (structured.parallel.sourceTrail || []).map((source) => source.source + " (" + source.url + ")").join("; ")
              ].join("\\n")
            : "- " + (structured.parallel || "No parallel recorded."),
          ""
        ] : [
          "Nearby context from the page:",
          note.context?.nearbyText || "No nearby context captured.",
          ""
        ];
        return [
          "I am reading The Opening Ledger, a finance market brief, and I highlighted a passage I want to understand more deeply.",
          "",
          "Page: " + note.pageTitle,
          "Section/story: " + note.sectionTitle,
          ...contextLines,
          "Highlighted passage:",
          quote(note.quote),
          "",
          "My question:",
          note.question,
          "",
          "Please answer like a patient finance tutor. Use plain English first, then explain the technical terms only when needed. Connect the answer to valuation, financing, markets, or deal implications where relevant. If there is a historical parallel, name the companies or episodes involved, explain what happened, and say whether the parallel is useful or misleading. End with 3 follow-up questions I should be able to answer."
        ].join("\\n");
      }

      function quote(text) {
        return text.split("\\n").map((line) => "> " + line).join("\\n");
      }

      function renderNotes() {
        const app = document.getElementById("notesApp");
        if (!app) return;
        const notes = readNotes();
        if (!notes.length) {
          app.innerHTML = '<div class="empty-notes"><b>No notes yet.</b><p>Highlight any passage in the brief and add your question. It will show up here.</p></div>';
          return;
        }
        app.innerHTML = notes.map((note) => {
          const prompt = promptFor(note);
          return '<article class="note-card" data-note-id="' + escape(note.id) + '">' +
            '<div class="meta">' + escape(new Date(note.createdAt).toLocaleString()) + '</div>' +
            '<h2>' + escape(note.sectionTitle) + '</h2>' +
            '<blockquote>' + escape(note.quote) + '</blockquote>' +
            '<p class="question"><strong>Your question:</strong> ' + escape(note.question) + '</p>' +
            '<p class="source-line"><strong>Where:</strong> <a href="' + escape(note.pageUrl) + '">' + escape(note.pageTitle) + '</a></p>' +
            '<div class="note-actions">' +
              '<button class="action-button ask-ai" type="button">Ask AI</button>' +
              '<button class="action-button secondary delete-note" type="button">Delete</button>' +
            '</div>' +
            '<div class="prompt-box hidden">' +
              '<textarea readonly>' + escape(prompt) + '</textarea>' +
              '<div class="note-actions"><button class="action-button copy-prompt" type="button">Copy prompt</button><span class="copy-status" aria-live="polite"></span></div>' +
            '</div>' +
          '</article>';
        }).join("");
      }

      async function copyText(text) {
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
          }
        } catch {}
        const temporary = document.createElement("textarea");
        temporary.value = text;
        temporary.setAttribute("readonly", "");
        temporary.style.position = "fixed";
        temporary.style.left = "-9999px";
        temporary.style.top = "0";
        document.body.appendChild(temporary);
        temporary.focus();
        temporary.select();
        let copied = false;
        try { copied = document.execCommand("copy"); }
        catch { copied = false; }
        temporary.remove();
        return copied;
      }

      document.addEventListener("click", async (event) => {
        const noteCard = event.target.closest(".note-card");
        if (!noteCard) return;
        const id = noteCard.dataset.noteId;
        if (event.target.matches(".delete-note")) {
          writeNotes(readNotes().filter((note) => note.id !== id));
          renderNotes();
        }
        if (event.target.matches(".ask-ai")) {
          noteCard.querySelector(".prompt-box").classList.toggle("hidden");
        }
        if (event.target.matches(".copy-prompt")) {
          const textarea = noteCard.querySelector(".prompt-box textarea");
          const copied = await copyText(textarea.value);
          const status = noteCard.querySelector(".copy-status");
          if (copied) {
            event.target.textContent = "Copied";
            if (status) status.textContent = "Copied to clipboard.";
            window.setTimeout(() => {
              event.target.textContent = "Copy prompt";
              if (status) status.textContent = "";
            }, 1400);
          } else {
            textarea.focus();
            textarea.select();
            if (status) status.textContent = "Select all and copy manually.";
          }
        }
      });

      renderNotes();
    })();
  </script>
</body>
</html>`;
}

async function loadArchiveEntries() {
  const files = (await fs.readdir(editionsDir).catch(() => []))
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
    .sort()
    .reverse();
  const entries = [];
  for (const file of files) {
    const edition = await readJson(path.join(editionsDir, file), null);
    if (!edition) continue;
    const lanes = [...new Set((edition.moves || []).map((move) => move.editorialLaneLabel || move.editorialLane).filter(Boolean))];
    entries.push({
      runDate: edition.runDate,
      title: edition.title,
      dek: edition.dek,
      leadTitle: edition.moves?.[0]?.title || "",
      lanes
    });
  }
  return entries;
}

function cleanRenderedHtml(html) {
  return html.replace(/[ \t]+$/gm, "");
}

async function writeRootPages(edition, review, archiveEntries) {
  for (const [id, , file] of pages) {
    await fs.writeFile(path.join(rootDir, file), cleanRenderedHtml(renderHtml(id, edition, review, archiveEntries)));
  }
}

async function writeIssuePages(archiveEntries) {
  await ensureDir(issuesDir);
  for (const entry of archiveEntries) {
    const edition = await readJson(path.join(editionsDir, `${entry.runDate}.json`), null);
    if (!edition) continue;
    const review = await readJson(path.join(reviewsDir, `${entry.runDate}.json`), { status: edition.review?.status || "PENDING", blockers: [], warnings: [] });
    const issueHtml = cleanRenderedHtml(renderHtml("overview", edition, review, archiveEntries, "../"));
    await fs.writeFile(path.join(issuesDir, `${entry.runDate}.html`), issueHtml);
  }
}

async function main() {
  const runDate = process.env.BRIEF_DATE || editionDate();
  const datedEdition = await readJson(path.join(editionsDir, `${runDate}.json`), false);
  const edition = datedEdition || await readJson(path.join(editionsDir, "latest.json"));
  const review = await readJson(path.join(reviewsDir, `${edition.runDate}.json`), { status: "PENDING", blockers: [], warnings: [] });
  const archiveEntries = await loadArchiveEntries();
  await ensureDir(issuesDir);
  await writeRootPages(edition, review, archiveEntries);
  await writeIssuePages(archiveEntries);
  const issueHtml = cleanRenderedHtml(renderHtml("overview", edition, review, archiveEntries, "../"));
  await fs.writeFile(path.join(issuesDir, "latest.html"), issueHtml);
  await fs.writeFile(path.join(issuesDir, `${edition.runDate}.html`), issueHtml);
  console.log(`Rendered edition ${edition.runDate}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
