import { NextResponse } from "next/server";
import { z } from "zod";

import { createSourceAccountStatusReadModel } from "@/application/source-account-status";
import { sourceAccounts } from "@/domain/source-accounts";
import { getPortfolioDatabase } from "@/server/portfolio-db";
import {
  getTrading212ConnectionConfig,
  trading212Environment,
} from "@/server/trading212-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const renameSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1).max(80),
});

function readAccounts() {
  const database = getPortfolioDatabase();
  const facts = database.readPortfolioFacts();
  const snapshots = facts.openingSnapshots;
  const statuses = createSourceAccountStatusReadModel({
    accounts: sourceAccounts,
    confirmedSnapshots: facts.confirmedSnapshots,
    snapshots,
    state: facts.state,
    labels: database.readSourceAccountLabels(),
    now: new Date().toISOString(),
  });

  return statuses.map((account) => ({
    ...account,
    ...(account.provider === "trading212"
      ? {
          connector: {
            configured: Boolean(getTrading212ConnectionConfig(account.id)),
            environment: trading212Environment(),
            access: "read-only" as const,
          },
        }
      : {}),
  }));
}

export async function GET() {
  return NextResponse.json({ accounts: readAccounts() });
}

export async function PATCH(request: Request) {
  try {
    const input = renameSchema.parse(await request.json());
    getPortfolioDatabase().renameSourceAccount(input.id, input.label);
    return NextResponse.json({ accounts: readAccounts() });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Choose an account and enter a name of 80 characters or fewer." },
        { status: 400 },
      );
    }
    console.error("Source Account rename failed", error);
    return NextResponse.json({ error: "Account name could not be saved." }, { status: 400 });
  }
}
