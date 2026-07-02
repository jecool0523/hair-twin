import { GoogleGenAI, Type } from "@google/genai";
import { BodyAnalysis } from "../types";

// Ensure API Key is available
const apiKey = process.env.API_KEY || '';

const ai = new GoogleGenAI({ apiKey });

/**
 * Analyzes a body image to estimate measurements and shape.
 */
export const analyzeBodyImage = async (base64Image: string): Promise<BodyAnalysis> => {
  if (!apiKey) throw new Error("API Key is missing");

  // Remove data URL prefix if present for processing
  const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|webp);base64,/, "");

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: cleanBase64,
            },
          },
          {
            text: `Analyze this person's body structure for a clothing try-on application. 
                   Estimate relative proportions. Be polite and professional.
                   Provide the output strictly in JSON format.`,
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            heightEstimate: { type: Type.STRING, description: "Estimated height description (e.g., 'Tall', 'Average')" },
            shoulderWidth: { type: Type.STRING, description: "Description of shoulder width" },
            bodyShape: { type: Type.STRING, description: "General body shape description (e.g., 'Athletic', 'Slim', 'Curvy')" },
            suggestedSize: { type: Type.STRING, description: "Suggested clothing size (S, M, L, XL)" },
            styleAdvice: { type: Type.STRING, description: "One sentence fashion advice based on body shape" },
          },
          required: ["heightEstimate", "shoulderWidth", "bodyShape", "suggestedSize", "styleAdvice"],
        },
      },
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");
    
    return JSON.parse(text) as BodyAnalysis;
  } catch (error) {
    console.error("Analysis failed:", error);
    throw error;
  }
};

/**
 * Generates a "Virtual Try-On" image.
 * Uses the image model to modify the user's clothes.
 * Supports either a text description OR a reference clothing image.
 */
export const generateTryOnImage = async (
  personImageBase64: string, 
  clothingDescription: string,
  clothingImageBase64?: string
): Promise<string> => {
  if (!apiKey) throw new Error("API Key is missing");

  const cleanPersonBase64 = personImageBase64.replace(/^data:image\/(png|jpeg|webp);base64,/, "");

  try {
    const parts: any[] = [
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: cleanPersonBase64,
        },
      }
    ];

    // If we have a custom clothing image, add it to the prompt parts
    if (clothingImageBase64) {
      const cleanClothingBase64 = clothingImageBase64.replace(/^data:image\/(png|jpeg|webp);base64,/, "");
      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: cleanClothingBase64,
        },
      });
      parts.push({
        text: `Using the second image (clothing) as a reference, dress the person in the first image with this item.
               Maintain the person's exact face, identity, pose, and background. 
               Adapt the fit to the person's body.
               Make it look photorealistic.`,
      });
    } else {
      // Standard Text-based Try On
      parts.push({
        text: `Replace the person's current outfit with: ${clothingDescription}. 
               Maintain the person's exact face, identity, pose, and background. 
               Make it look photorealistic. High fashion photography style.`,
      });
    }

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image", 
      contents: {
        parts: parts,
      },
    });

    // Extract image from response
    if (response.candidates && response.candidates[0].content.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData && part.inlineData.data) {
          return `data:image/png;base64,${part.inlineData.data}`;
        }
      }
    }
    
    throw new Error("No image generated.");

  } catch (error) {
    console.error("Try-on generation failed:", error);
    throw error;
  }
};
