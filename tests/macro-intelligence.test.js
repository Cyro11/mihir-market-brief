import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  INTELLIGENCE_SCHEMA_VERSION,
  RETAINED_CONTENT_POLICY,
  isStrictIsoUtcTimestamp,
  stableId,
  validateArticleBrief,
  validateArticleClaim,
  validateCanonicalProposition,
  validateEvidenceAssertion,
  validateIntelligenceArtifact,
  validateRunManifest,
  validateSourceDocument,
  validateSpeakingLadder,
  validateStoryDossier,
  verifyEvidenceAssertion
} from "../scripts/intelligence-contracts.js";
import {
  buildOfficialMacroArtifacts,
  buildOfficialMacroIntelligence,
  buildOfficialMacroIntelligenceBatch,
  isOfficialMacroRelease
} from "../scripts/macro-intelligence.js";
import { selectBuildNow } from "../scripts/build-edition.js";

test("importing render-edition does not write generated pages", (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "render-edition-import-"));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(fixtureRoot, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, "data", "editions"), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, "package.json"), JSON.stringify({ type: "module" }));
  for (const file of ["render-edition.js", "config.js", "utils.js"]) {
    fs.copyFileSync(path.join(process.cwd(), "scripts", file), path.join(fixtureRoot, "scripts", file));
  }
  fs.writeFileSync(path.join(fixtureRoot, "data", "editions", "latest.json"), JSON.stringify({
    runDate: "2099-01-01",
    title: "Import sentinel",
    dek: "Importing must not render this fixture.",
    moves: [],
    sections: {},
    review: { status: "PENDING" }
  }));

  const moduleUrl = pathToFileURL(path.join(fixtureRoot, "scripts", "render-edition.js")).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", `await import(${JSON.stringify(moduleUrl)})`], {
    cwd: fixtureRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(fixtureRoot, "issues")), false, "import created the generated issues directory");
  assert.equal(fs.existsSync(path.join(fixtureRoot, "index.html")), false, "import generated a root page");
});

const cpi = {
  id: "bls-cpi-consumer-price-index-summary",
  feedId: "bls-cpi",
  title: "Consumer Price Index Summary",
  source: "BLS CPI",
  sourceType: "official",
  url: "https://www.bls.gov/news.release/cpi.nr0.htm",
  publishedAt: "2026-06-10T12:30:00.000Z",
  fetchedAt: "2026-06-10T13:00:00.000Z",
  summary: "CPI-U increased 0.5 percent in May. Core CPI rose 0.2 percent.",
  facts: [
    "CPI-U increased 0.5 percent in May.",
    "The all-items index increased 4.2 percent over the last 12 months.",
    "Core CPI rose 0.2 percent in May."
  ],
  topics: ["macro", "inflation", "rates", "fed"]
};

const cpiEvent = (overrides = {}) => ({
  id: "calendar-cpi-2026-06-10",
  source: "Approved Calendar",
  releaseFamily: "cpi",
  name: "Consumer Price Index",
  scheduledFor: "2026-06-10T12:30:00.000Z",
  consensus: { value: 0.3, unit: "percent", period: "m/m" },
  prior: { value: 0.2, unit: "percent", period: "m/m" },
  ...overrides
});

test("stableId is deterministic and namespaced", () => {
  assert.equal(stableId("doc", "a", "b"), stableId("doc", "a", "b"));
  assert.match(stableId("doc", "a", "b"), /^doc_[a-f0-9]{20}$/);
  assert.notEqual(stableId("story", "a", "b"), stableId("doc", "a", "b"));
});

test("official macro classifier rejects non-official commentary", () => {
  assert.equal(isOfficialMacroRelease(cpi), true);
  assert.equal(isOfficialMacroRelease({ ...cpi, sourceType: "reputable", feedId: "news" }), false);
});

test("approved BLS feed, authority, and release-family pairs are accepted", () => {
  const cases = [
    [cpi, { releaseFamily: "cpi", name: "Consumer Price Index" }, "cpi"],
    [{ ...cpi, feedId: "bls-ppi", url: "https://www.bls.gov/news.release/ppi.nr0.htm", title: "Producer Price Index" }, { releaseFamily: "ppi", name: "Producer Price Index" }, "ppi"],
    [{ ...cpi, feedId: "bls-employment", url: "https://www.bls.gov/news.release/empsit.nr0.htm", title: "Employment Situation", topics: ["macro", "employment"] }, { releaseFamily: "employment", name: "Employment Situation" }, "employment"]
  ];
  for (const [item, event, family] of cases) {
    const artifact = buildOfficialMacroIntelligence(item, {
      generatedAt: item.fetchedAt,
      calendarEvents: [cpiEvent({ ...event, id: `calendar-${family}` })]
    });
    assert.equal(artifact.dossier.storyClass, `official_macro_${family}`);
    assert.equal(artifact.brief.consensusBaseline.eventMatched, true);
    assert.equal(artifact.brief.consensusBaseline.consensus.eventId, `calendar-${family}`);
  }
});

test("official-source trust boundary rejects unapproved feeds, authorities, URL forms, and family mismatches", () => {
  const rejected = [
    { ...cpi, feedId: "bea-news", url: "https://www.bea.gov/news/current-releases", title: "Personal Income and Outlays", releaseFamily: "pce" },
    { ...cpi, feedId: "bea-pce" },
    { ...cpi, feedId: "bls-cpi-copy" },
    { ...cpi, url: "http://www.bls.gov/news.release/cpi.nr0.htm" },
    { ...cpi, url: "https://user@www.bls.gov/news.release/cpi.nr0.htm" },
    { ...cpi, url: "https://user:secret@www.bls.gov/news.release/cpi.nr0.htm" },
    { ...cpi, url: "https://www.bls.gov:8443/news.release/cpi.nr0.htm" },
    { ...cpi, url: "https://bls.gov.evil.com/news.release/cpi.nr0.htm" },
    { ...cpi, url: "https://evilbls.gov/news.release/cpi.nr0.htm" },
    { ...cpi, url: "https://bls.gov/news.release/cpi.nr0.htm" },
    { ...cpi, url: "not a url" },
    { ...cpi, feedId: "bls-ppi", url: "https://www.bls.gov/news.release/ppi.nr0.htm", releaseFamily: "cpi" },
    { ...cpi, feedId: "bls-employment", url: "https://www.bls.gov/news.release/empsit.nr0.htm", title: "Consumer Price Index Summary" }
  ];
  for (const item of rejected) {
    assert.equal(isOfficialMacroRelease(item), false, `${item.feedId}: ${item.url}`);
    assert.throws(() => buildOfficialMacroIntelligence(item), /approved official macro release/);
  }
});

