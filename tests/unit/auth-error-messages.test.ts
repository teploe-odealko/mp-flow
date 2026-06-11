import { describe, expect, it } from "vitest";
import { authErrorMessage } from "../../src/frontend/lib/auth-client";

describe("authErrorMessage", () => {
  it("локализует известные коды better-auth", () => {
    expect(authErrorMessage({ code: "USER_ALREADY_EXISTS", message: "User already exists.", status: 422 }))
      .toBe("Пользователь с таким email уже зарегистрирован");
    expect(authErrorMessage({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password", status: 401 }))
      .toBe("Неверный email или пароль");
    expect(authErrorMessage({ code: "EMAIL_NOT_VERIFIED", message: "Email not verified", status: 403 }))
      .toContain("Email не подтверждён");
    expect(authErrorMessage({ code: "PASSWORD_TOO_SHORT", message: "Password too short", status: 400 }))
      .toContain("минимум 8 символов");
    expect(authErrorMessage({ code: "TOKEN_EXPIRED", message: "Token expired", status: 400 }))
      .toContain("Срок действия ссылки истёк");
  });

  it("429 трактуется как rate limit независимо от кода", () => {
    expect(authErrorMessage({ status: 429, statusText: "Too Many Requests" }))
      .toBe("Слишком много попыток. Подождите немного и повторите.");
  });

  it("пропускает русские сообщения серверных хуков как есть", () => {
    expect(authErrorMessage({ message: "Самостоятельная регистрация временно закрыта.", status: 403 }))
      .toBe("Самостоятельная регистрация временно закрыта.");
    // Формат нашего API ({ ok: false, error: {...} }), напр. auth_unavailable в dev-режиме.
    expect(authErrorMessage({ status: 400, error: { code: "auth_unavailable", message: "Авторизация не настроена" } }))
      .toBe("Авторизация не настроена");
  });

  it("неизвестные коды и английские сообщения дают нейтральный фоллбек", () => {
    expect(authErrorMessage({ code: "SOMETHING_NEW", message: "Something new", status: 400 }))
      .toBe("Не удалось выполнить действие");
    expect(authErrorMessage(null)).toBe("Не удалось выполнить действие");
    expect(authErrorMessage(undefined)).toBe("Не удалось выполнить действие");
  });
});
