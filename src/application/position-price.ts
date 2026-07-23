import Decimal from "decimal.js";

import type { OpeningPositionInput } from "@/domain/portfolio/types";

export function openingPositionUnitPrice(
  position: OpeningPositionInput,
): Decimal | undefined {
  if (position.observedPrice) return new Decimal(position.observedPrice);
  const quantity = new Decimal(position.quantity);
  if (quantity.isZero()) return undefined;
  if (position.reportedMarketValue) {
    return new Decimal(position.reportedMarketValue).div(quantity);
  }
  return new Decimal(position.costBasis)
    .plus(position.reportedPriorReturn ?? "0")
    .div(quantity);
}
