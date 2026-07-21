import { describe, expect, it } from "vitest";

import {
  createFxRateObservations,
  eurPerUnitAt,
} from "@/application/fx-history";

describe("FX observation history", () => {
  it("turns an ECB response into persistable dated observations", () => {
    expect(createFxRateObservations({
      rates: {
        asOf: "2026-07-20",
        eurPerUnit: { EUR: "1", CNY: "0.12", USD: "0.85" },
      },
      recordedAt: "2026-07-21T08:00:00.000Z",
    })).toEqual([
      {
        currency: "CNY",
        eurPerUnit: "0.12",
        asOf: "2026-07-20",
        recordedAt: "2026-07-21T08:00:00.000Z",
        source: "ecb",
      },
      {
        currency: "USD",
        eurPerUnit: "0.85",
        asOf: "2026-07-20",
        recordedAt: "2026-07-21T08:00:00.000Z",
        source: "ecb",
      },
    ]);
  });

  it("uses the latest prior rate without applying a future observation", () => {
    const observations = [
      {
        currency: "CNY",
        eurPerUnit: "0.12",
        asOf: "2026-07-20",
        recordedAt: "2026-07-20T16:00:00.000Z",
        source: "ecb",
      },
      {
        currency: "CNY",
        eurPerUnit: "0.125",
        asOf: "2026-07-22",
        recordedAt: "2026-07-22T16:00:00.000Z",
        source: "ecb",
      },
    ];

    expect(eurPerUnitAt(observations, "2026-07-21T12:00:00.000Z")).toEqual({
      EUR: "1",
      CNY: "0.12",
    });
  });
});
