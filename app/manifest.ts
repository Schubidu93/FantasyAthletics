import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fantasy Athletics",
    short_name: "Fantasy",
    start_url: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#1f57d1",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
