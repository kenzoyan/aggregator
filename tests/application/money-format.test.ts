import { describe, expect, it } from "vitest";

import {
  formatOriginalMoney,
  formatSignedOriginalMoney,
} from "@/application/money-format";

describe("original-currency money formatting", () => {
  it("shows a decimal point and two monetary decimals instead of an ambiguous decimal comma", () => {
    expect(formatSignedOriginalMoney(123.4567, "CNY"))
      .toBe("+123.46 CNY");
  });

  it("limits a current original-currency value to two monetary decimals", () => {
    expect(formatOriginalMoney(9876.54321, "CNY"))
      .toBe("9,876.54 CNY");
  });
});
