import path from "path";
import type { IncomingMessage, ServerResponse } from "http";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const readJsonBody = async (req: IncomingMessage): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
      if (body.length > 16 * 1024 * 1024) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });

const sendJson = (res: ServerResponse, status: number, payload: Record<string, unknown>) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
};

const dataUrlToBlob = (dataUrl: string) => {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/);
  if (!match) {
    throw new Error("sourceImage must be a base64 data URL.");
  }

  const mimeType = match[1] === "image/jpg" ? "image/jpeg" : match[1];
  return new Blob([Buffer.from(match[2], "base64")], { type: mimeType });
};

const openAiImageMiddleware = (env: Record<string, string>) => ({
  name: "hair-twin-openai-image-api",
  configureServer(server) {
    server.middlewares.use("/api/hair-twin/generate-image", async (req, res) => {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: { message: "Method not allowed." } });
        return;
      }

      try {
        const body = await readJsonBody(req);
        const sourceImage = typeof body.sourceImage === "string" ? body.sourceImage : "";
        const prompt = typeof body.prompt === "string" ? body.prompt : "";
        const requestApiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
        const requestModel = typeof body.model === "string" ? body.model.trim() : "";
        const requestQuality = typeof body.quality === "string" ? body.quality.trim() : "";
        const apiKey = requestApiKey || process.env.OPENAI_API_KEY || env.OPENAI_API_KEY;
        const model = requestModel || process.env.OPENAI_IMAGE_MODEL || env.OPENAI_IMAGE_MODEL || "gpt-image-2";
        const quality = requestQuality || process.env.OPENAI_IMAGE_QUALITY || env.OPENAI_IMAGE_QUALITY || "medium";

        if (!apiKey) {
          sendJson(res, 401, {
            error: {
              code: "missing_api_key",
              message: "OpenAI API key is missing. Enter a key in the Hair Twin UI or set OPENAI_API_KEY in .env.local."
            }
          });
          return;
        }

        if (!sourceImage || !prompt) {
          sendJson(res, 400, { error: { message: "sourceImage and prompt are required." } });
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
          sendJson(res, openAiResponse.status, {
            error: payload?.error ?? { message: "OpenAI image edit request failed." },
            retryAfterSeconds: retryAfter ? Number.parseInt(retryAfter, 10) : undefined
          });
          return;
        }

        const imageBase64 = payload?.data?.[0]?.b64_json;
        if (!imageBase64) {
          sendJson(res, 502, { error: { message: "OpenAI response did not include b64_json image data." } });
          return;
        }

        sendJson(res, 200, {
          image: `data:image/png;base64,${imageBase64}`,
          model,
          usage: payload?.usage
        });
      } catch (error) {
        sendJson(res, 500, {
          error: {
            message: error instanceof Error ? error.message : "Unexpected local image generation error."
          }
        });
      }
    });
  }
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    server: {
      port: 3000,
      host: "0.0.0.0"
    },
    plugins: [react(), openAiImageMiddleware(env)],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src")
      }
    }
  };
});
