import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { AnalyticsBoot } from "@/components/AnalyticsBoot";

export const metadata: Metadata = {
  metadataBase: new URL("https://palate.app"),
  title: "Palate — See what you actually eat",
  description:
    "Your eating habits have a pattern. Palate tells you what it means. A weekly identity reveal — plus a behavior-based feed of how your friends actually eat. iOS coming soon.",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    apple: "/favicon.svg",
  },
  openGraph: {
    type: "website",
    title: "Palate — See what you actually eat",
    description:
      "Your eating habits have a pattern. Palate tells you what it means. A weekly identity reveal — privacy-first.",
    url: "https://palate.app",
    images: [{ url: "/og-image.png" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Palate — See what you actually eat",
    description: "Your eating habits have a pattern. Palate tells you what it means.",
    images: ["/og-image.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#FF3008",
  width: "device-width",
  initialScale: 1,
};

// Provider precedence — see lib/analytics.ts for the same order. We pick at
// most one analytics script to load so the providers can't fight each other.
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const UMAMI_WEBSITE_ID = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
const UMAMI_SCRIPT_URL =
  process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL || "https://cloud.umami.is/script.js";
const PLAUSIBLE_DOMAIN = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;

const useUmami = !POSTHOG_KEY && !!UMAMI_WEBSITE_ID;
const usePlausible = !POSTHOG_KEY && !UMAMI_WEBSITE_ID && !!PLAUSIBLE_DOMAIN;

const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "MobileApplication",
  name: "Palate",
  applicationCategory: "LifestyleApplication",
  operatingSystem: "iOS",
  description:
    "Palate is a taste-identity system. Tap once when you arrive somewhere; every Sunday, get a personality reveal — 1 of 9 eating identities — built from your actual visits. Profile, friends, and feed all measured by behavior, not opinions. No ads. We don't sell your data.",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  publisher: { "@type": "Organization", name: "Palate", url: "https://palate.app" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-palate-paper text-palate-ink antialiased">
        {/* Skip link — keyboard users can jump past nav straight to main content. */}
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Script
          id="ld-json-app"
          type="application/ld+json"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
        />
        {children}

        {/*
          Analytics — at most one provider is loaded. Order:
          PostHog → Umami → Plausible. See lib/analytics.ts for matching
          precedence in the `track()` shim.
        */}
        {POSTHOG_KEY ? <AnalyticsBoot /> : null}

        {useUmami ? (
          <Script
            defer
            data-website-id={UMAMI_WEBSITE_ID}
            src={UMAMI_SCRIPT_URL}
            strategy="afterInteractive"
          />
        ) : null}

        {usePlausible ? (
          <Script
            defer
            data-domain={PLAUSIBLE_DOMAIN}
            src="https://plausible.io/js/script.outbound-links.js"
            strategy="afterInteractive"
          />
        ) : null}
      </body>
    </html>
  );
}
