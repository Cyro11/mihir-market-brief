import { createHash } from "node:crypto";
import {
  INTELLIGENCE_SCHEMA_VERSION,
  RETAINED_CONTENT_POLICY,
  isStrictIsoUtcTimestamp,
  stableId,
  validateIntelligenceArtifact,
  verifyEvidenceAssertion
} from "./intelligence-contracts.js";

function hash(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

// This is deliberately a feed-to-authority-to-family allowlist, not a list of
// domains or words which generally look governmental. Adding a feed here is
// an editorial trust-boundary change.
export const OFFICIAL_MACRO_SOURCE_ALLOWLIST = Object.freeze(Object.assign(Object.create(null), {
  "bls-cpi": Object.freeze({ canonicalUrl: "https://www.bls.gov/news.release/cpi.nr0.htm", releaseFamilies: Object.freeze(["cpi"]) }),
  "bls-ppi": Object.freeze({ canonicalUrl: "https://www.bls.gov/news.release/ppi.nr0.htm", releaseFamilies: Object.freeze(["ppi"]) }),
  "bls-employment": Object.freeze({ canonicalUrl: "https://www.bls.gov/news.release/empsit.nr0.htm", releaseFamilies: Object.freeze(["employment"]) })
}));

function canonicalReleaseFamily(value, fallback = "official_macro_release") {
  const explicitFamily = clean(value.releaseFamily).toLowerCase();
  if (["cpi", "ppi", "pce", "employment"].includes(explicitFamily)) return explicitFamily;
  const text = `${value.name || ""} ${value.title || ""} ${value.feedId || ""} ${(value.topics || []).join(" ")}`;
  if (/personal income|personal consumption expenditures|outlays|\bpce\b/i.test(text)) return "pce";
  if (/producer price|\bppi\b/i.test(text)) return "ppi";
  if (/employment situation|nonfarm payroll|employment|payroll|unemployment|\bjobs\b/i.test(text)) return "employment";
  if (/consumer price|\bcpi\b/i.test(text)) return "cpi";
  if (/inflation/i.test(text)) return "cpi";
  return fallback;
}

function declaredReleaseFamily(value) {
  const explicitFamily = clean(value.releaseFamily).toLowerCase();
  if (["cpi", "ppi", "pce", "employment"].includes(explicitFamily)) return explicitFamily;
  const text = `${value.name || ""} ${value.title || ""}`;
  if (/personal income|personal consumption expenditures|outlays|\bpce\b/i.test(text)) return "pce";
  if (/producer price|\bppi\b/i.test(text)) return "ppi";
  if (/employment situation|nonfarm payroll|payroll|unemployment|\bjobs\b/i.test(text)) return "employment";
  if (/consumer price|\bcpi\b/i.test(text)) return "cpi";
  return null;
}

function macroClass(item) {
  return canonicalReleaseFamily(item);
}

function authorityClass(item) {
  return item.sourceType === "official" ? "primary_official" : "secondary_report";
}

function riskForFact(text) {
  return /\d|percent|%|million|billion|trillion/i.test(text) ? "R2" : "R1";
}

function calendarFamily(event) {
  return canonicalReleaseFamily(event, null);
}

function releaseDate(value) {
  return isStrictIsoUtcTimestamp(value) ? value.slice(0, 10) : null;
}

function findCalendarEvent(item, events = []) {
  const kind = macroClass(item);
  const date = releaseDate(item.publishedAt);
  const matches = events.filter((event) => calendarFamily(event) === kind && releaseDate(event.scheduledFor) === date);
  if (matches.length === 1) return { event: matches[0], limitation: null };
  return { event: null, limitation: matches.length > 1
    ? `Calendar matching failed closed: ${matches.length} ${kind} events were scheduled on ${date}.`
    : `No unique exact-date ${kind} calendar event matched the ${date} publication.` };
}

function usableValue(value, event) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if ((typeof value.value !== "number" && typeof value.value !== "string") || (typeof value.value === "number" && !Number.isFinite(value.value)) || (typeof value.value === "string" && !value.value.trim())) return null;
  if (!clean(value.unit) || !clean(value.period)) return null;
  return { value: value.value, unit: clean(value.unit), period: clean(value.period), source: clean(event.source), eventId: clean(event.id), scheduledFor: new Date(event.scheduledFor).toISOString() };
}

