import { describe, expect, it } from "vitest";

import { holdingChartDomain } from "@/application/holding-chart-domain";

describe("holding chart domain", () => {
  it("focuses the scale around the visible holding values", () => {
    const [low, high] = holdingChartDomain([899, 910, 932]);
    expect(low).toBeGreaterThan(890);
    expect(low).toBeLessThan(899);
    expect(high).toBeGreaterThan(932);
    expect(high).toBeLessThan(940);
  });

  it("retains padding for constant values and avoids a negative floor", () => {
    const [low, high] = holdingChartDomain([900, 900]);
    expect(low).toBeLessThan(900);
    expect(high).toBeGreaterThan(900);
    expect(holdingChartDomain([0, 2])[0]).toBe(0);
  });
});
