import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * POST /auth/logto-exchange
 *
 * Exchanges a Logto access token for a Medusa session.
 * - Validates the token via Logto's /oidc/me endpoint
 * - Finds or creates a Medusa user by email
 * - Sets req.session.auth_context so Medusa admin works via session cookie
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { access_token } = req.body as { access_token?: string }

  if (!access_token) {
    return res.status(400).json({ error: "access_token is required" })
  }

  const logtoEndpoint = process.env.LOGTO_ENDPOINT
  if (!logtoEndpoint) {
    return res.status(500).json({ error: "LOGTO_ENDPOINT not configured" })
  }

  // 1. Validate the Logto token by calling Logto's userinfo endpoint
  let userinfo: { sub: string; email?: string; name?: string; picture?: string }
  try {
    const userinfoRes = await fetch(`${logtoEndpoint}/oidc/me`, {
      headers: { Authorization: `Bearer ${access_token}` },
    })

    if (!userinfoRes.ok) {
      return res.status(401).json({ error: "Invalid or expired Logto token" })
    }

    userinfo = await userinfoRes.json()
  } catch (err) {
    return res.status(401).json({ error: "Failed to validate token with Logto" })
  }

  if (!userinfo.email) {
    return res.status(400).json({ error: "Logto user has no email" })
  }

  // 2. Find or create Medusa user by email
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  let user: { id: string; email: string; first_name?: string; last_name?: string } | null = null

  const { data: existingUsers } = await query.graph({
    entity: "user",
    fields: ["id", "email", "first_name", "last_name"],
    filters: { email: userinfo.email },
  })

  if (existingUsers.length > 0) {
    user = existingUsers[0]
  } else {
    // Create new user
    const userModuleService = req.scope.resolve(Modules.USER)
    const [created] = await (userModuleService as any).createUsers([
      {
        email: userinfo.email,
        first_name: userinfo.name || null,
        last_name: null,
      },
    ])
    user = created
  }

  if (!user) {
    return res.status(500).json({ error: "Failed to find or create user" })
  }

  // 3. Set session — Medusa admin routes read req.session.auth_context
  ;(req.session as any).auth_context = {
    actor_id: user.id,
    actor_type: "user",
    auth_identity_id: "",
    app_metadata: { user_id: user.id },
    user_metadata: {
      email: userinfo.email,
      name: userinfo.name || null,
      picture: userinfo.picture || null,
    },
  }

  res.json({ user })
}
