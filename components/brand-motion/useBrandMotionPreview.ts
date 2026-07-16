"use client";

import { useEffect, useState } from "react";
import { BRAND_MOTION_PREVIEW_ENABLED, isBrandMotionPreviewHost } from "@/lib/brand-motion";

export function useBrandMotionPreview() {
  const [hostAllowed, setHostAllowed] = useState(false);

  useEffect(() => {
    setHostAllowed(isBrandMotionPreviewHost(window.location.hostname));
  }, []);

  return BRAND_MOTION_PREVIEW_ENABLED && hostAllowed;
}
