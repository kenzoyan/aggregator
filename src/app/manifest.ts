import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Invest Assets Monitor",
    short_name: "Invest Monitor",
    description: "Private, local-first investment portfolio monitoring.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3f6f8",
    theme_color: "#081b33",
    icons: [],
  };
}
