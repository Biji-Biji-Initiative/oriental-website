import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent, scrubSentrySpan } from "@/lib/sentry-privacy";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? "0.05"),
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  dataCollection: {
    cookies: false,
    genAI: { inputs: false, outputs: false },
    httpBodies: [],
    httpHeaders: { request: false, response: false },
    queryParams: false,
    stackFrameVariables: false,
    userInfo: false,
  },
  beforeSend: scrubSentryEvent,
  beforeSendSpan: scrubSentrySpan,
  beforeSendTransaction: scrubSentryEvent,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
