import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { customSession } from "better-auth/plugins";
import type { Pool } from "pg";
import { sendAuthEmail } from "./mailer";
import { authSetupState, bootstrapEmails, ensureWorkspaceMembership } from "./workspace";

/**
 * Конфигурация better-auth для MPFlow: email+пароль с обязательным подтверждением,
 * rate limiting в Postgres, политика регистрации owner-setup/публичный signup/закрыто,
 * автоверификация первого владельца и workspace per user через customSession.
 *
 * Таблицы better-auth ("user","session","account","verification","rateLimit") создаются
 * миграцией (см. db/migrations.ts), не самой библиотекой.
 */
export function createBetterAuth(pool: Pool) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_SECRET обязателен в production (генерация: npx @better-auth/cli secret)");
  }

  return betterAuth({
    database: pool,
    basePath: "/api/auth",
    baseURL: process.env.PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL,
    secret,
    telemetry: { enabled: false },

    emailAndPassword: {
      enabled: true,
      // Блокирует вход без подтверждения почты и даёт анти-enumeration на sign-up:
      // повторная регистрация на занятый email возвращает нейтральный ответ,
      // не трогая существующего пользователя (закрывает дыру захвата аккаунта).
      requireEmailVerification: true,
      minPasswordLength: 8,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendAuthEmail({ kind: "reset", to: user.email, name: user.name, url });
      }
    },

    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        if (user.emailVerified) return; // owner-setup уже верифицирован — письмо не нужно
        await sendAuthEmail({ kind: "verify", to: user.email, name: user.name, url });
      },
      sendOnSignIn: true, // повторная отправка письма при логине без верификации
      autoSignInAfterVerification: true, // после клика по ссылке — сразу сессия
      expiresIn: 60 * 60 * 24, // 24 часа
      // Публичный signup: workspace появляется сразу после подтверждения почты
      // (customSession всё равно создаст его лениво при первом запросе).
      afterEmailVerification: async (user) => {
        await ensureWorkspaceMembership(pool, user.id, user.email, "owner");
      }
    },

    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 дней
      updateAge: 60 * 60 * 24
    },

    advanced: {
      cookiePrefix: "mpflow", // cookie: mpflow.session_token
      useSecureCookies: process.env.NODE_ENV === "production"
    },

    rateLimit: {
      enabled: true, // и вне production тоже (по умолчанию только prod)
      storage: "database", // Postgres-only runtime: переживает рестарты и реплики
      customRules: {
        "/sign-in/email": { window: 10, max: 3 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 3 }
      }
    },

    hooks: {
      // Политика регистрации MPFlow: owner-setup / публичный signup / закрыто.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email") return;
        const setup = await authSetupState(pool);
        if (!setup.signUpOpen) {
          throw new APIError("FORBIDDEN", { message: "Самостоятельная регистрация временно закрыта." });
        }
        if (setup.signUpMode === "owner") {
          const allowed = bootstrapEmails();
          const email = String((ctx.body as { email?: unknown } | undefined)?.email ?? "").trim().toLowerCase();
          if (allowed.size > 0 && !allowed.has(email)) {
            throw new APIError("FORBIDDEN", { message: "Этот email не входит в список первого доступа" });
          }
        }
      })
    },

    databaseHooks: {
      user: {
        create: {
          // Первый владелец инстанса — автоверификация (n8n-style owner-setup).
          before: async (user) => {
            const setup = await authSetupState(pool);
            if (setup.signUpMode === "owner") {
              return { data: { ...user, emailVerified: true } };
            }
          },
          // Владелец сразу получает workspace; остальные — после верификации.
          after: async (user) => {
            if (user.emailVerified) {
              await ensureWorkspaceMembership(pool, user.id, user.email, "owner");
            }
          }
        }
      }
    },

    // workspaceId/roleCode попадают в ответ /get-session и в серверный auth.api.getSession()
    plugins: [
      customSession(async ({ user, session }) => {
        const membership = await ensureWorkspaceMembership(pool, user.id, user.email, "owner");
        return { user, session, workspaceId: membership.workspaceId, roleCode: membership.roleCode };
      })
    ]
  });
}

export type BetterAuthInstance = ReturnType<typeof createBetterAuth>;
