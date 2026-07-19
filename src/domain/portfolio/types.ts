export type CurrencyCode = string;

export interface MoneyInput {
  amount: string;
  currency: CurrencyCode;
}

export interface OpeningPositionInput {
  instrumentId: string;
  quantity: string;
  currency: CurrencyCode;
  costBasis: string;
  reportedPriorReturn?: string;
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
  quantity: string;
  currency: CurrencyCode;
  costBasis: string;
  reportedPriorReturn: string;
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
