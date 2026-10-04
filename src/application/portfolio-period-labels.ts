import type { Period } from "@/application/portfolio-read-model";

export const periodLabels = {
  today: "Today",
  week: "7 days",
  month: "30 days",
} satisfies Record<Period, string>;
