import path from "node:path";
import { editionsDir, reviewsDir } from "./config.js";
import { absoluteUrl, editionDate, ensureDir, readJson, writeJson } from "./utils.js";

const bannedPhrases = [
  "investors are closely watching",
  "in today's fast-paced market",
  "it remains to be seen",
  "only time will tell",
  "game changer",
  "market participants are digesting"
];

function deterministicReview(edition) {
  const blockers = [];
  const warnings = [];

  if (edition.moves.length > 5) blockers.push("Edition has more than five main items.");
  if (!edition.moves.length) warnings.push("No selected moves cleared the evidence bar; quiet edition is allowed.");
  const reviewed = new Map((edition.moves || []).map((move) => [move.id, move]));
  for (const [key, section] of Object.entries(edition.sections || {})) {
    if ((section.items || []).length > 3) blockers.push(`${key}: section has more than three items.`);
    for (const item of section.items || []) reviewed.set(item.id, item);
    for (const [segmentKey, segment] of Object.entries(section.segments || {})) {
      if ((segment.items || []).length > 2) blockers.push(`${key}.${segmentKey}: segment has more than two items.`);
      for (const item of segment.items || []) reviewed.set(item.id, item);
    }
  }

  for (const move of reviewed.values()) {
    if (!["LIVE", "FRESH", "TODAY", "BACKGROUND"].includes(move.freshnessStatus)) {
      blockers.push(`${move.title}: invalid freshness status.`);
    }
    if (move.freshnessStatus === "BACKGROUND") {
      blockers.push(`${move.title}: background item cannot drive the main tape.`);
    }
    if (!move.sourceTrail?.length || move.sourceTrail.some((source) => !absoluteUrl(source.url))) {
      blockers.push(`${move.title}: missing source trail URL.`);
    }
    if (!move.editorialLane || !["macro", "markets", "deals", "private_markets"].includes(move.editorialLane)) {
      blockers.push(`${move.title}: missing valid editorial lane.`);
    }
    if (!move.summary || String(move.summary).length < 80) {
      blockers.push(`${move.title}: summary is too thin.`);
    }
    if (!move.longform?.sections?.length || move.longform.sections.length < 5) {
      blockers.push(`${move.title}: longform sections are missing or too short.`);
    }
    for (const section of move.longform?.sections || []) {
      if (!section.heading || !section.body || String(section.body).length < 120) {
        blockers.push(`${move.title}: longform section ${section.id || section.heading || "unknown"} is too thin.`);
      }
    }
    for (const field of ["whatHappened", "whatMoved", "whyItMoved", "valuationImpact", "financingImplication", "sectorReadThrough", "watchNext"]) {
      if (!move[field] || String(move[field]).length < 30) {
        blockers.push(`${move.title}: ${field} is too thin.`);
      }
    }
    if (move.visual) {
      if (move.visual.type === "line-chart") {
        if (!move.visual.sourceNote || !move.visual.series?.length) blockers.push(`${move.title}: chart visual is missing source metadata.`);
        for (const series of move.visual.series || []) {
          if (!absoluteUrl(series.url) || !series.fetchedAt || !series.observations?.length) {
            blockers.push(`${move.title}: chart series ${series.id || series.label} is missing URL, fetched time, or observations.`);
          }
        }
      } else if (!move.visual.sourceTrail?.length || move.visual.sourceTrail.some((source) => !absoluteUrl(source.url))) {
        blockers.push(`${move.title}: non-chart visual is missing source trail.`);
      }
    }
    if (move.editorialLane === "private_markets" && !/SEC|FRED|Reuters|CNBC|Yahoo|MarketWatch|AP|Newswire|Investor|Relations|Capital|KKR|Blackstone|Apollo|Blue Owl|Ares|filing/i.test((move.sourceTrail || []).map((source) => `${source.source} ${source.url}`).join(" "))) {
      blockers.push(`${move.title}: private-market item needs a reputable public source.`);
    }
    if (typeof move.parallel === "string") {
      blockers.push(`${move.title}: parallel must be structured with precedent, outcome, similarity, difference, so-what, and sources.`);
    } else {
      for (const field of ["precedent", "outcome", "whatRhymes", "whatDiffers", "soWhat"]) {
        if (!move.parallel?.[field] || String(move.parallel[field]).length < 30) {
          blockers.push(`${move.title}: parallel.${field} is too thin.`);
        }
      }
      if (!move.parallel?.sourceTrail?.length || move.parallel.sourceTrail.some((source) => !absoluteUrl(source.url))) {
        blockers.push(`${move.title}: parallel is missing source trail URL.`);
      }
      const companyDriven = /company|stock|server|ai|deal|stake|revenue|shares|merger|acquisition/i.test(move.title);
      const hasNamedCompany = /\b[A-Z][A-Za-z&.-]+(?:\s+[A-Z][A-Za-z&.-]+)*\b/.test(move.parallel.precedent || "");
      if (companyDriven && !hasNamedCompany) {
        blockers.push(`${move.title}: company-driven parallel needs specific company names.`);
      }
    }
    const combined = Object.values(move).join(" ").toLowerCase();
    for (const phrase of bannedPhrases) {
      if (combined.includes(phrase)) blockers.push(`${move.title}: vague phrase "${phrase}" is not allowed.`);
    }
  }

  return { blockers, warnings };
}

async function optionalOpenAiReview(edition) {
  if (!process.env.OPENAI_API_KEY) return null;
  const prompt = [
    "Review this finance brief as a blocking banker-grade editor.",
    "Return compact JSON with blockers and warnings arrays.",
    "Block stale today claims, unsupported causality, generic AI prose, missing source trails, and forced analysis.",
    JSON.stringify(edition)
  ].join("\n\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: prompt,
      text: { format: { type: "json_object" } }
    })
  });
  if (!response.ok) throw new Error(`OpenAI review failed: ${response.status}`);
  const payload = await response.json();
  const text = payload.output_text || payload.output?.flatMap((item) => item.content || []).map((item) => item.text).join("\n");
  return JSON.parse(text);
}

async function main() {
  const runDate = process.env.BRIEF_DATE || editionDate();
  await ensureDir(reviewsDir);
  const editionFile = path.join(editionsDir, `${runDate}.json`);
  const edition = await readJson(editionFile);
  const local = deterministicReview(edition);
  const ai = await optionalOpenAiReview(edition);
  const blockers = [...local.blockers, ...(ai?.blockers || [])];
  const warnings = [...local.warnings, ...(ai?.warnings || [])];
  const review = {
    runDate,
    reviewedAt: new Date().toISOString(),
    status: blockers.length ? "BLOCKED" : "APPROVED",
    reviewers: {
      deterministic: local,
      openai: ai || { skipped: true, reason: "OPENAI_API_KEY not configured" }
    },
    blockers,
    warnings
  };

  edition.review = { status: review.status, reviewedAt: review.reviewedAt, blockerCount: blockers.length, warningCount: warnings.length };
  await writeJson(path.join(reviewsDir, `${runDate}.json`), review);
  await writeJson(editionFile, edition);
  await writeJson(path.join(editionsDir, "latest.json"), edition);

  if (blockers.length) {
    console.error(`Review blocked edition ${runDate}:\n- ${blockers.join("\n- ")}`);
    process.exit(1);
  }
  console.log(`Review approved edition ${runDate}; warnings: ${warnings.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
