// @vitest-environment jsdom
/**
 * UI-level proof of the customer exposure policy (rules 1 + 3 + 4).
 * The customer surface must never render an unapproved candidate, and must show
 * the calm "미용사 검수 중" state instead.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CandidateCompare } from "./CandidateCompare";
import type { CandidateView, JobView } from "@/lib/dto";

function candidate(over: Partial<CandidateView>): CandidateView {
  return {
    id: "c1",
    jobId: "j1",
    variantLabel: "후보 1",
    mediaUrl: "/api/media/tok",
    qualityStatus: "accepted",
    customerVisible: false,
    canApprove: true,
    hardFail: false,
    softFlags: [],
    hardReasons: [],
    signals: {
      identitySimilarity: 0.95,
      nonHairDiff: 0.02,
      realismScore: 0.8,
      styleMatch: 0.8,
      landmarkDelta: 0.01,
    },
    ...over,
  };
}

function job(candidates: CandidateView[]): JobView {
  return {
    id: "j1",
    status: "completed",
    attempts: 1,
    maxAttempts: 3,
    candidates,
    approvedCount: candidates.filter((c) => c.customerVisible).length,
  };
}

const noop = vi.fn();
const empty = new Set<string>();

describe("CandidateCompare — customer surface", () => {
  it("rule 4: shows 미용사 검수 중 when nothing is approved yet", () => {
    render(
      <CandidateCompare
        job={job([
          candidate({ id: "a", qualityStatus: "accepted", customerVisible: false }),
          candidate({
            id: "b",
            qualityStatus: "blocked_identity_changed",
            hardFail: true,
            canApprove: false,
            customerVisible: false,
          }),
        ])}
        sourceUrl="/api/media/src"
        mode="customer"
        onVerdict={noop}
        selectedForSave={empty}
        onToggleSave={noop}
      />,
    );
    expect(screen.getByText("미용사 검수 중")).toBeDefined();
    // No candidate images, no QC internals on the customer surface.
    expect(screen.queryByAltText("후보 1")).toBeNull();
    expect(screen.queryByText(/얼굴 유사도/)).toBeNull();
  });

  it("rule 1: customer sees only the approved candidate", () => {
    render(
      <CandidateCompare
        job={job([
          candidate({
            id: "a",
            variantLabel: "승인됨",
            customerVisible: true,
            stylistVerdict: "usable",
          }),
          candidate({
            id: "b",
            variantLabel: "미승인",
            customerVisible: false,
          }),
          candidate({
            id: "c",
            variantLabel: "차단됨",
            hardFail: true,
            canApprove: false,
            qualityStatus: "blocked_identity_changed",
            customerVisible: false,
          }),
        ])}
        sourceUrl="/api/media/src"
        mode="customer"
        onVerdict={noop}
        selectedForSave={empty}
        onToggleSave={noop}
      />,
    );
    expect(screen.getByAltText("승인됨")).toBeDefined();
    expect(screen.queryByAltText("미승인")).toBeNull();
    expect(screen.queryByAltText("차단됨")).toBeNull();
    // QC scores stay on the stylist surface only.
    expect(screen.queryByText(/얼굴 유사도/)).toBeNull();
  });
});

describe("CandidateCompare — stylist surface", () => {
  it("rule 3: offers no approval control for a hard-failed candidate", () => {
    render(
      <CandidateCompare
        job={job([
          candidate({
            id: "c",
            variantLabel: "차단됨",
            hardFail: true,
            canApprove: false,
            qualityStatus: "blocked_identity_changed",
            notApprovableReason: "자동 검수 차단됨 · 미용사 판정으로도 고객 노출 불가",
            customerVisible: false,
          }),
        ])}
        sourceUrl="/api/media/src"
        mode="stylist"
        onVerdict={noop}
        selectedForSave={empty}
        onToggleSave={noop}
      />,
    );
    expect(screen.queryByRole("button", { name: "사용 가능" })).toBeNull();
    expect(
      screen.getByText("자동 검수 차단됨 · 미용사 판정으로도 고객 노출 불가"),
    ).toBeDefined();
  });

  it("rule 2: offers approval for needs_stylist_review", () => {
    render(
      <CandidateCompare
        job={job([
          candidate({
            id: "r",
            qualityStatus: "needs_stylist_review",
            canApprove: true,
            softFlags: ["얼굴 유사도가 경계값 근처"],
          }),
        ])}
        sourceUrl="/api/media/src"
        mode="stylist"
        onVerdict={noop}
        selectedForSave={empty}
        onToggleSave={noop}
      />,
    );
    expect(screen.getByRole("button", { name: "사용 가능" })).toBeDefined();
    expect(screen.getByText("고객 비노출")).toBeDefined();
  });
});