test("official-source allowlist is prototype-safe for inherited property names", () => {
  for (const feedId of ["toString", "__proto__", "constructor", "hasOwnProperty"]) {
    assert.doesNotThrow(() => isOfficialMacroRelease({ ...cpi, feedId }));
    assert.equal(isOfficialMacroRelease({ ...cpi, feedId }), false);
  }
});

test("BLS feed trust is bound to its exact family-specific release pathname", () => {
  const rejected = [
    // Cross-family resources remain untrusted even when caller-controlled
    // family hints are spoofed to agree with the feed ID.
    { ...cpi, url: "https://www.bls.gov/news.release/ppi.nr0.htm", title: "Consumer Price Index", name: "BLS CPI", releaseFamily: "cpi", topics: ["cpi", "inflation"] },
    { ...cpi, feedId: "bls-ppi", url: "https://www.bls.gov/news.release/cpi.nr0.htm", title: "Producer Price Index", name: "BLS PPI", releaseFamily: "ppi", topics: ["ppi", "inflation"] },
    { ...cpi, feedId: "bls-employment", url: "https://www.bls.gov/news.release/ppi.nr0.htm", title: "Employment Situation", name: "BLS Employment Situation", releaseFamily: "employment", topics: ["employment", "jobs"] },
    // An approved authority does not confer trust on unrelated resources.
    { ...cpi, url: "https://www.bls.gov/news.release/other.nr0.htm" },
    { ...cpi, feedId: "bls-ppi", url: "https://www.bls.gov/home.htm", title: "Producer Price Index", releaseFamily: "ppi" },
    { ...cpi, feedId: "bls-employment", url: "https://www.bls.gov/news.release/", title: "Employment Situation", releaseFamily: "employment" },
    // Alternate resource selectors and encoded path spellings fail closed.
    { ...cpi, url: "https://www.bls.gov/news.release/cpi.nr0.htm?feed=ppi" },
    { ...cpi, url: "https://www.bls.gov/news.release/cpi.nr0.htm#ppi" },
    { ...cpi, url: "https://www.bls.gov/news.release/%63pi.nr0.htm" },
    { ...cpi, url: "https://www.bls.gov/news.release/cpi.nr0.htm/../ppi.nr0.htm" },
    { ...cpi, url: "https://www.bls.gov:443/news.release/cpi.nr0.htm" },
    { ...cpi, url: "https://www\u3002bls\u3002gov/news.release/cpi.nr0.htm" },
    { ...cpi, url: "https://www.bls.gov/news.release/./cpi.nr0.htm" },
    { ...cpi, url: "https://www.bls.gov/news.release/%2e/cpi.nr0.htm" },
    { ...cpi, url: "https://www.bls.gov/news.release/foo/%2e%2e/cpi.nr0.htm" }
  ];

  for (const item of rejected) {
    assert.equal(isOfficialMacroRelease(item), false, `${item.feedId}: ${item.url}`);
    assert.throws(() => buildOfficialMacroIntelligence(item), /approved official macro release/);
  }
});

test("official-looking sourceType and title cannot cross the explicit trust boundary", () => {
  assert.equal(isOfficialMacroRelease({ ...cpi, feedId: "news", url: "https://www.bls.gov/news.release/cpi.nr0.htm" }), false);
  assert.equal(isOfficialMacroRelease({ ...cpi, feedId: "bls-cpi", url: "https://example.com/cpi", title: "Official BLS Consumer Price Index" }), false);
});

test("official CPI vertical slice creates traceable evidence, dossier, brief, claims, and speaking utility", () => {
  const artifact = buildOfficialMacroIntelligence(cpi, {
    runDate: "2026-06-10",
    generatedAt: "2026-06-10T13:05:00.000Z",
    calendarEvents: [cpiEvent()]
  });

  assert.equal(artifact.schemaVersion, INTELLIGENCE_SCHEMA_VERSION);
  assert.equal(artifact.sourceDocument.sourceType, "official");
  assert.equal(artifact.sourceDocument.evidentiaryRole, "establishes_official_release_facts");
  assert.equal(artifact.assertions.length, 3);
  assert.ok(artifact.assertions.every((assertion) => assertion.documentId === artifact.sourceDocument.documentId));
  assert.ok(artifact.assertions.every((assertion) => assertion.sourceSpan.quoteHash.length === 64));
  assert.match(artifact.sourceDocument.retainedContent, /^Title: Consumer Price Index Summary\nSummary:/);
  assert.ok(artifact.assertions.every((assertion) => verifyEvidenceAssertion(artifact.sourceDocument, assertion)));
  assert.ok(artifact.assertions.every((assertion) => artifact.sourceDocument.retainedContent.slice(assertion.sourceSpan.start, assertion.sourceSpan.end) === assertion.sourceSpan.quote));
  assert.deepEqual(artifact.propositions[0].assertionIds, artifact.assertions.map((item) => item.assertionId));
  assert.equal(artifact.dossier.storyClass, "official_macro_cpi");
  assert.equal(artifact.dossier.evidenceCoverage.primarySource, true);
  assert.equal(artifact.dossier.evidenceCoverage.consensusAvailable, true);
  assert.deepEqual(artifact.brief.consensusBaseline.consensus, {
    value: 0.3, unit: "percent", period: "m/m", source: "Approved Calendar",
    eventId: "calendar-cpi-2026-06-10", scheduledFor: "2026-06-10T12:30:00.000Z"
  });
  assert.match(artifact.brief.centralQuestion, /Federal Reserve policy/);
  assert.match(artifact.brief.pricedInStatus, /unknown/);
  assert.equal(artifact.claims.length, artifact.assertions.length);
  assert.ok(artifact.claims.every((claim) => claim.verificationStatus === "supported_exact_primary_span"));
  assert.match(artifact.speakingLadder.twentySecond, /CPI-U increased 0\.5 percent/);
  assert.ok(artifact.speakingLadder.twentySecond.split(/\s+/).length <= 70);
  assert.match(artifact.speakingLadder.sixtySecond, /Consensus was 0\.3 percent m\/m/);
  assert.match(artifact.speakingLadder.likelyChallenge, /broad-based/);
  assert.match(artifact.speakingLadder.technicalConcept, /Core inflation/);
  assert.equal(artifact.runManifest.usage.modelCalls, 0);
  assert.deepEqual(artifact.runManifest.stageStatuses.map((stage) => stage.status), Array(7).fill("completed"));
});

