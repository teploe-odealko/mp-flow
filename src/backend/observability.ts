import * as Sentry from "@sentry/node";

let sentryEnabled = false;

export function initObservability() {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
        delete event.request.headers["x-ozon-api-key"];
      }
      return event;
    }
  });
  sentryEnabled = true;
}

export function captureException(error: unknown, context?: Record<string, string | number | boolean | undefined>) {
  if (!sentryEnabled) return;
  Sentry.withScope((scope) => {
    scope.setTag("service", "mpflow");
    for (const [key, value] of Object.entries(context ?? {})) {
      if (value !== undefined) scope.setTag(key, String(value));
    }
    Sentry.captureException(error);
  });
}

export function flushObservability(timeoutMs = 2000) {
  return sentryEnabled ? Sentry.flush(timeoutMs) : Promise.resolve(true);
}
