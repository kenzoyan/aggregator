import { expect, it } from "vitest";

import { formatPortfolioSaleMoney } from "@/application/portfolio-sale-presentation";

it("shows review amounts to cents without changing the stored precision", () => {
  expect(formatPortfolioSaleMoney("0.94413500223513634332", "CNY")).toBe("0.94 CNY");
  expect(formatPortfolioSaleMoney("-20.24586499776486365668", "CNY")).toBe("-20.25 CNY");
});
