import type { DocumentOcrProvider } from "@/application/imports/document-ocr";
import {
  screenshotExtractionSchema,
  type ScreenshotExtraction,
  type VisionExtractionRequest,
  type VisionExtractor,
} from "@/application/imports/vision-extractor";

export type OcrMarkdownParser = (
  markdown: string,
  options: { sourceAccountHint?: string },
) => ScreenshotExtraction;

const filenameByMimeType: Record<
  VisionExtractionRequest["mimeType"],
  string
> = {
  "image/jpeg": "portfolio-screenshot.jpg",
  "image/png": "portfolio-screenshot.png",
  "image/webp": "portfolio-screenshot.webp",
};

export class OcrVisionExtractor implements VisionExtractor {
  constructor(
    private readonly provider: DocumentOcrProvider,
    private readonly parse: OcrMarkdownParser,
  ) {}

  async extract(
    request: VisionExtractionRequest,
  ): Promise<ScreenshotExtraction> {
    const result = await this.provider.extractMarkdown({
      image: request.image,
      filename: filenameByMimeType[request.mimeType],
      mimeType: request.mimeType,
    });
    return screenshotExtractionSchema.parse(
      this.parse(result.markdown, {
        ...(request.sourceAccountHint
          ? { sourceAccountHint: request.sourceAccountHint }
          : {}),
      }),
    );
  }
}
