import type { UserAccount } from "../../core/models";
import { DomainError, id, nowIso } from "../../core/utils";
import type { RuntimeWriteContext } from "../../infra/db/runtime-store";

type RoleCode = UserAccount["roleCode"];

interface InviteUserInput {
  email: string;
  name?: string;
  roleCode?: RoleCode;
}

export async function inviteUser(writeContext: RuntimeWriteContext, input: InviteUserInput): Promise<UserAccount> {
  const organization = writeContext.setupMetadata().organization;
  if (!organization) throw new DomainError("not_configured", "Сначала настройте организацию");

  const user: UserAccount = {
    id: id("user"),
    organizationId: organization.id,
    email: input.email,
    name: input.name ?? input.email,
    roleCode: input.roleCode ?? "operator",
    status: "invited",
    invitedAt: nowIso()
  };
  await writeContext.repos.users.add(user);
  return user;
}

export async function updateUserRole(writeContext: RuntimeWriteContext, userId: string, roleCode: RoleCode) {
  const users = await writeContext.repos.users.all();
  const user = users.find((candidate) => candidate.id === userId);
  if (!user) throw new DomainError("user_not_found", "Пользователь не найден");
  ensureOwnerInvariant(users, user, roleCode);

  user.roleCode = roleCode;
  await writeContext.repos.users.upsert(user);
  return { user, role: (await writeContext.repos.roles.all()).find((role) => role.code === roleCode) };
}

export async function disableUser(writeContext: RuntimeWriteContext, userId: string): Promise<UserAccount> {
  const users = await writeContext.repos.users.all();
  const user = users.find((candidate) => candidate.id === userId);
  if (!user) throw new DomainError("user_not_found", "Пользователь не найден");
  ensureOwnerInvariant(users, user, user.roleCode, true);

  user.status = "disabled";
  await writeContext.repos.users.upsert(user);
  return user;
}

export async function resendUserInvite(writeContext: RuntimeWriteContext, userId: string): Promise<UserAccount> {
  const user = await writeContext.repos.users.getById(userId);
  if (!user) throw new DomainError("user_not_found", "Пользователь не найден");

  user.status = "invited";
  user.invitedAt = nowIso();
  await writeContext.repos.users.upsert(user);
  return user;
}

function ensureOwnerInvariant(users: UserAccount[], user: UserAccount, nextRoleCode: RoleCode, disabling = false) {
  const activeOwners = users.filter((candidate) => candidate.status !== "disabled" && candidate.roleCode === "owner");
  const removesOwner = user.roleCode === "owner" && (disabling || nextRoleCode !== "owner");
  if (removesOwner && activeOwners.length <= 1) {
    throw new DomainError("last_admin_required", "Нельзя отключить или снять роль владельца у последнего администратора");
  }
}
