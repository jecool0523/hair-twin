import { describe, expect, it } from "vitest";
import { evaluateQuality } from "./quality";
import type { QualitySignals } from "./types";

/**
 * These cover the quality GATE only (status + hardFail + reasons).
 * Customer exposure is a separate, response-time policy — see visibility.test.ts.
 */

const good: QualitySignals = {
  identitySimilarity: 0.96,
  landmarkDelta: 0.01,
  nonHairDiff: 0.01,
  hairCoverageRatio: 0.15,
  faceCount: 1,
  realismScore: 0.85,
  styleMatch: 0.8,
};

describe("evaluateQuality", () => {
  it("accepts a clean candidate", () => {
    const r = evaluateQuality(good);
    expect(r.status).toBe("accepted");
    expect(r.hardFail).toBe(false);
  });

  it("blocks identity change", () => {
    const r = evaluateQuality({ ...good, identitySimilarity: 0.6 });
    expect(r.status).toBe("blocked_identity_changed");
    expect(r.hardFail).toBe(true);
  });

  it("blocks when landmarks shift too much", () => {
    const r = evaluateQuality({ ...good, landmarkDelta: 0.2 });
    expect(r.status).toBe("blocked_identity_changed");
    expect(r.hardFail).toBe(true);
  });

  it("blocks non-hair region change", () => {
    const r = evaluateQuality({ ...good, nonHairDiff: 0.2 });
    expect(r.status).toBe("blocked_non_hair_changed");
    expect(r.hardFail).toBe(true);
  });

  it("blocks when more than one face is present", () => {
    const r = evaluateQuality({ ...good, faceCount: 2 });
    expect(r.hardFail).toBe(true);
  });

  it("flags borderline identity for stylist review", () => {
    const r = evaluateQuality({ ...good, identitySimilarity: 0.86 });
    expect(r.status).toBe("needs_stylist_review");
    expect(r.hardFail).toBe(false);
    expect(r.softFlags.length).toBeGreaterThan(0);
  });

  it("requests regeneration when hair is barely separated", () => {
    const r = evaluateQuality({ ...good, hairCoverageRatio: 0.005 });
    expect(r.status).toBe("regenerate");
    expect(r.hardFail).toBe(false);
  });

  it("never decides customer visibility itself", () => {
    // The gate must not carry a customerVisible flag; exposure is derived later
    // from the stylist verdict (policy rule 5).
    const r = evaluateQuality(good) as unknown as Record<string, unknown>;
    expect("customerVisible" in r).toBe(false);
  });
});
