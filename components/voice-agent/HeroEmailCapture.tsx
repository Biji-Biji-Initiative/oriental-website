"use client";

import { useState } from "react";
import { useTurnstile } from "@/components/security/useTurnstile";
import { useVoice } from "@/components/voice-agent/voice-state";

const emailPattern = /^\S+@\S+\.\S+$/;

export function HeroEmailCapture() {
  const voice = useVoice();
  const turnstile = useTurnstile("oriental-newsletter", voice.turnstileSiteKey);
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
    let turnstileToken = "";
    try {
      turnstileToken = await turnstile.execute();
    } catch {
      setBusy(false);
      setError("Could not verify this browser. Try again or email team@mereka.io.");
      return;
    }
    const response = await fetch("/api/newsletter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: value, turnstileToken }),
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
      <div className="hero-email hero-email--done">
        <span className="hero-email__check">
          <svg aria-hidden fill="none" height="18" viewBox="0 0 24 24" width="18">
            <title>Success</title>
            <path
              d="M5 12l4 4 10-10"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.4"
            />
          </svg>
        </span>
        <div className="hero-email__done-body">
          <div className="hero-email__done-title">Got it. We&apos;ll be in touch.</div>
          <div className="hero-email__done-detail">
            Want to tell us more?{" "}
            <button
              className="hero-email__link"
              onClick={() => voice.open("other", { email, mode: "form" })}
              type="button"
            >
              Take 2 minutes →
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form className="hero-email" onSubmit={submit}>
      <label className="hero-email__label" htmlFor="hero-email">
        Just want updates?
      </label>
      <div className="hero-email__row">
        <input
          aria-describedby={error ? "hero-email-error" : undefined}
          id="hero-email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="your@email.com"
          type="email"
          value={email}
        />
        <button
          className="hero-email__submit"
          disabled={busy || !turnstile.ready || !emailPattern.test(email.trim())}
          type="submit"
        >
          {busy ? "Saving..." : "Keep me posted →"}
        </button>
      </div>
      {/* Cloudflare expands this slot only when it needs a human check; it must
          stay visibly rendered (sr-only clips the challenge to one pixel). */}
      <div ref={turnstile.containerRef} className="hero-email__turnstile" />
      {error ? (
        <p className="hero-email__error" id="hero-email-error">
          {error}
        </p>
      ) : null}
    </form>
  );
}
