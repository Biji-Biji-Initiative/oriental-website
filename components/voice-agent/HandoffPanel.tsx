"use client";

import { CheckIcon, SendIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import type { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { getSegment } from "@/lib/segments";
import { cn } from "@/lib/utils";
import type { CapturedLead, VoiceEmailVerification, VoiceTranscriptEntry } from "@/lib/voice/realtime-events";

type HandoffPanelProps = {
  captured: CapturedLead;
  className?: string;
  emailVerification?: VoiceEmailVerification;
  form: UseFormReturn<CapturedLead>;
  onChange: (key: keyof CapturedLead, value: string) => void;
  onEmailFocus?: () => void;
  onFieldBlur?: (key: keyof CapturedLead) => void;
  onFieldFocus?: (key: keyof CapturedLead) => void;
  onSubmit: (values: CapturedLead) => Promise<Record<string, unknown>> | Record<string, unknown> | undefined;
  ready: boolean;
  selectedSegment: ReturnType<typeof getSegment>;
  submitted: boolean;
  submitting: boolean;
  transcript: VoiceTranscriptEntry[];
};

export function HandoffPanel({
  captured,
  className,
  emailVerification,
  form,
  onChange,
  onEmailFocus,
  onFieldBlur,
  onFieldFocus,
  onSubmit,
  ready,
  selectedSegment,
  submitted,
  submitting,
  transcript,
}: HandoffPanelProps) {
  const invalidCount = Object.keys(form.formState.errors).length;
  const locked = submitted || submitting;
  const sentTo = selectedSegment.routedTo.name;
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const transcriptTurnCount = transcript.length;
  const emailIsConfirmed =
    Boolean(captured.email.trim()) &&
    emailVerification?.status === "confirmed" &&
    emailVerification.value.trim().toLowerCase() === captured.email.trim().toLowerCase();
  const emailNeedsConfirmation = Boolean(captured.email.trim()) && !emailIsConfirmed;
  const latestTranscriptKey = transcript.at(-1) ? `${transcript.at(-1)?.role}:${transcript.at(-1)?.text}` : "";

  useEffect(() => {
    if (!latestTranscriptKey) return;
    const node = transcriptRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [latestTranscriptKey]);

  return (
    <aside className={cn("border-t border-white/10 p-5 lg:border-l xl:border-t-0", className)}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.16em] text-white/48">Send your enquiry</div>
          <p className="mt-2 text-sm leading-5 text-white/58">
            Email is the only required detail. Everything else is optional.
          </p>
        </div>
        <Chip active={ready} className="py-1">
          {ready ? "Ready" : "Email needed"}
        </Chip>
      </div>

      <div className="mt-5 rounded-lg border border-white/10 bg-white/[0.04] p-4">
        <div className="text-[11px] uppercase tracking-[0.14em] text-white/55">Routing</div>
        <div className="mt-1 text-sm font-semibold text-white/84">{selectedSegment.label}</div>
        <div className="mt-1 text-xs leading-5 text-white/52">
          {selectedSegment.routedTo.name} · {selectedSegment.routedTo.role}
        </div>
      </div>

      <Form {...form}>
        <form
          className="mt-5 grid gap-4"
          onSubmit={form.handleSubmit(
            (values) => (submitted ? undefined : onSubmit(values)),
            () => {
              toast.error("Please fix the highlighted details.", {
                description: "The handoff just needs a valid email — everything else is optional.",
              });
            },
          )}
        >
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem className="hidden lg:block">
                <FormLabel className="text-white/78">Email</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    className={cn(emailNeedsConfirmation && "border-[#f2d38a]/65")}
                    disabled={locked}
                    onBlur={() => {
                      field.onBlur();
                      onFieldBlur?.("email");
                    }}
                    onChange={(event) => {
                      field.onChange(event);
                      onChange("email", event.target.value);
                    }}
                    onFocus={() => {
                      onEmailFocus?.();
                      onFieldFocus?.("email");
                    }}
                    placeholder="name@example.com"
                    type="email"
                    variant="glass"
                  />
                </FormControl>
                {emailNeedsConfirmation ? (
                  <FormDescription aria-live="polite" className="text-xs leading-5 text-[#f2d38a]">
                    Please check this address once. Edit it here if anything looks wrong—Reka will not ask you to spell
                    it out.
                  </FormDescription>
                ) : emailIsConfirmed && emailVerification?.source === "speech" ? (
                  <FormDescription aria-live="polite" className="text-xs leading-5 text-mk-horizon">
                    Captured from your voice · edit anytime.
                  </FormDescription>
                ) : null}
                <FormMessage className={messageClassName} />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-white/78">Name</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    disabled={locked}
                    onBlur={() => {
                      field.onBlur();
                      onFieldBlur?.("name");
                    }}
                    onChange={(event) => {
                      field.onChange(event);
                      onChange("name", event.target.value);
                    }}
                    onFocus={() => onFieldFocus?.("name")}
                    placeholder="Your name"
                    variant="glass"
                  />
                </FormControl>
                <FormMessage className={messageClassName} />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="org"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-white/78">Organisation</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    disabled={locked}
                    onBlur={() => {
                      field.onBlur();
                      onFieldBlur?.("org");
                    }}
                    onChange={(event) => {
                      field.onChange(event);
                      onChange("org", event.target.value);
                    }}
                    onFocus={() => onFieldFocus?.("org")}
                    placeholder="Company, school, collective, or Individual"
                    variant="glass"
                  />
                </FormControl>
                <FormMessage className={messageClassName} />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-white/78">
                  Phone <span className="text-white/40">· optional</span>
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    disabled={locked}
                    onBlur={() => {
                      field.onBlur();
                      onFieldBlur?.("phone");
                    }}
                    onChange={(event) => {
                      field.onChange(event);
                      onChange("phone", event.target.value);
                    }}
                    onFocus={() => onFieldFocus?.("phone")}
                    placeholder="+60 ..."
                    type="tel"
                    variant="glass"
                  />
                </FormControl>
                <FormMessage className={messageClassName} />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="website"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-white/78">
                  Website / Socials <span className="text-white/40">· optional</span>
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    disabled={locked}
                    onBlur={() => {
                      field.onBlur();
                      onFieldBlur?.("website");
                    }}
                    onChange={(event) => {
                      field.onChange(event);
                      onChange("website", event.target.value);
                    }}
                    onFocus={() => onFieldFocus?.("website")}
                    placeholder="yoursite.com or @handle"
                    variant="glass"
                  />
                </FormControl>
                <FormMessage className={messageClassName} />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="message"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-white/78">
                  What would you build with Mereka? <span className="text-white/40">· optional</span>
                </FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    className="min-h-28 resize-none py-3"
                    disabled={locked}
                    onBlur={() => {
                      field.onBlur();
                      onFieldBlur?.("message");
                    }}
                    onChange={(event) => {
                      field.onChange(event);
                      onChange("message", event.target.value);
                    }}
                    onFocus={() => onFieldFocus?.("message")}
                    placeholder="A short note on the partnership, programme, tenancy, demo, or question."
                    variant="glass"
                  />
                </FormControl>
                <FormDescription className="text-xs leading-5 text-white/55">
                  Voice can draft it; you can edit it before sending.
                </FormDescription>
                <FormMessage className={messageClassName} />
              </FormItem>
            )}
          />
          {invalidCount > 0 && !submitted ? (
            <div
              className="flex gap-2 rounded-lg border border-mk-error/25 bg-mk-error/10 p-3 text-xs leading-5 text-mk-error-soft"
              role="alert"
            >
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              Fix the highlighted fields before sending the handoff.
            </div>
          ) : null}
          {submitted ? (
            <div
              className="flex gap-2 rounded-lg border border-mk-horizon/25 bg-mk-horizon/10 p-3 text-xs leading-5 text-mk-horizon"
              role="status"
            >
              <CheckIcon className="mt-0.5 size-4 shrink-0" />
              Sent to {sentTo}. The handoff is locked so it cannot be submitted twice.
            </div>
          ) : null}
          <Button
            className="h-12 rounded-full bg-mk-horizon px-5 text-sm font-semibold text-mk-off-black transition hover:bg-white disabled:opacity-55"
            disabled={!ready || locked}
            type="submit"
          >
            {submitted ? <CheckIcon data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}
            {submitted ? `Sent to ${sentTo}` : submitting ? "Sending..." : ready ? "Send enquiry" : "Add email to send"}
          </Button>
        </form>
      </Form>

      <p className="mt-4 text-xs leading-5 text-white/45">
        By sending, you ask the relevant team to follow up using these details. Read our{" "}
        <a className="font-semibold text-white/70 underline underline-offset-2 hover:text-white" href="/privacy">
          privacy notice
        </a>
        .
      </p>

      {transcriptTurnCount > 0 ? (
        <div className="mt-5 rounded-lg border border-white/10 bg-white/[0.04] p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-white/55">Live notes</div>
            <div className="text-[11px] text-white/36">{transcriptTurnCount} turns</div>
          </div>
          <div
            aria-label="Conversation transcript"
            aria-live="polite"
            className="mt-3 max-h-72 space-y-2 overflow-y-auto overscroll-contain pr-2"
            ref={transcriptRef}
            role="log"
          >
            {transcript.map((entry) => (
              <p className="text-xs leading-5 text-white/62" key={`${entry.role}:${entry.text}`}>
                <span className="font-semibold text-white/78">{entry.role === "user" ? "You" : "Reka"}:</span>{" "}
                {entry.text}
              </p>
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

const messageClassName = "text-xs leading-5 text-mk-error";
