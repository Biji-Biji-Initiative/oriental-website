"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useVoice } from "@/components/voice-agent/voice-state";
import { cn } from "@/lib/utils";

const emailPattern = /^\S+@\S+\.\S+$/;

export function HeroEmailCapture() {
  const voice = useVoice();
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = email.trim();
    if (!emailPattern.test(value)) {
      setError("Use a valid email.");
      return;
    }
    setBusy(true);
    setError("");
    const response = await fetch("/api/newsletter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: value, turnstileToken: "local-dev" }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setError("Could not save that yet. Try again or email team@mereka.io.");
      return;
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="flex max-w-xl items-center gap-3 rounded-full border border-white/25 bg-white/92 px-4 py-3 text-mk-off-black shadow-2xl backdrop-blur">
        <span className="flex size-9 items-center justify-center rounded-full bg-mk-anchor-blue text-white">✓</span>
        <div className="min-w-0 text-sm">
          <div className="font-semibold">Got it. We&apos;ll be in touch.</div>
          <button
            className="text-mk-anchor-blue underline-offset-4 hover:underline"
            onClick={() => voice.open("other", { email, mode: "form" })}
            type="button"
          >
            Want to tell us more? Take 2 minutes →
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="max-w-xl rounded-[28px] border border-white/18 bg-white/12 p-2 text-white backdrop-blur-md"
      onSubmit={submit}
    >
      <label
        className="px-3 pb-2 pt-1 text-xs font-medium uppercase tracking-[0.14em] text-white/72"
        htmlFor="hero-email"
      >
        Just want updates?
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          aria-describedby={error ? "hero-email-error" : undefined}
          className="h-12 rounded-full border-white/15 bg-white/95 px-5 text-mk-off-black placeholder:text-mk-off-black/45"
          id="hero-email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="your@email.com"
          type="email"
          value={email}
        />
        <button
          className={cn(
            "h-12 shrink-0 rounded-full bg-mk-anchor-blue px-5 text-sm font-semibold text-white transition hover:bg-mk-vivid-blue disabled:cursor-not-allowed disabled:opacity-55",
          )}
          disabled={busy || !emailPattern.test(email.trim())}
          type="submit"
        >
          {busy ? "Saving..." : "Keep me posted →"}
        </button>
      </div>
      {error ? (
        <p className="px-3 pt-2 text-sm text-white" id="hero-email-error">
          {error}
        </p>
      ) : null}
    </form>
  );
}
