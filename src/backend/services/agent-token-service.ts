import { createHash, randomBytes } from "node:crypto";
import type { AgentToken, ChannelAgentPermission } from "../../core/models";
import { DomainError, id, nowIso } from "../../core/utils";
import type { RuntimeWriteContext } from "../../infra/db/runtime-store";

interface AgentTokenCreateInput {
  name: string;
  mode?: AgentToken["mode"];
  scopes?: string[];
}

interface ChannelAgentPermissionInput {
  agentTokenId: string;
  permissionCode: string;
}

export async function issueMcpAgentToken(writeContext: RuntimeWriteContext, workspaceId: string, input: AgentTokenCreateInput) {
  const organization = writeContext.setupMetadata().organization;
  if (!organization) throw new DomainError("not_configured", "Сначала настройте организацию");

  const mode = input.mode ?? (input.scopes?.some((scope) => /write|post|patch|delete|sync/i.test(scope)) ? "read_write" : "read_only");
  const scopes = input.scopes?.length ? input.scopes : defaultMcpScopes(mode);
  const token: AgentToken = {
    id: id("agent"),
    organizationId: organization.id,
    name: input.name,
    mode,
    scopes,
    status: "active",
    createdAt: nowIso()
  };
  const key = createMcpKey(workspaceId, token.id);
  token.maskedToken = key.maskedToken;
  token.tokenHash = key.tokenHash;
  await writeContext.repos.agentTokens.add(token);
  return { token, secret: key.secret };
}

export async function revokeAgentToken(writeContext: RuntimeWriteContext, tokenId: string, message = "Токен агента не найден"): Promise<AgentToken> {
  const token = await writeContext.repos.agentTokens.getById(tokenId);
  if (!token) throw new DomainError("agent_token_not_found", message);

  token.status = "revoked";
  token.revokedAt = nowIso();
  await writeContext.repos.agentTokens.upsert(token);
  return token;
}

export async function setChannelAgentPermission(writeContext: RuntimeWriteContext, channelId: string, input: ChannelAgentPermissionInput): Promise<ChannelAgentPermission> {
  const existing = (await writeContext.repos.channelAgentPermissions.all()).find((candidate) =>
    candidate.agentTokenId === input.agentTokenId && candidate.channelId === channelId
  );
  const permission: ChannelAgentPermission = existing ?? {
    id: id("channel_agent_permission"),
    agentTokenId: input.agentTokenId,
    channelId,
    permissionCode: input.permissionCode
  };
  permission.permissionCode = input.permissionCode;
  if (existing) await writeContext.repos.channelAgentPermissions.upsert(permission);
  else await writeContext.repos.channelAgentPermissions.add(permission);
  return permission;
}

export function publicAgentToken(token: AgentToken) {
  const { tokenHash: _tokenHash, ...publicToken } = token;
  return publicToken;
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function createMcpKey(workspaceId: string, tokenId: string) {
  const workspacePart = encodeKeyPart(workspaceId);
  const tokenPart = encodeKeyPart(tokenId);
  const secretPart = randomBytes(32).toString("base64url");
  const secret = `mpf_${workspacePart}.${tokenPart}.${secretPart}`;
  return {
    secret,
    tokenHash: hashToken(secret),
    maskedToken: `mpf_${workspaceId}.${tokenId}.\u2022\u2022\u2022\u2022${secretPart.slice(-6)}`
  };
}

function encodeKeyPart(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function defaultMcpScopes(mode: AgentToken["mode"]) {
  return mode === "read_only" ? ["api:read", "mcp:tools"] : ["api:read", "api:write", "mcp:tools"];
}
