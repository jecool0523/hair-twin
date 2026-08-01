import { describe, expect, it } from "vitest";
import {
  assertCandidateCountAllowed,
  CandidateCountNotAllowedError,
  generationPolicy,
} from "./generation-policy";

describe("generation provider candidate policy", () => {
  it("defaults the actual OpenAI demo to one candidate", () => {
    const env = {
      HAIR_TWIN_PROVIDER: "openai",
      OPENAI_IMAGE_MAX_CANDIDATES_PER_JOB: "1",
    };
    expect(generationPolicy(env)).toMatchObject({
      provider: "openai",
      candidateOptions: [1],
      defaultCandidateCount: 1,
    });
    expect(() => assertCandidateCountAllowed(1, env)).not.toThrow();
  });

  it("keeps two through four candidates available for mock demos", () => {
    const env = { HAIR_TWIN_PROVIDER: "mock" };
    expect(generationPolicy(env).candidateOptions).toEqual([2, 3, 4]);
    for (const count of [2, 3, 4]) {
      expect(() => assertCandidateCountAllowed(count, env)).not.toThrow();
    }
  });

  it("rejects a count over the actual provider limit with a Korean message", () => {
    const env = {
      HAIR_TWIN_PROVIDER: "openai",
      OPENAI_IMAGE_MAX_CANDIDATES_PER_JOB: "1",
    };
    expect(() => assertCandidateCountAllowed(2, env)).toThrow(
      CandidateCountNotAllowedError,
    );
    expect(() => assertCandidateCountAllowed(2, env)).toThrow("후보 1개 이하만");
  });
});