function baselineFor(match) {
  const empty = { eventMatched: false, consensusAvailable: false, priorAvailable: false, consensus: null, prior: null, limitation: match.limitation };
  if (!match.event) return empty;
  const event = match.event;
  if (!clean(event.id) || !clean(event.source) || !releaseDate(event.scheduledFor)) return { ...empty, limitation: "The matched calendar event lacked required id, source, or scheduledFor metadata." };
  const consensus = usableValue(event.consensus, event);
  const prior = usableValue(event.prior, event);
  if (consensus && prior && (consensus.unit !== prior.unit || consensus.period !== prior.period)) return { ...empty, eventMatched: true, limitation: "Consensus and prior were withheld because their unit or period metadata was incompatible." };
  return { eventMatched: true, consensusAvailable: Boolean(consensus), priorAvailable: Boolean(prior), consensus, prior, limitation: consensus || prior ? null : "The matched calendar event did not provide usable consensus or prior value metadata." };
}

function mechanismFor(kind) {
  const mechanisms = {
    cpi: [
      "Separate the headline reading from core and major component contributions.",
      "Translate persistence into the expected Federal Reserve policy path rather than treating one print as the whole trend.",
      "Check the two-year Treasury yield and rate-sensitive equity multiples for confirmation before attributing the market move."
    ],
    ppi: [
      "Identify whether producer-price pressure is concentrated in goods, services, or trade margins.",
      "Assess whether firms can pass the pressure through to consumer prices or must absorb it in margins.",
      "Check Treasury yields, inflation expectations, and margin-sensitive sectors for confirmation."
    ],
    employment: [
      "Read payroll growth together with unemployment, participation, hours, wages, and revisions.",
      "Translate labor-market balance into wage and services-inflation pressure.",
      "Check the front end of the Treasury curve for the policy-path repricing."
    ],
    pce: [
      "Separate income, spending, savings, headline inflation, and core inflation.",
      "Assess whether demand and inflation are moving in a combination consistent with the Federal Reserve's expected path.",
      "Check Treasury yields and rate-sensitive assets for confirmation."
    ],
    official_macro_release: [
      "Identify the change against the prior trend and any available consensus.",
      "Map the release into growth, inflation, and policy expectations.",
      "Use cross-asset reaction as a check, not proof, of the interpretation."
    ]
  };
  return mechanisms[kind];
}

function technicalConceptFor(kind) {
  return {
    cpi: "Core inflation: inflation excluding food and energy, used to study persistence even though households still pay the excluded prices.",
    ppi: "Pass-through: the extent to which changes in producers' input or selling prices reach consumer prices or corporate margins.",
    employment: "Labor-market slack: unused labor capacity, assessed through unemployment, participation, hours, and related measures—not payrolls alone.",
    pce: "Core PCE inflation: the Federal Reserve's preferred underlying inflation gauge, built from a broader and differently weighted consumption basket than CPI.",
    official_macro_release: "Reaction function: the way policymakers are likely to adjust policy when growth, inflation, or financial conditions change."
  }[kind];
}

