import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createSourceAccountMarketDataStatuses,
  createSourceAccountStatusReadModel,
  type SourceAccountsPageReadModel,
} from "@/application/source-account-status";
import { sourceAccounts } from "@/domain/source-accounts";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { createStoredPortfolioOverviewReadModel } from "@/server/stored-portfolio-overview";

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
  isTrading212Configured: (sourceAccountId: string) => boolean;
  trading212Environment: () => "demo" | "live";
  logError?: (message: string, error: unknown) => void;
}) {
  function readAccountsPage(): SourceAccountsPageReadModel {
    const now = input.now?.() ?? new Date().toISOString();
    const facts = input.database.readPortfolioFacts();
    const marketData = input.database.readMarketData();
    const labels = input.database.readSourceAccountLabels();
    const portfolio = createStoredPortfolioOverviewReadModel({
      facts,
      marketData,
      accountLabels: labels,
      asOf: now,
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
              configured: input.isTrading212Configured(account.id),
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
      let rename: z.infer<typeof renameSchema>;
      try {
        rename = renameSchema.parse(await request.json());
      } catch (error) {
        if (error instanceof z.ZodError || error instanceof SyntaxError) {
          return NextResponse.json(
            { error: "Choose an account and enter a name of 80 characters or fewer." },
            { status: 400 },
          );
        }
        return NextResponse.json(
          { error: "Account name could not be saved." },
          { status: 400 },
        );
      }
      try {
        input.database.renameSourceAccount(rename.id, rename.label);
      } catch (error) {
        (input.logError ?? console.error)("Source Account rename failed", error);
        return NextResponse.json(
          { error: "Account name could not be saved." },
          { status: 400 },
        );
      }
      try {
        return NextResponse.json(readAccountsPage());
      } catch (error) {
        (input.logError ?? console.error)("Source Account reload failed", error);
        return NextResponse.json(
          { error: "Account name was saved, but account data could not be reloaded." },
          { status: 500 },
        );
      }
    },
  };
}
