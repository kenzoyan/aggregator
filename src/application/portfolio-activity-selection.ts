import type { CashActivityReadModel } from "@/application/portfolio-cash-activity";

export function selectHoldingActivity(activity: CashActivityReadModel, holding: { instrumentId?: string; cashCurrency?: string }) {
  return {
    records: activity.records.filter((record) => holding.instrumentId
      ? record.type === "sale" && record.instrumentId === holding.instrumentId
      : record.type === "cash-withdrawal" && record.amount.currency === holding.cashCurrency),
    updates: holding.instrumentId
      ? activity.holdingUpdates.filter((record) => record.instrumentId === holding.instrumentId)
      : [],
  };
}
