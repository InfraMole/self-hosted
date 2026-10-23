// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { Analytics } from "@/components/analytics";
import { SITE_URL } from "@/lib/i18n";
import { THEME_SCRIPT, ThemeSync } from "@/lib/theme";
import "./globals.css";

const DESCRIPTION =
  "See what depends on what. A living, simple map of your infrastructure — for small IT teams, MSPs and homelabs.";

export const metadata: Metadata = {
  // Share images and alternates resolve against the public website (M18).
  metadataBase: new URL(SITE_URL),
  title: { default: "InfraMole", template: "%s · InfraMole" },
  description: DESCRIPTION,
  applicationName: "InfraMole",
  openGraph: { type: "website", siteName: "InfraMole", locale: "en_GB", description: DESCRIPTION },
  twitter: { card: "summary_large_image" },
};

// Dark is the reference theme; a browser that chose light or "system" switches before paint (ADR-054).
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`dark ${GeistSans.variable} ${GeistMono.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col font-sans">
        <ThemeSync />
        {children}
        {/* Public website only, and only where UMAMI_* is set (ADR-047). */}
        <Analytics />
      </body>
    </html>
  );
}
