import type { Metadata } from "next";
import localFont from "next/font/local";
import { TurnstileProvider } from "@/components/security/TurnstileProvider";
import { SiteNav } from "@/components/site/SiteNav";
import { VoiceRail } from "@/components/site/VoiceRail";
import { Toaster } from "@/components/ui/sonner";
import { VoiceVariantPicker } from "@/components/voice-agent/VoiceVariantPicker";
import { VoiceProvider } from "@/components/voice-agent/voice-state";
import { siteMeta } from "@/lib/content";
import "./globals.css";

const poppins = localFont({
  variable: "--font-poppins",
  display: "swap",
  src: [
    { path: "../public/assets/fonts/Poppins-Light.ttf", weight: "300", style: "normal" },
    { path: "../public/assets/fonts/Poppins-Regular.ttf", weight: "400", style: "normal" },
    { path: "../public/assets/fonts/Poppins-Medium.ttf", weight: "500", style: "normal" },
    { path: "../public/assets/fonts/Poppins-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "../public/assets/fonts/Poppins-Bold.ttf", weight: "700", style: "normal" },
    { path: "../public/assets/fonts/Poppins-ExtraBold.ttf", weight: "800", style: "normal" },
  ],
});

const fraunces = localFont({
  variable: "--font-fraunces",
  display: "swap",
  src: [{ path: "../public/assets/fonts/Fraunces-Italic-Light.ttf", weight: "300", style: "italic" }],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteMeta.url),
  title: siteMeta.title,
  description: siteMeta.description,
  alternates: { canonical: "/" },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/assets/brand/mereka/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/assets/brand/mereka/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/assets/brand/mereka/favicon-256x256.png", sizes: "256x256", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "256x256", type: "image/png" },
      { url: "/assets/brand/mereka/favicon-256x256.png", sizes: "256x256", type: "image/png" },
    ],
  },
  openGraph: {
    title: siteMeta.title,
    description: siteMeta.description,
    url: siteMeta.url,
    siteName: "Oriental Building",
    images: [{ url: "/assets/og-image.png", width: 1200, height: 630, alt: siteMeta.title }],
  },
  twitter: {
    card: "summary_large_image",
    title: siteMeta.title,
    description: siteMeta.description,
    images: ["/assets/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${poppins.variable} ${fraunces.variable} scroll-smooth antialiased`}>
      <body className="min-h-svh bg-mk-paper text-mk-off-black">
        {/* Warm the TLS connection the voice flow depends on while the visitor
            is still reading; React hoists this into <head>. */}
        <link href="https://api.openai.com" rel="preconnect" />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-full focus:bg-mk-off-black focus:px-5 focus:py-2.5 focus:text-sm focus:font-medium focus:text-white"
        >
          Skip to content
        </a>
        <TurnstileProvider>
          <VoiceProvider>
            <SiteNav />
            {children}
            <VoiceRail />
            <VoiceVariantPicker />
            <Toaster />
          </VoiceProvider>
        </TurnstileProvider>
      </body>
    </html>
  );
}
