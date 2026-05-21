import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Context, Next } from "hono";
import { Pool, type PoolClient } from "pg";
import { AccountingApp } from "../core/accounting-app";
import { DomainError, id, nowIso } from "../core/utils";

const SESSION_COOKIE = "mpflow_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const DEFAULT_AUTH_WORKSPACE_ID = "default";

export interface AuthPrincipal {
  id: string;
  email: string;
  name: string;
  roleCode: "owner" | "accountant" | "operator" | "viewer";
  workspaceId?: string;
}

interface AuthSession extends AuthPrincipal {
  sessionId: string;
  workspaceId: string;
}

interface SignupInput {
  email: string;
  name?: string;
  password: string;
}

interface LoginInput {
  email: string;
  password: string;
}

export class AuthService {
  private readonly pool: Pool;
  private initPromise?: Promise<void>;

  constructor() {
    if (!process.env.DATABASE_URL) {
      throw new Error("Для auth нужен DATABASE_URL");
    }
    this.pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }

  async close() {
    await this.pool.end();
  }

  async init() {
    if (!this.initPromise) {
      this.initPromise = this.initialize().catch((error) => {
        this.initPromise = undefined;
        throw error;
      });
    }
    await this.initPromise;
  }

  async setup() {
    await this.init();
    const { rows } = await this.pool.query<{ verified_count: string }>(
      `select count(*) filter (where email_verified = true)::text as verified_count from auth_user`
    );
    const verifiedCount = Number(rows[0]?.verified_count ?? "0");
    const initialOwnerSignup = verifiedCount === 0;
    const publicSignup = publicSignupEnabled();
    const bootstrapEmailRequired = initialOwnerSignup && bootstrapEmails().size > 0;
    return {
      signUpOpen: initialOwnerSignup || publicSignup,
      signUpMode: initialOwnerSignup ? "owner" : "user",
      bootstrapEmailsConfigured: bootstrapEmails().size > 0,
      bootstrapEmailRequired,
      emailDeliveryMode: emailDeliveryMode()
    };
  }

  async signup(input: SignupInput) {
    await this.init();
    const email = normalizeEmail(input.email);
    if (!email) throw new DomainError("invalid_email", "Укажите email");
    if (input.password.length < 8) throw new DomainError("weak_password", "Пароль должен быть не короче 8 символов");

    const setup = await this.setup();
    if (!setup.signUpOpen) {
      throw new DomainError("sign_up_closed", "Самостоятельная регистрация временно закрыта до изоляции личных кабинетов.");
    }
    const allowed = bootstrapEmails();
    if (setup.signUpMode === "owner" && allowed.size > 0 && !allowed.has(email)) {
      throw new DomainError("sign_up_forbidden", "Этот email не входит в список первого доступа");
    }

    const roleCode = "owner" as const;
    const name = input.name?.trim() || email;
    const passwordHash = hashPassword(input.password);
    const userId = id("auth_user");

    const userResult = await this.pool.query<{ id: string }>(
      `insert into auth_user (id, email, name, password_hash, role_code, email_verified, created_at, updated_at)
       values ($1, $2, $3, $4, $5, false, now(), now())
       on conflict (email) do update set
         name = excluded.name,
         password_hash = excluded.password_hash,
         role_code = excluded.role_code,
         updated_at = now()
       returning id`,
      [userId, email, name, passwordHash, roleCode]
    );
    const persistedUserId = userResult.rows[0]?.id ?? userId;

    await this.createVerification(email, persistedUserId, name);
    return { email, verificationRequired: true, emailDeliveryMode: emailDeliveryMode() };
  }