test("vertical slice refuses to invent beat-or-miss language when consensus is unavailable", () => {
  const artifact = buildOfficialMacroIntelligence(cpi, { generatedAt: cpi.fetchedAt });
  assert.equal(artifact.brief.consensusBaseline.eventMatched, false);
  assert.equal(artifact.brief.consensusBaseline.consensus, null);
  assert.ok(artifact.dossier.openQuestions.some((question) => /consensus estimate/.test(question)));
  assert.doesNotMatch(JSON.stringify(artifact), /\bbeat expectations\b|\bmissed expectations\b/i);
});

test("exact-span verification fails closed for every retained provenance component", () => {
  const artifact = buildOfficialMacroIntelligence(cpi, { generatedAt: cpi.fetchedAt });
  const assertion = artifact.assertions[0];
  const variants = [
    { document: { ...artifact.sourceDocument, retainedContent: `${artifact.sourceDocument.retainedContent}!` }, assertion },
    { document: { ...artifact.sourceDocument, contentHash: "0".repeat(64) }, assertion },
    { document: artifact.sourceDocument, assertion: { ...assertion, sourceSpan: { ...assertion.sourceSpan, start: assertion.sourceSpan.start + 1 } } },
    { document: artifact.sourceDocument, assertion: { ...assertion, sourceSpan: { ...assertion.sourceSpan, end: assertion.sourceSpan.end - 1 } } },
    { document: artifact.sourceDocument, assertion: { ...assertion, sourceSpan: { ...assertion.sourceSpan, quote: `${assertion.sourceSpan.quote}!` } } },
    { document: artifact.sourceDocument, assertion: { ...assertion, sourceSpan: { ...assertion.sourceSpan, quoteHash: "0".repeat(64) } } }
  ];
  for (const variant of variants) assert.equal(verifyEvidenceAssertion(variant.document, variant.assertion), false);
  for (const variant of variants) {
    const assertions = [variant.assertion, ...artifact.assertions.slice(1)];
    assert.throws(() => validateIntelligenceArtifact({ ...artifact, sourceDocument: variant.document, assertions }), /contentHash|exact retained-content|exact primary evidence/);
  }
});

test("exact-span verification is bound to a non-empty matching document ID", () => {
  const artifact = buildOfficialMacroIntelligence(cpi, { generatedAt: cpi.fetchedAt });
  const assertion = artifact.assertions[0];
  assert.equal(verifyEvidenceAssertion(artifact.sourceDocument, { ...assertion, documentId: "doc_other" }), false);
  assert.equal(verifyEvidenceAssertion(artifact.sourceDocument, { ...assertion, documentId: "" }), false);
  assert.equal(verifyEvidenceAssertion({ ...artifact.sourceDocument, documentId: "" }, { ...assertion, documentId: "" }), false);
  assert.equal(verifyEvidenceAssertion({ ...artifact.sourceDocument, documentId: "   " }, { ...assertion, documentId: "   " }), false);
});

test("boolean exact-span verifier returns false for hostile accessors, proxies, and coercion traps", () => {
  const artifact = buildOfficialMacroIntelligence(cpi, { generatedAt: cpi.fetchedAt });
  const assertion = artifact.assertions[0];
  const throwingGetter = (base, key) => Object.defineProperty({ ...base }, key, { get() { throw new Error(`${key} trap`); } });
  const hostileValues = [
    [throwingGetter(artifact.sourceDocument, "retainedContent"), assertion],
    [throwingGetter(artifact.sourceDocument, "contentHash"), assertion],
    [throwingGetter(artifact.sourceDocument, "documentId"), assertion],
    [artifact.sourceDocument, throwingGetter(assertion, "documentId")],
    [artifact.sourceDocument, throwingGetter(assertion, "text")],
    [artifact.sourceDocument, throwingGetter(assertion, "sourceSpan")],
    [artifact.sourceDocument, { ...assertion, sourceSpan: throwingGetter(assertion.sourceSpan, "start") }],
    [artifact.sourceDocument, { ...assertion, sourceSpan: throwingGetter(assertion.sourceSpan, "quoteHash") }],
    [new Proxy({}, { get() { throw new Error("document proxy trap"); } }), assertion],
    [artifact.sourceDocument, new Proxy({}, { get() { throw new Error("assertion proxy trap"); } })],
    [artifact.sourceDocument, { ...assertion, sourceSpan: new Proxy({}, { get() { throw new Error("span proxy trap"); } }) }],
    [{ ...artifact.sourceDocument, retainedContent: { toString() { throw new Error("coercion trap"); } } }, assertion]
  ];
  for (const [document, hostileAssertion] of hostileValues) {
    assert.doesNotThrow(() => verifyEvidenceAssertion(document, hostileAssertion));
    assert.equal(verifyEvidenceAssertion(document, hostileAssertion), false);
  }
});

test("retained evidence uses UTF-8 hashes and UTF-16 offsets for astral Unicode and duplicate facts", () => {
  const unicode = { ...cpi, summary: "Markets reacted 🚀.", facts: ["Prices 🚀 rose 0.5 percent.", "Prices 🚀 rose 0.5 percent."] };
  const artifact = buildOfficialMacroIntelligence(unicode, { generatedAt: unicode.fetchedAt });
  assert.match(RETAINED_CONTENT_POLICY.description, /UTF-8 bytes/);
  assert.match(RETAINED_CONTENT_POLICY.description, /UTF-16 code-unit offsets/);
  assert.match(RETAINED_CONTENT_POLICY.description, /not the raw upstream webpage or PDF/);
  assert.ok(artifact.assertions.every((item) => verifyEvidenceAssertion(artifact.sourceDocument, item)));
  assert.notEqual(artifact.assertions[0].sourceSpan.start, artifact.assertions[1].sourceSpan.start);
  assert.equal(artifact.assertions[0].sourceSpan.end - artifact.assertions[0].sourceSpan.start, unicode.facts[0].length);
  assert.equal(artifact.assertions[0].sourceSpan.quoteHash, createHash("sha256").update(unicode.facts[0], "utf8").digest("hex"));
});

