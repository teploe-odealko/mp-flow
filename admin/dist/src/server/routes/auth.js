import { Hono } from "hono";
import { randomBytes, createHash } from "crypto";
import { getSession } from "../core/session.js";
const auth = new Hono();
const LOGTO_ENDPOINT = process.env.LOGTO_ENDPOINT || "";
const LOGTO_APP_ID = process.env.LOGTO_SPA_APP_ID || "";
function generateCodeVerifier() {
    return randomBytes(32).toString("base64url");
}
function generateCodeChallenge(verifier) {
    return createHash("sha256").update(verifier).digest("base64url");
}
function getOrigin(c) {
    const url = new URL(c.req.url);
    return `${url.protocol}//${url.host}`;
}
// GET /auth/login — redirect to Logto with PKCE
auth.get("/login", async (c) => {
    if (!LOGTO_ENDPOINT || !LOGTO_APP_ID) {
        return c.json({ error: "LOGTO_ENDPOINT or LOGTO_SPA_APP_ID not configured" }, 500);
    }
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = randomBytes(16).toString("hex");
    const origin = getOrigin(c);
    const redirectUri = `${origin}/auth/callback`;
    // Save PKCE state in session
    const session = getSession(c);
    session.codeVerifier = codeVerifier;
    session.oauthState = state;
    await session.save();
    const params = new URLSearchParams({
        response_type: "code",
        client_id: LOGTO_APP_ID,
        redirect_uri: redirectUri,
        scope: "openid email profile",
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        state,
    });
    return c.redirect(`${LOGTO_ENDPOINT}/oidc/auth?${params.toString()}`);
});
// GET /auth/callback — exchange code for tokens, create session
auth.get("/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state) {
        return c.json({ error: "Missing code or state" }, 400);
    }
    const session = getSession(c);
    // Verify state
    if (state !== session.oauthState) {
        return c.json({ error: "Invalid state parameter" }, 400);
    }
    const codeVerifier = session.codeVerifier;
    if (!codeVerifier) {
        return c.json({ error: "Missing code_verifier in session" }, 400);
    }
    const origin = getOrigin(c);
    const redirectUri = `${origin}/auth/callback`;
    // Exchange code for tokens
    let accessToken;
    try {
        const tokenRes = await fetch(`${LOGTO_ENDPOINT}/oidc/token`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "authorization_code",
                code,
                redirect_uri: redirectUri,
                client_id: LOGTO_APP_ID,
                code_verifier: codeVerifier,
            }),
        });
        if (!tokenRes.ok) {
            const errBody = await tokenRes.text();
            console.error("[auth] Token exchange failed:", tokenRes.status, errBody);
            return c.json({ error: "Token exchange failed" }, 401);
        }
        const tokenData = (await tokenRes.json());
        accessToken = tokenData.access_token;
    }
    catch (err) {
        console.error("[auth] Token exchange error:", err);
        return c.json({ error: "Token exchange error" }, 500);
    }
    // Get user info from Logto
    let userinfo;
    try {
        const userinfoRes = await fetch(`${LOGTO_ENDPOINT}/oidc/me`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!userinfoRes.ok) {
            console.error("[auth] Userinfo failed:", userinfoRes.status);
            return c.json({ error: "Failed to get user info" }, 401);
        }
        userinfo = (await userinfoRes.json());
    }
    catch (err) {
        console.error("[auth] Userinfo error:", err);
        return c.json({ error: "Failed to get user info" }, 500);
    }
    if (!userinfo.email) {
        return c.json({ error: "Logto user has no email" }, 400);
    }
    // Find or create user in DB
    const orm = c.get("orm");
    const em = orm.em.fork();
    const conn = em.getConnection();
    let userId;
    let userName = null;
    try {
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
        console.error("[auth] DB error in callback:", err);
        return c.json({ error: "Database error: " + (err.message || "unknown") }, 500);
    }
    // Set session
    session.userId = userId;
    session.email = userinfo.email;
    session.name = userName || undefined;
    // Clean up PKCE fields
    delete session.codeVerifier;
    delete session.oauthState;
    await session.save();
    return c.redirect("/");
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