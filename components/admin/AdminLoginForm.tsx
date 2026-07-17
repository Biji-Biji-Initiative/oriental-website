"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { EyeIcon, EyeOffIcon, LockKeyholeIcon } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { MerekaMiniMark } from "@/components/orb/MerekaMiniMark";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { adminLoginSchema } from "@/lib/schemas";

type AdminLoginValues = {
  token: string;
};

export function AdminLoginForm({ reason }: { reason?: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const form = useForm<AdminLoginValues>({
    defaultValues: { token: "" },
    resolver: zodResolver(adminLoginSchema),
  });

  async function onSubmit(values: AdminLoginValues) {
    setSubmitting(true);
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        toast.error("Admin login failed.", {
          description: loginErrorCopy(body?.error ?? String(response.status)),
        });
        return;
      }
      toast.success("Admin session opened.");
      window.location.reload();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-svh text-slate-100 lg:grid-cols-[1.05fr_minmax(440px,0.95fr)]">
      {/* Brand panel — desktop only */}
      <section className="relative hidden overflow-hidden border-r border-white/10 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="admin-halo pointer-events-none absolute -left-32 top-1/4 size-[34rem] rounded-full bg-sky-500/20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 right-0 size-[28rem] rounded-full bg-teal-500/10 blur-3xl"
        />
        <div className="relative flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl border border-sky-400/30 bg-sky-400/10 shadow-[0_0_28px_-6px_rgba(138,176,255,0.55)]">
            <MerekaMiniMark size={24} />
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.32em] text-sky-300/90">Oriental Admin</span>
        </div>
        <div className="relative">
          <h2 className="max-w-lg bg-gradient-to-br from-white via-slate-100 to-slate-500 bg-clip-text text-5xl font-bold leading-[1.05] tracking-tight text-transparent">
            Every handoff, every voice session, one cockpit.
          </h2>
          <p className="mt-5 max-w-md text-sm leading-7 text-slate-400">
            Review partner leads, recover unsent voice handoffs, and keep Reka&apos;s learning loop honest — from a
            single operations console.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            {["Lead pipeline", "Voice recovery", "Realtime QA", "Reka evals", "Audit trail"].map((chip) => (
              <span
                className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-300"
                key={chip}
              >
                {chip}
              </span>
            ))}
          </div>
        </div>
        <p className="relative text-xs text-slate-500">Private console · oriental.mereka.io/admin</p>
      </section>

      {/* Login form */}
      <section className="relative flex items-center justify-center px-4 py-16 sm:px-8">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-sky-500/[0.07] to-transparent lg:hidden"
        />
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="grid size-10 place-items-center rounded-xl border border-sky-400/30 bg-sky-400/10 shadow-[0_0_28px_-6px_rgba(138,176,255,0.55)]">
              <MerekaMiniMark size={24} />
            </div>
            <span className="text-[11px] font-semibold uppercase tracking-[0.32em] text-sky-300/90">
              Oriental Admin
            </span>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-7 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.9)] backdrop-blur-sm sm:p-9">
            <div className="grid size-11 place-items-center rounded-xl border border-sky-400/25 bg-sky-400/10 text-sky-300">
              <LockKeyholeIcon className="size-5" />
            </div>
            <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-100">Session review</h1>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Enter the internal review token to inspect recent lead handoffs and voice transcripts.
            </p>
            {reason === "unconfigured" ? (
              <div className="mt-5 rounded-lg border border-rose-400/25 bg-rose-400/10 p-3 text-sm text-rose-300">
                Admin review is not configured in this environment.
              </div>
            ) : null}
            <Form {...form}>
              {/* method="post" keeps the token out of the URL if a submit fires before hydration */}
              <form
                action="/api/admin/login"
                className="mt-6 grid gap-5"
                method="post"
                onSubmit={form.handleSubmit(onSubmit)}
              >
                <FormField
                  control={form.control}
                  name="token"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Review token</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            {...field}
                            autoComplete="current-password"
                            className="h-11 pr-11"
                            placeholder="Paste admin review token"
                            type={showToken ? "text" : "password"}
                          />
                          <button
                            aria-label={showToken ? "Hide token" : "Show token"}
                            className="absolute inset-y-0 right-0 grid w-11 place-items-center text-slate-500 transition hover:text-slate-300 focus-visible:text-slate-300 focus-visible:outline-none"
                            onClick={() => setShowToken((value) => !value)}
                            type="button"
                          >
                            {showToken ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  className="h-11 w-full text-sm font-semibold shadow-[0_0_32px_-8px_rgba(138,176,255,0.6)]"
                  disabled={submitting || reason === "unconfigured"}
                  type="submit"
                >
                  {submitting ? "Opening..." : "Open dashboard"}
                </Button>
              </form>
            </Form>
          </div>
          <p className="mt-6 text-center text-xs text-slate-500">
            Access is limited to the Oriental intake team. Sessions expire automatically.
          </p>
        </div>
      </section>
    </main>
  );
}

function loginErrorCopy(error: string) {
  if (error === "unconfigured") return "ADMIN_REVIEW_TOKEN is missing from this environment.";
  if (error === "invalid" || error === "missing") return "The token did not match the configured review token.";
  return "Please retry, then check the server logs if this keeps failing.";
}
