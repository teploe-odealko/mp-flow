import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createUserAccountWorkflow, setAuthAppMetadataWorkflow } from "@medusajs/core-flows"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

/**
 * POST /admin/auth/create-user
 *
 * Creates a Medusa User from Logto auth identity after first login.
 * Called by the frontend when decoded JWT has no actor_id.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const authContext = (req as any).auth_context

  if (!authContext) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Not authenticated")
  }

  // If user already exists for this auth identity, reject
  if (authContext.actor_id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "User already exists for this auth identity."
    )
  }

  const email = authContext.user_metadata?.email
  if (!email) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Email is required to create a user account."
    )
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Check if a user with this email already exists — link them
  const existingUser = await query
    .graph({
      entity: "user",
      fields: ["id"],
      filters: { email },
    })
    .then((result: any) => result.data[0])

  if (existingUser) {
    await setAuthAppMetadataWorkflow(req.scope).run({
      input: {
        authIdentityId: authContext.auth_identity_id,
        actorType: "user",
        value: existingUser.id,
      },
    })

    const updatedUser = await query
      .graph({
        entity: "user",
        fields: ["*"],
        filters: { id: existingUser.id },
      })
      .then((result: any) => result.data[0])

    res.status(200).json({ user: updatedUser })
    return
  }

  // Create new user + link to auth identity
  const { result: createdUser } = await createUserAccountWorkflow(req.scope).run({
    input: {
      authIdentityId: authContext.auth_identity_id,
      userData: {
        email,
        first_name: authContext.user_metadata?.name || null,
        last_name: null,
      },
    },
  })

  res.status(200).json({ user: createdUser })
}
