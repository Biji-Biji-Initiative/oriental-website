import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent, scrubSentrySpan } from "@/lib/sentry-privacy";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  release: process.env.SENTRY_RELEASE ?? process.env.GIT_SHA ?? process.env.SOURCE_COMMIT,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
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