  async verifyEmail(token: string) {
    await this.init();
    const tokenHash = hashToken(token);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const { rows } = await client.query<{ user_id: string; email: string; name: string; role_code: AuthPrincipal["roleCode"] }>(
        `select v.user_id, u.email, u.name, u.role_code
         from auth_email_verification v
         join auth_user u on u.id = v.user_id
         where v.token_hash = $1 and v.expires_at > now()
         for update of v`,
        [tokenHash]
      );
      const row = rows[0];
      if (!row) throw new DomainError("invalid_verification_token", "Ссылка подтверждения недействительна или устарела");

      await client.query("update auth_user set email_verified = true, updated_at = now() where id = $1", [row.user_id]);
      await client.query("delete from auth_email_verification where user_id = $1", [row.user_id]);
      const membership = await this.ensureWorkspaceMembership(client, {
        id: row.user_id,
        email: row.email,
        roleCode: row.role_code
      });
      await client.query("commit");
      return { email: row.email, verified: true, workspaceId: membership.workspaceId };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async login(input: LoginInput, c: Context) {
    await this.init();
    const email = normalizeEmail(input.email);
    const { rows } = await this.pool.query<{
      id: string;
      email: string;
      name: string;
      password_hash: string;
      role_code: AuthPrincipal["roleCode"];
      email_verified: boolean;
      workspace_id: string | null;
      membership_role_code: AuthPrincipal["roleCode"] | null;
    }>(
      `select
         u.id,
         u.email,
         u.name,
         u.password_hash,
         u.role_code,
         u.email_verified,
         m.workspace_id,
         m.role_code as membership_role_code
       from auth_user u
       left join lateral (
         select workspace_id, role_code
         from auth_workspace_member
         where user_id = u.id
         order by created_at
         limit 1
       ) m on true
       where u.email = $1`,
      [email]
    );
    const user = rows[0];
    if (!user || !verifyPassword(input.password, user.password_hash)) {
      throw new DomainError("invalid_credentials", "Неверный email или пароль");
    }
    if (!user.email_verified) {
      await this.createVerification(user.email, user.id, user.name);
      throw new DomainError("email_not_verified", "Email еще не подтвержден. Мы отправили письмо повторно.");
    }
    const membership = user.workspace_id
      ? { workspaceId: user.workspace_id, roleCode: user.membership_role_code ?? user.role_code }
      : await this.ensureWorkspaceMembership(this.pool, { id: user.id, email: user.email, roleCode: user.role_code });

    const token = randomToken();
    const sessionId = id("auth_session");
    await this.pool.query(
      `insert into auth_session (id, user_id, token_hash, expires_at, created_at, last_seen_at)
       values ($1, $2, $3, now() + interval '30 days', now(), now())`,
      [sessionId, user.id, hashToken(token)]
    );
    setSessionCookie(c, token);
    return {
      user: publicUser({
        id: user.id,
        email: user.email,
        name: user.name,
        roleCode: membership.roleCode,
        workspaceId: membership.workspaceId
      })
    };
  }

  async logout(c: Context) {
    await this.init();
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      await this.pool.query("delete from auth_session where token_hash = $1", [hashToken(token)]);
    }
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return { ok: true };
  }

