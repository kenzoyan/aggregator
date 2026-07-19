export type CurrencyCode = string;
export const assetTypes = ["fund", "stock", "bond", "etf", "unclassified"] as const;
export type AssetType = (typeof assetTypes)[number];
export const assetTypeLabels: Record<AssetType, string> = {
  fund: "Fund",
  stock: "Stock",
  bond: "Bond",
  etf: "ETF",
  unclassified: "Unclassified",
};

export interface MoneyInput {
  amount: string;
  currency: CurrencyCode;
}

export interface OpeningPositionInput {
  instrumentId: string;
  displayName?: string;
  instrumentCode?: string;
  assetType?: AssetType;
  quantity: string;
  currency: CurrencyCode;
  costBasis: string;
  reportedPriorReturn?: string;
  averageCost?: string;
  observedPrice?: string;
  priceAsOf?: string;
  priceSource?: string;
  reportedMarketValue?: string;
}

export interface OpeningSnapshotInput {
  id: string;
  sourceAccountId: string;
  asOf: string;
  portfolioCash?: MoneyInput;
  positions: readonly OpeningPositionInput[];
}

export interface SaleEventInput {
  id: string;
  type: "sale";
  sourceAccountId: string;
  instrumentId: string;
  asOf: string;
  quantity: string;
  proceeds: MoneyInput;
  fees?: MoneyInput;
}

export type PortfolioEventInput = SaleEventInput;

export interface Position {
  sourceAccountId: string;
  instrumentId: string;
  displayName?: string;
  instrumentCode?: string;
  assetType?: AssetType;
  quantity: string;
  currency: CurrencyCode;
  costBasis: string;
  reportedPriorReturn: string;
  averageCost?: string;
  observedPrice?: string;
  priceAsOf?: string;
  priceSource?: string;
  reportedMarketValue?: string;
}

export interface CashBalance {
  sourceAccountId: string;
  currency: CurrencyCode;
  amount: string;
}

export interface PortfolioState {
  positions: Position[];
  cashBalances: CashBalance[];
  appliedEventIds: string[];
}
