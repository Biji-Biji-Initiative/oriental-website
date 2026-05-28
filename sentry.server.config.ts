import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  release: process.env.SENTRY_RELEASE ?? process.env.GIT_SHA ?? process.env.SOURCE_COMMIT,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
  beforeSend(event) {
    scrubEvent(event);
    return event;
  },
});

function scrubEvent(event: Sentry.Event) {
  delete event.user;
  if (event.request?.cookies) delete event.request.cookies;
  if (event.request?.headers) {
    for (const key of Object.keys(event.request.headers)) {
      if (/authorization|cookie|token|secret|key/i.test(key)) event.request.headers[key] = "[redacted]";
    }
  }
}
