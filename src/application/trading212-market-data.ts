import type { MarketPriceObservation } from "@/domain/market-data";
import type { OpeningSnapshotInput } from "@/domain/portfolio/types";

export function marketObservationsFromTrading212Snapshot(
  snapshot: OpeningSnapshotInput,
): MarketPriceObservation[] {
  return snapshot.positions.flatMap((position) => {
    if (!position.observedPrice) return [];
    return [{
      sourceAccountId: snapshot.sourceAccountId,
      instrumentId: position.instrumentId,
      instrumentCode: position.instrumentCode ?? position.instrumentId,
      price: position.observedPrice,
      currency: position.currency,
      asOf: position.priceAsOf ?? snapshot.asOf,
      recordedAt: snapshot.asOf,
      source: position.priceSource ?? "trading212",
    }];
  });
}
