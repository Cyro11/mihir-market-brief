import path from "node:path";
import { fileURLToPath } from "node:url";
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

const publicInternalPhrases = [
  "This was selected because",
  "Current reputable-market headline",
  "thin RSS item",
  "source URL, timestamp",
  "market-moving public-tape keywords",
  "evidence bar",
  "cleared the source",
  "cleared the evidence",
  "Generated edition"
];

const repeatedIssuePhrases = [
  "The useful question",
  "The useful read",
  "The main move is"
];

const genericSpecificityWords = new Set([
  "the", "this", "that", "market", "markets", "macro", "deal", "deals", "private", "public", "credit", "equity",
  "story", "signal", "signals", "source", "sources", "company", "companies", "sector", "sectors", "move", "moves",
  "investors", "bankers", "sponsors", "lenders", "headline", "headlines", "today", "read", "useful", "main",
  "fresh", "breaking", "background", "official", "reputable", "capital", "finance", "financial", "the main", "plain", "english"
]);

function normalizedTokens(value) {
  return new Set(String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9%$\s.-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 4));
}

function overlapRatio(a, b) {
  const left = normalizedTokens(a);
  const right = normalizedTokens(b);
  if (!left.size || !right.size) return 0;
  const overlap = [...left].filter((token) => right.has(token)).length;
  return overlap / Math.min(left.size, right.size);
}

