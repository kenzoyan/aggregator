import { describe, expect, it } from "vitest";

import {
  formatOriginalMoney,
  formatSignedOriginalMoney,
} from "@/application/money-format";

describe("original-currency money formatting", () => {
  it("shows a decimal point and two monetary decimals instead of an ambiguous decimal comma", () => {
    expect(formatSignedOriginalMoney(524.316008, "CNY"))
      .toBe("+524.32 CNY");
  });

  it("limits a current original-currency value to two monetary decimals", () => {
    expect(formatOriginalMoney(6864.316008, "CNY"))
      .toBe("6,864.32 CNY");
  });
});
