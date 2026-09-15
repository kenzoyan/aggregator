import Decimal from "decimal.js";

import type {
  HoldingFieldChange,
  HoldingStateComparison,
} from "@/domain/import-draft";

export function sameDecimalValue(left: string, right: string): boolean {
  try {
    return new Decimal(left).equals(new Decimal(right));
  } catch {
    return left.trim() === right.trim();
  }
}

export function holdingStateFieldChanges(
  before: HoldingStateComparison,
  after: HoldingStateComparison,
): HoldingFieldChange[] {
  const changes: HoldingFieldChange[] = [];
  if (!sameDecimalValue(before.quantity, after.quantity)) {
    changes.push({ field: "quantity", before: before.quantity, after: after.quantity });
  }
  if (!sameDecimalValue(before.costBasis, after.costBasis)) {
    changes.push({ field: "costBasis", before: before.costBasis, after: after.costBasis });
  }
  if (before.currency.toUpperCase() !== after.currency.toUpperCase()) {
    changes.push({ field: "currency", before: before.currency, after: after.currency });
  }
  return changes;
}
