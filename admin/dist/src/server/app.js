import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { sessionMiddleware } from "./core/session.js";
import { authMiddleware } from "./core/auth.js";
export function createApp(cookieSecret) {
    const app = new Hono();
    // Global middleware
    app.use("*", logger());
    const allowedOrigins = (process.env.CORS_ORIGINS || "")
        .split(",").map(s => s.trim()).filter(Boolean);
    app.use("*", cors({
        origin: (origin) => {
            if (!origin)
                return "*"; // same-origin requests
            if (allowedOrigins.length === 0)
                return origin; // dev mode: allow all
            return allowedOrigins.includes(origin) ? origin : "";
        },
        credentials: true,
    }));
    // Session middleware for all /api and /auth routes
    app.use("/api/*", sessionMiddleware(cookieSecret));
    app.use("/auth/*", sessionMiddleware(cookieSecret));
    // Auth middleware for /api/* routes (except health)
    app.use("/api/*", async (c, next) => {
        // Skip auth for health check
        if (c.req.path === "/api/health") {
            return next();
        }
        return authMiddleware()(c, next);
    });
    // Global error handler — return error details (not just "Internal Server Error")
    app.onError((err, c) => {
        console.error("[mpflow] Unhandled error:", err);
        return c.json({ error: err.message, stack: err.stack?.split("\n").slice(0, 5) }, 500);
    });
    return app;
}
//# sourceMappingURL=app.js.map