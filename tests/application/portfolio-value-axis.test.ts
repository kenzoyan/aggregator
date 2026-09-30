import { describe, expect, it } from "vitest";

import { createPortfolioValueAxisFormatter } from "@/application/portfolio-value-axis";

describe("portfolio value axis", () => {
  it("keeps nearby euro ticks distinct instead of rounding them to the same K label", () => {
    const format = createPortfolioValueAxisFormatter([5600, 5700]);
    const labels = [5600, 5625, 5650, 5675, 5700].map(format);

    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toEqual(["€5,600", "€5,625", "€5,650", "€5,675", "€5,700"]);
  });

  it("adds decimal precision for a sub-euro range", () => {
    const format = createPortfolioValueAxisFormatter([100.01, 100.05]);

    expect(format(100.01)).toBe("€100.01");
    expect(format(100.02)).toBe("€100.02");
  });
});
