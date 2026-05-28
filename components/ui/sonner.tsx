"use client";

import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { type CSSProperties, useEffect, useState } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ position, ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();
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
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position={position ?? responsivePosition}
      expand
      gap={10}
      mobileOffset={16}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "calc(var(--radius) + 4px)",
        } as CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:border-border group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:shadow-xl group-[.toaster]:backdrop-blur supports-[backdrop-filter]:group-[.toaster]:bg-popover/95 group-[.toaster]:items-start group-[.toaster]:text-left",
          content: "group-[.toast]:grid group-[.toast]:gap-1 group-[.toast]:text-left",
          title:
            "group-[.toast]:text-left group-[.toast]:text-sm group-[.toast]:font-semibold group-[.toast]:tracking-normal",
          description:
            "group-[.toast]:text-left group-[.toast]:text-sm group-[.toast]:leading-5 group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          closeButton: "group-[.toast]:bg-background group-[.toast]:text-foreground group-[.toast]:border-border",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
