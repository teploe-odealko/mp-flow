import { emitAppAlert } from "./lib/app-alerts";

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly status?: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ApiRequestOptions {
  notifyOnError?: boolean;
}

async function unwrap<T>(response: Response, options: ApiRequestOptions = {}): Promise<T> {
  const payload = (await response.json()) as ApiResponse<T>;
  if (!payload.ok || !response.ok) {
    const error = new ApiError(
      payload.error?.code ?? "request_failed",
      payload.error?.message ?? "Ошибка запроса",
      payload.error?.details,
      response.status
    );
    if (options.notifyOnError !== false) {
      emitAppAlert({
        tone: "danger",
        title: "Не удалось выполнить действие",
        message: error.message
      });
    }
    throw error;
  }
  return payload.data as T;
}

export async function apiGet<T>(path: string, options?: ApiRequestOptions): Promise<T> {
  const response = await fetch(path, { credentials: "include" });
  return unwrap<T>(response, options);
}

export async function apiPost<T>(path: string, body: unknown = {}, options?: ApiRequestOptions): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body)
  });
  return unwrap<T>(response, options);
}

export async function apiPatch<T>(path: string, body: unknown = {}, options?: ApiRequestOptions): Promise<T> {
  const response = await fetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body)
  });
  return unwrap<T>(response, options);
}

export async function apiPut<T>(path: string, body: unknown = {}, options?: ApiRequestOptions): Promise<T> {
  const response = await fetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body)
  });
  return unwrap<T>(response, options);
}

export async function apiDelete<T>(path: string, options?: ApiRequestOptions): Promise<T> {
  const response = await fetch(path, { method: "DELETE", credentials: "include" });
  return unwrap<T>(response, options);
}

export { rub, qty, date, dateTime } from "./lib/format";
