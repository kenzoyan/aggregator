import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getDanskeInvestFundRoutes } from "@/server/danske-invest-config";

describe("local Danske Invest configuration", () => {
  it("returns no routes when the private local file is absent", () => {
    expect(getDanskeInvestFundRoutes("/path/that/does/not/exist.json")).toEqual({});
  });

  it("accepts a valid synthetic ISIN route and rejects malformed data", () => {
    const directory = mkdtempSync(join(tmpdir(), "danske-config-"));
    const validFile = join(directory, "valid.json");
    const invalidFile = join(directory, "invalid.json");
    writeFileSync(validFile, JSON.stringify({
      XX0000000001: { fund: "111", fundGroup: "222", siteId: "333" },
    }));
    writeFileSync(invalidFile, JSON.stringify({ XX0000000001: { fund: "not-a-number" } }));

    expect(getDanskeInvestFundRoutes(validFile)).toEqual({
      XX0000000001: { fund: "111", fundGroup: "222", siteId: "333" },
    });
    expect(() => getDanskeInvestFundRoutes(invalidFile)).toThrow(
      "Invalid local Danske Invest fund configuration",
    );
  });
});
