"use client";

import { useState } from "react";
import { useVoice } from "@/components/voice-agent/voice-state";
import { trackEvent } from "@/lib/analytics";
import { trackIntakeEvent } from "@/lib/client-analytics";

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
      body: JSON.stringify({ email: value }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setError("Could not save that yet. Try again or email team@mereka.io.");
      return;
    }
    trackIntakeEvent("newsletter_submit_success", {
      entry_point: "hero_updates",
      entry_method: "email_capture",
    });
    setSubmitted(true);
    trackEvent("newsletter_signup", { placement: "hero" });
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
              onClick={() => voice.open("other", { email, mode: "form", entryPoint: "hero_updates_followup" })}
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
        <button className="hero-email__submit" disabled={busy || !emailPattern.test(email.trim())} type="submit">
          {busy ? "Saving..." : "Keep me posted →"}
        </button>
      </div>
      {error ? (
        <p className="hero-email__error" id="hero-email-error">
          {error}
        </p>
      ) : null}
    </form>
  );
}
