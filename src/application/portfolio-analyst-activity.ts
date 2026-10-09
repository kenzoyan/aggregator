import Decimal from "decimal.js";
import { z } from "zod";

import type { ActivityHistoryToolInput, AnalystEvidenceFact, PortfolioAnalystContextV1, RecordedActivityFact } from "@/application/portfolio-analyst-contract";
import { holdingUpdateHistory } from "@/application/portfolio-activity-history";
import { assertPortfolioAnalystContextSize } from "@/application/portfolio-analyst-context-size";
import { buildPortfolioState } from "@/domain/portfolio/ledger";
import { normalizeSourceAccountType, type SourceAccountDefinition } from "@/domain/source-accounts";
import type { OpeningPositionInput, SaleEventInput } from "@/domain/portfolio/types";
import type { PortfolioFacts } from "@/infrastructure/sqlite/portfolio-repository-contract";

const MAX_RECORDS = 20;
const requestSchema = z.object({
  accountType: z.string().trim().min(1).max(200),
  holding: z.string().trim().min(1).max(200).optional(),
  fromDate: z.iso.date().optional(), toDate: z.iso.date().optional(),
  language: z.enum(["en", "zh-CN"]), includeHoldingNames: z.boolean(),
}).strict().refine((input) => !input.fromDate || !input.toDate || input.fromDate <= input.toDate, "Choose a valid history date range.");

