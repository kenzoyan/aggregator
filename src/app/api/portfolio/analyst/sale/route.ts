import { createPortfolioSaleHandlers } from "@/server/portfolio-sale-handlers";
import { getPortfolioDatabase } from "@/server/portfolio-db";
export const runtime = "nodejs";
function handlers() { return createPortfolioSaleHandlers(getPortfolioDatabase()); }
export async function GET(request: Request) { return handlers().GET(request); }
export async function POST(request: Request) { return handlers().POST(request); }
export async function PATCH(request: Request) { return handlers().PATCH(request); }
export async function PUT(request: Request) { return handlers().PUT(request); }
