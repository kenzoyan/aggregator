import type {
  Period,
  PortfolioValuePointReadModel,
} from "@/application/portfolio-read-model";

export const minimumVisiblePortfolioActivityEur = 1;

export function createPortfolioChartPresentation(
  period: Period,
  timeline: readonly PortfolioValuePointReadModel[],
  activityAvailable = true,
) {
  const portfolioActivities = activityAvailable
    ? timeline
        .filter((point) =>
          Math.abs(point.portfolioActivityEur) >= minimumVisiblePortfolioActivityEur
        )
        .map((point) => ({
          asOf: point.asOf,
          portfolioActivityEur: point.portfolioActivityEur,
        }))
    : [];
  const holdingActivities = timeline.flatMap((point) =>
    point.holdingActivities.map((activity) => ({
      asOf: point.asOf,
      ...activity,
    }))
  );
  const activityDates = [...new Set([
    ...portfolioActivities.map((activity) => activity.asOf),
    ...holdingActivities.map((activity) => activity.asOf),
  ])].sort();
  const activityGroups = activityDates.map((asOf) => ({
    asOf,
    holdingActivities: holdingActivities.filter((activity) => activity.asOf === asOf),
    portfolioActivityEur: portfolioActivities.find((activity) => activity.asOf === asOf)
      ?.portfolioActivityEur,
  })).slice(-4);
  const markerDates = activityGroups.map((group) => group.asOf);

  return {
    showValueTrend: period !== "today" && timeline.length > 1,
    portfolioActivities,
    holdingActivities,
    activityGroups,
    markerDates,
  };
}
