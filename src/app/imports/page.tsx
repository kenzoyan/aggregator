import type { Metadata } from "next";

import { AssetImportWorkflow } from "@/components/screenshot-import";

export const metadata: Metadata = {
  title: "Import assets · Aggregator",
};

export default function ImportsPage() {
  return <AssetImportWorkflow />;
}
