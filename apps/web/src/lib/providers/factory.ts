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

  if (choice === "openai" && key) {
    return new OpenAIHairProvider(
      key,
      process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1",
    );
  }
  // Default and fallback: mock. Never require a key to run the flow.
  return new MockHairProvider();
}
