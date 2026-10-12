import Decimal from "decimal.js";
import { hasCurrentHoldingsPnl } from "@/application/current-holdings-pnl";
import type { HoldingReadModel } from "@/application/portfolio-read-model";

export type PnlGrouping = "holding" | "account";
export interface PnlContribution {
  id: string;
  name: string;
  account: string;
  sourceAccountId: string;
  pnlEur: number;
  sharePercent: number;
}

/** Rank both signs together so a large loss cannot disappear behind smaller gains. */
export function largestPnlContributions(data: Pick<ReturnType<typeof holdingsPnlBreakdown>, "gains" | "losses">) {
  return [...data.gains, ...data.losses]
    .sort((a, b) => Math.abs(b.pnlEur) - Math.abs(a.pnlEur) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .slice(0, 5);
}

export function holdingsPnlBreakdown(holdings: readonly HoldingReadModel[], grouping: PnlGrouping) {
  const groups = new Map<string, { item: Omit<PnlContribution, "sharePercent">; pnl: Decimal }>();
  for (const holding of holdings) {
    if (!hasCurrentHoldingsPnl(holding) || !holding.totalReturn) continue;
    const id = grouping === "account" ? holding.sourceAccountId : holding.id;
    const existing = groups.get(id);
    const pnl = (existing?.pnl ?? new Decimal(0)).plus(holding.totalReturn.eurAmount);
    groups.set(id, { pnl, item: {
      id, name: grouping === "account" ? holding.source : holding.name,
      account: holding.source, sourceAccountId: holding.sourceAccountId, pnlEur: pnl.toNumber(),
    } });
  }
  const entries = [...groups.values()];
  const gains = entries.filter(({ pnl }) => pnl.gt(0));
  const losses = entries.filter(({ pnl }) => pnl.lt(0));
  const sum = (items: typeof entries) => items.reduce((total, { pnl }) => total.plus(pnl), new Decimal(0));
  const gainTotal = sum(gains), lossTotal = sum(losses).abs();
  const contributions = (items: typeof entries, total: Decimal): PnlContribution[] => items
    .map(({ item, pnl }) => ({ ...item, sharePercent: pnl.abs().div(total).mul(100).toNumber() }))
    .sort((a, b) => Math.abs(b.pnlEur) - Math.abs(a.pnlEur) || a.name.localeCompare(b.name));
  return {
    gains: contributions(gains, gainTotal), losses: contributions(losses, lossTotal),
    gainTotalEur: gainTotal.toNumber(), lossTotalEur: lossTotal.toNumber(),
    netEur: gainTotal.minus(lossTotal).toNumber(),
    unchangedCount: entries.filter(({ pnl }) => pnl.isZero()).length,
  };
}
