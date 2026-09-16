import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createSourceAccountMarketDataStatuses,
  createSourceAccountStatusReadModel,
  type SourceAccountsPageReadModel,
} from "@/application/source-account-status";
import {
  effectiveSourceAccountLabels,
  SourceAccountDeletionError,
  sourceAccountIdForType,
} from "@/domain/source-accounts";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { createStoredPortfolioOverviewReadModel } from "@/server/stored-portfolio-overview";

const renameSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1).max(80),
});

const createSchema = z.object({
  accountType: z.string().trim().min(1).max(80),
  label: z.string().trim().max(80).optional(),
});

const deleteSchema = z.object({ id: z.string().trim().min(1).max(120) }).strict();

type AccountsDatabase = Pick<
  PortfolioDatabase,
  | "readPortfolioFacts"
  | "readMarketData"
  | "readSourceAccountLabels"
  | "readSourceAccounts"
  | "createSourceAccount"
  | "deleteSourceAccount"
  | "renameSourceAccount"
>;

export function createAccountsHandlers(input: {
  database: AccountsDatabase;
  newId?: () => string;
  now?: () => string;
  isTrading212Configured: (sourceAccountId: string) => boolean;
  trading212Environment: () => "demo" | "live";
  logError?: (message: string, error: unknown) => void;
}) {
  function readAccountsPage(): SourceAccountsPageReadModel {
    const now = input.now?.() ?? new Date().toISOString();
    const facts = input.database.readPortfolioFacts();
    const marketData = input.database.readMarketData();
    const labelOverrides = input.database.readSourceAccountLabels();
    const sourceAccounts = input.database.readSourceAccounts();
    const labels = effectiveSourceAccountLabels(sourceAccounts, labelOverrides);
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
    async POST(request: Request) {
      try {
        const create = createSchema.parse(await request.json());
        const generatedId = input.newId?.() ?? `account-${crypto.randomUUID()}`;
        input.database.createSourceAccount({
          id: sourceAccountIdForType(create.accountType, generatedId),
          accountType: create.accountType,
          ...(create.label ? { label: create.label } : {}),
        });
        return NextResponse.json(readAccountsPage(), { status: 201 });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return NextResponse.json(
            { error: "Enter an account type and an optional name of 80 characters or fewer." },
            { status: 400 },
          );
        }
        if (error instanceof Error && error.message === "Source Account type already exists") {
          return NextResponse.json(
            { error: "An account of this type already exists." },
            { status: 409 },
          );
        }
        (input.logError ?? console.error)("Source Account creation failed", error);
        return NextResponse.json({ error: "Account could not be created." }, { status: 400 });
      }
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
        return NextResponse.json({ error: "Account name could not be saved." }, { status: 400 });
      }
    },
    async DELETE(request: Request) {
      try {
        const { id } = deleteSchema.parse(await request.json());
        input.database.deleteSourceAccount(id);
        return NextResponse.json(readAccountsPage());
      } catch (error) {
        if (error instanceof z.ZodError) {
          return NextResponse.json({ error: "Choose an account to delete." }, { status: 400 });
        }
        if (error instanceof SourceAccountDeletionError) {
          const response = {
            "has-data": ["Remove or transfer this account's portfolio data before deleting it.", 409],
            "not-found": ["Account was not found.", 404],
          }[error.code] as [string, number];
          return NextResponse.json({ error: response[0] }, { status: response[1] });
        }
        (input.logError ?? console.error)("Source Account deletion failed", error);
        return NextResponse.json({ error: "Account could not be deleted." }, { status: 500 });
      }
    },
  };
}