test("an unverified assertion cannot be represented to readers as exact-primary-span verified", () => {
  const artifact = buildOfficialMacroIntelligence(cpi, { generatedAt: cpi.fetchedAt });
  const assertion = artifact.assertions[0];
  const unverified = { ...assertion, reviewStatus: "machine_extracted_unverified", sourceSpan: { ...assertion.sourceSpan, start: assertion.sourceSpan.start + 1 } };
  const assertions = [unverified, ...artifact.assertions.slice(1)];
  assert.throws(() => validateIntelligenceArtifact({ ...artifact, assertions }), /exact primary evidence/);

  const claims = [{ ...artifact.claims[0], verificationStatus: "machine_extracted_unverified" }, ...artifact.claims.slice(1)];
  assert.doesNotThrow(() => validateIntelligenceArtifact({ ...artifact, assertions, claims }));
  assert.equal(claims[0].verificationStatus, "machine_extracted_unverified");
});

test("an exact-primary-span claim must exactly match its sole verified assertion", () => {
  const artifact = buildOfficialMacroIntelligence(cpi, { generatedAt: cpi.fetchedAt });
  const claims = [{ ...artifact.claims[0], text: `${artifact.claims[0].text} Tampered.` }, ...artifact.claims.slice(1)];

  assert.equal(claims[0].verificationStatus, "supported_exact_primary_span");
  assert.throws(() => validateIntelligenceArtifact({ ...artifact, claims }), /text must exactly equal its verified EvidenceAssertion text/);
});

test("expectation wording does not claim a calculated gap", () => {
  const artifact = buildOfficialMacroIntelligence(cpi, { generatedAt: cpi.fetchedAt, calendarEvents: [cpiEvent()] });
  assert.match(artifact.speakingLadder.twentySecond, /comparison with expectations/);
  assert.doesNotMatch(JSON.stringify(artifact), /gap versus expectations|expectation gap/i);
});

test("vertical slice fails closed for thin or malformed evidence", () => {
  assert.throws(() => buildOfficialMacroIntelligence({ ...cpi, facts: ["Only one fact."] }), /at least two/);
  assert.throws(() => buildOfficialMacroIntelligence({ ...cpi, url: "" }), /approved official macro release/);
});

test("batch builder emits only approved official macro releases", () => {
  const artifacts = buildOfficialMacroArtifacts([
    cpi,
    { ...cpi, id: "commentary", sourceType: "reputable", feedId: "news", title: "Markets debate CPI" }
  ], { generatedAt: cpi.fetchedAt });
  assert.equal(artifacts.length, 1);
});

test("production batch isolates malformed releases instead of losing valid artifacts", () => {
  const batch = buildOfficialMacroIntelligenceBatch([
    cpi,
    { ...cpi, id: "thin-release", facts: ["Only one extracted fact."] }
  ], { generatedAt: cpi.fetchedAt });
  assert.equal(batch.artifacts.length, 1);
  assert.equal(batch.failures.length, 1);
  assert.equal(batch.failures[0].itemId, "thin-release");
  assert.match(batch.failures[0].error, /at least two/);
});

test("production batch isolates classifier exceptions and preserves valid artifacts", () => {
  const malicious = { ...cpi, id: "malicious-classifier" };
  Object.defineProperty(malicious, "title", { get() { throw new Error("classifier trap"); } });
  const batch = buildOfficialMacroIntelligenceBatch([malicious, cpi], { generatedAt: cpi.fetchedAt });
  assert.equal(batch.artifacts.length, 1);
  assert.equal(batch.artifacts[0].sourceDocument.canonicalUrl, cpi.url);
});

test("production batch isolates non-Error coercion traps and preserves valid artifacts", () => {
  const coercionTrap = {
    toString() { throw new Error("toString trap"); },
    [Symbol.toPrimitive]() { throw new Error("primitive trap"); }
  };
  const malformed = { ...cpi, id: "coercion-trap" };
  Object.defineProperty(malformed, "facts", { get() { throw coercionTrap; } });

  const batch = buildOfficialMacroIntelligenceBatch([malformed, cpi], { generatedAt: cpi.fetchedAt });

  assert.equal(batch.artifacts.length, 1);
  assert.equal(batch.artifacts[0].sourceDocument.canonicalUrl, cpi.url);
  assert.deepEqual(batch.failures, [{
    itemId: "coercion-trap",
    sourceId: cpi.feedId,
    error: "Unknown error"
  }]);
});

test("production batch safely records failures when metadata accessors throw", () => {
  const malicious = { ...cpi, facts: ["Only one extracted fact."] };
  let feedIdReads = 0;
  Object.defineProperties(malicious, {
    id: { get() { throw new Error("id metadata trap"); } },
    // The two approval checks each read feedId twice. Trap only when the batch
    // catch block subsequently attempts to collect failure metadata.
    feedId: { get() {
      feedIdReads += 1;
      if (feedIdReads > 4) throw new Error("feedId metadata trap");
      return cpi.feedId;
    } },
    source: { get() { throw new Error("source metadata trap"); } }
  });

  const batch = buildOfficialMacroIntelligenceBatch([malicious, cpi], { generatedAt: cpi.fetchedAt });

  assert.equal(batch.artifacts.length, 1);
  assert.equal(batch.artifacts[0].sourceDocument.canonicalUrl, cpi.url);
  assert.equal(batch.failures.length, 1);
  assert.deepEqual(batch.failures[0], {
    itemId: null,
    sourceId: null,
    error: "Official macro release requires at least two extracted facts"
  });
});

test("calendar matching selects the unique exact-date CPI release even when an older CPI event is first", () => {
  const artifact = buildOfficialMacroIntelligence(cpi, { generatedAt: cpi.fetchedAt, calendarEvents: [
    cpiEvent({ id: "old-cpi", scheduledFor: "2026-05-13T12:30:00.000Z", consensus: { value: 9, unit: "percent", period: "m/m" } }), cpiEvent()
  ] });
  assert.equal(artifact.brief.consensusBaseline.eventMatched, true);
  assert.equal(artifact.brief.consensusBaseline.consensus.eventId, "calendar-cpi-2026-06-10");
  assert.equal(artifact.brief.consensusBaseline.consensus.value, 0.3);
});

