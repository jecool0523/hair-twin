interface ApiRequest {
  method?: string;
  body?: unknown;
  on: (event: string, callback: (chunk?: Buffer) => void) => void;
}

interface ApiResponse {
  status: (code: number) => ApiResponse;
  json: (payload: unknown) => void;
}

const readJsonBody = async (req: ApiRequest): Promise<Record<string, unknown>> => {
  if (req.body && typeof req.body === "object") {
    return req.body as Record<string, unknown>;
  }

  if (typeof req.body === "string") {
    return JSON.parse(req.body);
  }

  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk?: Buffer) => {
      body += chunk?.toString("utf8") ?? "";
      if (body.length > 16 * 1024 * 1024) {
        reject(new Error("Request body is too large."));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", (error?: Buffer) => reject(error));
  });
};

const dataUrlToBlob = (dataUrl: string) => {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/);
  if (!match) {
    throw new Error("sourceImage must be a base64 data URL.");
  }

  const mimeType = match[1] === "image/jpg" ? "image/jpeg" : match[1];
  return new Blob([Buffer.from(match[2], "base64")], { type: mimeType });
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: { message: "Method not allowed." } });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const sourceImage = typeof body.sourceImage === "string" ? body.sourceImage : "";
    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    const requestApiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    const requestModel = typeof body.model === "string" ? body.model.trim() : "";
    const requestQuality = typeof body.quality === "string" ? body.quality.trim() : "";
    const apiKey = requestApiKey || process.env.OPENAI_API_KEY;
    const model = requestModel || process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
    const quality = requestQuality || process.env.OPENAI_IMAGE_QUALITY || "medium";

    if (!apiKey) {
      res.status(401).json({
        error: {
          code: "missing_api_key",
          message: "OpenAI API key is missing. Enter a key in the Hair Twin UI or set OPENAI_API_KEY in Vercel."
        }
      });
      return;
    }

    if (!sourceImage || !prompt) {
      res.status(400).json({ error: { message: "sourceImage and prompt are required." } });
      return;
    }

    const form = new FormData();
    form.append("model", model);
    form.append("image[]", dataUrlToBlob(sourceImage), "customer-reference.png");
    form.append("prompt", prompt);
    form.append("size", "1024x1536");
    form.append("quality", quality);
    form.append("output_format", "png");

    const openAiResponse = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: form
    });

    const retryAfter = openAiResponse.headers.get("retry-after");
    const payload = await openAiResponse.json().catch(() => null);

    if (!openAiResponse.ok) {
      res.status(openAiResponse.status).json({
        error: payload?.error ?? { message: "OpenAI image edit request failed." },
        retryAfterSeconds: retryAfter ? Number.parseInt(retryAfter, 10) : undefined
      });
      return;
    }

    const imageBase64 = payload?.data?.[0]?.b64_json;
    if (!imageBase64) {
      res.status(502).json({ error: { message: "OpenAI response did not include b64_json image data." } });
      return;
    }

    res.status(200).json({
      image: `data:image/png;base64,${imageBase64}`,
      model,
      usage: payload?.usage
    });
  } catch (error) {
    res.status(500).json({
      error: {
        message: error instanceof Error ? error.message : "Unexpected image generation error."
      }
    });
  }
}
