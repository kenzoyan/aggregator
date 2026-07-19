import type { ScreenshotExtraction } from "@/application/imports/vision-extractor";

export const demoScreenshotExtraction: ScreenshotExtraction = {
  accountName: "Demo fund account",
  asOf: "2026-07-19T12:00:00.000Z",
  currency: "CNY",
  totalValue: "10280.50",
  reportedPriorReturn: "1280.50",
  confidence: "medium",
  warnings: ["The demo screenshot does not show fund units. Confirm whole-holding mode."],
  positions: [
    {
      displayName: "Demo Global Technology Index Fund",
      instrumentCode: null,
      quantity: null,
      currency: "CNY",
      marketValue: "6280.50",
      costBasis: null,
      reportedPriorReturn: "980.50",
      reportedPriorReturnPercent: "18.50",
      confidence: "high",
    },
    {
      displayName: "Demo Bond Fund",
      instrumentCode: null,
      quantity: null,
      currency: "CNY",
      marketValue: "4000.00",
      costBasis: null,
      reportedPriorReturn: "300.00",
      reportedPriorReturnPercent: "8.11",
      confidence: "medium",
    },
  ],
};
