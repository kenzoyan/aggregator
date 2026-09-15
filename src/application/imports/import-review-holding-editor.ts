import type { EditableDraftHolding } from "@/application/imports/import-draft-read-model";
import { assetTypeSchema } from "@/domain/portfolio/schemas";

export type EditableHoldingField =
  | "displayName"
  | "instrumentCode"
  | "assetType"
  | "quantity"
  | "currency"
  | "costBasis"
  | "reportedPriorReturn"
  | "averageCost"
  | "observedPrice"
  | "priceAsOf"
  | "reportedMarketValue";

export function updateEditableHoldingField(
  holding: EditableDraftHolding,
  field: EditableHoldingField,
  value: string,
  preserveIdentity: boolean,
): EditableDraftHolding {
  if (field === "displayName") {
    return {
      ...holding,
      displayName: value,
      instrumentId: preserveIdentity
        ? holding.instrumentId
        : holding.instrumentCode || value,
    };
  }
  if (field === "instrumentCode") {
    return {
      ...holding,
      instrumentCode: value || undefined,
      instrumentId: preserveIdentity
        ? holding.instrumentId
        : value || holding.displayName || holding.instrumentId,
    };
  }
  if (field === "assetType") {
    const assetType = assetTypeSchema.safeParse(value);
    return {
      ...holding,
      assetType: assetType.success ? assetType.data : undefined,
    };
  }
  if (field === "priceAsOf") {
    return {
      ...holding,
      priceAsOf: value ? `${value}T00:00:00.000Z` : undefined,
    };
  }
  if (
    field === "observedPrice" ||
    field === "averageCost" ||
    field === "reportedMarketValue"
  ) {
    return { ...holding, [field]: value || undefined };
  }
  return { ...holding, [field]: value };
}