test("matched calendar event with no values records the match and limitation", () => {
  const artifact = buildOfficialMacroIntelligence(cpi, { generatedAt: cpi.fetchedAt, calendarEvents: [cpiEvent({ consensus: null, prior: null })] });
  assert.deepEqual(artifact.brief.consensusBaseline, { eventMatched: true, consensusAvailable: false, priorAvailable: false, consensus: null, prior: null, limitation: "The matched calendar event did not provide usable consensus or prior value metadata." });
});

test("prior-only baseline does not produce expectation-gap, beat, or miss wording", () => {
  const artifact = buildOfficialMacroIntelligence(cpi, { generatedAt: cpi.fetchedAt, calendarEvents: [cpiEvent({ consensus: null })] });
  assert.equal(artifact.brief.consensusBaseline.priorAvailable, true);
  assert.doesNotMatch(JSON.stringify(artifact), /expectation[- ]gap|\bbeat\b|\bmiss\b/i);
});

test("same-date release-family ambiguity fails closed", () => {
  const artifact = buildOfficialMacroIntelligence(cpi, { generatedAt: cpi.fetchedAt, calendarEvents: [cpiEvent(), cpiEvent({ id: "duplicate" })] });
  assert.equal(artifact.brief.consensusBaseline.eventMatched, false);
  assert.equal(artifact.brief.consensusBaseline.consensus, null);
  assert.match(artifact.brief.consensusBaseline.limitation, /failed closed/);
});

test("incompatible consensus and prior unit or period metadata is withheld", () => {
  for (const prior of [{ value: 0.2, unit: "index points", period: "m/m" }, { value: 0.2, unit: "percent", period: "y/y" }]) {
    const artifact = buildOfficialMacroIntelligence(cpi, { generatedAt: cpi.fetchedAt, calendarEvents: [cpiEvent({ prior })] });
    assert.equal(artifact.brief.consensusBaseline.eventMatched, true);
    assert.equal(artifact.brief.consensusBaseline.consensusAvailable, false);
    assert.equal(artifact.brief.consensusBaseline.priorAvailable, false);
    assert.match(artifact.brief.consensusBaseline.limitation, /incompatible/);
  }
});

test("ArticleBrief contract rejects inconsistent structured baseline state", () => {
  const brief = buildOfficialMacroIntelligence(cpi, { generatedAt: cpi.fetchedAt, calendarEvents: [cpiEvent()] }).brief;
  assert.throws(() => validateArticleBrief({ ...brief, consensusBaseline: { ...brief.consensusBaseline, consensusAvailable: false } }), /availability is inconsistent/);
  assert.throws(() => validateArticleBrief({ ...brief, consensusBaseline: { ...brief.consensusBaseline, eventMatched: false } }), /unmatched event cannot have values/);
});

test("ArticleBrief contract rejects unknown keys in structured baseline values", () => {
  const brief = buildOfficialMacroIntelligence(cpi, { generatedAt: cpi.fetchedAt, calendarEvents: [cpiEvent()] }).brief;
  for (const field of ["consensus", "prior"]) {
    const consensusBaseline = {
      ...brief.consensusBaseline,
      [field]: { ...brief.consensusBaseline[field], extra: "not allowed" }
    };
    assert.throws(
      () => validateArticleBrief({ ...brief, consensusBaseline }),
      new RegExp(`ArticleBrief\\.consensusBaseline\\.${field} has an invalid shape`)
    );
  }
});

test("timestamps require canonical, valid ISO-8601 UTC values and calendar matching fails closed", () => {
  assert.equal(isStrictIsoUtcTimestamp("2026-06-10T12:30:00.000Z"), true);
  for (const invalid of ["2026-06-10", "2026-06-10T12:30:00Z", "2026-06-10T12:30:00.000+00:00", "2026-02-30T12:30:00.000Z"]) {
    assert.equal(isStrictIsoUtcTimestamp(invalid), false, invalid);
  }
  assert.throws(() => buildOfficialMacroIntelligence({ ...cpi, publishedAt: "2026-02-30T12:30:00.000Z" }), /canonical ISO-8601 UTC/);

  const unmatched = buildOfficialMacroIntelligence(cpi, {
    generatedAt: cpi.fetchedAt,
    calendarEvents: [cpiEvent({ scheduledFor: "2026-06-10 12:30:00Z" })]
  });
  assert.equal(unmatched.brief.consensusBaseline.eventMatched, false);

  const brief = buildOfficialMacroIntelligence(cpi, { generatedAt: cpi.fetchedAt, calendarEvents: [cpiEvent()] }).brief;
  assert.throws(() => validateArticleBrief({
    ...brief,
    consensusBaseline: { ...brief.consensusBaseline, consensus: { ...brief.consensusBaseline.consensus, scheduledFor: "2026-06-10T12:30:00Z" } }
  }), /canonical ISO-8601 UTC/);
});

test("CanonicalProposition validAt requires a canonical, valid ISO-8601 UTC timestamp", () => {
  const proposition = buildOfficialMacroIntelligence(cpi, { generatedAt: cpi.fetchedAt }).propositions[0];
  for (const invalid of ["2026-02-30T12:30:00.000Z", "2026-06-10T12:30:00.000+00:00"]) {
    assert.throws(
      () => validateCanonicalProposition({ ...proposition, validAt: invalid }),
      /CanonicalProposition\.validAt must be a canonical ISO-8601 UTC timestamp/
    );
  }
});

test("macro page speaking panel renders high-level and expandable answers from approved intelligence", async () => {
  const { macroSpeakingPanel } = await import("../scripts/render-edition.js");
  const artifact = buildOfficialMacroIntelligence(cpi, {
    generatedAt: cpi.fetchedAt,
    calendarEvents: [cpiEvent()]
  });
  const html = macroSpeakingPanel({ runDate: "2026-06-10", intelligence: { officialMacro: { artifacts: [artifact], failures: [] } } });
  assert.match(html, /Know It Well Enough To Say It/);
  assert.match(html, /In 20 seconds/);
  assert.match(html, /Build the 60-second answer/);
  assert.match(html, /Core inflation/);
  assert.doesNotMatch(html, /undefined|null/);
  assert.equal(macroSpeakingPanel({}), "");
  assert.equal(macroSpeakingPanel({ runDate: "2026-07-10", intelligence: { officialMacro: { artifacts: [artifact] } } }), "");
});