  async session(c: Context): Promise<AuthSession | null> {
    await this.init();
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) return null;
    const { rows } = await this.pool.query<{
      session_id: string;
      id: string;
      email: string;
      name: string;
      role_code: AuthPrincipal["roleCode"];
      workspace_id: string | null;
      membership_role_code: AuthPrincipal["roleCode"] | null;
    }>(
      `select
         s.id as session_id,
         u.id,
         u.email,
         u.name,
         u.role_code,
         m.workspace_id,
         m.role_code as membership_role_code
       from auth_session s
       join auth_user u on u.id = s.user_id
       left join lateral (
         select workspace_id, role_code
         from auth_workspace_member
         where user_id = u.id
         order by created_at
         limit 1
       ) m on true
       where s.token_hash = $1 and s.expires_at > now() and u.email_verified = true`,
      [hashToken(token)]
    );
    const row = rows[0];
    if (!row) return null;
    const membership = row.workspace_id
      ? { workspaceId: row.workspace_id, roleCode: row.membership_role_code ?? row.role_code }
      : await this.ensureWorkspaceMembership(this.pool, { id: row.id, email: row.email, roleCode: row.role_code });
    await this.pool.query("update auth_session set last_seen_at = now() where id = $1", [row.session_id]);
    return {
      sessionId: row.session_id,
      id: row.id,
      email: row.email,
      name: row.name,
      roleCode: membership.roleCode,
      workspaceId: membership.workspaceId
    };
  }

  async resend(emailInput: string) {
    await this.init();
    const email = normalizeEmail(emailInput);
    const { rows } = await this.pool.query<{ id: string; email: string; name: string; email_verified: boolean }>(
      "select id, email, name, email_verified from auth_user where email = $1",
      [email]
    );
    const user = rows[0];
    if (!user) throw new DomainError("user_not_found", "Пользователь не найден");
    if (user.email_verified) return { email: user.email, alreadyVerified: true };
    await this.createVerification(user.email, user.id, user.name);
    return { email: user.email, verificationRequired: true, emailDeliveryMode: emailDeliveryMode() };
  }

  private async initialize() {
    await this.pool.query(`
      create table if not exists auth_user (
        id text primary key,
        email text not null unique,
        name text not null,
        password_hash text not null,
        role_code text not null check (role_code in ('owner','accountant','operator','viewer')),
        email_verified boolean not null default false,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table if not exists auth_session (
        id text primary key,
        user_id text not null references auth_user(id) on delete cascade,
        token_hash text not null unique,
        expires_at timestamptz not null,
        created_at timestamptz not null default now(),
        last_seen_at timestamptz not null default now()
      );

      create index if not exists auth_session_user_id_idx on auth_session(user_id);
      create index if not exists auth_session_expires_at_idx on auth_session(expires_at);

      create table if not exists auth_email_verification (
        id text primary key,
        user_id text not null references auth_user(id) on delete cascade,
        email text not null,
        token_hash text not null unique,
        expires_at timestamptz not null,
        created_at timestamptz not null default now()
      );

      create table if not exists auth_workspace (
        id text primary key,
        name text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table if not exists auth_workspace_member (
        workspace_id text not null references auth_workspace(id) on delete cascade,
        user_id text not null references auth_user(id) on delete cascade,
        role_code text not null check (role_code in ('owner','accountant','operator','viewer')),
        created_at timestamptz not null default now(),
        primary key (workspace_id, user_id)
      );

      create unique index if not exists auth_workspace_member_one_workspace_per_user_idx
        on auth_workspace_member(user_id);
      create index if not exists auth_workspace_member_workspace_id_idx
        on auth_workspace_member(workspace_id);

      insert into auth_workspace (id, name, created_at, updated_at)
      values ('default', 'MPFlow', now(), now())
      on conflict (id) do nothing;
    `);
    await this.migrateVerifiedUsersWithoutWorkspace();
  }

  private async migrateVerifiedUsersWithoutWorkspace() {
    const { rows: users } = await this.pool.query<{ id: string; email: string; role_code: AuthPrincipal["roleCode"] }>(
      `select id, email, role_code
       from auth_user u
       where email_verified = true
         and not exists (select 1 from auth_workspace_member m where m.user_id = u.id)
       order by created_at, id`
    );
    if (users.length === 0) return;

    const defaultMember = await this.pool.query<{ exists: boolean }>(
      "select exists(select 1 from auth_workspace_member where workspace_id = $1) as exists",
      [DEFAULT_AUTH_WORKSPACE_ID]
    );
    const allowedDefaultEmails = bootstrapEmails();
    const defaultUser = defaultMember.rows[0]?.exists
      ? undefined
      : users.find((user) => allowedDefaultEmails.has(normalizeEmail(user.email))) ?? users[0];

    for (const user of users) {
      const workspaceId = user.id === defaultUser?.id ? DEFAULT_AUTH_WORKSPACE_ID : this.newWorkspaceId();
      const workspaceName = workspaceId === DEFAULT_AUTH_WORKSPACE_ID ? "MPFlow" : user.email;
      await this.createWorkspaceMembership(this.pool, {
        id: user.id,
        email: user.email,
        roleCode: "owner"
      }, workspaceId, workspaceName);
    }
  }

  private async ensureWorkspaceMembership(source: Pool | PoolClient, user: { id: string; email: string; roleCode: AuthPrincipal["roleCode"] }) {
    const existing = await source.query<{ workspace_id: string; role_code: AuthPrincipal["roleCode"] }>(
      `select workspace_id, role_code
       from auth_workspace_member
       where user_id = $1
       order by created_at
       limit 1`,
      [user.id]
    );
    const row = existing.rows[0];
    if (row) return { workspaceId: row.workspace_id, roleCode: row.role_code };

    const memberCount = await source.query<{ count: string }>("select count(*)::text as count from auth_workspace_member");
    const workspaceId = Number(memberCount.rows[0]?.count ?? "0") === 0 ? DEFAULT_AUTH_WORKSPACE_ID : this.newWorkspaceId();
    const workspaceName = workspaceId === DEFAULT_AUTH_WORKSPACE_ID ? "MPFlow" : user.email;
    return await this.createWorkspaceMembership(source, {
      id: user.id,
      email: user.email,
      roleCode: "owner"
    }, workspaceId, workspaceName);
  }

  private async createWorkspaceMembership(
    source: Pool | PoolClient,
    user: { id: string; email: string; roleCode: AuthPrincipal["roleCode"] },
    workspaceId: string,
    workspaceName: string
  ) {
    await source.query(
      `insert into auth_workspace (id, name, created_at, updated_at)
       values ($1, $2, now(), now())
       on conflict (id) do update set name = excluded.name, updated_at = now()`,
      [workspaceId, workspaceName]
    );
    await source.query(
      `insert into auth_workspace_member (workspace_id, user_id, role_code, created_at)
       values ($1, $2, $3, now())
       on conflict (user_id) do update set
         workspace_id = excluded.workspace_id,
         role_code = excluded.role_code`,
      [workspaceId, user.id, user.roleCode]
    );
    return { workspaceId, roleCode: user.roleCode };
  }

  private newWorkspaceId() {
    return `workspace_${randomBytes(12).toString("base64url")}`;
  }

  private async createVerification(email: string, userId: string, name: string) {
    const token = randomToken();
    await this.pool.query("delete from auth_email_verification where user_id = $1", [userId]);
    await this.pool.query(
      `insert into auth_email_verification (id, user_id, email, token_hash, expires_at)
       values ($1, $2, $3, $4, now() + interval '24 hours')`,
      [id("email_verification"), userId, email, hashToken(token)]
    );

    const verifyUrl = `${publicAppUrl()}/verify-email?token=${encodeURIComponent(token)}`;
    await sendVerificationEmail({ email, name, verifyUrl });
  }
}

