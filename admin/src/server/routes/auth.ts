import { Hono } from "hono"
import { randomBytes, createHash } from "crypto"
import { getSession } from "../core/session.js"
import { getAuthMode } from "../core/auth.js"
import { hashPassword, verifyPassword } from "../core/password.js"

const auth = new Hono<{ Variables: Record<string, any> }>()

const LOGTO_ENDPOINT = process.env.LOGTO_ENDPOINT || ""
const LOGTO_APP_ID = process.env.LOGTO_SPA_APP_ID || ""

function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url")
}

function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url")
}

function getOrigin(c: { req: { url: string } }): string {
  const url = new URL(c.req.url)
  return `${url.protocol}//${url.host}`
}

// ── Helpers ──

async function countUsers(c: any): Promise<number> {
  const orm = c.get("orm")
  const em = orm.em.fork()
  const conn = em.getConnection()
  const result = await conn.execute(
    `SELECT COUNT(*)::int AS cnt FROM mpflow_user WHERE deleted_at IS NULL`,
  )
  return result[0]?.cnt || 0
}

async function findUserByEmail(c: any, email: string): Promise<any | null> {
  const orm = c.get("orm")
  const em = orm.em.fork()
  const conn = em.getConnection()
  const result = await conn.execute(
    `SELECT id, email, name, password_hash FROM mpflow_user WHERE email = ? AND deleted_at IS NULL LIMIT 1`,
    [email],
  )
  return result.length > 0 ? result[0] : null
}

// ── GET /auth/mode ──

auth.get("/mode", async (c) => {
  const mode = getAuthMode()
  let needsSetup = false

  if (mode === "selfhosted") {
    try {
      needsSetup = (await countUsers(c)) === 0
    } catch {
      needsSetup = true
    }
  }

  return c.json({ mode, needsSetup })
})

// ── POST /auth/setup — create first admin (selfhosted only) ──

auth.post("/setup", async (c) => {
  if (getAuthMode() !== "selfhosted") {
    return c.json({ error: "Setup only available in selfhosted mode" }, 400)
  }

  const userCount = await countUsers(c)
  if (userCount > 0) {
    return c.json({ error: "Admin user already exists" }, 400)
  }

  const { email, password, name } = await c.req.json()
  if (!email || !password) {
    return c.json({ error: "Email and password are required" }, 400)
  }
  if (password.length < 6) {
    return c.json({ error: "Password must be at least 6 characters" }, 400)
  }

  const orm = c.get("orm")
  const em = orm.em.fork()
  const conn = em.getConnection()

  const { v4 } = await import("uuid")
  const userId = v4()
  const passwordHash = await hashPassword(password)

  await conn.execute(
    `INSERT INTO mpflow_user (id, email, name, password_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, NOW(), NOW())`,
    [userId, email, name || null, passwordHash],
  )

  // Set session
  const session = getSession(c)
  session.userId = userId
  session.email = email
  session.name = name || undefined
  await session.save()

  return c.json({ user: { id: userId, email, name: name || null } })
})

// ── POST /auth/login — email+password login (selfhosted) ──

auth.post("/login", async (c) => {
  if (getAuthMode() !== "selfhosted") {
    return c.json({ error: "Password login only available in selfhosted mode" }, 400)
  }

  const { email, password } = await c.req.json()
  if (!email || !password) {
    return c.json({ error: "Email and password are required" }, 400)
  }

  const user = await findUserByEmail(c, email)
  if (!user || !user.password_hash) {
    return c.json({ error: "Неверный email или пароль" }, 401)
  }

  const valid = await verifyPassword(password, user.password_hash)
  if (!valid) {
    return c.json({ error: "Неверный email или пароль" }, 401)
  }

  const session = getSession(c)
  session.userId = user.id
  session.email = user.email
  session.name = user.name || undefined
  await session.save()

  return c.json({ user: { id: user.id, email: user.email, name: user.name } })
})

// ── GET /auth/login — Logto OIDC flow or redirect ──

