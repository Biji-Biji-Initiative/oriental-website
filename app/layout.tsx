import type { Metadata } from "next";
import localFont from "next/font/local";
import { connection } from "next/server";
import { SiteNav } from "@/components/site/SiteNav";
import { VoiceRail } from "@/components/site/VoiceRail";
import { Toaster } from "@/components/ui/sonner";
import { VoiceProvider } from "@/components/voice-agent/voice-state";
import { siteMeta } from "@/lib/content";
import { readEnv } from "@/lib/env";
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
    images: ["/assets/og-image.svg"],
  },
  twitter: {
    card: "summary_large_image",
    title: siteMeta.title,
    description: siteMeta.description,
    images: ["/assets/og-image.svg"],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await connection();
  const turnstileSiteKey = readEnv("TURNSTILE_SITE_KEY") || readEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY");

  return (
    <html lang="en" className={`${poppins.variable} ${fraunces.variable} scroll-smooth antialiased`}>
      <body className="min-h-svh bg-mk-paper text-mk-off-black">
        <VoiceProvider turnstileSiteKey={turnstileSiteKey}>
          <SiteNav />
          {children}
          <VoiceRail />
          <Toaster />
        </VoiceProvider>
      </body>
    </html>
  );
}
