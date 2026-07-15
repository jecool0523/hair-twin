// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GenerationProgress } from "./GenerationProgress";
import type { JobView } from "@/lib/dto";

function job(over: Partial<JobView> = {}): JobView {
  return {
    id: "j1",
    status: "queued",
    attempts: 1,
    maxAttempts: 3,
    candidates: [],
    approvedCount: 0,
    ...over,
  };
}

describe("GenerationProgress", () => {
  it("keeps the status badge out of the heading", () => {
    render(<GenerationProgress job={job()} onRetry={vi.fn()} />);
    // Regression: the badge used to be nested inside CardTitle, so assistive
    // tech announced "생성 진행 상태대기열 등록" as one run-on heading.
    const heading = screen.getByRole("heading", { name: "생성 진행 상태" });
    expect(heading.textContent).toBe("생성 진행 상태");
    // The status is still conveyed, just not inside the heading.
    expect(screen.getAllByText("대기열 등록").length).toBeGreaterThan(0);
  });

  it("announces status changes politely", () => {
    const { container } = render(
      <GenerationProgress job={job({ status: "generating" })} onRetry={vi.fn()} />,
    );
    const live = container.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toContain("후보 생성 중");
  });

  it("offers retry with the failure reason when retryable", () => {
    render(
      <GenerationProgress
        job={job({
          status: "failed_retryable",
          failureReason: "자동 검수를 통과한 후보가 없습니다.",
          attempts: 2,
        })}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText("자동 검수를 통과한 후보가 없습니다.")).toBeDefined();
    expect(
      screen.getByRole("button", { name: /재시도/ }),
    ).toBeDefined();
  });

  it("stops offering retry once the failure is hard", () => {
    render(
      <GenerationProgress
        job={job({ status: "failed_hard", failureReason: "실패" })}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /재시도/ })).toBeNull();
    expect(screen.getByText(/재시도 한도/)).toBeDefined();
  });
});
