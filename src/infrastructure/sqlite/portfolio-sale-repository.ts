import type { DatabaseSync } from "node:sqlite";

import { prepareSaleReview, SaleReviewError, type SaleInput } from "@/application/portfolio-sale";
import type { PortfolioFacts } from "./portfolio-repository-contract";

export function createPortfolioSaleRepository(database: DatabaseSync, readFacts: () => PortfolioFacts) {
  const insert = database.prepare(`
    INSERT INTO portfolio_events (id, source_account_id, as_of, event_type, payload_json)
    VALUES (?, ?, ?, 'sale', ?)
  `);
  return {
    confirmSale(input: SaleInput, expectedReviewToken: string, id: string) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const review = prepareSaleReview(readFacts(), input);
        if (review.reviewToken !== expectedReviewToken) {
          throw new SaleReviewError("Holdings changed since this review. Review the sale again.");
        }
        const event = { ...review.event, id };
        insert.run(event.id, event.sourceAccountId, event.asOf, JSON.stringify(event));
        database.exec("COMMIT");
        return event;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
