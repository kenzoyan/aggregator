import { createPortfolioInsightsReadModel } from "@/application/portfolio-insights";
import { createPortfolioChartEvents } from "@/application/portfolio-chart-events";
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
    chartEvents: createPortfolioChartEvents(input),
    insights: createPortfolioInsightsReadModel({
      portfolio: portfolioWithHistory,
      asOf: input.asOf,
    }),
  };
}
