import { useQuery } from "@tanstack/react-query";
import { createAuthClient } from "better-auth/react";

/**
 * Клиент better-auth (same-origin): baseURL не указываем — в браузере он строится
 * от window.location.origin с basePath по умолчанию «/api/auth».
 * В dev vite-proxy перенаправляет /api на бекенд (см. vite.config.ts).
 */
export const authClient = createAuthClient();

export interface AuthSessionUser {
  id: string;
  email: string;
  name: string;
  emailVerified?: boolean;
}

export interface AuthSessionState {
  user: AuthSessionUser | null;
}

export const authSessionQueryKey = ["auth", "session"] as const;

/** Текущая сессия better-auth в форме `{ user }`; ошибка запроса трактуется как «не авторизован». */
export async function fetchAuthSession(): Promise<AuthSessionState> {
  const { data } = await authClient.getSession();
  return { user: data?.user ?? null };
}

export function useSessionQuery() {
  return useQuery({
    queryKey: authSessionQueryKey,
    retry: false,
    queryFn: fetchAuthSession
  });
}

export interface AuthClientError {
  code?: string;
  message?: string;
  status?: number;
  statusText?: string;
  /** Вложенная ошибка формата нашего API ({ ok: false, error: {...} }), напр. auth_unavailable. */
  error?: { code?: string; message?: string };
}

const AUTH_ERROR_FALLBACK = "Не удалось выполнить действие";

const AUTH_ERROR_TEXTS: Record<string, string> = {
  USER_ALREADY_EXISTS: "Пользователь с таким email уже зарегистрирован",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "Пользователь с таким email уже зарегистрирован",
  INVALID_EMAIL_OR_PASSWORD: "Неверный email или пароль",
  EMAIL_NOT_VERIFIED: "Email не подтверждён. Мы отправили новое письмо со ссылкой подтверждения.",
  PASSWORD_TOO_SHORT: "Пароль слишком короткий: минимум 8 символов",
  PASSWORD_TOO_LONG: "Пароль слишком длинный",
  INVALID_EMAIL: "Некорректный email",
  INVALID_PASSWORD: "Неверный пароль",
  INVALID_TOKEN: "Ссылка недействительна или уже использована. Запросите новую.",
  TOKEN_EXPIRED: "Срок действия ссылки истёк. Запросите новую.",
  USER_NOT_FOUND: "Пользователь не найден",
  USER_EMAIL_NOT_FOUND: "Пользователь с таким email не найден",
  EMAIL_ALREADY_VERIFIED: "Email уже подтверждён",
  CREDENTIAL_ACCOUNT_NOT_FOUND: "Для этого аккаунта не настроен вход по паролю",
  SESSION_EXPIRED: "Сессия истекла. Войдите заново.",
  FAILED_TO_CREATE_USER: "Не удалось создать пользователя",
  FAILED_TO_CREATE_SESSION: "Не удалось создать сессию"
};

/** Русский текст для ошибки better-auth: код → словарь, 429 → rate limit, иначе фоллбек. */
export function authErrorMessage(error: AuthClientError | null | undefined): string {
  if (!error) return AUTH_ERROR_FALLBACK;
  if (error.status === 429) return "Слишком много попыток. Подождите немного и повторите.";
  if (error.code && AUTH_ERROR_TEXTS[error.code]) return AUTH_ERROR_TEXTS[error.code];
  // Серверные хуки политики регистрации и DomainError присылают готовые русские тексты.
  const message = error.message ?? error.error?.message;
  if (message && /[а-яё]/i.test(message)) return message;
  return AUTH_ERROR_FALLBACK;
}
