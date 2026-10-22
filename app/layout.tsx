import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "NestList",
  title: { default: "NestList", template: "%s · NestList" },
  description: "A calm home for your tasks, routines, and shared plans.",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "NestList" },
};

export const viewport: Viewport = {
  themeColor: "#f7f8fc",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
