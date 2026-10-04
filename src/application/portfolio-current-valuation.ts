import Decimal from "decimal.js";

import { formatOriginalMoney } from "@/application/money-format";
import { openingPositionUnitPrice } from "@/application/position-price";
import {
  cashHoldingId,
  investmentHoldingId,
} from "@/application/portfolio-holding-id";
import type {
  HoldingPriceHistoryReadModel,
  HoldingReadModel,
  MarketDataStatusReadModel,
  MissingValuationInputReadModel,
} from "@/application/portfolio-read-model";
import type {
  MarketPriceObservation,
  MarketRefreshRecord,
} from "@/domain/market-data";
import { sourceAccountDashboardLabel } from "@/domain/source-accounts";
import {
  assetTypeLabels,
  type OpeningSnapshotInput,
  type PortfolioState,
  type Position,
} from "@/domain/portfolio/types";
import { valuePortfolio, type FxObservation } from "@/domain/portfolio/valuation";

function latestMarketPrice(
  position: Position,
  observations: readonly MarketPriceObservation[],
  priceAsOfLimit: string,
): MarketPriceObservation | undefined {
  return observations
    .filter((candidate) =>
      candidate.sourceAccountId === position.sourceAccountId &&
      candidate.instrumentId === position.instrumentId &&
      candidate.currency === position.currency &&
      candidate.asOf.slice(0, 10) <= priceAsOfLimit.slice(0, 10)
    )
    .sort((left, right) =>
      left.asOf.localeCompare(right.asOf) ||
      left.recordedAt.localeCompare(right.recordedAt)
    )
    .at(-1);
}

function marketPriceFreshness(priceAsOf: string, asOf: string) {
  const age = new Date(asOf).getTime() - new Date(priceAsOf).getTime();
  const fundNavFreshnessWindowMs = 4 * 24 * 60 * 60 * 1000;
  return age <= fundNavFreshnessWindowMs ? "fresh" as const : "stale" as const;
}

function holdingPriceHistory(
  position: Position,
  snapshots: readonly OpeningSnapshotInput[],
  observations: readonly MarketPriceObservation[],
  asOf: string,
): HoldingPriceHistoryReadModel[] {
  const byDate = new Map<string, HoldingPriceHistoryReadModel>();
  const currentPositionPrice = openingPositionUnitPrice(position);
  if (currentPositionPrice && position.priceAsOf) {
    byDate.set(position.priceAsOf.slice(0, 10), {
      price: currentPositionPrice.toString(),
      currency: position.currency,
      asOf: position.priceAsOf.slice(0, 10),
      source: position.priceSource ?? "confirmed-snapshot",
    });
  }
  for (const snapshot of [...snapshots].sort((left, right) =>
    left.asOf.localeCompare(right.asOf)
  )) {
    if (snapshot.sourceAccountId !== position.sourceAccountId) continue;
    const snapshotPosition = snapshot.positions.find((candidate) =>
      candidate.instrumentId === position.instrumentId
    );
    if (!snapshotPosition || snapshotPosition.currency !== position.currency) continue;
    const price = openingPositionUnitPrice(snapshotPosition);
    const priceAsOf = (snapshotPosition.priceAsOf ?? snapshot.asOf).slice(0, 10);
    if (!price || priceAsOf > asOf.slice(0, 10)) continue;
    byDate.set(priceAsOf, {
      price: price.toString(),
      currency: snapshotPosition.currency,
      asOf: priceAsOf,
      source: snapshotPosition.priceSource ?? "confirmed-snapshot",
    });
  }
  for (const observation of observations
    .filter((candidate) =>
      candidate.sourceAccountId === position.sourceAccountId &&
      candidate.instrumentId === position.instrumentId &&
      candidate.currency === position.currency &&
      candidate.asOf.slice(0, 10) <= asOf.slice(0, 10)
    )
    .sort((left, right) =>
      left.asOf.localeCompare(right.asOf) ||
      left.recordedAt.localeCompare(right.recordedAt)
    )) {
    byDate.set(observation.asOf.slice(0, 10), {
      price: observation.price,
      currency: observation.currency,
      asOf: observation.asOf.slice(0, 10),
      source: observation.source,
    });
  }
  return [...byDate.values()].sort((left, right) =>
    right.asOf.localeCompare(left.asOf)
  );
}

interface ResolvedPositionPrice {
  unitPrice: string;
  asOf: string;
  source: string;
  freshness: HoldingReadModel["freshness"];
  marketPrice?: MarketPriceObservation;
}

