import { NextResponse } from "next/server";
import { z } from "zod";

import { createPortfolioOverviewReadModel } from "@/application/portfolio-overview";
import {
  createSourceAccountMarketDataStatuses,
  createSourceAccountStatusReadModel,
} from "@/application/source-account-status";
import { sourceAccounts } from "@/domain/source-accounts";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";

const renameSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1).max(80),
});

type AccountsDatabase = Pick<
  PortfolioDatabase,
  | "readPortfolioFacts"
  | "readMarketData"
  | "readSourceAccountLabels"
  | "renameSourceAccount"
>;

export function createAccountsHandlers(input: {
  database: AccountsDatabase;
  now?: () => string;
  trading212Configuration: (sourceAccountId: string) => unknown;
  trading212Environment: () => "demo" | "live";
  logError?: (message: string, error: unknown) => void;
}) {
  function readAccountsPage() {
    const now = input.now?.() ?? new Date().toISOString();
    const facts = input.database.readPortfolioFacts();
    const marketData = input.database.readMarketData();
    const labels = input.database.readSourceAccountLabels();
    const portfolio = createPortfolioOverviewReadModel({
      snapshots: facts.openingSnapshots,
      events: facts.events,
      asOf: now,
      marketPrices: marketData.observations,
      fxObservations: marketData.fxObservations,
      marketRefreshHistory: marketData.marketRefreshHistory,
      accountLabels: labels,
    });
    const accounts = createSourceAccountStatusReadModel({
      accounts: sourceAccounts,
      confirmedSnapshots: facts.confirmedSnapshots,
      snapshots: facts.openingSnapshots,
      state: facts.state,
      labels,
      now,
    }).map((account) => ({
      ...account,
      ...(account.provider === "trading212"
        ? {
            connector: {
              configured: Boolean(input.trading212Configuration(account.id)),
              environment: input.trading212Environment(),
              access: "read-only" as const,
            },
          }
        : {}),
    }));

    return {
      accounts,
      accountAllocation: portfolio.accountAllocation,
      marketDataStatuses: createSourceAccountMarketDataStatuses(
        portfolio.holdings,
        portfolio.missingInputs,
      ),
    };
  }

  return {
    async GET() {
      return NextResponse.json(readAccountsPage());
    },
    async PATCH(request: Request) {
      try {
        const rename = renameSchema.parse(await request.json());
        input.database.renameSourceAccount(rename.id, rename.label);
        return NextResponse.json(readAccountsPage());
      } catch (error) {
        if (error instanceof z.ZodError) {
          return NextResponse.json(
            { error: "Choose an account and enter a name of 80 characters or fewer." },
            { status: 400 },
          );
        }
        (input.logError ?? console.error)("Source Account rename failed", error);
        return NextResponse.json(
          { error: "Account name could not be saved." },
          { status: 400 },
        );
      }
    },
  };
}
