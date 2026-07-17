"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function AdminLogoutButton() {
  const [submitting, setSubmitting] = useState(false);

  async function logout() {
    setSubmitting(true);
    try {
      const response = await fetch("/api/admin/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        toast.error("Could not sign out.", { description: body?.error ?? `HTTP ${response.status}` });
        return;
      }
      window.location.assign("/admin/session-review");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Button disabled={submitting} onClick={logout} type="button" variant="outline">
      {submitting ? "Signing out..." : "Sign out"}
    </Button>
  );
}