test("contract validators reject broken provenance links, unsupported claims, invalid lifecycle states, and unversioned manifests", () => {
  const artifact = buildOfficialMacroIntelligence(cpi, { generatedAt: cpi.fetchedAt });
  assert.throws(() => validateIntelligenceArtifact({
    ...artifact,
    claims: [{ ...artifact.claims[0], assertionIds: [stableId("assertion", "missing-claim-evidence")] }, ...artifact.claims.slice(1)]
  }), /unknown EvidenceAssertion/);

  assert.throws(() => validateArticleClaim({
    schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
    type: "ArticleClaim",
    claimId: stableId("claim", "manual"),
    briefId: stableId("brief", "manual"),
    storyId: stableId("story", "manual"),
    text: "Unsupported",
    riskClass: "R2",
    assertionIds: [],
    verificationStatus: "machine_extracted_unverified"
  }), /requires evidence/);

  assert.throws(() => validateStoryDossier({
    schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
    type: "StoryDossier",
    dossierId: stableId("dossier", "manual"),
    storyId: stableId("story", "manual"),
    storyClass: "official_macro_cpi",
    asOf: cpi.fetchedAt,
    status: "invented_state",
    dossierRevision: 1,
    documentIds: [], assertionIds: [], propositionIds: [], openQuestions: [], contradictions: [],
    evidenceCoverage: { primarySource: false, extractedFactCount: 0, consensusAvailable: false, marketReactionAvailable: false }
  }), /status is invalid/);

  assert.throws(() => validateRunManifest({
    schemaVersion: "0.0.1",
    type: "RunManifest"
  }), /schemaVersion/);
});

test("artifact validator rejects adversarial graph links, duplicate IDs, wrong types, and extras", () => {
  const a = buildOfficialMacroIntelligence(cpi, { generatedAt: cpi.fetchedAt });
  const cases = [
    { ...a, assertions: [a.assertions[0], { ...a.assertions[1], assertionId: a.assertions[0].assertionId }] },
    { ...a, propositions: [a.propositions[0], { ...a.propositions[0] }] },
    { ...a, claims: [a.claims[0], { ...a.claims[1], claimId: a.claims[0].claimId }] },
    { ...a, dossier: { ...a.dossier, documentIds: [stableId("doc", "missing")] } },
    { ...a, dossier: { ...a.dossier, assertionIds: [stableId("assertion", "missing")] } },
    { ...a, dossier: { ...a.dossier, propositionIds: [stableId("proposition", "missing")] } },
    { ...a, brief: { ...a.brief, claimIds: [stableId("claim", "missing")] } },
    { ...a, speakingLadder: { ...a.speakingLadder, claimIds: [stableId("claim", "missing")] } },
    { ...a, propositions: [{ ...a.propositions[0], assertionIds: [stableId("assertion", "missing")] }] },
    { ...a, claims: [{ ...a.claims[0], storyId: stableId("story", "swapped") }, ...a.claims.slice(1)] },
    { ...a, dossier: { ...a.dossier, assertionIds: [42, ...a.dossier.assertionIds.slice(1)] } },
    { ...a, extra: true },
    { ...a, sourceDocument: { ...a.sourceDocument, extra: true } },
    { ...a, assertions: [{ ...a.assertions[0], extra: true }, ...a.assertions.slice(1)] },
    { ...a, assertions: [{ ...a.assertions[0], sourceSpan: { ...a.assertions[0].sourceSpan, extra: true } }, ...a.assertions.slice(1)] },
    { ...a, propositions: [{ ...a.propositions[0], extra: true }] },
    { ...a, dossier: { ...a.dossier, extra: true } },
    { ...a, dossier: { ...a.dossier, evidenceCoverage: { ...a.dossier.evidenceCoverage, extra: true } } },
    { ...a, brief: { ...a.brief, extra: true } },
    { ...a, claims: [{ ...a.claims[0], extra: true }, ...a.claims.slice(1)] },
    { ...a, speakingLadder: { ...a.speakingLadder, extra: true } },
    { ...a, runManifest: { ...a.runManifest, extra: true } },
    { ...a, runManifest: { ...a.runManifest, stageStatuses: [{ ...a.runManifest.stageStatuses[0], extra: true }, ...a.runManifest.stageStatuses.slice(1)] } },
    { ...a, runManifest: { ...a.runManifest, usage: { ...a.runManifest.usage, extra: 0 } } }
  ];
  for (const artifact of cases) assert.throws(() => validateIntelligenceArtifact(artifact), TypeError);
});

test("every standalone contract rejects reserved values in every internal own-ID and reference field", () => {
  const a = buildOfficialMacroIntelligence(cpi, { generatedAt: cpi.fetchedAt });
  const mutations = [
    [validateSourceDocument, a.sourceDocument, "documentId"],
    [validateSourceDocument, a.sourceDocument, "retrievalId"],
    [validateEvidenceAssertion, a.assertions[0], "assertionId"],
    [validateEvidenceAssertion, a.assertions[0], "documentId"],
    [validateCanonicalProposition, a.propositions[0], "propositionId"],
    [validateCanonicalProposition, a.propositions[0], "assertionIds", true],
    [validateStoryDossier, a.dossier, "dossierId"],
    [validateStoryDossier, a.dossier, "storyId"],
    [validateStoryDossier, a.dossier, "documentIds", true],
    [validateStoryDossier, a.dossier, "assertionIds", true],
    [validateStoryDossier, a.dossier, "propositionIds", true],
    [validateArticleBrief, a.brief, "briefId"],
    [validateArticleBrief, a.brief, "storyId"],
    [validateArticleBrief, a.brief, "sourceDossierId"],
    [validateArticleBrief, a.brief, "claimIds", true],
    [validateArticleClaim, a.claims[0], "claimId"],
    [validateArticleClaim, a.claims[0], "briefId"],
    [validateArticleClaim, a.claims[0], "storyId"],
    [validateArticleClaim, a.claims[0], "assertionIds", true],
    [validateSpeakingLadder, a.speakingLadder, "storyId"],
    [validateSpeakingLadder, a.speakingLadder, "claimIds", true],
    [validateRunManifest, a.runManifest, "runId"]
  ];
  for (const id of ["__proto__", "prototype", "constructor", "toString", "valueOf", "hasOwnProperty"]) {
    for (const [validator, value, field, array] of mutations) {
      assert.throws(() => validator({ ...value, [field]: array ? [id] : id }), /valid namespaced ID/, `${value.type}.${field} accepted ${id}`);
    }
  }
});

