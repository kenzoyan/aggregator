import { readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import type { DanskeFundRoute } from "@/infrastructure/danske-invest/danske-invest-fund-nav-client";

const routeSchema = z.object({
  fund: z.string().regex(/^\d+$/),
  fundGroup: z.string().regex(/^\d+$/),
  siteId: z.string().regex(/^\d+$/),
}).strict();

const routesSchema = z.record(
  z.string().regex(/^[A-Z]{2}[A-Z0-9]{10}$/),
  routeSchema,
);

export function getDanskeInvestFundRoutes(
  filename = join(process.cwd(), "data", "danske-invest-funds.json"),
): Readonly<Record<string, DanskeFundRoute>> {
  try {
    return routesSchema.parse(JSON.parse(readFileSync(filename, "utf8")));
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) return {};
    throw new Error("Invalid local Danske Invest fund configuration", {
      cause: error,
    });
  }
}
