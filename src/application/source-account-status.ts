import type {
  OpeningSnapshotInput,
  PortfolioState,
} from "@/domain/portfolio/types";
import { selectLatestSnapshotsByAccount } from "@/domain/portfolio/ledger";
import type { SourceAccountDefinition } from "@/domain/source-accounts";

export type SourceAccountConnectionStatus = "current" | "stale" | "not-connected";

export interface SourceAccountStatus {
  id: string;
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

const DAY_MS = 24 * 60 * 60 * 1000;

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
