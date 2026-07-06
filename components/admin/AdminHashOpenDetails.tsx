"use client";

import { useEffect } from "react";

export function AdminHashOpenDetails() {
  useEffect(() => {
    function openHashTarget() {
      const hash = window.location.hash.slice(1);
      if (!hash) return;
      const target = document.getElementById(decodeHash(hash));
      if (!target) return;
      let node: HTMLElement | null = target;
      while (node) {
        if (node instanceof HTMLDetailsElement) node.open = true;
        node = node.parentElement;
      }
      target.scrollIntoView({ block: "start" });
    }

    openHashTarget();
    window.addEventListener("hashchange", openHashTarget);
    return () => window.removeEventListener("hashchange", openHashTarget);
  }, []);

  return null;
}

function decodeHash(hash: string) {
  try {
    return decodeURIComponent(hash);
  } catch {
    return hash;
  }
}
