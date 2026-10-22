import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NestList — Shared tasks, gently organized",
    short_name: "NestList",
    description: "A calm home for your tasks, routines, and shared plans.",
    start_url: "/today",
    display: "standalone",
    background_color: "#f8f8f4",
    theme_color: "#f8f8f4",
    orientation: "portrait",
    icons: [
      {
        src: "/icons/icon-192.svg",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/icon-192.svg",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Today",
        url: "/today",
        icons: [{ src: "/icons/icon-192.svg", sizes: "192x192" }],
      },
      {
        name: "Quick Add",
        url: "/today?action=add",
        icons: [{ src: "/icons/icon-192.svg", sizes: "192x192" }],
      },
      {
        name: "Later",
        url: "/later",
        icons: [{ src: "/icons/icon-192.svg", sizes: "192x192" }],
      },
    ],
    screenshots: [
      {
        src: "/screenshots/today-wide.svg",
        sizes: "1280x720",
        type: "image/svg+xml",
        form_factor: "wide",
        label: "NestList Today view",
      },
      {
        src: "/screenshots/today-mobile.svg",
        sizes: "390x844",
        type: "image/svg+xml",
        form_factor: "narrow",
        label: "NestList mobile Today view",
      },
    ],
  };
}