interface CurrentPortfolioValuationInput {
  state: PortfolioState;
  snapshots?: readonly OpeningSnapshotInput[];
  asOf: string;
  snapshotTimes: Readonly<Record<string, string>>;
  marketPrices?: readonly MarketPriceObservation[];
  marketRefreshHistory?: readonly MarketRefreshRecord[];
  eurPerUnit: Readonly<Record<string, string>>;
  fxAsOf: string;
  accountLabels?: Readonly<Record<string, string>>;
}

function resolvePositionPrice(input: {
  position: Position;
  marketPrices: readonly MarketPriceObservation[];
  asOf: string;
  snapshotTimes: Readonly<Record<string, string>>;
}): ResolvedPositionPrice | undefined {
  const quantity = new Decimal(input.position.quantity);
  if (quantity.isZero()) return undefined;
  const marketPrice = latestMarketPrice(
    input.position,
    input.marketPrices,
    input.asOf,
  );
  const unitPrice = marketPrice?.price ??
    openingPositionUnitPrice(input.position)?.toString();
  if (!unitPrice) return undefined;
  const asOf = marketPrice?.asOf ?? input.position.priceAsOf ??
    input.snapshotTimes[input.position.sourceAccountId] ?? input.asOf;
  return {
    unitPrice,
    asOf,
    source: marketPrice?.source ?? input.position.priceSource ??
      "confirmed-snapshot",
    freshness: marketPrice
      ? marketPrice.source === "manual"
        ? "manual"
        : marketPriceFreshness(marketPrice.asOf, input.asOf)
      : input.position.sourceAccountId.includes("trading212")
        ? "fresh"
        : "manual",
    ...(marketPrice ? { marketPrice } : {}),
  };
}

function resolvePositionPrices(
  input: CurrentPortfolioValuationInput,
  marketPrices: readonly MarketPriceObservation[],
) {
  return new Map(
    input.state.positions.flatMap((position) => {
      const resolved = resolvePositionPrice({
        position,
        marketPrices,
        asOf: input.asOf,
        snapshotTimes: input.snapshotTimes,
      });
      return resolved
        ? [[investmentHoldingId(position), resolved] as const]
        : [];
    }),
  );
}

function createMarketDataStatus(
  marketPrices: readonly MarketPriceObservation[],
  marketRefreshHistory: readonly MarketRefreshRecord[],
  asOf: string,
): MarketDataStatusReadModel {
  const latestMarketRefresh = marketRefreshHistory[0];
  return {
    lastRefreshedAt: latestMarketRefresh?.completedAt ?? marketPrices
      .filter((observation) => observation.recordedAt <= asOf)
      .map((observation) => observation.recordedAt)
      .sort()
      .at(-1),
    ...(latestMarketRefresh
      ? {
          latestResult: {
            updated: latestMarketRefresh.updated,
            unchanged: latestMarketRefresh.unchanged,
            failed: latestMarketRefresh.failed,
            failures: latestMarketRefresh.failures,
          },
        }
      : {}),
    refreshHistory: marketRefreshHistory.map((refresh) => ({
      mode: refresh.mode,
      provider: refresh.provider,
      completedAt: refresh.completedAt,
      updated: refresh.updated,
      unchanged: refresh.unchanged,
      failed: refresh.failed,
      failures: refresh.failures,
    })),
  };
}

