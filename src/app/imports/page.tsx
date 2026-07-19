import type { Metadata } from "next";

import { ScreenshotImport } from "@/components/screenshot-import";

export const metadata: Metadata = {
  title: "Import assets · Invest Assets Monitor",
};

export default function ImportsPage() {
  return <ScreenshotImport />;
}
