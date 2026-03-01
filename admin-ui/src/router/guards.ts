import type { Router } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const PUBLIC_ROUTES = new Set(['login'])

export function setupGuards(router: Router): void {
  router.beforeEach(async (to) => {
    const authStore = useAuthStore()

    // Wait for auth boot to complete
    if (authStore.isBooting) {
      await new Promise<void>((resolve) => {
        const unwatch = authStore.$subscribe(() => {
          if (!authStore.isBooting) {
            unwatch()
            resolve()
          }
        })
        // Also check immediately in case boot already finished
        if (!authStore.isBooting) {
          unwatch()
          resolve()
        }
      })
    }

    // If route is public, allow
    if (to.name && PUBLIC_ROUTES.has(to.name as string)) {
      return true
    }

    // If not authenticated, App.vue will show LoginView instead of AppShell,
    // so we don't need to redirect — just let the navigation proceed.
    // The AppShell (with router-view) is only rendered when authenticated.
    return true
  })
}
