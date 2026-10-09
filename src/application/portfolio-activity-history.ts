import Decimal from "decimal.js";

import { buildPortfolioState } from "@/domain/portfolio/ledger";
import type { PortfolioFacts } from "@/infrastructure/sqlite/portfolio-repository-contract";

export function holdingUpdateHistory(facts: Pick<PortfolioFacts, "openingSnapshots" | "events">, sourceAccountId: string) {
  const snapshots = facts.openingSnapshots.filter((snapshot) => snapshot.sourceAccountId === sourceAccountId)
    .toSorted((a, b) => a.asOf.localeCompare(b.asOf));
  const seen = new Set<string>();
  return snapshots.flatMap((snapshot, index) => {
    const before = buildPortfolioState({
      openingSnapshots: snapshots.slice(0, index),
      events: index === 0 ? [] : facts.events.filter((event) => event.sourceAccountId === sourceAccountId && event.asOf <= snapshot.asOf && !event.sourceImportId),
    });
    return snapshot.positions.flatMap((position) => {
      const previous = before.positions.find((candidate) => candidate.instrumentId === position.instrumentId);
      const created = !seen.has(position.instrumentId);
      seen.add(position.instrumentId);
      const importedSale = facts.events.some((event) => event.type === "sale" && !event.voidedAt &&
        event.sourceAccountId === sourceAccountId && event.instrumentId === position.instrumentId &&
        event.importUndo?.snapshotId === snapshot.id);
      if (importedSale) return [];
      const quantityChange = new Decimal(position.quantity).minus(previous?.quantity ?? "0");
      const costChange = new Decimal(position.costBasis).minus(previous?.costBasis ?? "0");
      if (!created && quantityChange.isZero() && costChange.isZero()) return [];
      return [{
        id: `snapshot:${snapshot.id}:${position.instrumentId}`, asOf: snapshot.asOf,
        instrumentId: position.instrumentId, holdingName: position.displayName ?? position.instrumentId,
        type: created ? "Holding created" : quantityChange.gt(0) ? "Units added" : "Holding updated",
        quantity: created ? position.quantity : quantityChange.toFixed(),
        amount: { amount: created ? position.costBasis : costChange.toFixed(), currency: position.currency },
        note: created ? "Initial recorded holding · cost" : "Confirmed holding update · cost change",
      }];
    });
  });
}
