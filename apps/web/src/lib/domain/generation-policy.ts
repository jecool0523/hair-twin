export interface GenerationPolicy {
  provider: "mock" | "openai";
  candidateOptions: number[];
  defaultCandidateCount: number;
  costNoticeKo: string;
}

interface GenerationEnvironment {
  [key: string]: string | undefined;
  HAIR_TWIN_PROVIDER?: string;
  OPENAI_IMAGE_MAX_CANDIDATES_PER_JOB?: string;
}

export class CandidateCountNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CandidateCountNotAllowedError";
  }
}

/**
 * One server-owned policy is shared by the page and job creation boundary.
 * The database contract intentionally remains 1..4; this is the narrower,
 * deployment-specific cost gate for the configured provider.
 */
export function generationPolicy(
  env: GenerationEnvironment = process.env,
): GenerationPolicy {
  const provider = env.HAIR_TWIN_PROVIDER?.trim().toLowerCase();
  if (provider === "openai") {
    const configured = Number(env.OPENAI_IMAGE_MAX_CANDIDATES_PER_JOB ?? "1");
    const maximum =
      Number.isInteger(configured) && configured >= 1 && configured <= 4
        ? configured
        : 1;
    const candidateOptions = Array.from({ length: maximum }, (_, index) => index + 1);
    return {
      provider: "openai",
      candidateOptions,
      defaultCandidateCount: 1,
      costNoticeKo:
        "실제 AI는 후보 수만큼 생성 비용이 늘어납니다. 현재 시연 기본값은 후보 1개·HTTP 시도 1회이며, 정확한 예상 비용은 유료 호출 승인 단계에서 공식 가격으로 확인합니다.",
    };
  }

  return {
    provider: "mock",
    candidateOptions: [2, 3, 4],
    defaultCandidateCount: 3,
    costNoticeKo: "Mock 시연은 외부 AI 호출 비용 없이 후보 2~4개를 생성합니다.",
  };
}

export function assertCandidateCountAllowed(
  candidateCount: number,
  env: GenerationEnvironment = process.env,
): void {
  const policy = generationPolicy(env);
  // The shared API/DB contract remains 1..4. Mock UI keeps its existing 2..4
  // choices, while internal integration fixtures may still exercise one.
  if (
    policy.provider === "mock" &&
    Number.isInteger(candidateCount) &&
    candidateCount >= 1 &&
    candidateCount <= 4
  ) {
    return;
  }
  if (!policy.candidateOptions.includes(candidateCount)) {
    const maximum = Math.max(...policy.candidateOptions);
    throw new CandidateCountNotAllowedError(
      policy.provider === "openai"
        ? `현재 실제 AI 설정에서는 후보 ${maximum}개 이하만 생성할 수 있습니다. 비용 제한과 worker 설정을 확인해 주세요.`
        : "현재 Mock 설정에서는 후보 1~4개만 생성할 수 있습니다.",
    );
  }
}
