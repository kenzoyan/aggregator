import {
  screenshotExtractionSchema,
  type ScreenshotExtraction,
  type VisionExtractor,
} from "@/application/imports/vision-extraction-contract";
import type { SourceProvider } from "@/domain/source-accounts";

export {
  prepareScreenshotImport,
  type PreparedScreenshotImport,
} from "@/application/imports/screenshot-import-preparation";
export * from "@/application/imports/vision-extraction-contract";

const sourceProviderPatterns: ReadonlyArray<[
  SourceProvider,
  RegExp,
]> = [
  ["alipay", /alipay|支付宝/i],
  ["wechat", /wechat|微信|理财通/i],
  ["danske", /danske/i],
  ["trading212", /trading\s*212/i],
];

export function detectedSourceProvider(
  accountName: string | null,
): SourceProvider | undefined {
  if (!accountName) return undefined;
  return sourceProviderPatterns.find(([, pattern]) =>
    pattern.test(accountName)
  )?.[0];
}

export function fixtureVisionExtractor(
  result: ScreenshotExtraction,
): VisionExtractor {
  const validated = screenshotExtractionSchema.parse(result);

  return {
    async extract() {
      return structuredClone(validated);
    },
  };
}