export function createCurrentPortfolioValuationReadModel(
  input: CurrentPortfolioValuationInput,
) {
  const marketPrices = input.marketPrices ?? [];
  const snapshots = input.snapshots ?? [];
  const marketRefreshHistory = input.marketRefreshHistory ?? [];
  const resolvedPriceByHolding = resolvePositionPrices(input, marketPrices);
  const prices = input.state.positions.flatMap((position) => {
    const resolved = resolvedPriceByHolding.get(
      investmentHoldingId(position),
    );
    return resolved
      ? [{
      sourceAccountId: position.sourceAccountId,
      instrumentId: position.instrumentId,
      price: resolved.unitPrice,
      ...(!resolved.marketPrice && position.reportedMarketValue
        ? { reportedMarketValue: position.reportedMarketValue }
        : {}),
      currency: position.currency,
      asOf: resolved.asOf,
      source: resolved.source,
      freshness: resolved.freshness,
    }]
      : [];
  });
  const fxRates: FxObservation[] = Object.entries(input.eurPerUnit).map(
    ([currency, eurPerUnit]) => ({
      currency,
      eurPerUnit,
      asOf: input.fxAsOf,
      source: "ecb",
    }),
  );
  const valuation = valuePortfolio({
    state: input.state,
    asOf: input.asOf,
    prices,
    fxRates,
  });

  const holdings: HoldingReadModel[] = [
    ...valuation.positions.map((position) => {
      const sourcePosition = input.state.positions.find((candidate) =>
        candidate.sourceAccountId === position.sourceAccountId &&
        candidate.instrumentId === position.instrumentId
      );
      const category: HoldingReadModel["category"] = sourcePosition?.assetType
        ? assetTypeLabels[sourcePosition.assetType]
        : "Unclassified";
      const resolvedPrice = resolvedPriceByHolding.get(
        investmentHoldingId(position),
      );
      const currentValue = new Decimal(position.originalValue);
      const costBasis = sourcePosition
        ? new Decimal(sourcePosition.costBasis)
        : undefined;
      const eurPerUnit = input.eurPerUnit[position.currency] ??
        (position.currency === "EUR" ? "1" : undefined);
      const totalReturn = costBasis && eurPerUnit
        ? (() => {
            const originalAmount = currentValue.minus(costBasis);
            return {
              originalAmount: originalAmount.toNumber(),
              eurAmount: originalAmount.mul(eurPerUnit).toNumber(),
              ...(!costBasis.isZero()
                ? { percent: originalAmount.div(costBasis).mul(100).toNumber() }
                : {}),
            };
          })()
        : undefined;

      return {
        id: investmentHoldingId(position),
        sourceAccountId: position.sourceAccountId,
        holdingKey: {
          sourceAccountId: position.sourceAccountId,
          instrumentId: position.instrumentId,
        },
        name: sourcePosition?.displayName ?? position.instrumentId,
        ...(sourcePosition?.displayName
          ? { analystDisplayName: sourcePosition.displayName }
          : {}),
        symbol: sourcePosition?.instrumentCode ?? position.instrumentId,
        source: sourceAccountDashboardLabel(position.sourceAccountId, input.accountLabels),
        category,
        currency: position.currency as HoldingReadModel["currency"],
        originalValue: formatOriginalMoney(
          Number(position.originalValue),
          position.currency,
        ),
        eurValue: Number(position.eurValue),
        ...(totalReturn
          ? { totalReturn }
          : {}),
        changeEur: 0,
        changePercent: 0,
        freshness: position.freshness,
        asOf: position.priceAsOf.slice(0, 16).replace("T", " "),
        ...(sourcePosition && resolvedPrice
          ? {
              detail: {
                quantity: sourcePosition.quantity,
                costBasis: sourcePosition.costBasis,
                reportedPriorReturn: sourcePosition.reportedPriorReturn,
                ...(sourcePosition.averageCost
                  ? { averageCost: sourcePosition.averageCost }
                  : {}),
                currentPrice: resolvedPrice.unitPrice,
                currentPriceAsOf: resolvedPrice.asOf.slice(0, 10),
                currentPriceSource: resolvedPrice.source,
                priceHistory: holdingPriceHistory(
                  sourcePosition,
                  snapshots,
                  marketPrices,
                  input.asOf,
                ),
              },
            }
          : {}),
      };
    }),
    ...valuation.cash
      .filter((cash) => !new Decimal(cash.originalValue).isZero())
      .map((cash) => ({
        id: cashHoldingId(cash),
        sourceAccountId: cash.sourceAccountId,
        name: "Portfolio Cash",
        symbol: "CASH",
        source: sourceAccountDashboardLabel(cash.sourceAccountId, input.accountLabels),
        category: "Portfolio cash" as const,
        currency: cash.currency as HoldingReadModel["currency"],
        originalValue: formatOriginalMoney(
          Number(cash.originalValue),
          cash.currency,
        ),
        eurValue: Number(cash.eurValue),
        changeEur: 0,
        changePercent: 0,
        freshness: "fresh" as const,
        asOf: (input.snapshotTimes[cash.sourceAccountId] ?? input.asOf)
          .slice(0, 16)
          .replace("T", " "),
      })),
  ];

  return {
    holdings,
    totalValueEur: Number(valuation.totalValueEur),
    missingInputs: valuation.missingInputs.map((missing): MissingValuationInputReadModel => {
      const sourcePosition = missing.instrumentId
        ? input.state.positions.find((position) =>
            position.sourceAccountId === missing.sourceAccountId &&
            position.instrumentId === missing.instrumentId
          )
        : undefined;
      return {
        ...missing,
        ...(sourcePosition?.displayName
          ? { analystDisplayName: sourcePosition.displayName }
          : {}),
      };
    }),
    fxAsOf: input.fxAsOf,
    marketData: createMarketDataStatus(
      marketPrices,
      marketRefreshHistory,
      input.asOf,
    ),
  };
}
