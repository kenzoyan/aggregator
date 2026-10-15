import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";

import { AppShell } from "@/components/app-shell";

import "./globals.css";
import "./dashboard.css";
import "./portfolio-analyst.css";
import "./portfolio-pages.css";
import "./responsive.css";
import "./design-overrides.css";
import "./home-experience.css";

export const metadata: Metadata = {
  title: "Aggregator",
  description: "Your investments. One view. A sharper perspective. A private portfolio overview in euros.",
  applicationName: "Aggregator",
};

export const viewport: Viewport = {
  themeColor: "#17211e",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      data-scroll-behavior="smooth"
    >
      <body><AppShell>{children}</AppShell></body>
    </html>
  );
}
