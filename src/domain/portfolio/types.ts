export type CurrencyCode = string;
export const assetTypes = ["fund", "stock", "bond", "etf", "unclassified"] as const;
export type AssetType = (typeof assetTypes)[number];
export const assetTypeLabels = {
  fund: "Fund",
  stock: "Stock",
  bond: "Bond",
  etf: "ETF",
  unclassified: "Unclassified",
} as const satisfies Record<AssetType, string>;

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
  kind?: "opening" | "holding-state";
  portfolioCash?: MoneyInput;
  positions: readonly OpeningPositionInput[];
}

export type CashDestination =
  | { kind: "investment-account" }
  | { kind: "external-account"; name: string };

interface EventRecord {
  recordedAt?: string;
  voidedAt?: string;
  sourceImportId?: string;
}

export interface SaleEventInput extends EventRecord {
  id: string;
  type: "sale";
  sourceAccountId: string;
  instrumentId: string;
  asOf: string;
  quantity: string;
  proceeds: MoneyInput;
  fees?: MoneyInput;
  destination?: CashDestination;
  importUndo?: {
    snapshotId: string;
    positionBefore: OpeningPositionInput;
    retainedCash: MoneyInput;
  };
}

export interface CashWithdrawalEventInput extends EventRecord {
  id: string;
  type: "cash-withdrawal";
  sourceAccountId: string;
  asOf: string;
  amount: MoneyInput;
  destination: { kind: "external-account"; name: string };
}

export type PortfolioEventInput = SaleEventInput | CashWithdrawalEventInput;

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
