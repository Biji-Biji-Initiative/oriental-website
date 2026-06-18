"use client";

import { usePathname } from "next/navigation";
import { VoiceVariantPicker } from "@/components/voice-agent/VoiceVariantPicker";
import { SiteNav } from "./SiteNav";
import { VoiceRail } from "./VoiceRail";

export function PublicChrome() {
  const pathname = usePathname();
  if (pathname?.startsWith("/admin")) return null;

  return (
    <>
      <SiteNav />
      <VoiceRail />
      <VoiceVariantPicker />
    </>
  );
}
