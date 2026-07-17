"use client";

import { CheckIcon, CircleDashedIcon, SendIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
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
import { handoffCompletion, handoffFieldSpecs } from "./voice-dialog-copy";

type HandoffPanelProps = {
  captured: CapturedLead;
  className?: string;
  emailVerification?: VoiceEmailVerification;
  form: UseFormReturn<CapturedLead>;
  onChange: (key: keyof CapturedLead, value: string) => void;
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
  onSubmit,
  ready,
  selectedSegment,
  submitted,
  submitting,
  transcript,
}: HandoffPanelProps) {
  const completion = useMemo(() => handoffCompletion(captured), [captured]);
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
          <div className="text-xs uppercase tracking-[0.16em] text-white/48">Handoff details</div>
          <p className="mt-2 text-sm leading-5 text-white/58">Captured for the team that should follow up.</p>
        </div>
        <Chip active={completion.ready} className="py-1">
          {completion.completedCount}/{completion.totalCount}
        </Chip>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2">
        {handoffFieldSpecs.map((field) => {
          const complete = completion.completedKeys.has(field.key);
          return (
            <div
              className={cn(
                "flex min-h-10 items-center gap-2 rounded-md border px-3 text-xs font-medium",
                complete
                  ? "border-mk-horizon/35 bg-mk-horizon/12 text-white"
                  : "border-white/10 bg-white/[0.035] text-white/46",
              )}
              key={field.key}
            >
              {complete ? (
                <CheckIcon className="size-3.5 text-mk-horizon" />
              ) : (
                <CircleDashedIcon className="size-3.5" />
              )}
              {field.label}
            </div>
          );
        })}
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
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-white/78">Name</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    disabled={locked}
                    onChange={(event) => {
                      field.onChange(event);
                      onChange("name", event.target.value);
                    }}
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
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-white/78">Email</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    disabled={locked}
                    onChange={(event) => {
                      field.onChange(event);
                      onChange("email", event.target.value);
                    }}
                    placeholder="name@example.com"
                    type="email"
                    variant="glass"
                  />
                </FormControl>
                {emailNeedsConfirmation ? (
                  <FormDescription aria-live="polite" className="text-xs leading-5 text-[#f2d38a]">
                    Reka heard this address. Say yes after the exact read-back, or edit it here to confirm it.
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
            name="org"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-white/78">Organisation</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    disabled={locked}
                    onChange={(event) => {
                      field.onChange(event);
                      onChange("org", event.target.value);
                    }}
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
                    onChange={(event) => {
                      field.onChange(event);
                      onChange("phone", event.target.value);
                    }}
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
                    onChange={(event) => {
                      field.onChange(event);
                      onChange("website", event.target.value);
                    }}
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
                    onChange={(event) => {
                      field.onChange(event);
                      onChange("message", event.target.value);
                    }}
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
            {submitted
              ? `Sent to ${sentTo}`
              : submitting
                ? "Sending..."
                : completion.ready
                  ? "Send complete handoff"
                  : "Send to Mereka"}
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
