/**
 * Prompt contract (ai-generation-design §7).
 *
 * Prompts are generated from structured style presets, never free text, and
 * always carry the hair-only + identity-preservation constraints. This module
 * is provider-agnostic; adapters decide how to send the prompt.
 */
import type { StylePreset } from "./types";

export interface HairPrompt {
  positive: string;
  negative: string;
  normalizedStyle: string;
}

const NEGATIVE_PROMPT = [
  "Do not change the face, eyes, nose, mouth, eyebrows, jaw, skin tone, expression, body, clothing, background, camera angle, or age.",
  "Do not beautify the person.",
  "Do not make the output look illustrated, cinematic, fantasy, plastic, airbrushed, or heavily retouched.",
  "Do not add accessories.",
  "Do not change the customer's identity.",
].join(" ");

export function buildHairPrompt(
  preset: StylePreset,
  opts: { stricter?: boolean } = {},
): HairPrompt {
  const normalizedStyle = [
    preset.length,
    preset.bangs,
    preset.parting,
    preset.silhouette,
    preset.texture,
    preset.volume,
    `${preset.color.tone} (level ${preset.color.level})`,
  ]
    .filter((s) => s && s !== "unchanged")
    .join(", ");

  const positive = [
    "Edit only the hair inside the provided mask.",
    "Preserve the same person, face identity, expression, skin tone, facial structure, pose, clothing, and background.",
    `Create a realistic salon consultation preview of ${preset.displayNameKo}.`,
    `Hair attributes: ${normalizedStyle}.`,
    "The result should look like a practical salon outcome, not a beauty filter or fashion editorial.",
    "Keep lighting and camera perspective consistent with the original photo.",
    opts.stricter
      ? "Apply the smallest change necessary; keep the edit strictly within the hair mask."
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return { positive, negative: NEGATIVE_PROMPT, normalizedStyle };
}
