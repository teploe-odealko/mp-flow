import { defineMiddlewares, authenticate } from "@medusajs/framework/http"

export default defineMiddlewares({
  routes: [
    {
      // Allow authenticated users who don't yet have a user record (first login via Logto)
      matcher: "/admin/auth/create-user",
      method: ["POST"],
      middlewares: [
        authenticate("user", ["session", "bearer"], {
          allowUnregistered: true,
        }),
      ],
    },
  ],
})
