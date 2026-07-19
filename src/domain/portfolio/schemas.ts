import Decimal from "decimal.js";
import { z } from "zod";

import { assetTypes } from "./types";

export const decimalStringSchema = z.string().trim().refine((value) => {
  try {
    return new Decimal(value).isFinite();
  } catch {
    return false;
  }
}, "Enter a valid number.");

export const positiveDecimalStringSchema = decimalStringSchema.refine(
  (value) => new Decimal(value).gt(0),
  "Enter a number greater than zero.",
);

export const currencyCodeSchema = z.string().trim().regex(
  /^[A-Za-z]{3}$/,
  "Use a three-letter currency code.",
);

export const assetTypeSchema = z.enum(assetTypes);
