import Decimal from "decimal.js";

import type { CurrencyCode, PortfolioState } from "./types";

export type Freshness = "fresh" | "awaiting-nav" | "stale" | "manual";

export interface PriceObservation {
  sourceAccountId: string;
  instrumentId: string;
  price: string;
  reportedMarketValue?: string;
  currency: CurrencyCode;
  asOf: string;
  source: string;
  freshness: Freshness;
}

export interface FxObservation {
  currency: CurrencyCode;
  eurPerUnit: string;
  asOf: string;
  source: string;
}

interface ValuePortfolioInput {
  state: PortfolioState;
  asOf: string;
  prices: readonly PriceObservation[];
  fxRates: readonly FxObservation[];
}

interface ValuedPosition {
  sourceAccountId: string;
  instrumentId: string;
  currency: CurrencyCode;
  originalValue: string;
  eurValue: string;
  priceAsOf: string;
  fxAsOf: string;
  freshness: Freshness;
}

interface ValuedCash {
  sourceAccountId: string;
  currency: CurrencyCode;
  originalValue: string;
  eurValue: string;
  fxAsOf: string;
}

export interface MissingValuationInput {
  kind: "price" | "fx";
  sourceAccountId?: string;
  instrumentId?: string;
  currency: CurrencyCode;
}

export interface DailyValuation {
  asOf: string;
  totalValueEur: string;
  positions: ValuedPosition[];
  cash: ValuedCash[];
  missingInputs: MissingValuationInput[];
}

function resolveFx(
  currency: CurrencyCode,
  asOf: string,
  fxRates: readonly FxObservation[],
): FxObservation | undefined {
  if (currency === "EUR") {
    return {
      currency: "EUR",
      eurPerUnit: "1",
      asOf,
      source: "base-currency",
    };
  }

  return fxRates.find((candidate) => candidate.currency === currency);
}

export function valuePortfolio({
  state,
  asOf,
  prices,
  fxRates,
}: ValuePortfolioInput): DailyValuation {
  const valuedPositions: ValuedPosition[] = [];
  const valuedCash: ValuedCash[] = [];
  const missingInputs: MissingValuationInput[] = [];
  let totalValueEur = new Decimal(0);

  for (const position of state.positions) {
    if (new Decimal(position.quantity).isZero()) continue;
    const price = prices.find(
      (candidate) =>
        candidate.sourceAccountId === position.sourceAccountId &&
        candidate.instrumentId === position.instrumentId &&
        candidate.currency === position.currency,
    );
    const fx = resolveFx(position.currency, asOf, fxRates);

    if (!price) {
      missingInputs.push({
        kind: "price",
        sourceAccountId: position.sourceAccountId,
        instrumentId: position.instrumentId,
        currency: position.currency,
      });
      continue;
    }

    if (!fx) {
      missingInputs.push({
        kind: "fx",
        sourceAccountId: position.sourceAccountId,
        instrumentId: position.instrumentId,
        currency: position.currency,
      });
      continue;
    }

    const originalValue = price.reportedMarketValue
      ? new Decimal(price.reportedMarketValue)
      : new Decimal(position.quantity).mul(price.price);
    const eurValue = originalValue.mul(fx.eurPerUnit);
    totalValueEur = totalValueEur.plus(eurValue);
    valuedPositions.push({
      sourceAccountId: position.sourceAccountId,
      instrumentId: position.instrumentId,
      currency: position.currency,
      originalValue: originalValue.toString(),
      eurValue: eurValue.toString(),
      priceAsOf: price.asOf,
      fxAsOf: fx.asOf,
      freshness: price.freshness,
    });
  }

  for (const cash of state.cashBalances) {
    const fx = resolveFx(cash.currency, asOf, fxRates);

    if (!fx) {
      missingInputs.push({ kind: "fx", sourceAccountId: cash.sourceAccountId, currency: cash.currency });
      continue;
    }

    const originalValue = new Decimal(cash.amount);
    const eurValue = originalValue.mul(fx.eurPerUnit);
    totalValueEur = totalValueEur.plus(eurValue);
    valuedCash.push({
      sourceAccountId: cash.sourceAccountId,
      currency: cash.currency,
      originalValue: originalValue.toString(),
      eurValue: eurValue.toString(),
      fxAsOf: fx.asOf,
    });
  }

  return {
    asOf,
    totalValueEur: totalValueEur.toString(),
    positions: valuedPositions,
    cash: valuedCash,
    missingInputs,
  };
}
