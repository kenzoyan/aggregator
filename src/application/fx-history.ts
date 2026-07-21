import type { FxRateObservation } from "@/domain/market-data";

export interface DatedFxRates {
  asOf: string;
  eurPerUnit: Readonly<Record<string, string>>;
}

export function createFxRateObservations(input: {
  rates: DatedFxRates;
  recordedAt: string;
}): FxRateObservation[] {
  return Object.entries(input.rates.eurPerUnit)
    .filter(([currency]) => currency !== "EUR")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, eurPerUnit]) => ({
      currency,
      eurPerUnit,
      asOf: input.rates.asOf,
      recordedAt: input.recordedAt,
      source: "ecb",
    }));
}

export function eurPerUnitAt(
  observations: readonly FxRateObservation[],
  asOf: string,
): Record<string, string> {
  const latestByCurrency = new Map<string, FxRateObservation>();
  for (const observation of observations) {
    if (observation.asOf > asOf.slice(0, 10)) continue;
    const current = latestByCurrency.get(observation.currency);
    if (
      !current ||
      observation.asOf > current.asOf ||
      (
        observation.asOf === current.asOf &&
        observation.recordedAt > current.recordedAt
      )
    ) {
      latestByCurrency.set(observation.currency, observation);
    }
  }
  return {
    EUR: "1",
    ...Object.fromEntries(
      [...latestByCurrency.entries()].map(([currency, observation]) => [
        currency,
        observation.eurPerUnit,
      ]),
    ),
  };
}
