import { getIronSession, type IronSession } from "iron-session"
import type { Context, MiddlewareHandler } from "hono"
import type { SessionData } from "../../shared/types.js"

export interface SessionContext {
  session: IronSession<SessionData>
}

export function sessionMiddleware(cookieSecret: string): MiddlewareHandler {
  return async (c: Context, next) => {
    const req = c.req.raw
    const res = new Response()

    const session = await getIronSession<SessionData>(req, res, {
      password: cookieSecret,
      cookieName: "mpflow_session",
      cookieOptions: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 7, // 7 days
      },
    })

    c.set("session", session)

    await next()

    // Copy set-cookie headers from iron-session response to actual response
    const setCookie = res.headers.get("set-cookie")
    if (setCookie) {
      c.header("set-cookie", setCookie)
    }
  }
}

export function getSession(c: Context): IronSession<SessionData> {
  return c.get("session") as IronSession<SessionData>
}
