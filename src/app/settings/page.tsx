import type { Metadata } from "next";

import { PortfolioSettings } from "@/components/portfolio-settings";

export const metadata: Metadata = {
  title: "Settings · Invest Assets Monitor",
};

export default function SettingsPage() {
  return <PortfolioSettings />;
}
