import type { Period, PortfolioValuePointReadModel } from "@/application/portfolio-read-model";

export function shouldShowPortfolioValueTrend(
  period: Period,
  timeline: readonly PortfolioValuePointReadModel[],
) {
  return period !== "today" && timeline.length > 1;
}
