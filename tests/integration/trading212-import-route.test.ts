import { describe, expect, it, vi } from "vitest";

import { createTrading212ImportHandler } from "@/app/api/imports/trading212/route";
import type { StoredImportDraft } from "@/infrastructure/sqlite/portfolio-repository";
import { Trading212RequestError } from "@/infrastructure/trading212/trading212-client";

function request(sourceAccountId = "trading212-main") {
  return new Request("http://localhost/api/imports/trading212", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceAccountId }),
  });
}

function repository() {
  const drafts = new Map<string, StoredImportDraft>();
  return {
    createImportDraft: vi.fn((draft: Omit<StoredImportDraft, "status">) => {
      drafts.set(draft.id, { ...draft, status: "draft" });
    }),
    getImportDraft: vi.fn((id: string) => drafts.get(id)),
  };
}

const snapshot = {
  id: "snapshot-1",
  sourceAccountId: "trading212-main",
  asOf: "2026-07-21T12:00:00.000Z",
  portfolioCash: { amount: "50", currency: "EUR" },
  positions: [],
};

describe("POST /api/imports/trading212", () => {
  it("creates a review draft without directly changing the portfolio", async () => {
    const store = repository();
    const handler = createTrading212ImportHandler({
      repository: store,
      getConfig: () => ({ apiKey: "key", apiSecret: "secret", environment: "demo" }),
      createClient: () => ({ fetchOpeningSnapshot: async () => snapshot }),
      newId: (() => {
        const ids = ["draft-1", "snapshot-1"];
        return () => ids.shift() ?? "unexpected";
      })(),
    });

    const response = await handler(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      draft: {
        id: "draft-1",
        status: "draft",
        sourceKind: "trading-212",
        proposedOpeningSnapshot: snapshot,
      },
    });
    expect(store.createImportDraft).toHaveBeenCalledOnce();
  });

  it("explains rejected credentials without leaking upstream details", async () => {
    const handler = createTrading212ImportHandler({
      repository: repository(),
      getConfig: () => ({ apiKey: "key", apiSecret: "secret", environment: "live" }),
      createClient: () => ({
        fetchOpeningSnapshot: async () => {
          throw new Trading212RequestError(401);
        },
      }),
      newId: () => "id",
      logError: () => undefined,
    });

    const response = await handler(request());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Trading 212 rejected the credentials. Check the key and secret, read-only account/portfolio permissions, environment and IP restrictions.",
    });
  });

  it("reports when local credentials are not configured", async () => {
    const handler = createTrading212ImportHandler({
      repository: repository(),
      getConfig: () => undefined,
      createClient: () => { throw new Error("should not create client"); },
      newId: () => "id",
    });

    const response = await handler(request());

    expect(response.status).toBe(503);
  });
});
