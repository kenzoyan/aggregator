import { createHash } from "node:crypto";

import Decimal from "decimal.js";
import { z } from "zod";

import { portfolioCalendarDate } from "@/application/portfolio-calendar";
import { SaleReviewError } from "@/application/portfolio-sale";
import { externalDestinationSchema } from "@/application/portfolio-cash-contract";
import { holdingUpdateHistory } from "@/application/portfolio-activity-history";
import type { PortfolioFacts } from "@/infrastructure/sqlite/portfolio-repository-contract";
import type { CashWithdrawalEventInput, PortfolioEventInput } from "@/domain/portfolio/types";

export const withdrawalInputSchema = z.object({
  sourceAccountId: z.string().min(1),
  date: z.iso.date(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  amount: z.string().trim().regex(/^\d+(?:\.\d+)?$/),
  destination: externalDestinationSchema,
}).strict();
export type WithdrawalInput = z.infer<typeof withdrawalInputSchema>;

export function activityReviewToken(facts: PortfolioFacts) {
  return createHash("sha256").update(JSON.stringify(facts)).digest("hex");
}

export function prepareWithdrawalReview(facts: PortfolioFacts, input: WithdrawalInput) {
  const cash = facts.state.cashBalances.find((balance) =>
    balance.sourceAccountId === input.sourceAccountId && balance.currency === input.currency);
  const amount = new Decimal(input.amount);
  if (!cash || amount.lte(0) || amount.gt(cash.amount)) {
    throw new SaleReviewError("Withdrawal must be above zero and no more than this account's cash balance.");
  }
  const now = new Date();
  if (input.date > portfolioCalendarDate(now)) throw new SaleReviewError("A transfer date cannot be in the future.");
  const asOf = input.date === portfolioCalendarDate(now) ? now.toISOString() : `${input.date}T23:59:59.999Z`;
  const latestSnapshot = facts.openingSnapshots.filter((snapshot) => snapshot.sourceAccountId === input.sourceAccountId).at(-1);
  const latestEvent = facts.events.filter((event) => !event.voidedAt && event.sourceAccountId === input.sourceAccountId).at(-1);
  if (!latestSnapshot || asOf <= latestSnapshot.asOf || (latestEvent && asOf < latestEvent.asOf)) {
    throw new SaleReviewError("Choose a date after the latest holding snapshot and on or after the latest saved activity.");
  }
  const event: CashWithdrawalEventInput = {
    id: "withdrawal-preview", type: "cash-withdrawal", sourceAccountId: input.sourceAccountId,
    asOf, amount: { amount: amount.toString(), currency: input.currency }, destination: input.destination,
  };
  return { event, reviewToken: activityReviewToken(facts), preview: {
    cashBefore: cash.amount, cashAfter: new Decimal(cash.amount).minus(amount).toString(),
    currency: input.currency, externalOutflow: amount.toString(), destination: input.destination,
  } };
}

export function activityUndoBlock(facts: PortfolioFacts, event: PortfolioEventInput): string | undefined {
  if (event.voidedAt) return "This record was already undone.";
  const latest = facts.events.filter((candidate) => !candidate.voidedAt && candidate.sourceAccountId === event.sourceAccountId).at(-1);
  if (latest?.id !== event.id) return "Undo the account's later activity first.";
  if (event.sourceImportId) {
    const latestSnapshot = facts.confirmedSnapshots.filter(({ snapshot }) => snapshot.sourceAccountId === event.sourceAccountId).at(-1)?.snapshot;
    if (event.type !== "sale" || !event.importUndo || latestSnapshot?.id !== event.importUndo.snapshotId) {
      return "This account has a later import. Reconcile the account before undoing this record.";
    }
    const cashToRemove = new Decimal(event.importUndo.retainedCash.amount);
    const cash = facts.state.cashBalances.find((balance) => balance.sourceAccountId === event.sourceAccountId && balance.currency === event.importUndo!.retainedCash.currency);
    if (cashToRemove.gt(cash?.amount ?? "0")) return "There is not enough account cash to undo the retained sale proceeds. Reconcile the account first.";
    return undefined;
  }
  if (facts.confirmedSnapshots.some(({ snapshot, confirmedAt }) =>
    snapshot.sourceAccountId === event.sourceAccountId &&
      (snapshot.asOf >= event.asOf || (event.recordedAt && confirmedAt >= event.recordedAt)))) {
    return "This account was imported after this record. Reconcile the account before undoing it.";
  }
  return undefined;
}

export function createCashActivityReadModel(facts: PortfolioFacts, sourceAccountId: string) {
  return {
    reviewToken: activityReviewToken(facts),
    holdingUpdates: holdingUpdateHistory(facts, sourceAccountId),
    destinations: [...new Set(facts.events.flatMap((event) =>
      event.destination?.kind === "external-account" ? [event.destination.name] : []))].sort(),
    cashBalances: facts.state.cashBalances.filter((cash) => cash.sourceAccountId === sourceAccountId),
    records: facts.events.filter((event) => event.sourceAccountId === sourceAccountId).toReversed().map((event) => ({
      ...event, undoBlockedReason: activityUndoBlock(facts, event) ?? null,
      holdingName: event.type === "sale" ? facts.openingSnapshots.toReversed().flatMap((snapshot) =>
        snapshot.sourceAccountId === event.sourceAccountId
          ? snapshot.positions.filter((position) => position.instrumentId === event.instrumentId).map((position) => position.displayName ?? position.instrumentId)
          : []).at(0) ?? event.instrumentId : undefined,
    })),
  };
}
export type CashActivityReadModel = ReturnType<typeof createCashActivityReadModel>;
