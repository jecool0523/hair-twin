import { describe, expect, it } from "vitest";
import {
  approvedCount,
  canStylistApprove,
  isCustomerVisible,
  notApprovableReason,
} from "./visibility";
import type { QualityStatus, StylistVerdict } from "./types";

const q = (status: QualityStatus, hardFail = false) => ({ status, hardFail });

describe("customer exposure policy", () => {
  // ---- The three cases reported from the browser verification ----
  describe("reported cases", () => {
    it("case 1: accepted + stylist marked 재생성 => NOT visible", () => {
      // Was: customerVisible stayed true after the stylist rejected it.
      expect(isCustomerVisible(q("accepted"), "regenerate")).toBe(false);
    });

    it("case 2: needs_stylist_review + stylist approved => visible", () => {
      // Was: stylist approval had no effect, stayed hidden.
      expect(isCustomerVisible(q("needs_stylist_review"), "usable")).toBe(true);
    });

    it("case 3: accepted + no verdict at all => NOT visible", () => {
      // Was: auto-QC alone exposed it to the customer with zero review.
      expect(isCustomerVisible(q("accepted"), undefined)).toBe(false);
    });
  });

  // ---- Policy rule 3: hard fail / regenerate can never be exposed ----
  describe("hard-fail bypass prevention", () => {
    const blocked: QualityStatus[] = [
      "blocked_identity_changed",
      "blocked_non_hair_changed",
      "blocked_low_realism",
      "blocked_policy_or_safety",
    ];

    it.each(blocked)(
      "%s stays hidden even with an explicit usable verdict",
      (status) => {
        expect(isCustomerVisible(q(status, true), "usable")).toBe(false);
        expect(canStylistApprove(q(status, true))).toBe(false);
      },
    );

    it("regenerate stays hidden even with a usable verdict", () => {
      expect(isCustomerVisible(q("regenerate"), "usable")).toBe(false);
      expect(canStylistApprove(q("regenerate"))).toBe(false);
    });

    it("a hardFail flag overrides an otherwise-approvable status", () => {
      // Defence in depth: status says accepted but hardFail is set.
      expect(canStylistApprove(q("accepted", true))).toBe(false);
      expect(isCustomerVisible(q("accepted", true), "usable")).toBe(false);
    });
  });

  // ---- Policy rule 2: approvable set ----
  describe("approvable statuses", () => {
    it("accepted and needs_stylist_review are approvable", () => {
      expect(canStylistApprove(q("accepted"))).toBe(true);
      expect(canStylistApprove(q("needs_stylist_review"))).toBe(true);
    });

    it("non-usable verdicts never expose an approvable candidate", () => {
      const verdicts: Array<StylistVerdict | undefined> = [
        "needs_manual_review",
        "regenerate",
        undefined,
      ];
      for (const v of verdicts) {
        expect(isCustomerVisible(q("accepted"), v)).toBe(false);
      }
    });

    it("gives a Korean reason when approval is impossible", () => {
      expect(notApprovableReason(q("blocked_identity_changed", true))).toContain(
        "고객 노출 불가",
      );
      expect(notApprovableReason(q("regenerate"))).toContain("고객 노출 불가");
      expect(notApprovableReason(q("accepted"))).toBeUndefined();
    });
  });

  // ---- Policy rule 6: customer view gating ----
  describe("approvedCount", () => {
    it("counts only approved+approvable candidates", () => {
      const n = approvedCount([
        { quality: q("accepted"), stylistVerdict: "usable" }, // counts
        { quality: q("needs_stylist_review"), stylistVerdict: "usable" }, // counts
        { quality: q("accepted"), stylistVerdict: "regenerate" }, // no
        { quality: q("accepted") }, // no verdict -> no
        { quality: q("blocked_identity_changed", true), stylistVerdict: "usable" }, // no
        { quality: q("regenerate"), stylistVerdict: "usable" }, // no
      ]);
      expect(n).toBe(2);
    });

    it("is zero before any stylist review, so customer view stays gated", () => {
      expect(
        approvedCount([{ quality: q("accepted") }, { quality: q("accepted") }]),
      ).toBe(0);
    });
  });
});
