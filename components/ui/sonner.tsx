"use client";

import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import { type CSSProperties, useEffect, useState } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

// The site is a fixed editorial palette (no theme switcher), and most toasts
// fire over the dark voice workspace — so toasts use one deliberate dark ink
// style with AA-contrast text instead of following the OS light/dark setting.
const Toaster = ({ position, ...props }: ToasterProps) => {
  const [responsivePosition, setResponsivePosition] = useState<ToasterProps["position"]>("top-right");

  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const sync = () => setResponsivePosition(query.matches ? "top-right" : "top-center");
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return (
    <Sonner
      theme="dark"
      className="toaster group"
      position={position ?? responsivePosition}
      expand
      gap={10}
      mobileOffset={16}
      icons={{
        success: <CircleCheckIcon className="size-4 text-emerald-300" />,
        info: <InfoIcon className="size-4 text-mk-horizon" />,
        warning: <TriangleAlertIcon className="size-4 text-amber-300" />,
        error: <OctagonXIcon className="size-4 text-red-300" />,
        loading: <Loader2Icon className="size-4 animate-spin text-white/70" />,
      }}
      style={
        {
          "--normal-bg": "rgba(22, 17, 38, 0.96)",
          "--normal-text": "#ffffff",
          "--normal-border": "rgba(255, 255, 255, 0.14)",
          "--border-radius": "calc(var(--radius) + 4px)",
        } as CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:border-white/14 group-[.toaster]:bg-[#161126]/95 group-[.toaster]:text-white group-[.toaster]:shadow-[0_24px_80px_rgba(0,0,0,0.45)] group-[.toaster]:backdrop-blur group-[.toaster]:items-start group-[.toaster]:text-left",
          content: "group-[.toast]:grid group-[.toast]:gap-1 group-[.toast]:text-left",
          title:
            "group-[.toast]:text-left group-[.toast]:text-sm group-[.toast]:font-semibold group-[.toast]:tracking-normal group-[.toast]:text-white",
          description:
            "group-[.toast]:text-left group-[.toast]:text-sm group-[.toast]:leading-5 group-[.toast]:!text-white/78",
          actionButton: "group-[.toast]:bg-white group-[.toast]:text-mk-off-black",
          cancelButton: "group-[.toast]:bg-white/10 group-[.toast]:text-white/80",
          closeButton: "group-[.toast]:bg-white/10 group-[.toast]:text-white group-[.toast]:border-white/14",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
