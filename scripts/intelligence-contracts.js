import { createHash } from "node:crypto";

export const INTELLIGENCE_SCHEMA_VERSION = "1.0.0";

export const STORY_STATES = Object.freeze([
  "discovered",
  "normalized",
  "clustered",
  "dossier_ready",
  "eligible",
  "selected",
  "researched",
  "drafted",
  "verified",
  "approved",
  "published",
  "held",
  "rejected",
  "superseded",
  "correction_required",
  "failed_retryable",
  "failed_terminal"
]);

export const CLAIM_RISK_CLASSES = Object.freeze(["R0", "R1", "R2", "R3"]);
export const SOURCE_TYPES = Object.freeze(["official", "reputable", "secondary", "derived"]);
export const ASSERTION_REVIEW_STATUSES = Object.freeze(["machine_extracted_unverified", "machine_checked"]);
export const CLAIM_VERIFICATION_STATUSES = Object.freeze(["machine_extracted_unverified", "supported_exact_primary_span"]);
export const STORY_CLASSES = Object.freeze(["official_macro_cpi", "official_macro_ppi", "official_macro_employment"]);
export const ASSERTION_AUTHORITY_CLASSES = Object.freeze(["primary_official"]);
export const RUN_STAGES = Object.freeze(["source_document", "evidence_assertions", "canonical_proposition", "story_dossier", "article_brief", "speaking_ladder", "claim_verification"]);
export const RUN_STAGE_STATUSES = Object.freeze(["completed"]);
const RESERVED_IDS = new Set(["__proto__", "prototype", "constructor", "toString", "toLocaleString", "valueOf", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable"]);
const ID_PATTERN = /^(?:doc|retrieval|assertion|proposition|story|dossier|brief|claim|speaking|run)_[a-f0-9]{20}$/;
// External IDs are printable ASCII and case-sensitive upstream identifiers.
const EXTERNAL_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function requireId(value, label, prefix) {
  requireString(value, label);
  if (RESERVED_IDS.has(value) || !ID_PATTERN.test(value) || (prefix && !value.startsWith(`${prefix}_`))) throw new TypeError(`${label} must be a valid namespaced ID`);
}

function requireExternalId(value, label) {
  requireString(value, label);
  if (RESERVED_IDS.has(value) || !EXTERNAL_ID_PATTERN.test(value)) throw new TypeError(`${label} must be a valid external ID`);
}

export const RETAINED_CONTENT_POLICY = Object.freeze({
  id: "canonical_labeled_title_summary_and_cleaned_facts_v1",
  description: "Canonical retained feed representation made from the labeled, cleaned title, summary, and facts in input order. contentHash and sourceSpan.quoteHash are SHA-256 hashes of UTF-8 bytes. sourceSpan.start and sourceSpan.end are JavaScript UTF-16 code-unit offsets. supported_exact_primary_span means exact against this cleaned canonical retained feed representation, not the raw upstream webpage or PDF."
});

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  let prototype;
  try { prototype = Object.getPrototypeOf(value); } catch { throw new TypeError(`${label} must be a plain-data object`); }
  // JSON-style records permit normal and null prototypes, never class instances.
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be a plain-data object`);
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
}

function exactKeys(value, keys, label) {
  requireObject(value, label);
  let actual;
  try { actual = Reflect.ownKeys(value); } catch { throw new TypeError(`${label} has an invalid shape`); }
  if (actual.some((key) => typeof key !== "string")) throw new TypeError(`${label} has an invalid shape`);
  actual.sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new TypeError(`${label} has an invalid shape`);
}

function stringIds(value, label, nonEmpty = false, prefix) {
  requireArray(value, label);
  if (nonEmpty && !value.length) throw new TypeError(`${label} must not be empty`);
  const seen = new Set();
  for (const id of value) {
    requireId(id, `${label} item`, prefix);
    if (seen.has(id)) throw new TypeError(`${label} contains a duplicate ID`);
    seen.add(id);
  }
}

function uniqueMap(items, key, label) {
  const map = new Map();
  for (const item of items) {
    const id = item[key];
    if (map.has(id)) throw new TypeError(`${label} contains duplicate ID`);
    map.set(id, item);
  }
  return map;
}

function exactCoverage(ids, known, label) {
  if (ids.length !== known.size || ids.some((id) => !known.has(id))) throw new TypeError(`${label} must exactly cover its owned collection`);
}

function exactOrderedCoverage(ids, expected, label) {
  if (ids.length !== expected.length || ids.some((id, index) => id !== expected[index])) throw new TypeError(`${label} must exactly cover its owned collection in order`);
}

export function isStrictIsoUtcTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function requireIso(value, label) {
  requireString(value, label);
  if (!isStrictIsoUtcTimestamp(value)) throw new TypeError(`${label} must be a canonical ISO-8601 UTC timestamp`);
}

function assertSchema(value, type) {
  requireObject(value, type);
  if (value.schemaVersion !== INTELLIGENCE_SCHEMA_VERSION) {
    throw new TypeError(`${type}.schemaVersion must equal ${INTELLIGENCE_SCHEMA_VERSION}`);
  }
  if (value.type !== type) throw new TypeError(`Expected type ${type}`);
}

export function stableId(prefix, ...parts) {
  const digest = createHash("sha256").update(parts.map((part) => String(part ?? "")).join("\u001f"), "utf8").digest("hex").slice(0, 20);
  return `${prefix}_${digest}`;
}

export function validateSourceDocument(value) {
  assertSchema(value, "SourceDocument");
  exactKeys(value, ["schemaVersion", "type", "documentId", "retrievalId", "sourceId", "canonicalUrl", "sourceType", "evidentiaryRole", "publishedAt", "fetchedAt", "contentHash", "retainedContent", "retainedContentPolicy", "title"], "SourceDocument");
  for (const field of ["documentId", "retrievalId", "sourceId", "canonicalUrl", "sourceType", "publishedAt", "fetchedAt", "contentHash"]) {
    requireString(value[field], `SourceDocument.${field}`);
  }
  requireIso(value.publishedAt, "SourceDocument.publishedAt");
  requireId(value.documentId, "SourceDocument.documentId", "doc");
  requireId(value.retrievalId, "SourceDocument.retrievalId", "retrieval");
  requireExternalId(value.sourceId, "SourceDocument.sourceId");
  requireString(value.title, "SourceDocument.title");
  if (value.evidentiaryRole !== "establishes_official_release_facts") throw new TypeError("SourceDocument.evidentiaryRole is invalid");
  requireIso(value.fetchedAt, "SourceDocument.fetchedAt");
  if (Date.parse(value.publishedAt) > Date.parse(value.fetchedAt)) throw new TypeError("SourceDocument.publishedAt must not follow fetchedAt");
  if (!/^https?:\/\//.test(value.canonicalUrl)) throw new TypeError("SourceDocument.canonicalUrl must be HTTP(S)");
  if (!SOURCE_TYPES.includes(value.sourceType)) throw new TypeError("SourceDocument.sourceType is invalid");
  if (!/^[a-f0-9]{64}$/.test(value.contentHash)) throw new TypeError("SourceDocument.contentHash must be a SHA-256 digest");
  requireString(value.retainedContent, "SourceDocument.retainedContent");
  if (value.retainedContentPolicy !== RETAINED_CONTENT_POLICY.id) throw new TypeError("SourceDocument.retainedContentPolicy is invalid");
  if (sha256(value.retainedContent) !== value.contentHash) throw new TypeError("SourceDocument.contentHash does not match retainedContent");
  return value;
}

// This authenticates the exact retained string; it never reconstructs source
// content from the document's display fields.
function verifyEvidenceAssertionInternal(sourceDocument, assertion, contentHashAlreadyVerified) {
  try {
    if (!sourceDocument || typeof sourceDocument !== "object" || Array.isArray(sourceDocument) ||
        !assertion || typeof assertion !== "object" || Array.isArray(assertion)) return false;
    const retainedContent = sourceDocument.retainedContent;
    const contentHash = sourceDocument.contentHash;
    const sourceDocumentId = sourceDocument.documentId;
    const assertionDocumentId = assertion.documentId;
    const assertionText = assertion.text;
    const locator = assertion.sourceSpan;
    if (typeof retainedContent !== "string" || typeof contentHash !== "string" || !/^[a-f0-9]{64}$/.test(contentHash)) return false;
    if (typeof sourceDocumentId !== "string" || sourceDocumentId.trim().length === 0 || typeof assertionDocumentId !== "string" || assertionDocumentId.trim().length === 0 || assertionDocumentId !== sourceDocumentId || typeof assertionText !== "string") return false;
    if (!locator || typeof locator !== "object" || Array.isArray(locator)) return false;
    const start = locator.start;
    const end = locator.end;
    const quote = locator.quote;
    const quoteHash = locator.quoteHash;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > retainedContent.length) return false;
    if (typeof quote !== "string" || typeof quoteHash !== "string" || !/^[a-f0-9]{64}$/.test(quoteHash)) return false;
    if (retainedContent.slice(start, end) !== quote) return false;
    if ((!contentHashAlreadyVerified && sha256(retainedContent) !== contentHash) || sha256(quote) !== quoteHash) return false;
    return assertionText === quote;
  } catch {
    return false;
  }
}

export function verifyEvidenceAssertion(sourceDocument, assertion) {
  return verifyEvidenceAssertionInternal(sourceDocument, assertion, false);
}

export function validateEvidenceAssertion(value) {
  assertSchema(value, "EvidenceAssertion");
  exactKeys(value, ["schemaVersion", "type", "assertionId", "documentId", "text", "sourceSpan", "supportType", "authorityClass", "riskClass", "extractionMethod", "reviewStatus"], "EvidenceAssertion");
  for (const field of ["assertionId", "documentId", "text", "supportType", "authorityClass"]) {
    requireString(value[field], `EvidenceAssertion.${field}`);
  }
  if (!CLAIM_RISK_CLASSES.includes(value.riskClass)) throw new TypeError("EvidenceAssertion.riskClass is invalid");
  if (!ASSERTION_AUTHORITY_CLASSES.includes(value.authorityClass)) throw new TypeError("EvidenceAssertion.authorityClass is invalid");
  requireId(value.assertionId, "EvidenceAssertion.assertionId", "assertion");
  requireId(value.documentId, "EvidenceAssertion.documentId", "doc");
  if (value.extractionMethod !== "official_release_sentence_extraction") throw new TypeError("EvidenceAssertion.extractionMethod is invalid");
  if (!['supports', 'contradicts', 'contextualizes'].includes(value.supportType)) throw new TypeError("EvidenceAssertion.supportType is invalid");
  requireObject(value.sourceSpan, "EvidenceAssertion.sourceSpan");
  exactKeys(value.sourceSpan, ["start", "end", "quote", "quoteHash"], "EvidenceAssertion.sourceSpan");
  if (!Number.isInteger(value.sourceSpan.start) || value.sourceSpan.start < 0) throw new TypeError("EvidenceAssertion.sourceSpan.start must be a non-negative integer");
  if (!Number.isInteger(value.sourceSpan.end) || value.sourceSpan.end <= value.sourceSpan.start) throw new TypeError("EvidenceAssertion.sourceSpan.end must be greater than start");
  requireString(value.sourceSpan.quote, "EvidenceAssertion.sourceSpan.quote");
  requireString(value.sourceSpan.quoteHash, "EvidenceAssertion.sourceSpan.quoteHash");
  if (!/^[a-f0-9]{64}$/.test(value.sourceSpan.quoteHash)) throw new TypeError("EvidenceAssertion.sourceSpan.quoteHash must be a SHA-256 digest");
  if (!ASSERTION_REVIEW_STATUSES.includes(value.reviewStatus)) throw new TypeError("EvidenceAssertion.reviewStatus is invalid");
  return value;
}

export function validateCanonicalProposition(value) {
  assertSchema(value, "CanonicalProposition");
  exactKeys(value, ["schemaVersion", "type", "propositionId", "text", "assertionIds", "contradictionState", "adjudicationState", "validAt"], "CanonicalProposition");
  requireString(value.propositionId, "CanonicalProposition.propositionId");
  requireId(value.propositionId, "CanonicalProposition.propositionId", "proposition");
  requireString(value.text, "CanonicalProposition.text");
  stringIds(value.assertionIds, "CanonicalProposition.assertionIds", true, "assertion");
  if (!value.assertionIds.length) throw new TypeError("CanonicalProposition requires at least one assertion");
  requireString(value.adjudicationState, "CanonicalProposition.adjudicationState");
  if (value.contradictionState !== "none_observed") throw new TypeError("CanonicalProposition.contradictionState is invalid");
  if (value.adjudicationState !== "supported_by_primary_source") throw new TypeError("CanonicalProposition.adjudicationState is invalid");
  requireIso(value.validAt, "CanonicalProposition.validAt");
  return value;
}

export function validateStoryDossier(value) {
  assertSchema(value, "StoryDossier");
  exactKeys(value, ["schemaVersion", "type", "dossierId", "storyId", "dossierRevision", "storyClass", "asOf", "status", "documentIds", "assertionIds", "propositionIds", "openQuestions", "contradictions", "evidenceCoverage"], "StoryDossier");
  requireId(value.dossierId, "StoryDossier.dossierId", "dossier");
  requireId(value.storyId, "StoryDossier.storyId", "story");
  requireString(value.storyClass, "StoryDossier.storyClass");
  if (!STORY_CLASSES.includes(value.storyClass)) throw new TypeError("StoryDossier.storyClass is invalid");
  requireIso(value.asOf, "StoryDossier.asOf");
  if (!STORY_STATES.includes(value.status)) throw new TypeError("StoryDossier.status is invalid");
  stringIds(value.documentIds, "StoryDossier.documentIds", true, "doc");
  stringIds(value.assertionIds, "StoryDossier.assertionIds", true, "assertion");
  stringIds(value.propositionIds, "StoryDossier.propositionIds", true, "proposition");
  requireArray(value.openQuestions, "StoryDossier.openQuestions");
  value.openQuestions.forEach((item) => requireString(item, "StoryDossier.openQuestions item"));
  requireArray(value.contradictions, "StoryDossier.contradictions");
  if (value.contradictions.length) throw new TypeError("StoryDossier.contradictions must be empty in schema 1.0.0");
  if (!Number.isInteger(value.dossierRevision) || value.dossierRevision < 1) throw new TypeError("StoryDossier.dossierRevision must be a positive integer");
  exactKeys(value.evidenceCoverage, ["primarySource", "extractedFactCount", "consensusAvailable", "marketReactionAvailable"], "StoryDossier.evidenceCoverage");
  if (typeof value.evidenceCoverage.primarySource !== "boolean" || typeof value.evidenceCoverage.consensusAvailable !== "boolean" || typeof value.evidenceCoverage.marketReactionAvailable !== "boolean" || !Number.isInteger(value.evidenceCoverage.extractedFactCount) || value.evidenceCoverage.extractedFactCount < 0) throw new TypeError("StoryDossier.evidenceCoverage has invalid values");
  return value;
}

export function validateArticleBrief(value) {
  assertSchema(value, "ArticleBrief");
  exactKeys(value, ["schemaVersion", "type", "briefId", "storyId", "sourceDossierId", "sourceDossierRevision", "centralQuestion", "consensusBaseline", "newInformation", "mechanismSteps", "rivalExplanation", "pricedInStatus", "claimIds", "editorialBurden"], "ArticleBrief");
  requireId(value.briefId, "ArticleBrief.briefId", "brief");
  requireId(value.storyId, "ArticleBrief.storyId", "story");
  requireId(value.sourceDossierId, "ArticleBrief.sourceDossierId", "dossier");
  if (!Number.isInteger(value.sourceDossierRevision) || value.sourceDossierRevision < 1) throw new TypeError("ArticleBrief.sourceDossierRevision must be a positive integer");
  requireString(value.centralQuestion, "ArticleBrief.centralQuestion");
  requireObject(value.consensusBaseline, "ArticleBrief.consensusBaseline");
  const baseline = value.consensusBaseline;
  const baselineKeys = ["consensus", "consensusAvailable", "eventMatched", "limitation", "prior", "priorAvailable"];
  exactKeys(baseline, baselineKeys, "ArticleBrief.consensusBaseline");
  for (const field of ["eventMatched", "consensusAvailable", "priorAvailable"]) {
    if (typeof baseline[field] !== "boolean") throw new TypeError(`ArticleBrief.consensusBaseline.${field} must be boolean`);
  }
  if (baseline.limitation !== null && (typeof baseline.limitation !== "string" || !baseline.limitation.trim())) throw new TypeError("ArticleBrief.consensusBaseline.limitation must be null or a non-empty string");
  for (const [field, available] of [["consensus", baseline.consensusAvailable], ["prior", baseline.priorAvailable]]) {
    const datum = baseline[field];
    if (available !== (datum !== null)) throw new TypeError(`ArticleBrief.consensusBaseline.${field} availability is inconsistent`);
    if (datum !== null) {
      requireObject(datum, `ArticleBrief.consensusBaseline.${field}`);
      const datumKeys = ["eventId", "period", "scheduledFor", "source", "unit", "value"];
      exactKeys(datum, datumKeys, `ArticleBrief.consensusBaseline.${field}`);
      if ((typeof datum.value !== "number" && typeof datum.value !== "string") || (typeof datum.value === "number" && !Number.isFinite(datum.value)) || (typeof datum.value === "string" && !datum.value.trim())) throw new TypeError(`ArticleBrief.consensusBaseline.${field}.value is unusable`);
      for (const key of ["unit", "period", "source", "scheduledFor"]) requireString(datum[key], `ArticleBrief.consensusBaseline.${field}.${key}`);
      requireExternalId(datum.eventId, `ArticleBrief.consensusBaseline.${field}.eventId`);
      requireIso(datum.scheduledFor, `ArticleBrief.consensusBaseline.${field}.scheduledFor`);
    }
  }
  if (!baseline.eventMatched && (baseline.consensusAvailable || baseline.priorAvailable)) throw new TypeError("ArticleBrief.consensusBaseline unmatched event cannot have values");
  if ((!baseline.eventMatched || (!baseline.consensusAvailable && !baseline.priorAvailable)) && baseline.limitation === null) throw new TypeError("ArticleBrief.consensusBaseline requires a limitation when no event or value is available");
  if (baseline.consensus && baseline.prior && (baseline.consensus.unit !== baseline.prior.unit || baseline.consensus.period !== baseline.prior.period)) throw new TypeError("ArticleBrief.consensusBaseline values must have compatible unit and period");
  if (baseline.consensus && baseline.prior && ["source", "eventId", "scheduledFor"].some((field) => baseline.consensus[field] !== baseline.prior[field])) throw new TypeError("ArticleBrief.consensusBaseline values must reference the same event");
  requireString(value.newInformation, "ArticleBrief.newInformation");
  requireArray(value.mechanismSteps, "ArticleBrief.mechanismSteps");
  if (!value.mechanismSteps.length) throw new TypeError("ArticleBrief.mechanismSteps must not be empty");
  value.mechanismSteps.forEach((item) => requireString(item, "ArticleBrief.mechanismSteps item"));
  requireString(value.rivalExplanation, "ArticleBrief.rivalExplanation");
  if (value.pricedInStatus !== "unknown_without_verified_market_expectations") throw new TypeError("ArticleBrief.pricedInStatus is invalid");
  requireString(value.editorialBurden, "ArticleBrief.editorialBurden");
  stringIds(value.claimIds, "ArticleBrief.claimIds", true, "claim");
  return value;
}

export function validateArticleClaim(value) {
  assertSchema(value, "ArticleClaim");
  exactKeys(value, ["schemaVersion", "type", "claimId", "briefId", "storyId", "text", "riskClass", "assertionIds", "verificationStatus"], "ArticleClaim");
  requireId(value.claimId, "ArticleClaim.claimId", "claim");
  requireId(value.briefId, "ArticleClaim.briefId", "brief");
  requireId(value.storyId, "ArticleClaim.storyId", "story");
  requireString(value.text, "ArticleClaim.text");
  if (!CLAIM_RISK_CLASSES.includes(value.riskClass)) throw new TypeError("ArticleClaim.riskClass is invalid");
  stringIds(value.assertionIds, "ArticleClaim.assertionIds", false, "assertion");
  if (!value.assertionIds.length) throw new TypeError("ArticleClaim requires evidence assertion IDs");
  if (!CLAIM_VERIFICATION_STATUSES.includes(value.verificationStatus)) throw new TypeError("ArticleClaim.verificationStatus is invalid");
  return value;
}

export function validateSpeakingLadder(value) {
  assertSchema(value, "SpeakingLadder");
  exactKeys(value, ["schemaVersion", "type", "speakingLadderId", "storyId", "claimIds", "twentySecond", "sixtySecond", "likelyChallenge", "defensibleResponse", "technicalConcept"], "SpeakingLadder");
  requireId(value.speakingLadderId, "SpeakingLadder.speakingLadderId", "speaking");
  requireId(value.storyId, "SpeakingLadder.storyId", "story");
  stringIds(value.claimIds, "SpeakingLadder.claimIds", true, "claim");
  for (const field of ["twentySecond", "sixtySecond", "likelyChallenge", "defensibleResponse", "technicalConcept"]) {
    requireString(value[field], `SpeakingLadder.${field}`);
  }
  return value;
}

export function validateRunManifest(value) {
  assertSchema(value, "RunManifest");
  exactKeys(value, ["schemaVersion", "type", "runId", "editionId", "storyId", "sourceDocumentIds", "assertionIds", "propositionIds", "claimIds", "dossierId", "briefId", "speakingLadderId", "startedAt", "completedAt", "configurationHash", "inputDocumentHashes", "stageStatuses", "usage"], "RunManifest");
  for (const field of ["runId", "editionId", "startedAt", "completedAt", "configurationHash"]) {
    requireString(value[field], `RunManifest.${field}`);
  }
  requireIso(value.startedAt, "RunManifest.startedAt");
  requireIso(value.completedAt, "RunManifest.completedAt");
  if (Date.parse(value.completedAt) < Date.parse(value.startedAt)) throw new TypeError("RunManifest.completedAt must not precede startedAt");
  requireArray(value.inputDocumentHashes, "RunManifest.inputDocumentHashes");
  requireId(value.runId, "RunManifest.runId", "run");
  requireId(value.storyId, "RunManifest.storyId", "story");
  stringIds(value.sourceDocumentIds, "RunManifest.sourceDocumentIds", true, "doc");
  stringIds(value.assertionIds, "RunManifest.assertionIds", true, "assertion");
  stringIds(value.propositionIds, "RunManifest.propositionIds", true, "proposition");
  stringIds(value.claimIds, "RunManifest.claimIds", true, "claim");
  requireId(value.dossierId, "RunManifest.dossierId", "dossier");
  requireId(value.briefId, "RunManifest.briefId", "brief");
  requireId(value.speakingLadderId, "RunManifest.speakingLadderId", "speaking");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.editionId) || !Number.isFinite(Date.parse(`${value.editionId}T00:00:00.000Z`)) || new Date(`${value.editionId}T00:00:00.000Z`).toISOString().slice(0, 10) !== value.editionId) throw new TypeError("RunManifest.editionId must be a valid YYYY-MM-DD date");
  if (value.startedAt.slice(0, 10) !== value.editionId || value.completedAt.slice(0, 10) !== value.editionId) throw new TypeError("RunManifest timestamps must fall on the editionId UTC date");
  if (!SHA256_PATTERN.test(value.configurationHash)) throw new TypeError("RunManifest.configurationHash must be a lowercase SHA-256 digest");
  if (!value.inputDocumentHashes.length) throw new TypeError("RunManifest.inputDocumentHashes must not be empty");
  const hashes = new Set();
  for (const digest of value.inputDocumentHashes) {
    if (typeof digest !== "string" || !SHA256_PATTERN.test(digest)) throw new TypeError("RunManifest.inputDocumentHashes item must be a lowercase SHA-256 digest");
    if (hashes.has(digest)) throw new TypeError("RunManifest.inputDocumentHashes contains a duplicate hash");
    hashes.add(digest);
  }
  requireArray(value.stageStatuses, "RunManifest.stageStatuses");
  requireObject(value.usage, "RunManifest.usage");
  for (const stage of value.stageStatuses) {
    exactKeys(stage, ["stage", "status"], "RunManifest.stageStatus");
    requireString(stage.stage, "RunManifest.stageStatus.stage");
    requireString(stage.status, "RunManifest.stageStatus.status");
    if (!RUN_STAGES.includes(stage.stage)) throw new TypeError("RunManifest.stageStatus.stage is invalid");
    if (!RUN_STAGE_STATUSES.includes(stage.status)) throw new TypeError("RunManifest.stageStatus.status is invalid");
  }
  if (new Set(value.stageStatuses.map((stage) => stage.stage)).size !== value.stageStatuses.length) throw new TypeError("RunManifest.stageStatuses contains a duplicate stage");
  if (value.stageStatuses.length !== RUN_STAGES.length || value.stageStatuses.some((stage, index) => stage.stage !== RUN_STAGES[index])) throw new TypeError("RunManifest.stageStatuses must exactly match the required stage order");
  exactKeys(value.usage, ["modelCalls", "searchQueries", "inputTokens", "outputTokens", "estimatedCostUsd"], "RunManifest.usage");
  for (const [key, number] of Object.entries(value.usage)) {
    if (typeof number !== "number" || !Number.isFinite(number) || number < 0) throw new TypeError(`RunManifest.usage.${key} must be a non-negative finite number`);
    if (key !== "estimatedCostUsd" && !Number.isInteger(number)) throw new TypeError(`RunManifest.usage.${key} must be a non-negative integer`);
  }
  return value;
}

export function validateIntelligenceArtifact(artifact) {
  assertSchema(artifact, "IntelligenceArtifact");
  exactKeys(artifact, ["schemaVersion", "type", "sourceDocument", "assertions", "propositions", "dossier", "claims", "brief", "speakingLadder", "runManifest"], "IntelligenceArtifact");
  requireArray(artifact.assertions, "IntelligenceArtifact.assertions");
  requireArray(artifact.propositions, "IntelligenceArtifact.propositions");
  requireArray(artifact.claims, "IntelligenceArtifact.claims");
  validateSourceDocument(artifact.sourceDocument);
  artifact.assertions.forEach(validateEvidenceAssertion);
  artifact.propositions.forEach(validateCanonicalProposition);
  validateStoryDossier(artifact.dossier);
  artifact.claims.forEach(validateArticleClaim);
  validateArticleBrief(artifact.brief);
  validateSpeakingLadder(artifact.speakingLadder);
  validateRunManifest(artifact.runManifest);
  const assertionsById = uniqueMap(artifact.assertions, "assertionId", "IntelligenceArtifact.assertions");
  const propositionsById = uniqueMap(artifact.propositions, "propositionId", "IntelligenceArtifact.propositions");
  const claimsById = uniqueMap(artifact.claims, "claimId", "IntelligenceArtifact.claims");
  const assertionIds = new Set(assertionsById.keys());
  const propositionIds = new Set(propositionsById.keys());
  const claimIds = new Set(claimsById.keys());
  // SourceDocument validation already authenticated the document hash. Cache
  // each assertion result so claim validation does not repeat provenance work.
  const assertionVerification = new Map();
  const verifyAssertion = (assertion) => {
    if (!assertionVerification.has(assertion)) assertionVerification.set(assertion, verifyEvidenceAssertionInternal(artifact.sourceDocument, assertion, true));
    return assertionVerification.get(assertion);
  };
  for (const assertion of artifact.assertions) {
    if (assertion.documentId !== artifact.sourceDocument.documentId) throw new TypeError("EvidenceAssertion references an unknown SourceDocument");
    if (assertion.reviewStatus === "machine_checked" && !verifyAssertion(assertion)) throw new TypeError("machine_checked EvidenceAssertion failed exact retained-content verification");
  }
  for (const proposition of artifact.propositions) {
    if (proposition.assertionIds.some((id) => !assertionIds.has(id))) throw new TypeError("CanonicalProposition references an unknown EvidenceAssertion");
  }
  if (artifact.dossier.assertionIds.some((id) => !assertionIds.has(id))) throw new TypeError("StoryDossier references an unknown EvidenceAssertion");
  if (artifact.dossier.propositionIds.some((id) => !propositionIds.has(id))) throw new TypeError("StoryDossier references an unknown CanonicalProposition");
  if (artifact.brief.claimIds.some((id) => !claimIds.has(id))) throw new TypeError("ArticleBrief references an unknown ArticleClaim");
  for (const claim of artifact.claims) {
    if (claim.assertionIds.some((id) => !assertionIds.has(id))) throw new TypeError("ArticleClaim references an unknown EvidenceAssertion");
    if (claim.storyId !== artifact.dossier.storyId) throw new TypeError("ArticleClaim belongs to a different story");
    if (claim.briefId !== artifact.brief.briefId) throw new TypeError("ArticleClaim references a different ArticleBrief");
    const evidence = claim.assertionIds.map((id) => assertionsById.get(id));
    if (claim.verificationStatus === "supported_exact_primary_span") {
      if (evidence.length !== 1) throw new TypeError("supported_exact_primary_span ArticleClaim must reference exactly one verified EvidenceAssertion");
      const [assertion] = evidence;
      if (assertion.reviewStatus !== "machine_checked" || !verifyAssertion(assertion)) throw new TypeError("supported_exact_primary_span ArticleClaim lacks verified exact primary evidence");
      if (claim.text !== assertion.text) throw new TypeError("supported_exact_primary_span ArticleClaim text must exactly equal its verified EvidenceAssertion text");
    }
  }
  stringIds(artifact.dossier.documentIds, "StoryDossier.documentIds", true);
  stringIds(artifact.dossier.assertionIds, "StoryDossier.assertionIds", true);
  stringIds(artifact.dossier.propositionIds, "StoryDossier.propositionIds", true);
  stringIds(artifact.brief.claimIds, "ArticleBrief.claimIds", true);
  if (artifact.dossier.documentIds.some((id) => id !== artifact.sourceDocument.documentId)) throw new TypeError("StoryDossier references an unknown SourceDocument");
  exactCoverage(artifact.dossier.documentIds, new Set([artifact.sourceDocument.documentId]), "StoryDossier.documentIds");
  exactCoverage(artifact.dossier.assertionIds, assertionIds, "StoryDossier.assertionIds");
  exactCoverage(artifact.dossier.propositionIds, propositionIds, "StoryDossier.propositionIds");
  for (const proposition of artifact.propositions) exactCoverage(proposition.assertionIds, assertionIds, "CanonicalProposition.assertionIds");
  const claimedAssertionIds = artifact.claims.flatMap((claim) => claim.assertionIds);
  stringIds(claimedAssertionIds, "ArticleClaim ownership assertion IDs", true);
  exactCoverage(claimedAssertionIds, assertionIds, "ArticleClaim evidence ownership");
  if (artifact.dossier.evidenceCoverage.extractedFactCount !== artifact.assertions.length) throw new TypeError("StoryDossier evidence count does not match assertions");
  const primarySource = artifact.sourceDocument.sourceType === "official" && artifact.sourceDocument.evidentiaryRole === "establishes_official_release_facts";
  if (artifact.dossier.evidenceCoverage.primarySource !== primarySource) throw new TypeError("StoryDossier primary-source coverage contradicts SourceDocument semantics");
  if (artifact.dossier.evidenceCoverage.consensusAvailable !== artifact.brief.consensusBaseline.consensusAvailable) throw new TypeError("StoryDossier consensus coverage contradicts ArticleBrief baseline");
  if (artifact.runManifest.inputDocumentHashes.length !== 1 || artifact.runManifest.inputDocumentHashes[0] !== artifact.sourceDocument.contentHash) throw new TypeError("RunManifest input hashes do not exactly identify the SourceDocument");
  exactCoverage(artifact.brief.claimIds, claimIds, "ArticleBrief.claimIds");
  if (artifact.speakingLadder.claimIds.some((id) => !claimsById.has(id))) throw new TypeError("SpeakingLadder references an unknown ArticleClaim");
  exactCoverage(artifact.speakingLadder.claimIds, claimIds, "SpeakingLadder.claimIds");
  if (artifact.speakingLadder.storyId !== artifact.dossier.storyId || artifact.brief.storyId !== artifact.dossier.storyId) {
    throw new TypeError("IntelligenceArtifact story IDs must agree");
  }
  if (artifact.brief.sourceDossierId !== artifact.dossier.dossierId || artifact.brief.sourceDossierRevision !== artifact.dossier.dossierRevision) throw new TypeError("ArticleBrief does not reference the current StoryDossier revision");
  // Version 1 currently owns exactly one story and one source document.
  const manifest = artifact.runManifest;
  if (manifest.storyId !== artifact.dossier.storyId || manifest.dossierId !== artifact.dossier.dossierId || manifest.briefId !== artifact.brief.briefId || manifest.speakingLadderId !== artifact.speakingLadder.speakingLadderId) throw new TypeError("RunManifest ownership references do not identify this artifact");
  exactCoverage(manifest.sourceDocumentIds, new Set([artifact.sourceDocument.documentId]), "RunManifest.sourceDocumentIds");
  exactOrderedCoverage(manifest.assertionIds, artifact.assertions.map((item) => item.assertionId), "RunManifest.assertionIds");
  exactOrderedCoverage(manifest.propositionIds, artifact.propositions.map((item) => item.propositionId), "RunManifest.propositionIds");
  exactOrderedCoverage(manifest.claimIds, artifact.claims.map((item) => item.claimId), "RunManifest.claimIds");
  const asOf = Date.parse(artifact.dossier.asOf);
  if (Date.parse(artifact.sourceDocument.fetchedAt) > asOf) throw new TypeError("StoryDossier.asOf must not precede SourceDocument.fetchedAt");
  if (asOf < Date.parse(manifest.startedAt) || asOf > Date.parse(manifest.completedAt) || artifact.dossier.asOf.slice(0, 10) !== manifest.editionId) throw new TypeError("StoryDossier.asOf must fall within the RunManifest edition interval");
  for (const field of ["consensus", "prior"]) {
    const datum = artifact.brief.consensusBaseline[field];
    if (datum && datum.scheduledFor.slice(0, 10) !== artifact.sourceDocument.publishedAt.slice(0, 10)) throw new TypeError(`ArticleBrief.consensusBaseline.${field}.scheduledFor must match the SourceDocument publication UTC date`);
  }
  return artifact;
}
