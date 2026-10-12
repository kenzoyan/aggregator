import Decimal from "decimal.js";
import { investmentHoldingId } from "@/application/portfolio-holding-id";
import type { PortfolioOverviewReadModel } from "@/application/portfolio-read-model";

export interface CurrentHoldingsPnl {
  coverage: "complete" | "partial" | "unavailable" | "empty";
  includedHoldingCount: number;
  totalHoldingCount: number;
  pnlEur?: number;
  costEur?: number;
  percent?: number;
}

/** Reuse the existing original-currency P&L translated at current FX rates.
 * Subtracting it from EUR value gives cost on the same FX basis, not historical EUR acquisition cost.
 */
export function currentHoldingsPnl(
  portfolio: Pick<PortfolioOverviewReadModel, "holdings" | "missingInputs">,
): CurrentHoldingsPnl {
  const investments = portfolio.holdings.filter((holding) => holding.category !== "Portfolio cash");
  const expected = new Set(investments.map((holding) => holding.id));
  for (const missing of portfolio.missingInputs) {
    if (missing.instrumentId) expected.add(investmentHoldingId({
      sourceAccountId: missing.sourceAccountId ?? "", instrumentId: missing.instrumentId,
    }));
  }
  let pnl = new Decimal(0), cost = new Decimal(0), includedHoldingCount = 0;
  for (const holding of investments) {
    if (!holding.totalReturn || !Number.isFinite(holding.eurValue) || !Number.isFinite(holding.totalReturn.eurAmount)) continue;
    const holdingCost = new Decimal(holding.eurValue).minus(holding.totalReturn.eurAmount);
    if (holdingCost.isNegative()) continue;
    pnl = pnl.plus(holding.totalReturn.eurAmount);
    cost = cost.plus(holdingCost);
    includedHoldingCount += 1;
  }
  const totalHoldingCount = expected.size;
  return {
    coverage: totalHoldingCount === 0 ? "empty" : includedHoldingCount === 0 ? "unavailable" : includedHoldingCount < totalHoldingCount ? "partial" : "complete",
    includedHoldingCount, totalHoldingCount,
    ...(includedHoldingCount ? {
      pnlEur: pnl.toNumber(), costEur: cost.toNumber(),
      ...(cost.gt(0) ? { percent: pnl.div(cost).mul(100).toNumber() } : {}),
    } : {}),
  };
}
