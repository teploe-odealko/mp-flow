import { Hono } from "hono";
import { getSession } from "../core/session.js";
const auth = new Hono();
// GET /auth/logto-config — public Logto SPA config
auth.get("/logto-config", (c) => {
    return c.json({
        endpoint: process.env.LOGTO_ENDPOINT || "",
        app_id: process.env.LOGTO_SPA_APP_ID || "",
    });
});
// POST /auth/logto-exchange — exchange Logto token for session
auth.post("/logto-exchange", async (c) => {
    const { access_token } = await c.req.json();
    if (!access_token) {
        return c.json({ error: "access_token is required" }, 400);
    }
    const logtoEndpoint = process.env.LOGTO_ENDPOINT;
    if (!logtoEndpoint) {
        return c.json({ error: "LOGTO_ENDPOINT not configured" }, 500);
    }
    // Validate the Logto token
    let userinfo;
    try {
        const userinfoRes = await fetch(`${logtoEndpoint}/oidc/me`, {
            headers: { Authorization: `Bearer ${access_token}` },
        });
        if (!userinfoRes.ok) {
            return c.json({ error: "Invalid or expired Logto token" }, 401);
        }
        userinfo = await userinfoRes.json();
    }
    catch {
        return c.json({ error: "Failed to validate token with Logto" }, 401);
    }
    if (!userinfo.email) {
        return c.json({ error: "Logto user has no email" }, 400);
    }
    // Find or create user in our DB
    const orm = c.get("orm");
    const em = orm.em.fork();
    const conn = em.getConnection();
    let userId;
    let userName = null;
    try {
        // Ensure user table exists (idempotent)
        await conn.execute(`
      CREATE TABLE IF NOT EXISTS "mpflow_user" (
        "id" text NOT NULL,
        "email" text NOT NULL UNIQUE,
        "name" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "mpflow_user_pkey" PRIMARY KEY ("id")
      )
    `);
        const result = await conn.execute(`SELECT id, email, name FROM mpflow_user WHERE email = ? AND deleted_at IS NULL LIMIT 1`, [userinfo.email]);
        if (result.length > 0) {
            userId = result[0].id;
            userName = result[0].name;
        }
        else {
            const { v4 } = await import("uuid");
            userId = v4();
            userName = userinfo.name || null;
            await conn.execute(`INSERT INTO mpflow_user (id, email, name, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())`, [userId, userinfo.email, userName]);
        }
    }
    catch (err) {
        console.error("[auth] DB error in logto-exchange:", err);
        return c.json({ error: "Database error: " + (err.message || "unknown") }, 500);
    }
    // Set session
    const session = getSession(c);
    session.userId = userId;
    session.email = userinfo.email;
    session.name = userName || undefined;
    await session.save();
    return c.json({ user: { id: userId, email: userinfo.email, name: userName } });
});
// POST /auth/logout — destroy session
auth.post("/logout", async (c) => {
    const session = getSession(c);
    session.destroy();
    return c.json({ success: true });
});
// GET /auth/me — current user
auth.get("/me", async (c) => {
    const session = getSession(c);
    if (!session.userId) {
        return c.json({ user: null });
    }
    return c.json({
        user: {
            id: session.userId,
            email: session.email,
            name: session.name,
        },
    });
});
export default auth;
//# sourceMappingURL=auth.js.map