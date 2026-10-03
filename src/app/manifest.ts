import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Aggrigator",
    short_name: "Aggrigator",
    description: "All your investments, together. A private portfolio overview in euros.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3f6f8",
    theme_color: "#081b33",
    icons: [
      { src: "/brand/aggrigator-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/aggrigator-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
