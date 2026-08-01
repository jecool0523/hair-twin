/**
 * Provider selection (server-side only). Reads env; never runs in the browser.
 */
import "server-only";
import type { HairGenerationProvider } from "./adapter";
import { MockHairProvider } from "./mock";
import { OpenAIHairProvider } from "./openai";

export function createProvider(): HairGenerationProvider {
  const choice = (process.env.HAIR_TWIN_PROVIDER ?? "mock").toLowerCase();
  const key = process.env.OPENAI_API_KEY?.trim();

  if (choice === "openai") {
    if (!key || !process.env.OPENAI_IMAGE_MODEL?.trim()) {
      throw new Error("실제 AI provider의 비밀키와 승인된 모델 설정이 필요합니다.");
    }
    return new OpenAIHairProvider(
      key,
      process.env.OPENAI_IMAGE_MODEL,
    );
  }
  if (choice === "mock") {
    const allowMock = process.env.HAIR_TWIN_ALLOW_MOCK?.toLowerCase();
    if (allowMock === "true" || process.env.NODE_ENV === "test") {
      return new MockHairProvider();
    }
    throw new Error("Mock provider는 명시적인 로컬/테스트 opt-in이 필요합니다.");
  }
  throw new Error("지원하지 않는 Hair Twin provider 설정입니다.");
}
