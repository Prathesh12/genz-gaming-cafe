import type { MetadataRoute } from "next";

import mainLogo from "./main_logo.png";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dr. Games",
    short_name: "Dr. Games",
    description: "PlayStation room management and point of sale.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#080808",
    theme_color: "#080808",
    icons: [
      { src: mainLogo.src, sizes: "any", type: "image/png", purpose: "any" },
      { src: mainLogo.src, sizes: "any", type: "image/png", purpose: "maskable" },
    ],
  };
}
