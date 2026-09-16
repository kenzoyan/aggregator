import {
  draftValue,
  knownDraftValue,
  unknownDraftValue,
  type DraftHolding,
  type DraftPortfolio,
  type DraftValue,
  type ImportFieldSource,
  type ImportReconciliation,
} from "@/domain/import-draft";
import type {
  OpeningPositionInput,
  OpeningSnapshotInput,
  PortfolioState,
} from "@/domain/portfolio/types";

function requiredDraftValue<T>(
  value: DraftValue<T>,
  path: string,
): T {
  const resolved = draftValue(value);
  if (resolved === undefined) {
    throw new Error(`${path} is still unknown`);
  }
  return resolved;
}

function materializeHolding(
  holding: DraftHolding,
  index: number,
): OpeningPositionInput {
  const path = `Holding ${index + 1}`;
  const displayName = draftValue(holding.displayName);
  const instrumentCode = draftValue(holding.instrumentCode);
  const assetType = draftValue(holding.assetType);
  const reportedPriorReturn = draftValue(holding.reportedPriorReturn);
  const averageCost = draftValue(holding.averageCost);
  const observedPrice = draftValue(holding.observedPrice);
  const priceAsOf = draftValue(holding.priceAsOf);
  const priceSource = draftValue(holding.priceSource);
  const reportedMarketValue = draftValue(holding.reportedMarketValue);

  return {
    instrumentId: requiredDraftValue(
      holding.instrumentId,
      `${path} instrumentId`,
    ),
    ...(displayName ? { displayName } : {}),
    ...(instrumentCode ? { instrumentCode } : {}),
    ...(assetType ? { assetType } : {}),
    quantity: requiredDraftValue(holding.quantity, `${path} quantity`),
    currency: requiredDraftValue(holding.currency, `${path} currency`),
    costBasis: requiredDraftValue(holding.costBasis, `${path} costBasis`),
    ...(reportedPriorReturn !== undefined ? { reportedPriorReturn } : {}),
    ...(averageCost ? { averageCost } : {}),
    ...(observedPrice ? { observedPrice } : {}),
    ...(priceAsOf ? { priceAsOf } : {}),
    ...(priceSource ? { priceSource } : {}),
    ...(reportedMarketValue ? { reportedMarketValue } : {}),
  };
}

export function materializeOpeningSnapshot(
  sourceAccountId: string,
  portfolio: DraftPortfolio,
  snapshotKind?: ImportReconciliation["snapshotKind"],
): OpeningSnapshotInput {
  const portfolioCash = draftValue(portfolio.portfolioCash);
  return {
    id: portfolio.snapshotId,
    sourceAccountId,
    asOf: requiredDraftValue(portfolio.asOf, "Portfolio asOf"),
    ...(snapshotKind ? { kind: snapshotKind } : {}),
    ...(portfolioCash ? { portfolioCash } : {}),
    positions: portfolio.holdings.map(materializeHolding),
  };
}

export function draftPortfolioFromOpeningSnapshot(
  snapshot: OpeningSnapshotInput,
  source: ImportFieldSource,
): DraftPortfolio {
  return {
    snapshotId: snapshot.id,
    asOf: knownDraftValue(snapshot.asOf, source),
    portfolioCash: snapshot.portfolioCash
      ? knownDraftValue(snapshot.portfolioCash, source)
      : unknownDraftValue(),
    holdings: snapshot.positions.map((position, index) => ({
      lineId: `${snapshot.id}:line:${index + 1}`,
      instrumentId: knownDraftValue(position.instrumentId, source),
      displayName: position.displayName
        ? knownDraftValue(position.displayName, source)
        : unknownDraftValue(),
      instrumentCode: position.instrumentCode
        ? knownDraftValue(position.instrumentCode, source)
        : unknownDraftValue(),
      assetType: position.assetType
        ? knownDraftValue(position.assetType, source)
        : unknownDraftValue(),
      quantity: knownDraftValue(position.quantity, source),
      currency: knownDraftValue(position.currency, source),
      costBasis: knownDraftValue(position.costBasis, source),
      reportedPriorReturn: position.reportedPriorReturn !== undefined
        ? knownDraftValue(position.reportedPriorReturn, source)
        : unknownDraftValue(),
      averageCost: position.averageCost
        ? knownDraftValue(position.averageCost, source)
        : unknownDraftValue(),
      observedPrice: position.observedPrice
        ? knownDraftValue(position.observedPrice, source)
        : unknownDraftValue(),
      priceAsOf: position.priceAsOf
        ? knownDraftValue(position.priceAsOf, source)
        : unknownDraftValue(),
      priceSource: position.priceSource
        ? knownDraftValue(position.priceSource, source)
        : unknownDraftValue(),
      reportedMarketValue: position.reportedMarketValue
        ? knownDraftValue(position.reportedMarketValue, source)
        : unknownDraftValue(),
    })),
  };
}

export function openingPositionFromPortfolioState(
  position: PortfolioState["positions"][number],
): OpeningPositionInput {
  return {
    instrumentId: position.instrumentId,
    ...(position.displayName ? { displayName: position.displayName } : {}),
    ...(position.instrumentCode ? { instrumentCode: position.instrumentCode } : {}),
    ...(position.assetType ? { assetType: position.assetType } : {}),
    quantity: position.quantity,
    currency: position.currency,
    costBasis: position.costBasis,
    reportedPriorReturn: position.reportedPriorReturn,
    ...(position.averageCost ? { averageCost: position.averageCost } : {}),
    ...(position.observedPrice ? { observedPrice: position.observedPrice } : {}),
    ...(position.priceAsOf ? { priceAsOf: position.priceAsOf } : {}),
    ...(position.priceSource ? { priceSource: position.priceSource } : {}),
    ...(position.reportedMarketValue
      ? { reportedMarketValue: position.reportedMarketValue }
      : {}),
  };
}
