import { NextResponse } from "next/server";

import {
  createDashboardReadModel,
  createPortfolioHistoryReadModel,
} from "@/application/portfolio-dashboard";
import { createSourceAccountStatusReadModel } from "@/application/source-account-status";
import { sourceAccounts } from "@/domain/source-accounts";
import { EcbFxClient, type EcbRates } from "@/infrastructure/ecb/ecb-fx-client";
import { getPortfolioRepository } from "@/server/portfolio-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cachedRates: { expiresAt: number; value: EcbRates } | undefined;

async function latestRates(): Promise<EcbRates> {
  if (cachedRates && cachedRates.expiresAt > Date.now()) return cachedRates.value;
  const value = await new EcbFxClient().fetchLatestRates();
  cachedRates = { expiresAt: Date.now() + 6 * 60 * 60 * 1000, value };
  return value;
}

export async function GET() {
  const repository = getPortfolioRepository();
  const state = repository.getPortfolioState();
  const snapshots = repository.getOpeningSnapshots();
  const accountLabels = repository.getSourceAccountLabels();
  const snapshotTimes = Object.fromEntries(
    snapshots.map((snapshot) => [snapshot.sourceAccountId, snapshot.asOf]),
  );

  let rates: EcbRates;
  try {
    rates = await latestRates();
  } catch (error) {
    console.error("ECB FX refresh failed", error);
    rates = { asOf: new Date().toISOString(), eurPerUnit: { EUR: "1" } };
  }

  const portfolio = createDashboardReadModel({
    state,
    asOf: new Date().toISOString(),
    snapshotTimes,
    eurPerUnit: rates.eurPerUnit,
    fxAsOf: rates.asOf,
    accountLabels,
  });
  const history = createPortfolioHistoryReadModel({
    snapshots,
    asOf: new Date().toISOString(),
    eurPerUnit: rates.eurPerUnit,
    fxAsOf: rates.asOf,
  });

  return NextResponse.json({
    hasPortfolioData: state.positions.length > 0 || state.cashBalances.length > 0,
    portfolio: {
      ...portfolio,
      history,
      accounts: createSourceAccountStatusReadModel({
        accounts: sourceAccounts,
        confirmedSnapshots: repository.getConfirmedSnapshots(),
        snapshots,
        state,
        labels: accountLabels,
        now: new Date().toISOString(),
      }),
    },
  });
}
