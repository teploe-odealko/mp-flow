const BASE = ""

export async function api<T = any>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error || body.message || `HTTP ${res.status}`)
  }

  return res.json()
}

export const apiGet = <T = any>(path: string) => api<T>(path)
export const apiPost = <T = any>(path: string, body: any) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) })
export const apiPut = <T = any>(path: string, body: any) =>
  api<T>(path, { method: "PUT", body: JSON.stringify(body) })
export const apiDelete = <T = any>(path: string) =>
  api<T>(path, { method: "DELETE" })
