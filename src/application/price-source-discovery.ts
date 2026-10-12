import { danskeEuropeanEquitySource } from "@/domain/public-fund-price-sources";
import type { PortfolioState, Position } from "@/domain/portfolio/types";
import type { FundNavProvider, MarketRefreshFailureCategory } from "@/domain/market-data";

export type PriceSourceProvider = "eastmoney" | "financial-times" | "danske-invest";
export type PriceSourceProviders = Partial<Record<PriceSourceProvider, FundNavProvider>>;

export interface PriceSourceRefreshStatus {
  sourceAccountId: string;
  instrumentId: string;
  instrumentCode: string;
  provider: PriceSourceProvider;
  checkedAt: string;
  outcome: "updated" | "unchanged" | "failed";
  latestPriceAsOf?: string;
  failureCategory?: MarketRefreshFailureCategory;
}

export interface PriceSourceCandidate {
  id: string;
  name: string;
  instrumentCode: string;
  currency: string;
  shareClass: string;
  provider: PriceSourceProvider;
  identityUrl: string;
}

export interface PriceSourceBinding {
  sourceAccountId: string;
  instrumentId: string;
  instrumentName: string;
  instrumentCode: string;
  currency: string;
  shareClass: string;
  provider: PriceSourceProvider;
  identityUrl: string;
  confirmedAt: string;
  lastRefresh?: Omit<PriceSourceRefreshStatus, "sourceAccountId" | "instrumentId" | "instrumentCode" | "provider">;
}

const danskeCandidate: PriceSourceCandidate = {
  id: "danske-FI0008802988-EUR",
  name: danskeEuropeanEquitySource.name,
  instrumentCode: danskeEuropeanEquitySource.isin,
  currency: danskeEuropeanEquitySource.currency,
  shareClass: danskeEuropeanEquitySource.shareClass,
  provider: "danske-invest",
  identityUrl: danskeEuropeanEquitySource.identityUrl,
};

const opCandidate: PriceSourceCandidate = {
  id: "ft-FI4000439773-EUR",
  name: "OP-Europe Fund A",
  instrumentCode: "FI4000439773",
  currency: "EUR",
  shareClass: "A (Accumulation)",
  provider: "financial-times",
  identityUrl: "https://markets.ft.com/data/funds/tearsheet/historical?s=FI4000439773:EUR",
};

const pilotCandidate: PriceSourceCandidate = {
  id: "cmf-012414-eastmoney",
  name: "招商中证白酒指数C",
  instrumentCode: "012414",
  currency: "CNY",
  shareClass: "C",
  provider: "eastmoney",
  identityUrl: "https://www.cmfchina.com/web/fundDetail/012414/index.html",
};

function normalizedName(name: string | undefined): string {
  return (name ?? "").replaceAll(/\s|[()（）]/g, "").toLowerCase();
}

export function discoverPriceSourceCandidates(
  position: Position,
  accountProvider: string,
): PriceSourceCandidate[] {
  for (const candidate of [opCandidate, danskeCandidate]) {
    if (position.assetType === "fund" && position.currency === candidate.currency && position.instrumentCode === candidate.instrumentCode) return [candidate];
  }
  if (accountProvider !== "wechat" || position.assetType !== "fund" ||
      position.currency !== "CNY" || /^\d{6}$/.test(position.instrumentCode ?? "")) {
    return [];
  }
  const name = normalizedName(position.displayName);
  return name === normalizedName(pilotCandidate.name) ||
    name === normalizedName("招商中证白酒指数(LOF)C")
    ? [pilotCandidate]
    : [];
}

export function bindingMatchesPosition(binding: PriceSourceBinding, position: Position): boolean {
  return binding.sourceAccountId === position.sourceAccountId &&
    binding.instrumentId === position.instrumentId &&
    binding.currency === position.currency &&
    (binding.provider === "eastmoney" ||
      (position.assetType === "fund" && position.instrumentCode === binding.instrumentCode)) &&
    (!/^\d{6}$/.test(position.instrumentCode ?? "") ||
      position.instrumentCode === binding.instrumentCode) &&
    normalizedName(binding.instrumentName) === normalizedName(position.displayName);
}

export function applyConfirmedPriceSources(
  state: PortfolioState,
  bindings: readonly PriceSourceBinding[],
): PortfolioState {
  const byPosition = new Map(bindings.map((binding) => [
    `${binding.sourceAccountId}:${binding.instrumentId}`,
    binding,
  ]));
  return {
    ...state,
    positions: state.positions.map((position) => {
      const binding = byPosition.get(`${position.sourceAccountId}:${position.instrumentId}`);
      return binding && bindingMatchesPosition(binding, position)
        ? { ...position, instrumentCode: binding.instrumentCode }
        : position;
    }),
  };
}
