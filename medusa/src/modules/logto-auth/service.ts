import crypto from "crypto"
import { AbstractAuthModuleProvider, MedusaError } from "@medusajs/framework/utils"
import type { AuthenticationInput, AuthenticationResponse, AuthIdentityProviderService, Logger } from "@medusajs/framework/types"

type LogtoAuthOptions = {
  clientId: string
  clientSecret: string
  callbackUrl: string
  endpoint: string
}

type InjectedDependencies = {
  logger: Logger
}

class LogtoAuthService extends AbstractAuthModuleProvider {
  static identifier = "logto"
  static DISPLAY_NAME = "Logto Authentication"

  protected config_: LogtoAuthOptions
  protected logger_: Logger

  static validateOptions(options: Record<string, unknown>) {
    if (!options.clientId) throw new Error("Logto clientId is required")
    if (!options.clientSecret) throw new Error("Logto clientSecret is required")
    if (!options.callbackUrl) throw new Error("Logto callbackUrl is required")
    if (!options.endpoint) throw new Error("Logto endpoint is required")
  }

  constructor({ logger }: InjectedDependencies, options: LogtoAuthOptions) {
    // @ts-ignore
    super(...arguments)
    this.config_ = options
    this.logger_ = logger
  }

  async register(_data: AuthenticationInput): Promise<AuthenticationResponse> {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Logto does not support registration through Medusa. Use Logto sign-up directly."
    )
  }

  async authenticate(
    req: AuthenticationInput,
    authIdentityService: AuthIdentityProviderService
  ): Promise<AuthenticationResponse> {
    const body = req.body ?? {}

    if (req.query?.error) {
      return {
        success: false,
        error: `${req.query.error_description || req.query.error}`,
      }
    }

    const stateKey = crypto.randomBytes(32).toString("hex")
    const state = {
      callback_url: body.callback_url ?? this.config_.callbackUrl,
    }
    await authIdentityService.setState(stateKey, state)

    const authUrl = new URL(`${this.config_.endpoint}/oidc/auth`)
    authUrl.searchParams.set("client_id", this.config_.clientId)
    authUrl.searchParams.set("redirect_uri", state.callback_url)
    authUrl.searchParams.set("response_type", "code")
    authUrl.searchParams.set("scope", "openid profile email")
    authUrl.searchParams.set("state", stateKey)

    return { success: true, location: authUrl.toString() }
  }

  async validateCallback(
    req: AuthenticationInput,
    authIdentityService: AuthIdentityProviderService
  ): Promise<AuthenticationResponse> {
    const query = req.query ?? {}
    const body = req.body ?? {}

    if (query.error) {
      return {
        success: false,
        error: `${query.error_description || query.error}`,
      }
    }

    const code = query.code ?? body.code
    if (!code) {
      return { success: false, error: "No authorization code provided" }
    }

    const savedState = await authIdentityService.getState(query.state ?? body.state)
    if (!savedState) {
      return { success: false, error: "Invalid or expired state" }
    }

    try {
      // Exchange code for tokens
      const tokenResponse = await fetch(`${this.config_.endpoint}/oidc/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.config_.clientId,
          client_secret: this.config_.clientSecret,
          code,
          redirect_uri: (savedState as Record<string, string>).callback_url,
          grant_type: "authorization_code",
        }),
      })

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text()
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Token exchange failed: ${tokenResponse.status} ${errorText}`
        )
      }

      const tokens = await tokenResponse.json()

      // Get user info from Logto
      const userinfoResponse = await fetch(`${this.config_.endpoint}/oidc/me`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      })

      if (!userinfoResponse.ok) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Userinfo request failed: ${userinfoResponse.status}`
        )
      }

      const userinfo = await userinfoResponse.json()
      const entityId = userinfo.sub

      const userMetadata = {
        email: userinfo.email ?? null,
        name: userinfo.name ?? null,
        picture: userinfo.picture ?? null,
      }

      // Find or create auth identity
      let authIdentity
      try {
        authIdentity = await authIdentityService.retrieve({ entity_id: entityId })
      } catch (error: any) {
        if (error.type === MedusaError.Types.NOT_FOUND) {
          authIdentity = await authIdentityService.create({
            entity_id: entityId,
            user_metadata: userMetadata,
          })
        } else {
          return { success: false, error: error.message }
        }
      }

      return { success: true, authIdentity }
    } catch (error: any) {
      this.logger_.error(`Logto auth callback error: ${error.message}`)
      return { success: false, error: error.message }
    }
  }
}

export default LogtoAuthService