test("external source and calendar IDs accept feed formats but reject reserved and malformed values", () => {
  const a = buildOfficialMacroIntelligence(cpi, { generatedAt: cpi.fetchedAt, calendarEvents: [cpiEvent()] });
  assert.doesNotThrow(() => validateSourceDocument({ ...a.sourceDocument, sourceId: "vendor.feed:CPI_2026-06" }));

  for (const id of ["__proto__", "prototype", "constructor", "toString", "valueOf", "hasOwnProperty", "", "has space", "calendar/cpi", "-leading", "trailing-", "évent"]) {
    assert.throws(() => validateSourceDocument({ ...a.sourceDocument, sourceId: id }), /non-empty string|valid external ID/, `SourceDocument.sourceId accepted ${JSON.stringify(id)}`);
    for (const field of ["consensus", "prior"]) {
      const baseline = a.brief.consensusBaseline;
      assert.throws(() => validateArticleBrief({
        ...a.brief,
        consensusBaseline: { ...baseline, [field]: { ...baseline[field], eventId: id } }
      }), /non-empty string|valid external ID/, `consensusBaseline.${field}.eventId accepted ${JSON.stringify(id)}`);
    }
  }
});

test("RunManifest editionId matches the UTC run date", () => {
  const manifest = buildOfficialMacroIntelligence(cpi, { generatedAt: cpi.fetchedAt }).runManifest;
  assert.throws(() => validateRunManifest({ ...manifest, editionId: "2025-06-10" }), /timestamps must fall on the editionId UTC date/);
  assert.throws(() => validateRunManifest({ ...manifest, startedAt: "2026-06-11T00:00:00.000Z", completedAt: "2026-06-11T00:00:00.000Z" }), /timestamps must fall on the editionId UTC date/);
  assert.throws(() => validateRunManifest({ ...manifest, completedAt: "2026-06-11T00:00:00.000Z" }), /timestamps must fall on the editionId UTC date/);
});

test("standalone contracts enforce the namespace of every ID reference", () => {
  const a = buildOfficialMacroIntelligence(cpi, { generatedAt: cpi.fetchedAt });
  const wrong = stableId("run", "wrong-namespace");
  const cases = [
    [validateSourceDocument, { ...a.sourceDocument, documentId: wrong }],
    [validateSourceDocument, { ...a.sourceDocument, retrievalId: wrong }],
    [validateEvidenceAssertion, { ...a.assertions[0], assertionId: wrong }],
    [validateEvidenceAssertion, { ...a.assertions[0], documentId: wrong }],
    [validateCanonicalProposition, { ...a.propositions[0], propositionId: wrong }],
    [validateCanonicalProposition, { ...a.propositions[0], assertionIds: [wrong] }],
    [validateStoryDossier, { ...a.dossier, dossierId: wrong }],
    [validateStoryDossier, { ...a.dossier, storyId: wrong }],
    [validateStoryDossier, { ...a.dossier, documentIds: [wrong] }],
    [validateStoryDossier, { ...a.dossier, assertionIds: [wrong] }],
    [validateStoryDossier, { ...a.dossier, propositionIds: [wrong] }],
    [validateArticleBrief, { ...a.brief, briefId: wrong }],
    [validateArticleBrief, { ...a.brief, storyId: wrong }],
    [validateArticleBrief, { ...a.brief, sourceDossierId: wrong }],
    [validateArticleBrief, { ...a.brief, claimIds: [wrong] }],
    [validateArticleClaim, { ...a.claims[0], claimId: wrong }],
    [validateArticleClaim, { ...a.claims[0], briefId: wrong }],
    [validateArticleClaim, { ...a.claims[0], storyId: wrong }],
    [validateArticleClaim, { ...a.claims[0], assertionIds: [wrong] }],
    [validateSpeakingLadder, { ...a.speakingLadder, storyId: wrong }],
    [validateSpeakingLadder, { ...a.speakingLadder, claimIds: [wrong] }]
  ];
  for (const [validator, value] of cases) assert.throws(() => validator(value), /valid namespaced ID/);
});

test("ownership edges, manifest hashes, and newly constrained local fields fail closed", () => {
  const a = buildOfficialMacroIntelligence(cpi, { generatedAt: cpi.fetchedAt });
  const invalidArtifacts = [
    { ...a, brief: { ...a.brief, sourceDossierId: stableId("dossier", "other") } },
    { ...a, brief: { ...a.brief, sourceDossierRevision: 2 } },
    { ...a, claims: [{ ...a.claims[0], briefId: stableId("brief", "other") }, ...a.claims.slice(1)] },
    { ...a, runManifest: { ...a.runManifest, inputDocumentHashes: [a.sourceDocument.contentHash, a.sourceDocument.contentHash] } },
    { ...a, runManifest: { ...a.runManifest, inputDocumentHashes: ["A".repeat(64)] } },
    { ...a, runManifest: { ...a.runManifest, configurationHash: "bad" } },
    { ...a, sourceDocument: { ...a.sourceDocument, title: 7 } },
    { ...a, assertions: [{ ...a.assertions[0], extractionMethod: "invented" }, ...a.assertions.slice(1)] },
    { ...a, assertions: [{ ...a.assertions[0], authorityClass: "secondary_report" }, ...a.assertions.slice(1)] },
    { ...a, propositions: [{ ...a.propositions[0], contradictionState: "unknown" }] },
    { ...a, dossier: { ...a.dossier, storyClass: "official_macro_pce" } },
    { ...a, dossier: { ...a.dossier, openQuestions: [7] } },
    { ...a, brief: { ...a.brief, mechanismSteps: [7] } },
    { ...a, brief: { ...a.brief, pricedInStatus: "priced_in" } },
    { ...a, runManifest: { ...a.runManifest, editionId: "2026-02-30" } },
    { ...a, runManifest: { ...a.runManifest, completedAt: "2026-06-10T12:59:59.000Z" } },
    { ...a, runManifest: { ...a.runManifest, stageStatuses: a.runManifest.stageStatuses.slice(0, -1) } },
    { ...a, runManifest: { ...a.runManifest, stageStatuses: [...a.runManifest.stageStatuses].reverse() } },
    { ...a, runManifest: { ...a.runManifest, stageStatuses: a.runManifest.stageStatuses.map((stage, index) => index ? stage : { ...stage, stage: "invented" }) } },
    { ...a, runManifest: { ...a.runManifest, stageStatuses: a.runManifest.stageStatuses.map((stage, index) => index ? stage : { ...stage, status: "pending" }) } },
    { ...a, runManifest: { ...a.runManifest, usage: { ...a.runManifest.usage, modelCalls: 0.5 } } },
    { ...a, runManifest: { ...a.runManifest, usage: { ...a.runManifest.usage, inputTokens: -1 } } }
  ];
  invalidArtifacts.forEach((artifact) => assert.throws(() => validateIntelligenceArtifact(artifact), TypeError));
});

