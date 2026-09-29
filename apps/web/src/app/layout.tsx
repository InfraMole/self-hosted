// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "InfraMole", template: "%s · InfraMole" },
  description:
    "See what depends on what. A living, simple map of your infrastructure — for small IT teams, MSPs and homelabs.",
  applicationName: "InfraMole",
};

// M0: dark only (reference theme). Light tokens exist; a toggle is in the backlog.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${GeistSans.variable} ${GeistMono.variable} h-full`}>
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