function conciseFact(value, max = 210) {
  const withoutReleaseHeader = clean(clean(value).replace(/^[A-Z][A-Z0-9 –—-]{8,}(?=\s+(?:The|Total|Nonfarm|Real|Personal)\b)/, ""));
  const sentence = withoutReleaseHeader.match(/^.*?[.!?](?=\s|$)/)?.[0] || withoutReleaseHeader;
  if (sentence.length <= max) return sentence;
  return `${sentence.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

function formatValue(value) {
  return `${value.value} ${value.unit} ${value.period}`;
}

function speakingBaseline(baseline) {
  if (baseline.consensusAvailable && baseline.consensus) {
    const prior = baseline.priorAvailable && baseline.prior ? `; the prior reading was ${formatValue(baseline.prior)}` : "";
    return `Consensus was ${formatValue(baseline.consensus)}${prior}.`;
  }
  if (baseline.priorAvailable && baseline.prior) return `The prior reading was ${formatValue(baseline.prior)}; no usable consensus estimate was available.`;
  return "No usable consensus estimate was available in the approved inputs.";
}

function makeSpeakingLadder({ speakingLadderId, storyId, claimIds, title, facts, baseline, kind }) {
  const first = conciseFact(facts[0] || title);
  const second = conciseFact(facts[1] || "The component detail is needed before drawing a strong policy conclusion.");
  const judgment = !baseline.consensusAvailable || !baseline.consensus
    ? "The disciplined read is to focus on the composition until a usable consensus estimate is attached."
    : "The key judgment is whether the comparison with expectations and the component mix change the policy path.";
  const likelyChallenge = kind === "cpi"
    ? "Was the inflation change broad-based or driven by volatile components, and what did the core measure do?"
    : kind === "employment"
      ? "Did the headline payroll number agree with unemployment, participation, hours, wages, and revisions?"
      : "Which components drove the headline, and do they change the underlying trend rather than just one month's noise?";
  return {
    schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
    type: "SpeakingLadder",
    speakingLadderId,
    storyId,
    claimIds,
    twentySecond: `${first} ${judgment}`,
    sixtySecond: `${first} ${second} ${speakingBaseline(baseline)} The decision-useful question is whether the composition changes the expected policy path and whether the front end of the Treasury curve confirms that interpretation.`,
    likelyChallenge,
    defensibleResponse: "I would anchor the answer in the published components and revisions, then check market confirmation. A different component mix, meaningful revisions, or a conflicting rates move would weaken the initial interpretation; one release is not a complete trend.",
    technicalConcept: technicalConceptFor(kind)
  };
}

export function isOfficialMacroRelease(item) {
  try {
    if (!item || item.sourceType !== "official" || !Object.hasOwn(OFFICIAL_MACRO_SOURCE_ALLOWLIST, item.feedId)) return false;
    const approval = OFFICIAL_MACRO_SOURCE_ALLOWLIST[item.feedId];
    // Parse first, then require the exact configured lexical spelling. Parsed
    // equality alone accepts default ports, Unicode separators, and dot paths.
    new URL(item.url);
    if (item.url !== approval.canonicalUrl) return false;
    const family = declaredReleaseFamily(item);
    return family !== null && approval.releaseFamilies.includes(family);
  } catch {
    return false;
  }
}

export function buildOfficialMacroIntelligence(item, options = {}) {
  if (!isOfficialMacroRelease(item)) throw new TypeError("Official macro intelligence requires an approved official macro release");
  if (!item.url || !item.publishedAt || !item.fetchedAt) throw new TypeError("Official macro release is missing URL or timestamps");
  if (!isStrictIsoUtcTimestamp(item.publishedAt) || !isStrictIsoUtcTimestamp(item.fetchedAt)) throw new TypeError("Official macro release timestamps must be canonical ISO-8601 UTC timestamps");
  const facts = (item.facts || []).map(clean).filter(Boolean);
  if (facts.length < 2) throw new TypeError("Official macro release requires at least two extracted facts");

  const generatedAt = options.generatedAt || item.fetchedAt;
  if (!isStrictIsoUtcTimestamp(generatedAt)) throw new TypeError("generatedAt must be a canonical ISO-8601 UTC timestamp");
  const editionId = options.editionId || options.runDate || generatedAt.slice(0, 10);
  const kind = macroClass(item);
  // Canonical retained representation v1: labeled cleaned title and summary,
  // then labeled cleaned facts in their stable input order.
  const retainedLines = [`Title: ${clean(item.title)}`, `Summary: ${clean(item.summary)}`, ...facts.map((fact, index) => `Fact ${index + 1}: ${fact}`)];
  const retainedContent = retainedLines.join("\n");
  const contentHash = hash(retainedContent);
  const documentId = stableId("doc", item.url, item.publishedAt, contentHash);
  const retrievalId = stableId("retrieval", item.url, item.fetchedAt);
  const storyId = stableId("story", kind, item.publishedAt.slice(0, 10), item.title);
  const dossierRevision = 1;
  const dossierId = stableId("dossier", storyId, dossierRevision);
  const briefId = stableId("brief", storyId, dossierRevision);
  const speakingLadderId = stableId("speaking", storyId, dossierRevision);

  const sourceDocument = {
    schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
    type: "SourceDocument",
    documentId,
    retrievalId,
    sourceId: item.feedId || item.source,
    canonicalUrl: item.url,
    sourceType: item.sourceType,
    evidentiaryRole: "establishes_official_release_facts",
    publishedAt: new Date(item.publishedAt).toISOString(),
    fetchedAt: new Date(item.fetchedAt).toISOString(),
    contentHash,
    retainedContent,
    retainedContentPolicy: RETAINED_CONTENT_POLICY.id,
    title: clean(item.title)
  };

  const assertions = facts.map((text, index) => {
    const prefix = `Fact ${index + 1}: `;
    const start = retainedLines.slice(0, index + 2).reduce((length, line) => length + line.length + 1, 0) + prefix.length;
    const assertion = {
    schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
    type: "EvidenceAssertion",
    assertionId: stableId("assertion", documentId, index, text),
    documentId,
    text,
    sourceSpan: { start, end: start + text.length, quote: text, quoteHash: hash(text) },
    supportType: "supports",
    authorityClass: authorityClass(item),
    riskClass: riskForFact(text),
    extractionMethod: "official_release_sentence_extraction",
    reviewStatus: "machine_extracted_unverified"
    };
    if (verifyEvidenceAssertion(sourceDocument, assertion)) assertion.reviewStatus = "machine_checked";
    return assertion;
  });

  const proposition = {
    schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
    type: "CanonicalProposition",
    propositionId: stableId("proposition", storyId, contentHash),
    text: facts.join(" "),
    assertionIds: assertions.map((assertion) => assertion.assertionId),
    contradictionState: "none_observed",
    adjudicationState: "supported_by_primary_source",
    validAt: sourceDocument.publishedAt
  };

  const calendarMatch = findCalendarEvent(item, options.calendarEvents || []);
  const consensusBaseline = baselineFor(calendarMatch);
  const claims = assertions.map((assertion) => ({
    schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
    type: "ArticleClaim",
    claimId: stableId("claim", storyId, assertion.assertionId),
    briefId,
    storyId,
    text: assertion.text,
    riskClass: assertion.riskClass,
    assertionIds: [assertion.assertionId],
    verificationStatus: assertion.reviewStatus === "machine_checked" ? "supported_exact_primary_span" : "machine_extracted_unverified"
  }));

  const dossier = {
    schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
    type: "StoryDossier",
    dossierId,
    storyId,
    dossierRevision,
    storyClass: `official_macro_${kind}`,
    asOf: generatedAt,
    status: "dossier_ready",
    documentIds: [documentId],
    assertionIds: assertions.map((assertion) => assertion.assertionId),
    propositionIds: [proposition.propositionId],
    openQuestions: [
      !consensusBaseline.consensusAvailable ? "Attach an approved consensus estimate before making comparisons with expectations." : null,
      "Did the two-year Treasury yield confirm a change in the expected policy path?",
      "Do revisions or component details change the headline interpretation?"
    ].filter(Boolean),
    contradictions: [],
    evidenceCoverage: {
      primarySource: true,
      extractedFactCount: assertions.length,
      consensusAvailable: consensusBaseline.consensusAvailable,
      marketReactionAvailable: false
    }
  };

  const brief = {
    schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
    type: "ArticleBrief",
    briefId,
    storyId,
    sourceDossierId: dossierId,
    sourceDossierRevision: dossierRevision,
    centralQuestion: `Does ${clean(item.title)} change the expected path for inflation, growth, or Federal Reserve policy?`,
    consensusBaseline,
    newInformation: facts.join(" "),
    mechanismSteps: mechanismFor(kind),
    rivalExplanation: "The apparent signal may be noise from volatile components, revisions, or a market move driven by another contemporaneous catalyst.",
    pricedInStatus: "unknown_without_verified_market_expectations",
    claimIds: claims.map((claim) => claim.claimId),
    editorialBurden: consensusBaseline.consensusAvailable
      ? "Explain the release, the comparison with expectations, the component mix, the policy transmission, and the evidence that would confirm or reject the interpretation. Do not force a longer form."
      : "Explain the release, the component mix, the policy transmission, and the evidence that would confirm or reject the interpretation. Do not force a longer form."
  };

  const speakingLadder = makeSpeakingLadder({ speakingLadderId, storyId, claimIds: claims.map((claim) => claim.claimId), title: clean(item.title), facts, baseline: consensusBaseline, kind });
  const runId = stableId("run", editionId, documentId, generatedAt);
  const runManifest = {
    schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
    type: "RunManifest",
    runId,
    editionId,
    storyId,
    sourceDocumentIds: [documentId],
    assertionIds: assertions.map((assertion) => assertion.assertionId),
    propositionIds: [proposition.propositionId],
    claimIds: claims.map((claim) => claim.claimId),
    dossierId,
    briefId,
    speakingLadderId,
    startedAt: generatedAt,
    completedAt: generatedAt,
    configurationHash: hash(`${INTELLIGENCE_SCHEMA_VERSION}|official_macro_v1`),
    inputDocumentHashes: [contentHash],
    stageStatuses: [
      { stage: "source_document", status: "completed" },
      { stage: "evidence_assertions", status: "completed" },
      { stage: "canonical_proposition", status: "completed" },
      { stage: "story_dossier", status: "completed" },
      { stage: "article_brief", status: "completed" },
      { stage: "speaking_ladder", status: "completed" },
      { stage: "claim_verification", status: "completed" }
    ],
    usage: { modelCalls: 0, searchQueries: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 }
  };

  return validateIntelligenceArtifact({
    schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
    type: "IntelligenceArtifact",
    sourceDocument,
    assertions,
    propositions: [proposition],
    dossier,
    claims,
    brief,
    speakingLadder,
    runManifest
  });
}

export function buildOfficialMacroArtifacts(items, options = {}) {
  return (items || []).filter(isOfficialMacroRelease).map((item) => buildOfficialMacroIntelligence(item, options));
}

function safeFailureMetadata(item, key) {
  try {
    return item?.[key] || null;
  } catch {
    return null;
  }
}

const UNKNOWN_FAILURE_MESSAGE = "Unknown error";

function safeFailureMessage(error) {
  try {
    if (error instanceof Error) {
      try {
        return typeof error.message === "string" ? error.message : String(error.message);
      } catch {
        return UNKNOWN_FAILURE_MESSAGE;
      }
    }
    return String(error);
  } catch {
    return UNKNOWN_FAILURE_MESSAGE;
  }
}

export function buildOfficialMacroIntelligenceBatch(items, options = {}) {
  const artifacts = [];
  const failures = [];
  for (const item of (items || [])) {
    try {
      if (!isOfficialMacroRelease(item)) continue;
      artifacts.push(buildOfficialMacroIntelligence(item, options));
    } catch (error) {
      failures.push({
        itemId: safeFailureMetadata(item, "id"),
        sourceId: safeFailureMetadata(item, "feedId") || safeFailureMetadata(item, "source"),
        error: safeFailureMessage(error)
      });
    }
  }
  return { artifacts, failures };
}