auth.get("/login", async (c) => {
  const mode = getAuthMode()

  // Dev mode: auto-login
  if (mode === "dev") {
    const session = getSession(c)
    session.userId = "dev-admin-local"
    session.email = "admin@localhost"
    session.name = "Dev Admin"
    await session.save()
    return c.redirect("/")
  }

  // Selfhosted: client handles login form, just redirect
  if (mode === "selfhosted") {
    return c.redirect("/")
  }

  // Logto OIDC
  if (!LOGTO_ENDPOINT || !LOGTO_APP_ID) {
    return c.json({ error: "LOGTO_ENDPOINT or LOGTO_SPA_APP_ID not configured" }, 500)
  }

  const codeVerifier = generateCodeVerifier()
  const codeChallenge = generateCodeChallenge(codeVerifier)
  const state = randomBytes(16).toString("hex")
  const origin = getOrigin(c)
  const redirectUri = `${origin}/auth/callback`

  const session = getSession(c)
  session.codeVerifier = codeVerifier
  session.oauthState = state
  await session.save()

  const params = new URLSearchParams({
    response_type: "code",
    client_id: LOGTO_APP_ID,
    redirect_uri: redirectUri,
    scope: "openid email profile",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  })

  return c.redirect(`${LOGTO_ENDPOINT}/oidc/auth?${params.toString()}`)
})

// ── GET /auth/callback — Logto OIDC callback ──

auth.get("/callback", async (c) => {
  const code = c.req.query("code")
  const state = c.req.query("state")

  if (!code || !state) {
    return c.json({ error: "Missing code or state" }, 400)
  }

  const session = getSession(c)

  if (state !== session.oauthState) {
    return c.json({ error: "Invalid state parameter" }, 400)
  }

  const codeVerifier = session.codeVerifier
  if (!codeVerifier) {
    return c.json({ error: "Missing code_verifier in session" }, 400)
  }

  const origin = getOrigin(c)
  const redirectUri = `${origin}/auth/callback`

  let accessToken: string
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
    })

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text()
      console.error("[auth] Token exchange failed:", tokenRes.status, errBody)
      return c.json({ error: "Token exchange failed" }, 401)
    }

    const tokenData = (await tokenRes.json()) as { access_token: string }
    accessToken = tokenData.access_token
  } catch (err) {
    console.error("[auth] Token exchange error:", err)
    return c.json({ error: "Token exchange error" }, 500)
  }

  let userinfo: { sub: string; email?: string; name?: string }
  try {
    const userinfoRes = await fetch(`${LOGTO_ENDPOINT}/oidc/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!userinfoRes.ok) {
      console.error("[auth] Userinfo failed:", userinfoRes.status)
      return c.json({ error: "Failed to get user info" }, 401)
    }
    userinfo = (await userinfoRes.json()) as any
  } catch (err) {
    console.error("[auth] Userinfo error:", err)
    return c.json({ error: "Failed to get user info" }, 500)
  }

  if (!userinfo.email) {
    return c.json({ error: "Logto user has no email" }, 400)
  }

  const orm = c.get("orm")
  const em = orm.em.fork()
  const conn = em.getConnection()

  let userId: string
  let userName: string | null = null

  try {
    const result = await conn.execute(
      `SELECT id, email, name FROM mpflow_user WHERE email = ? AND deleted_at IS NULL LIMIT 1`,
      [userinfo.email],
    )

    if (result.length > 0) {
      userId = result[0].id
      userName = result[0].name
    } else {
      const { v4 } = await import("uuid")
      userId = v4()
      userName = userinfo.name || null
      await conn.execute(
        `INSERT INTO mpflow_user (id, email, name, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())`,
        [userId, userinfo.email, userName],
      )
    }
  } catch (err: any) {
    console.error("[auth] DB error in callback:", err)
    return c.json({ error: "Database error: " + (err.message || "unknown") }, 500)
  }

  session.userId = userId
  session.email = userinfo.email
  session.name = userName || undefined
  delete session.codeVerifier
  delete session.oauthState
  await session.save()

  return c.redirect("/")
})

// ── POST /auth/logout ──

auth.post("/logout", async (c) => {
  const session = getSession(c)
  session.destroy()
  await session.save()
  return c.json({ success: true })
})

// ── GET /auth/me ──

auth.get("/me", async (c) => {
  const session = getSession(c)
  if (!session.userId) {
    return c.json({ user: null })
  }
  return c.json({
    user: {
      id: session.userId,
      email: session.email,
      name: session.name,
    },
  })
})

export default auth
