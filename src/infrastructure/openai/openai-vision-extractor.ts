import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import {
  screenshotExtractionSchema,
  type ScreenshotExtraction,
  type VisionExtractionRequest,
  type VisionExtractor,
} from "@/application/imports/vision-extractor";

const EXTRACTION_PROMPT = `You extract investment holdings from a screenshot for a personal portfolio monitor.

Rules:
- Extract only facts visible in the image. Never invent a value.
- Preserve institution and instrument names exactly as shown, in their original script. Never translate, romanize, or anglicize source names.
- Use null when a value, date, currency, code, quantity, cost basis, or return is not visible.
- Keep decimal values as plain strings without currency symbols or thousands separators.
- A displayed current/holding amount is marketValue. A displayed accumulated/holding profit is reportedPriorReturn.
- Do not treat the current market value as invested principal.
- confidence describes OCR certainty, not investment quality.
- Write warnings and explanations in English, while preserving any embedded source name in its original script.
- Add a warning for cropped rows, ambiguous labels, inferred currency, or missing units.
- Return every visible holding row, but ignore advertisements and recommended products.
- This is data transcription only, never financial advice.`;

export class OpenAIVisionExtractor implements VisionExtractor {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async extract(
    request: VisionExtractionRequest,
  ): Promise<ScreenshotExtraction> {
    const base64 = Buffer.from(request.image).toString("base64");
    const hint = request.sourceAccountHint
      ? `The user says this screenshot is from: ${request.sourceAccountHint}. Treat this only as a hint.`
      : "No source-account hint was provided.";

    const response = await this.client.responses.parse({
      model: this.model,
      store: false,
      input: [
        {
          role: "developer",
          content: EXTRACTION_PROMPT,
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: hint },
            {
              type: "input_image",
              image_url: `data:${request.mimeType};base64,${base64}`,
              detail: "high",
            },
          ],
        },
      ],
      text: {
        format: zodTextFormat(
          screenshotExtractionSchema,
          "investment_screenshot_extraction",
        ),
      },
    });

    if (!response.output_parsed) {
      throw new Error("The screenshot service returned no structured result");
    }

    return screenshotExtractionSchema.parse(response.output_parsed);
  }
}
