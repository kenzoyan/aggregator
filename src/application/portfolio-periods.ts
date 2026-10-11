import type { HoldingHistoryReadModel } from "@/application/holding-history";
import type {
  Period,
  PeriodPerformanceReadModel,
} from "@/application/portfolio-read-model";

const periods = ["today", "week", "month"] as const satisfies readonly Period[];

function holdingPeriodTotals(
  history: HoldingHistoryReadModel,
  period: Period,
) {
  const available = Object.values(history)
    .map((holding) => holding[period])
    .filter((performance) => performance.available);
  return {
    count: available.length,
    change: available.reduce(
      (total, performance) => total + performance.change,
      0,
    ),
    priceChange: available.reduce(
      (total, performance) => total + (performance.priceChange ?? 0),
      0,
    ),
    fxChange: available.reduce(
      (total, performance) => total + (performance.fxChange ?? 0),
      0,
    ),
  };
}

export function combinePortfolioPeriodHistory(input: {
  portfolioHistory: Record<Period, PeriodPerformanceReadModel>;
  holdingHistory: HoldingHistoryReadModel;
  currentTotalValueEur: number;
}): Record<Period, PeriodPerformanceReadModel> {
  return Object.fromEntries(periods.map((period) => {
    const portfolioPeriod = input.portfolioHistory[period];
    const holdingTotals = holdingPeriodTotals(input.holdingHistory, period);
    if (period !== "today") {
      return [period, {
        ...portfolioPeriod,
        priceChange: portfolioPeriod.available ? holdingTotals.priceChange : 0,
        fxChange: portfolioPeriod.available ? holdingTotals.fxChange : 0,
      }];
    }

    const {
      baselineAsOf: _baselineAsOf,
      currentAsOf: _currentAsOf,
      coverage: _coverage,
      ...todayDefaults
    } = portfolioPeriod;
    const available = holdingTotals.count > 0;
    const baselineValue = input.currentTotalValueEur - holdingTotals.change;
    return [period, {
      ...todayDefaults,
      available,
      change: available ? holdingTotals.change : 0,
      percent: available && baselineValue !== 0
        ? holdingTotals.change / baselineValue * 100
        : 0,
      points: available
        ? [baselineValue, input.currentTotalValueEur]
        : [input.currentTotalValueEur],
      dailyChanges: available
        ? [{
            asOf: portfolioPeriod.currentAsOf?.slice(0, 10) ?? "Latest",
            change: holdingTotals.change,
          }]
        : [],
      priceChange: available ? holdingTotals.priceChange : 0,
      fxChange: available ? holdingTotals.fxChange : 0,
      // Today compares each holding's latest observations, rather than a common calendar baseline.
      contributions: Object.entries(input.holdingHistory).flatMap(([holdingId, periods]) => {
        const performance = periods.today;
        if (!performance.available || !performance.baselineAsOf || !performance.currentAsOf) return [];
        return [{ holdingId, change: performance.change, percent: performance.percent,
          baselineValueEur: performance.points[0], currentValueEur: performance.points.at(-1)!,
          baselineAsOf: performance.valuationBaselineAsOf ?? performance.baselineAsOf,
          currentAsOf: performance.valuationCurrentAsOf ?? performance.currentAsOf,
          baselinePriceAsOf: performance.baselineAsOf, currentPriceAsOf: performance.currentAsOf,
          priceChange: performance.priceChange, fxChange: performance.fxChange }];
      }),
    }];
  })) as Record<Period, PeriodPerformanceReadModel>;
}
