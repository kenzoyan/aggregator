import type {
  OpeningSnapshotInput,
  PortfolioState,
} from "@/domain/portfolio/types";
import { selectLatestSnapshotsByAccount } from "@/domain/portfolio/ledger";
import type { SourceAccountDefinition } from "@/domain/source-accounts";
import type {
  HoldingReadModel,
  MissingValuationInputReadModel,
  SourceAccountAllocationReadModel,
} from "@/application/portfolio-read-model";

export type SourceAccountConnectionStatus = "current" | "stale" | "not-connected";

export interface SourceAccountStatus {
  id: string;
  accountType: string;
  provider: SourceAccountDefinition["provider"];
  label: string;
  updateMethod: "Screenshot" | "Trading 212 API";
  status: SourceAccountConnectionStatus;
  lastUpdatedAt?: string;
  dataAsOf?: string;
  holdingCount: number;
}

export interface SourceAccountConnectorStatus {
  configured: boolean;
  environment: "demo" | "live";
  access: "read-only";
}

export interface SourceAccountView extends SourceAccountStatus {
  connector?: SourceAccountConnectorStatus;
}

export interface SourceAccountMarketDataStatus {
  sourceAccountId: string;
  status: "current" | "attention" | "manual";
  asOf?: string;
  holdingCount: number;
}

export interface SourceAccountsPageReadModel {
  accounts: SourceAccountView[];
  accountAllocation: SourceAccountAllocationReadModel[];
  marketDataStatuses: SourceAccountMarketDataStatus[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function createSourceAccountMarketDataStatuses(
  holdings: readonly Pick<
    HoldingReadModel,
    "sourceAccountId" | "category" | "freshness" | "asOf" | "detail"
  >[],
  missingInputs: readonly Pick<MissingValuationInputReadModel, "sourceAccountId">[] = [],
): SourceAccountMarketDataStatus[] {
  const investments = holdings.filter((holding) => holding.category !== "Portfolio cash");
  const accountIds = new Set([
    ...investments.map((holding) => holding.sourceAccountId),
    ...missingInputs.flatMap((missing) => missing.sourceAccountId ? [missing.sourceAccountId] : []),
  ]);
  return [...accountIds].map((sourceAccountId) => {
    const accountHoldings = investments.filter((holding) => holding.sourceAccountId === sourceAccountId);
    const accountMissingInputs = missingInputs.filter((missing) => missing.sourceAccountId === sourceAccountId);
    const problemHoldings = accountHoldings.filter((holding) =>
      holding.freshness === "stale" || holding.freshness === "awaiting-nav"
    );
    const status = accountMissingInputs.length > 0 || problemHoldings.length > 0
      ? "attention" as const
      : accountHoldings.some((holding) => holding.freshness === "manual")
        ? "manual" as const
        : "current" as const;
    const datedHoldings = status === "attention" ? problemHoldings : accountHoldings;
    const dates = datedHoldings
      .map((holding) => holding.detail?.currentPriceAsOf ?? holding.asOf)
      .sort();
    const asOf = status === "attention" ? dates.at(0) : dates.at(-1);
    return {
      sourceAccountId,
      status,
      ...(asOf ? { asOf } : {}),
      holdingCount: accountHoldings.length + accountMissingInputs.length,
    };
  });
}

export function createSourceAccountStatusReadModel(input: {
  accounts: readonly SourceAccountDefinition[];
  confirmedSnapshots: readonly {
    snapshot: OpeningSnapshotInput;
    confirmedAt: string;
  }[];
  snapshots: readonly OpeningSnapshotInput[];
  state: PortfolioState;
  labels: Readonly<Record<string, string>>;
  now: string;
}): SourceAccountStatus[] {
  const latestConfirmationByAccount = new Map<string, string>();
  for (const record of input.confirmedSnapshots) {
    const current = latestConfirmationByAccount.get(record.snapshot.sourceAccountId);
    if (!current || record.confirmedAt >= current) {
      latestConfirmationByAccount.set(record.snapshot.sourceAccountId, record.confirmedAt);
    }
  }
  const activeSnapshots = selectLatestSnapshotsByAccount(input.snapshots);

  const now = new Date(input.now).getTime();
  return input.accounts.map((account) => {
    const snapshot = activeSnapshots.get(account.id);
    const lastUpdatedAt = latestConfirmationByAccount.get(account.id);
    const staleAfter = account.updateMethod === "trading-212" ? 2 * DAY_MS : 35 * DAY_MS;
    const age = snapshot ? now - new Date(snapshot.asOf).getTime() : undefined;

    return {
      id: account.id,
      accountType: account.accountType,
      provider: account.provider,
      label: input.labels[account.id] ?? account.label,
      updateMethod: account.updateMethod === "trading-212" ? "Trading 212 API" : "Screenshot",
      status: !snapshot ? "not-connected" : age !== undefined && age > staleAfter ? "stale" : "current",
      ...(lastUpdatedAt ? { lastUpdatedAt } : {}),
      ...(snapshot ? { dataAsOf: snapshot.asOf } : {}),
      holdingCount: input.state.positions.filter(
        (position) => position.sourceAccountId === account.id,
      ).length,
    };
  });
}