export function createAuthMiddleware(auth: AuthService) {
  return async (c: Context, next: Next) => {
    if (!authRequired()) return next();
    if (isPublicPath(c.req.path)) return next();

    const session = await auth.session(c);
    if (!session) {
      return c.json({ ok: false, error: { code: "auth_required", message: "Требуется вход в систему" } }, 401);
    }

    const method = c.req.method.toUpperCase();
    if (session.roleCode === "viewer" && !["GET", "HEAD", "OPTIONS"].includes(method)) {
      return c.json({ ok: false, error: { code: "forbidden", message: "У пользователя только просмотр" } }, 403);
    }
    if (isOwnerPath(c.req.path) && session.roleCode !== "owner") {
      return c.json({ ok: false, error: { code: "forbidden", message: "Доступно только владельцу" } }, 403);
    }

    c.set("authUser", publicUser(session));
    return next();
  };
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

export function ensureAppUser(app: AccountingApp, input: AuthPrincipal & { status: "invited" | "active" | "disabled" }) {
  if (!app.state.organization) {
    return null;
  }
  const existing = app.state.users.find((candidate) => candidate.email.toLowerCase() === input.email.toLowerCase());
  const organizationId = app.state.organization.id;
  if (existing) {
    existing.name = input.name;
    existing.roleCode = input.roleCode;
    existing.status = input.status;
    existing.lastActiveAt = input.status === "active" ? nowIso() : existing.lastActiveAt;
    return existing;
  }
  const placeholder = app.state.users.find((candidate) =>
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
  app.state.users.push(user);
  return user;
}

function isPublicPath(path: string) {
  return path === "/api/health" ||
    path === "/api/health/live" ||
    path === "/api/health/ready" ||
    path === "/api/auth/setup" ||
    path === "/api/auth/signup" ||
    path === "/api/auth/login" ||
    path === "/api/auth/verify-email" ||
    path === "/api/auth/resend";
}

function isOwnerPath(path: string) {
  return path.startsWith("/api/settings/users") ||
    path.startsWith("/api/agent-tokens") ||
    path.includes("/agent-permission");
}

function authRequired() {
  return process.env.AUTH_REQUIRED === "true" || process.env.NODE_ENV === "production";
}

function publicSignupEnabled() {
  const value = process.env.ACCOUNTING_AUTH_PUBLIC_SIGNUP?.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(value ?? "") && saasWorkspacesEnabled();
}

function saasWorkspacesEnabled() {
  const value = process.env.ACCOUNTING_SAAS_WORKSPACES_ENABLED?.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(value ?? "");
}

function bootstrapEmails() {
  return new Set(
    (process.env.ACCOUNTING_AUTH_BOOTSTRAP_EMAILS ?? "")
      .split(",")
      .map((value) => normalizeEmail(value))
      .filter(Boolean)
  );
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(password, salt, 64).toString("base64url");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password: string, encoded: string) {
  const [scheme, salt, hash] = encoded.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const actual = Buffer.from(scryptSync(password, salt, 64).toString("base64url"));
  const expected = Buffer.from(hash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function randomToken() {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function setSessionCookie(c: Context, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS
  });
}

function publicAppUrl() {
  return process.env.PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? `http://127.0.0.1:${process.env.PORT ?? "3004"}`;
}

function emailDeliveryMode() {
  if (process.env.ACCOUNTING_EMAIL_PROVIDER === "smtp" || process.env.ACCOUNTING_AUTH_SMTP_HOST) return "smtp";
  return process.env.NODE_ENV === "production" ? "missing" : "log";
}

async function sendVerificationEmail(input: { email: string; name: string; verifyUrl: string }) {
  if (process.env.ACCOUNTING_EMAIL_PROVIDER && process.env.ACCOUNTING_EMAIL_PROVIDER !== "smtp") {
    throw new Error(`ACCOUNTING_EMAIL_PROVIDER=${process.env.ACCOUNTING_EMAIL_PROVIDER} пока не поддержан в коде`);
  }

  const host = process.env.ACCOUNTING_AUTH_SMTP_HOST?.trim();
  const from = process.env.ACCOUNTING_AUTH_EMAIL_FROM?.trim();
  if (!host || !from) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Email transport is required in production");
    }
    console.warn(`[auth:mail] verification email for ${input.email}`);
    console.warn(`[auth:mail] ${input.verifyUrl}`);
    return;
  }

  const port = Number(process.env.ACCOUNTING_AUTH_SMTP_PORT ?? 587);
  const secure = process.env.ACCOUNTING_AUTH_SMTP_SECURE === "true" || port === 465;
  const user = process.env.ACCOUNTING_AUTH_SMTP_USER?.trim();
  const pass = process.env.ACCOUNTING_AUTH_SMTP_PASS;
  const ignoreTLS = process.env.ACCOUNTING_AUTH_SMTP_IGNORE_TLS === "true";

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    ignoreTLS,
    auth: user && pass ? { user, pass } : undefined
  });

  await transporter.sendMail({
    from,
    to: input.email,
    subject: "MPFlow: подтвердите email",
    text: [
      `Здравствуйте, ${input.name}.`,
      "",
      "Подтвердите email, чтобы завершить вход в MPFlow.",
      "",
      input.verifyUrl
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
        <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#0369a1;font-weight:700">MPFlow</div>
        <h1 style="font-size:24px;line-height:1.3;margin:16px 0 12px">Подтвердите email</h1>
        <p style="font-size:15px;line-height:1.7;margin:0 0 24px;color:#334155">Откройте ссылку ниже, чтобы завершить вход в MPFlow.</p>
        <p style="margin:0 0 24px"><a href="${escapeHtml(input.verifyUrl)}" style="display:inline-block;background:#0369a1;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600">Подтвердить email</a></p>
        <p style="font-size:13px;line-height:1.6;color:#64748b;margin:0">Если кнопка не сработала, откройте ссылку вручную:</p>
        <p style="font-size:13px;line-height:1.6;word-break:break-all;color:#0f172a;margin:8px 0 0">${escapeHtml(input.verifyUrl)}</p>
      </div>
    `
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