test("contracts accept only exact plain-data records, including nested records", () => {
  const a = buildOfficialMacroIntelligence(cpi, { generatedAt: cpi.fetchedAt, calendarEvents: [cpiEvent()] });
  class ArtifactRecord {}
  assert.throws(() => validateIntelligenceArtifact(Object.assign(new ArtifactRecord(), a)), /plain-data object/);
  const hidden = (record) => Object.defineProperty({ ...record }, "hiddenExtra", { value: true, enumerable: false });
  const symbol = (record) => Object.assign({ ...record }, { [Symbol("extra")]: true });
  const variants = [
    hidden(a),
    { ...a, sourceDocument: symbol(a.sourceDocument) },
    { ...a, assertions: [{ ...a.assertions[0], sourceSpan: hidden(a.assertions[0].sourceSpan) }, ...a.assertions.slice(1)] },
    { ...a, dossier: { ...a.dossier, evidenceCoverage: symbol(a.dossier.evidenceCoverage) } },
    { ...a, brief: { ...a.brief, consensusBaseline: hidden(a.brief.consensusBaseline) } },
    { ...a, runManifest: { ...a.runManifest, usage: symbol(a.runManifest.usage) } }
  ];
  for (const variant of variants) assert.throws(() => validateIntelligenceArtifact(variant), /invalid shape/);
});

test("aggregate semantics reject contradictory coverage, ownership, and time references", () => {
  const a = buildOfficialMacroIntelligence(cpi, { generatedAt: cpi.fetchedAt, calendarEvents: [cpiEvent()] });
  const wrong = (prefix, label) => stableId(prefix, `wrong-${label}`);
  const variants = [
    { ...a, dossier: { ...a.dossier, evidenceCoverage: { ...a.dossier.evidenceCoverage, primarySource: false } } },
    { ...a, dossier: { ...a.dossier, evidenceCoverage: { ...a.dossier.evidenceCoverage, consensusAvailable: false } } },
    { ...a, dossier: { ...a.dossier, asOf: "2026-06-10T12:59:59.000Z" } },
    { ...a, runManifest: { ...a.runManifest, storyId: wrong("story", "story") } },
    { ...a, runManifest: { ...a.runManifest, sourceDocumentIds: [wrong("doc", "document")] } },
    { ...a, runManifest: { ...a.runManifest, dossierId: wrong("dossier", "dossier") } },
    { ...a, runManifest: { ...a.runManifest, briefId: wrong("brief", "brief") } },
    { ...a, runManifest: { ...a.runManifest, speakingLadderId: wrong("speaking", "ladder") } }
  ];
  for (const variant of variants) assert.throws(() => validateIntelligenceArtifact(variant), TypeError);
});

test("RunManifest completely covers generated collections in exact order", () => {
  const a = buildOfficialMacroIntelligence(cpi, { generatedAt: cpi.fetchedAt });
  assert.deepEqual(a.runManifest.assertionIds, a.assertions.map((item) => item.assertionId));
  assert.deepEqual(a.runManifest.propositionIds, a.propositions.map((item) => item.propositionId));
  assert.deepEqual(a.runManifest.claimIds, a.claims.map((item) => item.claimId));
  for (const field of ["assertionIds", "claimIds"]) {
    const ids = a.runManifest[field];
    for (const value of [ids.slice(1), [ids[0], ids[0], ...ids.slice(2)], [...ids].reverse(), [...ids, stableId(field === "claimIds" ? "claim" : "assertion", "extra")]]) {
      assert.throws(() => validateIntelligenceArtifact({ ...a, runManifest: { ...a.runManifest, [field]: value } }), TypeError);
    }
  }
  assert.throws(() => validateIntelligenceArtifact({ ...a, runManifest: { ...a.runManifest, propositionIds: [stableId("proposition", "wrong-valid-id")] } }), /exactly cover/);
  assert.throws(() => validateRunManifest({ ...a.runManifest, assertionIds: [stableId("claim", "wrong-namespace")] }), /valid namespaced ID/);
});

test("source and matched calendar timestamps reject temporal contradictions", () => {
  const a = buildOfficialMacroIntelligence(cpi, { generatedAt: cpi.fetchedAt, calendarEvents: [cpiEvent()] });
  assert.throws(() => validateSourceDocument({ ...a.sourceDocument, fetchedAt: "2026-06-10T12:29:59.000Z" }), /publishedAt must not follow fetchedAt/);
  for (const field of ["consensus", "prior"]) {
    const baseline = a.brief.consensusBaseline;
    assert.throws(() => validateIntelligenceArtifact({ ...a, brief: { ...a.brief, consensusBaseline: { ...baseline, [field]: { ...baseline[field], scheduledFor: "2026-06-09T12:30:00.000Z" } } } }), TypeError);
  }
  assert.doesNotThrow(() => buildOfficialMacroIntelligence(cpi, { generatedAt: cpi.fetchedAt, calendarEvents: [cpiEvent({ consensus: null, prior: null })] }));
});

test("historical build timestamp selection stays on edition date and preserves explicit now", () => {
  const wallClock = new Date("2026-07-11T10:00:00.000Z");
  assert.equal(selectBuildNow("2026-06-10", undefined, wallClock).toISOString(), "2026-06-10T23:59:59.999Z");
  assert.equal(selectBuildNow("2026-07-11", undefined, wallClock).toISOString(), wallClock.toISOString());
  assert.equal(selectBuildNow("2026-06-10", "2026-06-10T14:00:00.000Z", wallClock).toISOString(), "2026-06-10T14:00:00.000Z");
  assert.doesNotThrow(() => buildOfficialMacroIntelligence(cpi, { editionId: "2026-06-10", generatedAt: selectBuildNow("2026-06-10", undefined, wallClock).toISOString() }));
});
