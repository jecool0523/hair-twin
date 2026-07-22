import { describe, expect, it } from "vitest";
import { canRetry, canTransition, retryTuning, MAX_JOB_ATTEMPTS } from "./job";

describe("job lifecycle", () => {
  it("allows legal transitions and rejects illegal ones", () => {
    expect(canTransition("created", "queued")).toBe(true);
    expect(canTransition("generating", "quality_checking")).toBe(true);
    expect(canTransition("completed", "generating")).toBe(false);
    expect(canTransition("deleted", "queued")).toBe(false);
  });

  it("permits retry only while retryable and under the attempt cap", () => {
    expect(canRetry(1, "failed_retryable")).toBe(true);
    expect(canRetry(MAX_JOB_ATTEMPTS, "failed_retryable")).toBe(false);
    expect(canRetry(1, "completed")).toBe(false);
  });

  it("shrinks the edit mask on later attempts", () => {
    expect(retryTuning(2).expansionRadius).toBeGreaterThan(
      retryTuning(3).expansionRadius,
    );
    expect(retryTuning(3).stricterPrompt).toBe(true);
  });
});
