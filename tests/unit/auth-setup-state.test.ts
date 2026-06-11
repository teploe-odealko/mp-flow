import type { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { authSetupState, bootstrapEmails } from "../../src/backend/auth/workspace";

const ENV_KEYS = [
  "ACCOUNTING_AUTH_PUBLIC_SIGNUP",
  "ACCOUNTING_SAAS_WORKSPACES_ENABLED",
  "ACCOUNTING_AUTH_BOOTSTRAP_EMAILS",
  "ACCOUNTING_EMAIL_PROVIDER",
  "ACCOUNTING_AUTH_SMTP_HOST"
] as const;

const previousEnv = new Map<string, string | undefined>(ENV_KEYS.map((key) => [key, process.env[key]]));

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) {
    const value = values[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

afterEach(() => {
  for (const [key, value] of previousEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

function poolWithVerifiedCount(verifiedCount: number) {
  return {
    query: async () => ({ rows: [{ verified_count: String(verifiedCount) }] })
  } as unknown as Pool;
}

describe("authSetupState", () => {
  it("без подтверждённых пользователей открывает owner-setup", async () => {
    setEnv({});
    const state = await authSetupState(poolWithVerifiedCount(0));
    expect(state).toEqual({
      signUpOpen: true,
      signUpMode: "owner",
      bootstrapEmailsConfigured: false,
      bootstrapEmailRequired: false,
      emailDeliveryMode: "log"
    });
  });

  it("owner-фаза со списком первого доступа требует bootstrap-email", async () => {
    setEnv({ ACCOUNTING_AUTH_BOOTSTRAP_EMAILS: "owner@example.com" });
    const state = await authSetupState(poolWithVerifiedCount(0));
    expect(state.signUpMode).toBe("owner");
    expect(state.bootstrapEmailsConfigured).toBe(true);
    expect(state.bootstrapEmailRequired).toBe(true);
  });

  it("после появления владельца регистрация закрыта без публичного signup", async () => {
    setEnv({});
    const state = await authSetupState(poolWithVerifiedCount(1));
    expect(state.signUpOpen).toBe(false);
    expect(state.signUpMode).toBe("user");
    expect(state.bootstrapEmailRequired).toBe(false);
  });

  it("публичный signup открывается только вместе с SaaS-workspaces", async () => {
    setEnv({ ACCOUNTING_AUTH_PUBLIC_SIGNUP: "true", ACCOUNTING_SAAS_WORKSPACES_ENABLED: "true" });
    expect((await authSetupState(poolWithVerifiedCount(1))).signUpOpen).toBe(true);

    setEnv({ ACCOUNTING_AUTH_PUBLIC_SIGNUP: "true" });
    expect((await authSetupState(poolWithVerifiedCount(1))).signUpOpen).toBe(false);

    setEnv({ ACCOUNTING_SAAS_WORKSPACES_ENABLED: "true" });
    expect((await authSetupState(poolWithVerifiedCount(1))).signUpOpen).toBe(false);
  });

  it("отдаёт smtp-режим доставки при настроенном SMTP", async () => {
    setEnv({ ACCOUNTING_AUTH_SMTP_HOST: "smtp.example.com" });
    expect((await authSetupState(poolWithVerifiedCount(0))).emailDeliveryMode).toBe("smtp");
  });
});

describe("bootstrapEmails", () => {
  it("нормализует список: регистр, пробелы, пустые элементы", () => {
    setEnv({ ACCOUNTING_AUTH_BOOTSTRAP_EMAILS: " Owner@Example.com ,, second@example.com " });
    expect(bootstrapEmails()).toEqual(new Set(["owner@example.com", "second@example.com"]));
  });

  it("пустая переменная даёт пустой список", () => {
    setEnv({});
    expect(bootstrapEmails()).toEqual(new Set());
  });
});
