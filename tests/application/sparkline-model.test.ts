import { describe, expect, it } from "vitest";

import {
  comparableSparklineModels,
  type SparklineSeries,
} from "@/application/sparkline-model";

describe("comparable holding sparklines", () => {
  it("uses one percentage scale so different gains produce different paths", () => {
    const series: SparklineSeries[] = [
      { id: "small-gain", points: [100, 100.1] },
      { id: "large-gain", points: [100, 150] },
    ];

    const models = comparableSparklineModels(series);

    expect(models["small-gain"]?.path).toBe(
      "M0.00,34.00 L100.00,33.96",
    );
    expect(models["small-gain"]?.zeroY).toBe(models["large-gain"]?.zeroY);
    expect(models["large-gain"]?.path).toBe("M0.00,34.00 L100.00,12.00");
  });

  it("places losses below the common zero baseline", () => {
    const models = comparableSparklineModels([
      { id: "gain", points: [100, 110] },
      { id: "loss", points: [100, 95] },
    ]);

    expect(models.gain?.path).toBe("M0.00,34.00 L100.00,12.00");
    expect(models.loss?.path).toBe("M0.00,34.00 L100.00,45.00");
  });
});
