import { randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { emailDeliveryMode } from "./mailer";

/**
 * Workspace-модель MPFlow поверх better-auth: таблицы auth_workspace и
 * auth_workspace_member остаются кастомными (роль живёт в членстве, политика
 * «1 workspace на пользователя»). Создаются миграцией, не лениво.
 */
export type WorkspaceRoleCode = "owner" | "accountant" | "operator" | "viewer";

export interface WorkspaceMembership {
  workspaceId: string;
  roleCode: WorkspaceRoleCode;
}

export interface AuthSetupState {
  signUpOpen: boolean;
  signUpMode: "owner" | "user";
  bootstrapEmailsConfigured: boolean;
  bootstrapEmailRequired: boolean;
  emailDeliveryMode: "smtp" | "log" | "missing";
}

/**
 * Состояние первичной настройки: пока нет ни одного подтверждённого пользователя,
 * регистрация работает в режиме owner-setup (первый аккаунт становится владельцем).
 */
export async function authSetupState(pool: Pool): Promise<AuthSetupState> {
  const { rows } = await pool.query<{ verified_count: string }>(
    `select count(*) filter (where "emailVerified" = true)::text as verified_count from "user"`
  );
  const verifiedCount = Number(rows[0]?.verified_count ?? "0");
  const initialOwnerSignup = verifiedCount === 0;
  const bootstrapEmailRequired = initialOwnerSignup && bootstrapEmails().size > 0;
  return {
    signUpOpen: initialOwnerSignup || publicSignupEnabled(),
    signUpMode: initialOwnerSignup ? "owner" : "user",
    bootstrapEmailsConfigured: bootstrapEmails().size > 0,
    bootstrapEmailRequired,
    emailDeliveryMode: emailDeliveryMode()
  };
}

/**
 * Возвращает членство пользователя, при отсутствии — создаёт персональный workspace
 * и членство с ролью owner (политика «каждому аккаунту свой кабинет»).
 */
export async function ensureWorkspaceMembership(
  source: Pool | PoolClient,
  userId: string,
  email: string,
  roleCode: WorkspaceRoleCode = "owner"
): Promise<WorkspaceMembership> {
  const existing = await source.query<{ workspace_id: string; role_code: WorkspaceRoleCode }>(
    `select workspace_id, role_code
     from auth_workspace_member
     where user_id = $1
     order by created_at
     limit 1`,
    [userId]
  );
  const row = existing.rows[0];
  if (row) return { workspaceId: row.workspace_id, roleCode: row.role_code };

  const workspaceId = `workspace_${randomBytes(12).toString("base64url")}`;
  await source.query(
    `insert into auth_workspace (id, name, created_at, updated_at)
     values ($1, $2, now(), now())
     on conflict (id) do update set name = excluded.name, updated_at = now()`,
    [workspaceId, email]
  );
  await source.query(
    `insert into auth_workspace_member (workspace_id, user_id, role_code, created_at)
     values ($1, $2, $3, now())
     on conflict (user_id) do update set
       workspace_id = excluded.workspace_id,
       role_code = excluded.role_code`,
    [workspaceId, userId, roleCode]
  );
  return { workspaceId, roleCode };
}

/** Список email первого доступа (ACCOUNTING_AUTH_BOOTSTRAP_EMAILS, через запятую). */
export function bootstrapEmails(): Set<string> {
  return new Set(
    (process.env.ACCOUNTING_AUTH_BOOTSTRAP_EMAILS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function publicSignupEnabled() {
  const publicSignup = process.env.ACCOUNTING_AUTH_PUBLIC_SIGNUP?.trim().toLowerCase();
  const saasWorkspaces = process.env.ACCOUNTING_SAAS_WORKSPACES_ENABLED?.trim().toLowerCase();
  const truthy = ["1", "true", "yes", "on"];
  return truthy.includes(publicSignup ?? "") && truthy.includes(saasWorkspaces ?? "");
}
