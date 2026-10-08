import Decimal from "decimal.js";
import { openingPositionUnitPrice } from "@/application/position-price";
import type { OpeningSnapshotInput } from "@/domain/portfolio/types";
import type { DatabaseSync } from "node:sqlite";

import { prepareSaleReview, saleInputSchema, SaleReviewError, type SaleInput } from "@/application/portfolio-sale";
import { activityReviewToken, activityUndoBlock, prepareWithdrawalReview, withdrawalInputSchema, type WithdrawalInput } from "@/application/portfolio-cash-activity";
import type { PortfolioFacts } from "./portfolio-repository-contract";

export function createPortfolioSaleRepository(database: DatabaseSync, readFacts: () => PortfolioFacts) {
  const insert = database.prepare(`
    INSERT INTO portfolio_events (id, source_account_id, as_of, event_type, payload_json)
    VALUES (?, ?, ?, ?, ?)
  `);
  const update = database.prepare("UPDATE portfolio_events SET payload_json = ? WHERE id = ?");
  return {
    confirmWithdrawal(input: WithdrawalInput, expectedReviewToken: string, id: string) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const review = prepareWithdrawalReview(readFacts(), withdrawalInputSchema.parse(input));
        if (review.reviewToken !== expectedReviewToken) throw new SaleReviewError("Account activity changed. Review the transfer again.");
        const event = { ...review.event, id, recordedAt: new Date().toISOString() };
        insert.run(event.id, event.sourceAccountId, event.asOf, event.type, JSON.stringify(event));
        database.exec("COMMIT");
        return event;
      } catch (error) { database.exec("ROLLBACK"); throw error; }
    },
    undoCashActivity(id: string, expectedReviewToken: string) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const facts = readFacts();
        if (activityReviewToken(facts) !== expectedReviewToken) throw new SaleReviewError("Account activity changed. Reload and review the record again.");
        const event = facts.events.find((candidate) => candidate.id === id);
        if (!event) throw new SaleReviewError("Activity record was not found.");
        const blocked = activityUndoBlock(facts, event);
        if (blocked) throw new SaleReviewError(blocked);
        if (event.type === "sale" && event.sourceImportId && event.importUndo) {
          const row = database.prepare("SELECT payload_json FROM opening_snapshots WHERE id = ? AND confirmed_import_id = ?").get(event.importUndo.snapshotId, event.sourceImportId) as { payload_json: string } | undefined;
          if (!row) throw new SaleReviewError("The imported snapshot was not found.");
          const snapshot = JSON.parse(row.payload_json) as OpeningSnapshotInput;
          const before = event.importUndo.positionBefore;
          const after = snapshot.positions.find((position) => position.instrumentId === event.instrumentId);
          const restoredPosition = { ...before, ...after, quantity: before.quantity, costBasis: before.costBasis, reportedPriorReturn: before.reportedPriorReturn };
          if (after) {
            restoredPosition.observedPrice = openingPositionUnitPrice(after)?.toString();
            if (!after.reportedMarketValue) delete restoredPosition.reportedMarketValue;
          }
          if (after?.reportedMarketValue) {
            restoredPosition.reportedMarketValue = new Decimal(after.reportedMarketValue).div(after.quantity).mul(before.quantity).toString();
          }
          const restored: OpeningSnapshotInput = { ...snapshot,
            positions: [...snapshot.positions.filter((position) => position.instrumentId !== event.instrumentId), restoredPosition],
          };
          const cashToRemove = new Decimal(event.importUndo.retainedCash.amount);
          if (cashToRemove.gt(0)) {
            if (!snapshot.portfolioCash || snapshot.portfolioCash.currency !== event.importUndo.retainedCash.currency) throw new SaleReviewError("Reconcile account cash before undoing this sale.");
            restored.portfolioCash = { ...snapshot.portfolioCash, amount: new Decimal(snapshot.portfolioCash.amount).minus(cashToRemove).toString() };
          }
          database.prepare("UPDATE opening_snapshots SET payload_json = ? WHERE id = ?").run(JSON.stringify(restored), snapshot.id);
        }
        const undone = { ...event, voidedAt: new Date().toISOString() };
        update.run(JSON.stringify(undone), id);
        readFacts();
        database.exec("COMMIT");
        return undone;
      } catch (error) { database.exec("ROLLBACK"); throw error; }
    },
    confirmSale(input: SaleInput, expectedReviewToken: string, id: string) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const review = prepareSaleReview(readFacts(), saleInputSchema.parse(input));
        if (review.reviewToken !== expectedReviewToken) {
          throw new SaleReviewError("Holdings changed since this review. Review the sale again.");
        }
        const event = { ...review.event, id, recordedAt: new Date().toISOString() };
        insert.run(event.id, event.sourceAccountId, event.asOf, event.type, JSON.stringify(event));
        database.exec("COMMIT");
        return event;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