function startsWithSameClause(a, b) {
  const normalize = (value) => String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
  const left = normalize(a).slice(0, 140);
  const right = normalize(b).slice(0, 140);
  return left.length > 80 && right.length > 80 && (left.startsWith(right) || right.startsWith(left));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function addVisibleText(entries, pathLabel, value) {
  if (value === null || value === undefined) return;
  if (["string", "number"].includes(typeof value)) entries.push({ path: pathLabel, text: String(value) });
}

function visibleMoveTexts(move, prefix = move.title || move.id || "move") {
  const entries = [];
  for (const field of [
    "title", "dek", "summary", "whatHappened", "whatMoved", "whyItMoved", "valuationImpact",
    "financingImplication", "sectorReadThrough", "watchNext", "ibAngle", "interviewLine", "readerSummary"
  ]) addVisibleText(entries, `${prefix}.${field}`, move[field]);
  for (const [field, value] of Object.entries(move.parallel || {})) {
    if (field !== "sourceTrail") addVisibleText(entries, `${prefix}.parallel.${field}`, value);
  }
  for (const section of move.longform?.sections || []) {
    addVisibleText(entries, `${prefix}.longform.${section.id || section.heading || "section"}.heading`, section.heading);
    addVisibleText(entries, `${prefix}.longform.${section.id || section.heading || "section"}.body`, section.body);
  }
  if (move.visual) {
    for (const field of ["title", "subtitle", "relevanceNote", "axisTitle", "visualSource", "sourceNote"]) {
      addVisibleText(entries, `${prefix}.visual.${field}`, move.visual[field]);
    }
    for (const item of move.visual.items || []) {
      addVisibleText(entries, `${prefix}.visual.${item.id || item.label || "item"}.label`, item.label);
      addVisibleText(entries, `${prefix}.visual.${item.id || item.label || "item"}.displayValue`, item.displayValue);
    }
  }
  for (const link of move.relatedLinks || []) addVisibleText(entries, `${prefix}.relatedLinks.${link.label || "link"}`, link.label);
  return entries;
}

function visibleEditionTexts(edition) {
  const entries = [];
  for (const field of ["title", "dek", "summary", "lead", "description"]) addVisibleText(entries, `edition.${field}`, edition[field]);
  for (const move of edition.moves || []) entries.push(...visibleMoveTexts(move));
  for (const [key, section] of Object.entries(edition.sections || {})) {
    for (const field of ["title", "heading", "summary", "description"]) addVisibleText(entries, `section.${key}.${field}`, section[field]);
    for (const item of section.items || []) entries.push(...visibleMoveTexts(item, `section.${key}.${item.title || item.id || "item"}`));
    for (const [segmentKey, segment] of Object.entries(section.segments || {})) {
      for (const field of ["title", "heading", "summary", "description"]) addVisibleText(entries, `section.${key}.${segmentKey}.${field}`, segment[field]);
      for (const item of segment.items || []) entries.push(...visibleMoveTexts(item, `section.${key}.${segmentKey}.${item.title || item.id || "item"}`));
    }
  }
  return entries;
}

function phraseCount(text, phrase) {
  return (String(text || "").match(new RegExp(escapeRegExp(phrase), "gi")) || []).length;
}

function hasConcreteSpecificity(text) {
  const value = String(text || "");
  if (/\b\d+(?:\.\d+)?\s?(?:%|bps?|x|million|billion|trillion|mn|bn|tn|m|b)\b|[$€£]\s?\d|\b[A-Z]{2,6}\b/.test(value)) return true;
  const entities = value.match(/\b[A-Z][A-Za-z&.-]+(?:\s+[A-Z][A-Za-z&.-]+){0,4}\b/g) || [];
  return entities.some((entity) => {
    const words = entity.toLowerCase().split(/\s+/).filter(Boolean);
    return words.length && words.some((word) => !genericSpecificityWords.has(word));
  });
}

function sourceNames(move) {
  return (move.sourceTrail || []).map((source) => String(source.source || source.name || "").trim()).filter(Boolean);
}

function hasSourceSpecificFacts(move) {
  const longform = (move.longform?.sections || []).map((section) => section.body).join(" ");
  if (!longform) return false;
  if (/\b\d+(?:\.\d+)?\s?(?:%|bps?|x|million|billion|trillion|mn|bn|tn|m|b)\b|[$€£]\s?\d/.test(longform)) return true;
  return sourceNames(move).some((name) => name.split(/\s+/)
    .filter((token) => token.length > 2 && !genericSpecificityWords.has(token.toLowerCase()))
    .some((token) => new RegExp(`\\b${escapeRegExp(token)}\\b`, "i").test(longform)));
}

function isPrimaryOrOfficialSource(source = {}) {
  const haystack = `${source.source || ""} ${source.name || ""} ${source.type || ""} ${source.sourceType || ""} ${source.kind || ""} ${source.url || ""}`;
  return /\b(primary|official|company|filing|investor relations|ir\.|sec|federal reserve|fed|bls|bea|treasury|census|press release|newsroom)\b/i.test(haystack);
}

function isSeverelyThinOneSource(move) {
  const combined = `${move.summary || ""} ${move.whatHappened || ""}`;
  return /thin RSS item|current reputable-market headline|source URL, timestamp|market-moving public-tape keywords/i.test(combined)
    || (String(move.summary || "").length < 140 && !hasConcreteSpecificity(combined));
}

export function deterministicReview(edition) {
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
    if (!move.editorialLane || !["breaking", "macro", "markets", "deals", "private_markets"].includes(move.editorialLane)) {
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
      if (startsWithSameClause(section.body, move.summary)) {
        blockers.push(`${move.title}: longform section ${section.id || section.heading || "unknown"} repeats the summary opening instead of adding analysis.`);
      } else if (overlapRatio(section.body, move.summary) > 0.82) {
        warnings.push(`${move.title}: longform section ${section.id || section.heading || "unknown"} is very close to the summary; add story-specific analysis.`);
      }
    }
    const longformSections = move.longform?.sections || [];
    for (let i = 0; i < longformSections.length; i += 1) {
      for (let j = i + 1; j < longformSections.length; j += 1) {
        if (overlapRatio(longformSections[i].body, longformSections[j].body) > 0.86) {
          warnings.push(`${move.title}: longform sections ${longformSections[i].id || i + 1} and ${longformSections[j].id || j + 1} look repetitive.`);
        }
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
    if (!hasConcreteSpecificity(`${move.title || ""} ${move.summary || ""} ${move.whatHappened || ""}`)) {
      blockers.push(`${move.title}: top move lacks a concrete number, ticker, or named entity beyond generic lane language.`);
    }
    if (!hasSourceSpecificFacts(move)) {
      blockers.push(`${move.title}: longform needs source-specific facts, names, or numbers instead of generic analysis.`);
    }
    const recruitingFields = ["ibAngle", "interviewLine", "readerSummary"];
    const presentRecruitingFields = recruitingFields.filter((field) => move[field] !== undefined && move[field] !== null && String(move[field]).trim());
    if (presentRecruitingFields.length && presentRecruitingFields.length < recruitingFields.length) {
      blockers.push(`${move.title}: narrative recruiting fields are partially present; include ibAngle, interviewLine, and readerSummary together.`);
    } else if (presentRecruitingFields.length === recruitingFields.length) {
      for (const field of recruitingFields) {
        if (String(move[field]).trim().length < 30) blockers.push(`${move.title}: ${field} is too thin to be useful for recruiting prep.`);
      }
    } else {
      warnings.push(`${move.title}: add ibAngle, interviewLine, and readerSummary when narrative fields merge so the item is useful for recruiting prep.`);
    }
  }

  for (const phrase of publicInternalPhrases) {
    for (const entry of visibleEditionTexts(edition)) {
      if (entry.text.toLowerCase().includes(phrase.toLowerCase())) {
        blockers.push(`${entry.path}: contains internal pipeline phrase "${phrase}".`);
      }
    }
  }

  const issueText = visibleEditionTexts(edition).map((entry) => entry.text).join("\n");
  for (const phrase of repeatedIssuePhrases) {
    const count = phraseCount(issueText, phrase);
    if (count > 1) blockers.push(`Issue repeats robotic phrase "${phrase}" ${count} times; vary the framing and add story-specific language.`);
  }

  const lead = edition.moves?.[0];
  if (lead && (lead.sourceTrail || []).length === 1 && !isPrimaryOrOfficialSource(lead.sourceTrail[0])) {
    const message = `${lead.title}: lead story has only one non-primary/non-official source; add a corroborating source or caveat the lead.`;
    if (isSeverelyThinOneSource(lead)) blockers.push(`${message} The summary is too thin or derived from pipeline/RSS language.`);
    else warnings.push(message);
  }

  return { blockers, warnings };
}

export async function optionalOpenAiReview(edition) {
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

export function composeReview(runDate, local, ai, options = {}) {
  const blockers = [...local.blockers, ...(ai?.blockers || [])];
  const warnings = [...local.warnings, ...(ai?.warnings || [])];
  const requireAiReview = options.requireAiReview ?? process.env.REQUIRE_AI_REVIEW === "1";
  if (requireAiReview && !ai) blockers.push("OpenAI review was required by REQUIRE_AI_REVIEW=1 but skipped because OPENAI_API_KEY is not configured.");
  return {
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
}

async function main() {
  const runDate = process.env.BRIEF_DATE || editionDate();
  await ensureDir(reviewsDir);
  const editionFile = path.join(editionsDir, `${runDate}.json`);
  const edition = await readJson(editionFile);
  const local = deterministicReview(edition);
  const ai = await optionalOpenAiReview(edition);
  const review = composeReview(runDate, local, ai);
  const { blockers, warnings } = review;

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

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
