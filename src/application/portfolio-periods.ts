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
      priceChange: available ? holdingTotals.priceChange : 0,
      fxChange: available ? holdingTotals.fxChange : 0,
    }];
  })) as Record<Period, PeriodPerformanceReadModel>;
}
