import { createPortfolioInsightsReadModel } from "@/application/portfolio-insights";
import {
  createPortfolioValuationTimeline,
  type PortfolioValuationTimelineInput,
} from "@/application/portfolio-valuation-timeline";
import type {
  PortfolioInsightsReadModel,
  PortfolioOverviewReadModel,
} from "@/application/portfolio-read-model";

export type PortfolioOverviewInput = PortfolioValuationTimelineInput;

export function createPortfolioOverviewReadModel(
  input: PortfolioOverviewInput,
): PortfolioOverviewReadModel & { insights: PortfolioInsightsReadModel } {
  const portfolioWithHistory = createPortfolioValuationTimeline(input);
  return {
    ...portfolioWithHistory,
    insights: createPortfolioInsightsReadModel({
      portfolio: portfolioWithHistory,
      asOf: input.asOf,
    }),
  };
}
