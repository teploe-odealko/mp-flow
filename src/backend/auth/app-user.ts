import { AccountingApp } from "../../core/accounting-app";
import { nowIso } from "../../core/utils";
import type { WorkspaceRoleCode } from "./workspace";

/**
 * Принципал авторизованного пользователя в HTTP-контексте: форма одинакова для
 * better-auth-сессий, dev-фоллбека и MCP-агентов (см. createSessionMiddleware).
 */
export interface AuthPrincipal {
  id: string;
  email: string;
  name: string;
  roleCode: WorkspaceRoleCode;
  workspaceId?: string;
}

export function publicUser(user: AuthPrincipal) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    roleCode: user.roleCode,
    workspaceId: user.workspaceId
  };
}

/**
 * Мост better-auth user → доменная таблица user_account: создаёт/актуализирует
 * запись пользователя внутри workspace (включая замену placeholder-владельца).
 */
export async function ensureAppUser(app: AccountingApp, input: AuthPrincipal & { status: "invited" | "active" | "disabled" }) {
  const setup = await app.setupSnapshot();
  if (!setup.organization) {
    return null;
  }
  const users = await app.repos.users.all();
  const existing = users.find((candidate) => candidate.email.toLowerCase() === input.email.toLowerCase());
  const organizationId = setup.organization.id;
  if (existing) {
    existing.name = input.name;
    existing.roleCode = input.roleCode;
    existing.status = input.status;
    existing.lastActiveAt = input.status === "active" ? nowIso() : existing.lastActiveAt;
    await app.repos.users.upsert(existing);
    return existing;
  }
  const placeholder = users.find((candidate) =>
    candidate.email.toLowerCase() === "owner@mpflow.local" &&
    candidate.roleCode === "owner" &&
    input.roleCode === "owner"
  );
  if (placeholder) {
    placeholder.id = input.id;
    placeholder.email = input.email;
    placeholder.name = input.name;
    placeholder.roleCode = input.roleCode;
    placeholder.status = input.status;
    placeholder.lastActiveAt = input.status === "active" ? nowIso() : placeholder.lastActiveAt;
    await app.repos.users.upsert(placeholder);
    return placeholder;
  }
  const user = {
    id: input.id,
    organizationId,
    email: input.email,
    name: input.name,
    roleCode: input.roleCode,
    status: input.status,
    invitedAt: nowIso(),
    lastActiveAt: input.status === "active" ? nowIso() : undefined
  };
  await app.repos.users.add(user);
  return user;
}
