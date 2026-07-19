import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Invest Assets Monitor",
  description: "Private, local-first investment portfolio monitoring.",
  applicationName: "Invest Monitor",
};

export const viewport: Viewport = {
  themeColor: "#081b33",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
