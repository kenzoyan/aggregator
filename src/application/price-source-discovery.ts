import type { PortfolioState, Position } from "@/domain/portfolio/types";
import type { MarketRefreshFailureCategory } from "@/domain/market-data";

export interface PriceSourceRefreshStatus {
  sourceAccountId: string;
  instrumentId: string;
  instrumentCode: string;
  provider: "eastmoney";
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
  provider: "eastmoney";
  identityUrl: string;
}

export interface PriceSourceBinding {
  sourceAccountId: string;
  instrumentId: string;
  instrumentName: string;
  instrumentCode: string;
  currency: string;
  shareClass: string;
  provider: "eastmoney";
  identityUrl: string;
  confirmedAt: string;
  lastRefresh?: Omit<PriceSourceRefreshStatus, "sourceAccountId" | "instrumentId" | "instrumentCode" | "provider">;
}

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
