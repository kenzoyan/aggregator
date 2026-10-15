import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Aggregator",
    short_name: "Aggregator",
    description: "Your investments. One view. A sharper perspective. A private portfolio overview in euros.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3f6f8",
    theme_color: "#081b33",
    icons: [
      { src: "/brand/aggregator-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/aggregator-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
