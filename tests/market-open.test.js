import test from "node:test";
import assert from "node:assert/strict";
import { shouldRunMarketOpen } from "../scripts/should-run-market-open.js";

test("runs at 9:35 AM New York during daylight saving time", () => {
  const check = shouldRunMarketOpen(new Date("2026-06-01T13:35:00Z"), "schedule");
  assert.equal(check.shouldRun, true);
});

test("runs at 9:35 AM New York during standard time", () => {
  const check = shouldRunMarketOpen(new Date("2026-12-01T14:35:00Z"), "schedule");
  assert.equal(check.shouldRun, true);
});

test("skips the duplicate off-season UTC schedule", () => {
  const check = shouldRunMarketOpen(new Date("2026-06-01T14:35:00Z"), "schedule");
  assert.equal(check.shouldRun, false);
});

test("skips NYSE full holidays", () => {
  const check = shouldRunMarketOpen(new Date("2026-12-25T14:35:00Z"), "schedule");
  assert.equal(check.shouldRun, false);
});

test("manual dispatch always runs", () => {
  const check = shouldRunMarketOpen(new Date("2026-12-25T14:35:00Z"), "workflow_dispatch");
  assert.equal(check.shouldRun, true);
});
