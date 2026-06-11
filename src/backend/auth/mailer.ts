import nodemailer from "nodemailer";

/**
 * Транспорт auth-писем: SMTP по ACCOUNTING_AUTH_SMTP_*, вне production без SMTP —
 * лог-режим (ссылка печатается в консоль backend). В production без SMTP — ошибка.
 * Вызывается из хуков better-auth (sendVerificationEmail / sendResetPassword).
 */
export interface AuthEmailInput {
  kind: "verify" | "reset";
  to: string;
  name: string;
  url: string;
}

export function emailDeliveryMode(): "smtp" | "log" | "missing" {
  if (process.env.ACCOUNTING_EMAIL_PROVIDER === "smtp" || process.env.ACCOUNTING_AUTH_SMTP_HOST) return "smtp";
  return process.env.NODE_ENV === "production" ? "missing" : "log";
}

export async function sendAuthEmail(input: AuthEmailInput) {
  if (process.env.ACCOUNTING_EMAIL_PROVIDER && process.env.ACCOUNTING_EMAIL_PROVIDER !== "smtp") {
    throw new Error(`ACCOUNTING_EMAIL_PROVIDER=${process.env.ACCOUNTING_EMAIL_PROVIDER} пока не поддержан в коде`);
  }

  const template = templates[input.kind];
  const host = process.env.ACCOUNTING_AUTH_SMTP_HOST?.trim();
  const from = process.env.ACCOUNTING_AUTH_EMAIL_FROM?.trim();
  if (!host || !from) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Email transport is required in production");
    }
    console.warn(`[auth:mail] ${input.kind} email for ${input.to}`);
    console.warn(`[auth:mail] ${input.url}`);
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
    to: input.to,
    subject: template.subject,
    text: [
      `Здравствуйте, ${input.name}.`,
      "",
      template.intro,
      "",
      input.url
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
        <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#0369a1;font-weight:700">MPFlow</div>
        <h1 style="font-size:24px;line-height:1.3;margin:16px 0 12px">${template.heading}</h1>
        <p style="font-size:15px;line-height:1.7;margin:0 0 24px;color:#334155">${template.intro}</p>
        <p style="margin:0 0 24px"><a href="${escapeHtml(input.url)}" style="display:inline-block;background:#0369a1;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600">${template.cta}</a></p>
        <p style="font-size:13px;line-height:1.6;color:#64748b;margin:0">Если кнопка не сработала, откройте ссылку вручную:</p>
        <p style="font-size:13px;line-height:1.6;word-break:break-all;color:#0f172a;margin:8px 0 0">${escapeHtml(input.url)}</p>
      </div>
    `
  });
}

const templates: Record<AuthEmailInput["kind"], { subject: string; heading: string; intro: string; cta: string }> = {
  verify: {
    subject: "MPFlow: подтвердите email",
    heading: "Подтвердите email",
    intro: "Откройте ссылку ниже, чтобы завершить вход в MPFlow.",
    cta: "Подтвердить email"
  },
  reset: {
    subject: "MPFlow: сброс пароля",
    heading: "Сброс пароля",
    intro: "Вы запросили сброс пароля в MPFlow. Откройте ссылку ниже, чтобы задать новый пароль. Если это были не вы — просто проигнорируйте письмо.",
    cta: "Задать новый пароль"
  }
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
