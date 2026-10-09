import type {
  HoldingReadModel,
  Period,
  PortfolioInsightAllocationReadModel,
  PortfolioInsightMoverReadModel,
  PortfolioInsightsReadModel,
  PortfolioOverviewReadModel,
} from "@/application/portfolio-read-model";

const periods = ["today", "week", "month"] as const satisfies readonly Period[];

function sharePercent(value: number, total: number): number {
  return total === 0 ? 0 : value / total * 100;
}

function groupedAllocation<Key extends string>(
  holdings: readonly HoldingReadModel[],
  totalValueEur: number,
  key: (holding: HoldingReadModel) => Key,
): Array<PortfolioInsightAllocationReadModel & { key: Key }> {
  const groups = new Map<Key, { valueEur: number; holdingCount: number }>();
  for (const holding of holdings) {
    const groupKey = key(holding);
    const current = groups.get(groupKey) ?? { valueEur: 0, holdingCount: 0 };
    groups.set(groupKey, {
      valueEur: current.valueEur + holding.eurValue,
      holdingCount: current.holdingCount + 1,
    });
  }
  return [...groups.entries()]
    .map(([groupKey, group]) => ({
      key: groupKey,
      valueEur: group.valueEur,
      sharePercent: sharePercent(group.valueEur, totalValueEur),
      holdingCount: group.holdingCount,
    }))
    .sort((left, right) =>
      right.valueEur - left.valueEur || left.key.localeCompare(right.key)
    );
}

function mover(
  holding: HoldingReadModel,
): PortfolioInsightMoverReadModel {
  const performance = holding.history!.today;
  return {
    id: holding.id,
    name: holding.name,
    changeEur: performance.change,
    percent: performance.percent,
  };
}

export function createPortfolioInsightsReadModel(input: {
  portfolio: PortfolioOverviewReadModel;
  asOf: string;
}): PortfolioInsightsReadModel {
  const holdings = input.portfolio.holdings;
  const investmentHoldings = holdings.filter((holding) =>
    holding.category !== "Portfolio cash"
  );
  const rankedInvestments = [...investmentHoldings].sort((left, right) =>
    right.eurValue - left.eurValue || left.name.localeCompare(right.name)
  );
  const topHolding = rankedInvestments.at(0);
  const todayMovers = investmentHoldings
    .filter((holding) => holding.history?.today.available)
    .sort((left, right) =>
      left.history!.today.change - right.history!.today.change ||
      left.name.localeCompare(right.name)
    );
  const weakest = todayMovers.at(0);
  const strongest = todayMovers.at(-1);
  const holdingCurrencyAllocation = groupedAllocation(
    holdings,
    input.portfolio.totalValueEur,
    (holding) => holding.currency,
  ).map(({ key, ...allocation }) => ({ currency: key, ...allocation }));
  const categoryAllocation = groupedAllocation(
    holdings,
    input.portfolio.totalValueEur,
    (holding) => holding.category,
  ).map(({ key, ...allocation }) => ({ category: key, ...allocation }));

  return {
    asOf: input.asOf,
    latestDailyCoverage: {
      includedCount: todayMovers.length,
      totalCount: investmentHoldings.length,
      componentsAvailable: todayMovers.length > 0 && todayMovers.every((holding) =>
        holding.history!.today.priceChange !== undefined && holding.history!.today.fxChange !== undefined),
      comparisons: todayMovers.map((holding) => ({
        holdingId: holding.id, name: holding.name,
        baselineAsOf: holding.history!.today.baselineAsOf,
        currentAsOf: holding.history!.today.currentAsOf,
      })),
    },
    summary: {
      investmentPositionCount: investmentHoldings.length,
      sourceAccountCount: new Set(holdings.map((holding) =>
        holding.sourceAccountId
      )).size,
      ...(topHolding
        ? {
            topHolding: {
              id: topHolding.id,
              name: topHolding.name,
              valueEur: topHolding.eurValue,
              sharePercent: sharePercent(
                topHolding.eurValue,
                input.portfolio.totalValueEur,
              ),
            },
          }
        : {}),
      topThreeSharePercent: sharePercent(
        rankedInvestments.slice(0, 3)
          .reduce((total, holding) => total + holding.eurValue, 0),
        input.portfolio.totalValueEur,
      ),
    },
    holdingCurrencyAllocation,
    categoryAllocation,
    performance: Object.fromEntries(periods.map((period) => {
      const performance = input.portfolio.history[period];
      return [period, {
        available: performance.available,
        changeEur: performance.available ? performance.change : 0,
        percent: performance.available ? performance.percent : 0,
        priceChangeEur: performance.available
          ? performance.priceChange ?? 0
          : 0,
        fxChangeEur: performance.available ? performance.fxChange ?? 0 : 0,
      }];
    })) as PortfolioInsightsReadModel["performance"],
    ...(strongest && weakest
      ? {
          recentMovers: {
            period: "today" as const,
            strongest: mover(strongest),
            weakest: mover(weakest),
          },
        }
      : {}),
    dataQuality: {
      valuedHoldingCount: holdings.length,
      freshCount: holdings.filter((holding) => holding.freshness === "fresh").length,
      manualCount: holdings.filter((holding) => holding.freshness === "manual").length,
      staleCount: holdings.filter((holding) => holding.freshness === "stale").length,
      awaitingNavCount: holdings.filter((holding) =>
        holding.freshness === "awaiting-nav"
      ).length,
      missingInputCount: input.portfolio.missingInputs.length,
      availablePerformancePeriods: periods.filter((period) =>
        input.portfolio.history[period].available
      ),
    },
  };
}