function identity(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function saleCost(facts: PortfolioFacts, event: SaleEventInput) {
  const index = facts.events.findIndex((candidate) => candidate.id === event.id);
  // Imported sales already contain their pre-import position. Manual sales use
  // only the account's snapshots and events that precede this sale.
  const before = event.importUndo?.positionBefore ?? buildPortfolioState({
    openingSnapshots: facts.openingSnapshots.filter((snapshot) =>
      snapshot.sourceAccountId === event.sourceAccountId && snapshot.asOf <= event.asOf),
    events: facts.events.filter((candidate, candidateIndex) =>
      candidate.sourceAccountId === event.sourceAccountId &&
      (candidate.asOf < event.asOf || (candidate.asOf === event.asOf && candidateIndex < index))),
  }).positions.find((position) => position.sourceAccountId === event.sourceAccountId && position.instrumentId === event.instrumentId);
  if (!before || new Decimal(before.quantity).lte(0)) return undefined;
  return new Decimal(before.costBasis).times(event.quantity).div(before.quantity);
}

export function createActivityHistoryContext(input: {
  request: ActivityHistoryToolInput & { holding?: string };
  accounts: readonly SourceAccountDefinition[];
  facts?: PortfolioFacts;
  factsAsOf: string;
}): PortfolioAnalystContextV1 {
  const request = requestSchema.parse(input.request);
  const summary: Extract<AnalystEvidenceFact, { kind: "activity-history-summary" }> = {
    key: "history.summary", kind: "activity-history-summary", label: "Recorded history summary",
    requestedAccount: request.accountType, ...(request.holding ? { requestedHolding: request.holding } : {}),
    status: "unavailable", recordCount: 0, shownRecordCount: 0, coverage: "recorded-history-only",
    ...(request.fromDate ? { fromDate: request.fromDate } : {}), ...(request.toDate ? { toDate: request.toDate } : {}),
    provenance: "portfolio-ledger",
  };
  const context: PortfolioAnalystContextV1 = {
    version: "portfolio-analyst-context.v1", job: "manage-accounts", language: request.language,
    factsAsOf: input.factsAsOf, scope: {},
    definitions: { baseCurrency: "EUR", holdingCurrencyMeaning: "instrument-quoted-currency", portfolioActivityMeaning: "estimated-unexplained-value-movement" },
    facts: [summary], limitations: [], allowedActions: [],
  };
  if (!input.facts) return context;
  const accounts = input.accounts.filter((account) =>
    normalizeSourceAccountType(account.accountType) === normalizeSourceAccountType(request.accountType) ||
    normalizeSourceAccountType(account.label) === normalizeSourceAccountType(request.accountType));
  if (accounts.length !== 1) {
    summary.status = accounts.length === 0 ? "account-not-found" : "account-ambiguous";
    return context;
  }
  const accountId = accounts[0].id;
  const facts = input.facts;
  const positions = new Map<string, { position: OpeningPositionInput; identities: Set<string> }>();
  for (const snapshot of facts.openingSnapshots.toSorted((a, b) => b.asOf.localeCompare(a.asOf))) {
    if (snapshot.sourceAccountId !== accountId) continue;
    for (const position of snapshot.positions) {
      const item = positions.get(position.instrumentId) ?? { position, identities: new Set<string>() };
      for (const value of [position.instrumentId, position.instrumentCode, position.displayName]) if (value) item.identities.add(identity(value));
      positions.set(position.instrumentId, item);
    }
  }
  let instrumentId: string | undefined;
  if (request.holding) {
    const matches = [...positions.entries()].filter(([, item]) => item.identities.has(identity(request.holding!)));
    if (matches.length !== 1) {
      summary.status = matches.length === 0 ? "holding-not-found" : "holding-ambiguous";
      return context;
    }
    instrumentId = matches[0][0];
  }
  const names = (id: string) => {
    const position = positions.get(id)?.position;
    return request.includeHoldingNames ? {
      ...(position?.displayName ? { name: position.displayName.slice(0, 120) } : {}),
      ...(position?.instrumentCode ? { symbol: position.instrumentCode.slice(0, 80) } : {}),
    } : {};
  };
  const records: Omit<RecordedActivityFact, "key">[] = [];
  if (instrumentId) {
    for (const update of holdingUpdateHistory(facts, accountId).filter((item) => item.instrumentId === instrumentId)) {
      records.push({ kind: "recorded-activity", label: "Recorded activity", activity: update.type === "Holding created" ? "holding-created" : update.type === "Units added" ? "units-added" : "holding-updated",
        asOf: update.asOf, status: "active", ...names(instrumentId), quantity: update.quantity,
        currency: update.amount.currency, amount: update.amount.amount, amountMeaning: update.type === "Holding created" ? "initial-cost" : "cost-change",
        source: "confirmed-holding-update", provenance: "portfolio-ledger" });
    }
  }
  for (const event of facts.events) {
    if (event.sourceAccountId !== accountId || (instrumentId && (event.type !== "sale" || event.instrumentId !== instrumentId))) continue;
    const base = {
      kind: "recorded-activity" as const, label: "Recorded activity" as const, asOf: event.asOf,
      status: event.voidedAt ? "undone" as const : "active" as const,
      ...(event.recordedAt ? { recordedAt: event.recordedAt } : {}), ...(event.voidedAt ? { voidedAt: event.voidedAt } : {}),
      source: event.sourceImportId ? "confirmed-import" as const : "manual-record" as const, provenance: "portfolio-ledger" as const,
      destinationKnown: Boolean(event.destination), ...(event.destination ? { destination: event.destination.kind } : {}),
      ...(request.includeHoldingNames && event.destination?.kind === "external-account" ? { destinationName: event.destination.name.slice(0, 100) } : {}),
      excludedFromTrackedAssets: !event.voidedAt && event.destination?.kind === "external-account",
    };
    if (event.type === "cash-withdrawal") {
      records.push({ ...base, activity: "cash-withdrawal", amount: event.amount.amount, currency: event.amount.currency, amountMeaning: "withdrawal" });
    } else {
      const net = new Decimal(event.proceeds.amount).minus(event.fees?.amount ?? "0");
      const cost = event.voidedAt ? undefined : saleCost(facts, event);
      records.push({ ...base, activity: "sale", ...names(event.instrumentId), quantity: event.quantity,
        amount: event.proceeds.amount, currency: event.proceeds.currency, amountMeaning: "gross-sale-proceeds",
        fees: event.fees?.amount ?? "0", netProceeds: net.toString(),
        ...(cost ? { soldCostBasis: cost.toString(), realizedResult: net.minus(cost).toString() } : {}),
      });
    }
  }
  const matching = records.filter((record) => (!request.fromDate || record.asOf.slice(0, 10) >= request.fromDate) &&
    (!request.toDate || record.asOf.slice(0, 10) <= request.toDate)).toSorted((a, b) => b.asOf.localeCompare(a.asOf));
  summary.status = "found";
  summary.recordCount = matching.length;
  summary.shownRecordCount = Math.min(matching.length, MAX_RECORDS);
  context.facts.push(...matching.slice(0, MAX_RECORDS).map((record, index) => ({ ...record, key: `history.record.${index + 1}` })));
  assertPortfolioAnalystContextSize(context);
  return context;
}
