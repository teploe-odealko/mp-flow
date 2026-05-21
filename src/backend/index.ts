import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createAccountingRuntimeFromEnv } from "../infra/db/runtime-store";
import { createApi } from "./app";
import { AuthService } from "./auth";
import { flushObservability, initObservability } from "./observability";

loadLocalEnv();
initObservability();

const port = Number(process.env.PORT ?? 3004);
const hostname = process.env.HOST ?? "0.0.0.0";

const runtime = await createAccountingRuntimeFromEnv();
const auth = process.env.DATABASE_URL ? new AuthService() : null;
const api = createApi(runtime.app, { persistence: runtime.persistence, auth });

const server = serve({
  fetch: (request) => routeRequest(request, api.fetch),
  port,
  hostname
});

const shutdown = async () => {
  await runtime.persistence?.close?.();
  await auth?.close();
  await flushObservability();
  server.close();
};

process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));

console.log(`mpflow listening on http://${hostname}:${port}`);

async function routeRequest(request: Request, apiFetch: typeof api.fetch) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/") || url.pathname === "/metrics") {
    return apiFetch(request);
  }
  if (url.pathname === "/app-config.js") {
    return runtimeConfigScript();
  }
  if (!["GET", "HEAD"].includes(request.method)) {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const response = await serveFrontend(url.pathname, request.method === "HEAD");
  return response ?? apiFetch(request);
}

async function serveFrontend(pathname: string, headOnly: boolean) {
  const frontendDir = frontendRoot();
  const decoded = safeDecodePath(pathname);
  const assetPath = decoded === "/" ? "/index.html" : decoded;
  const filePath = resolve(frontendDir, `.${assetPath}`);

  if (!filePath.startsWith(`${frontendDir}/`)) {
    return new Response("Not Found", { status: 404 });
  }

  const direct = await readStaticFile(filePath, headOnly);
  if (direct) return direct;
  if (assetPath.includes(".")) {
    return new Response("Not Found", { status: 404 });
  }
  return await readStaticFile(resolve(frontendDir, "index.html"), headOnly);
}

function frontendRoot() {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), "dist/frontend"),
    resolve(currentDir, "../../frontend"),
    resolve(currentDir, "../frontend")
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

async function readStaticFile(path: string, headOnly: boolean) {
  try {
    const data = headOnly ? undefined : await readFile(path);
    return new Response(data, {
      headers: {
        "content-type": contentType(path),
        "cache-control": path.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache"
      }
    });
  } catch {
    return null;
  }
}

function safeDecodePath(pathname: string) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return "/";
  }
}

function contentType(path: string) {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".ico")) return "image/x-icon";
  return "application/octet-stream";
}

function runtimeConfigScript() {
  const payload = {
    sentryDsn: process.env.VITE_SENTRY_DSN ?? process.env.SENTRY_DSN ?? "",
    sentryEnvironment: process.env.VITE_SENTRY_ENVIRONMENT ?? process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "production",
    sentryRelease: process.env.VITE_SENTRY_RELEASE ?? process.env.SENTRY_RELEASE ?? ""
  };
  return new Response(`window.__MPFLOW_CONFIG__ = ${JSON.stringify(payload)};`, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-cache"
    }
  });
}

function loadLocalEnv() {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(currentDir, "../../.env"),
    resolve(currentDir, "../../../.env")
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
  }
}
