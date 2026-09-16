import { describe, expect, it } from "vitest";

import { buildPortfolioState } from "@/domain/portfolio/ledger";
import { sourceAccounts } from "@/domain/source-accounts";
import { readPortfolioOverviewIncludingEmpty } from "@/server/current-portfolio";

describe("current portfolio overview", () => {
  it("builds an empty overview so account-management Agent tools remain available", () => {
    const overview = readPortfolioOverviewIncludingEmpty({
      readPortfolioFacts: () => ({
        openingSnapshots: [],
        events: [],
        confirmedImports: [],
        confirmedSnapshots: [],
        state: buildPortfolioState({ openingSnapshots: [], events: [] }),
      }),
      readMarketData: () => ({
        observations: [],
        fxObservations: [],
        marketRefreshHistory: [],
        latestMarketRefresh: undefined,
      }),
      readSourceAccountLabels: () => ({}),
      readSourceAccounts: () => [...sourceAccounts],
    }, "2026-09-16T12:00:00.000Z");

    expect(overview.totalValueEur).toBe(0);
    expect(overview.holdings).toEqual([]);
    expect(overview.insights.asOf).toBe("2026-09-16T12:00:00.000Z");
  });
});
