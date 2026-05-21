import { Counter, Gauge, Histogram, collectDefaultMetrics, register } from "prom-client";
import type { Context, Next } from "hono";
import { matchedRoutes } from "hono/route";

const SERVICE_LABEL = "mpflow";
const DEFAULT_ROUTE = "unmatched";

let defaultMetricsStarted = false;

const requestTotal = new Counter({
  name: "mpflow_http_requests_total",
  help: "Total HTTP requests handled by MPFlow.",
  labelNames: ["method", "route", "status_code", "status_family"] as const
});

const requestDuration = new Histogram({
  name: "mpflow_http_request_duration_seconds",
  help: "HTTP request duration in seconds for MPFlow.",
  labelNames: ["method", "route", "status_code", "status_family"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
});

const inFlightRequests = new Gauge({
  name: "mpflow_http_requests_in_flight",
  help: "Current in-flight HTTP requests for MPFlow.",
  labelNames: ["method", "route"] as const
});

const appInfo = new Gauge({
  name: "mpflow_app_info",
  help: "Static MPFlow application metadata.",
  labelNames: ["service", "environment", "release"] as const
});

export function initHttpMetrics() {
  if (!defaultMetricsStarted) {
    register.setDefaultLabels({ service: SERVICE_LABEL });
    collectDefaultMetrics({
      register,
      prefix: "mpflow_node_",
      labels: { service: SERVICE_LABEL }
    });
    defaultMetricsStarted = true;
  }

  appInfo.set({
    service: SERVICE_LABEL,
    environment: process.env.NODE_ENV ?? "development",
    release: process.env.SENTRY_RELEASE ?? "unknown"
  }, 1);
}

export async function metricsMiddleware(c: Context, next: Next) {
  if (c.req.path === "/metrics") {
    return next();
  }

  const method = c.req.method.toUpperCase();
  const route = normalizeRoute(c);
  const startedAt = process.hrtime.bigint();
  inFlightRequests.inc({ method, route });

  try {
    await next();
  } finally {
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
    const status = c.res.status || 500;
    const labels = {
      method,
      route: normalizeRoute(c) || route,
      status_code: String(status),
      status_family: `${Math.floor(status / 100)}xx`
    };

    requestTotal.inc(labels);
    requestDuration.observe(labels, durationSeconds);
    inFlightRequests.dec({ method, route });
  }
}

export async function renderMetrics(headers: Headers) {
  const token = process.env.METRICS_TOKEN?.trim();
  if (!token && process.env.NODE_ENV === "production") {
    return new Response("METRICS_TOKEN is required in production\n", { status: 503 });
  }

  if (token) {
    const authorization = headers.get("authorization") ?? "";
    if (authorization !== `Bearer ${token}`) {
      return new Response("Unauthorized\n", { status: 401 });
    }
  }

  return new Response(await register.metrics(), {
    headers: {
      "content-type": register.contentType
    }
  });
}

function normalizeRoute(c: Context) {
  const matchedRoute = safeRoutePath(c);
  if (matchedRoute && matchedRoute !== "*" && matchedRoute !== "/*") {
    return matchedRoute;
  }

  return normalizeUnmatchedPath(c.req.path);
}

function safeRoutePath(c: Context) {
  try {
    return [...matchedRoutes(c)]
      .reverse()
      .find((route) => !["*", "/*", "/api/*"].includes(route.path))
      ?.path ?? "";
  } catch {
    return "";
  }
}

function normalizeUnmatchedPath(path: string) {
  if (!path) return DEFAULT_ROUTE;
  if (path === "/") return "/";
  if (path.startsWith("/assets/")) return "/assets/:asset";
  if (path.startsWith("/api/")) return path.replaceAll(/[0-9a-f]{8,}|[0-9]{4,}/gi, ":id");
  return DEFAULT_ROUTE;
}
