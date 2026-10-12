import { createPriceSourceService, PriceSourceError } from "@/application/price-source-service";

export function createPriceSourceHandler(input: Parameters<typeof createPriceSourceService>[0]) {
  const service = createPriceSourceService(input);
  async function handle(operation: () => Promise<unknown>) {
    try { return Response.json(await operation(), { headers: { "Cache-Control": "no-store" } }); }
    catch (error) {
      if (error instanceof PriceSourceError) return Response.json({ error: error.message }, { status: error.status });
      throw error;
    }
  }
  return {
    lookup: (request: Request) => handle(() => service.lookup(Object.fromEntries(new URL(request.url).searchParams))),
    confirm: (request: Request) => handle(async () => service.confirm(await request.json().catch(() => ({})))),
  };
}
