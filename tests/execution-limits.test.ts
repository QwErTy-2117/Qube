/**
 * Execution-limit tests: every loop bound is configurable, clamped, and
 * finite even when the environment is nonsense.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  boundedInt,
  computeRoundLimit,
  maxConcurrentRuns,
  maxStepsPerRound,
  maxVerificationRounds,
} from "@/lib/pi/execution-limits";
import { maxSilentRounds } from "@/lib/pi/continuation";

describe("boundedInt", () => {
  it("falls back on empty/invalid input", () => {
    assert.equal(boundedInt(undefined, 7, 1, 10), 7);
    assert.equal(boundedInt("", 7, 1, 10), 7);
    assert.equal(boundedInt("nope", 7, 1, 10), 7);
    assert.equal(boundedInt("3.9", 7, 1, 10), 3);
  });

  it("clamps both ends", () => {
    assert.equal(boundedInt("0", 7, 1, 10), 1);
    assert.equal(boundedInt("-5", 7, 1, 10), 1);
    assert.equal(boundedInt("9999", 7, 1, 10), 10);
  });
});

describe("harness limits", () => {
  it("defaults to documented values", () => {
    assert.equal(maxStepsPerRound(undefined), 60);
    assert.equal(maxVerificationRounds(undefined), 2);
    assert.equal(maxConcurrentRuns(undefined), 32);
  });

  it("honors valid overrides", () => {
    assert.equal(maxStepsPerRound("120"), 120);
    assert.equal(maxVerificationRounds("5"), 5);
    assert.equal(maxConcurrentRuns("4"), 4);
  });

  it("clamps hostile overrides", () => {
    assert.equal(maxStepsPerRound("100000"), 500);
    assert.equal(maxStepsPerRound("0"), 1);
    assert.equal(maxVerificationRounds("999"), 10);
    assert.equal(maxVerificationRounds("-1"), 0);
    assert.equal(maxConcurrentRuns("0"), 1);
    assert.equal(maxConcurrentRuns("9999"), 128);
  });

  it("caps silent continuations", () => {
    const prev = process.env.QUBE_SILENT_CONTINUATIONS;
    try {
      process.env.QUBE_SILENT_CONTINUATIONS = "100000";
      assert.equal(maxSilentRounds(), 100);
      process.env.QUBE_SILENT_CONTINUATIONS = "-1";
      assert.equal(maxSilentRounds(), 8);
    } finally {
      if (prev === undefined) delete process.env.QUBE_SILENT_CONTINUATIONS;
      else process.env.QUBE_SILENT_CONTINUATIONS = prev;
    }
  });
});

describe("computeRoundLimit", () => {
  it("adds both budgets plus fixed slack", () => {
    assert.equal(computeRoundLimit(8, 2), 18);
    assert.equal(computeRoundLimit(0, 0), 8);
  });

  it("is finite even for absurd inputs", () => {
    assert.equal(computeRoundLimit(Number.POSITIVE_INFINITY, Number.NaN), 8);
    assert.equal(computeRoundLimit(-5, -5), 8);
    const limit = computeRoundLimit(100, 10);
    assert.equal(limit, 118);
    assert.ok(Number.isFinite(limit));
  });
});
