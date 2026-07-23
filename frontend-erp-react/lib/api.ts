// Axios client for the FastAPI backend.
//
// One shared instance owns cross-cutting HTTP concerns via interceptors:
// bearer-token injection, error normalisation to `ApiError`, and 401 → session
// drop. Callers get thin `apiGet/apiPost/...` helpers that resolve to the
// response body, so query/mutation functions read as plain data calls.
//
// The backend speaks camelCase JSON that already matches `lib/types.ts`, so
// request/response bodies pass through untouched.

import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
} from "axios"

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000"

const TOKEN_KEY = "scas-erp-token"

export function getToken(): string | null {
  if (typeof window === "undefined") return null
  return window.localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  if (typeof window !== "undefined") window.localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  if (typeof window !== "undefined") window.localStorage.removeItem(TOKEN_KEY)
}

// The AuthProvider registers a callback here so a 401 anywhere drops the session.
let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn
}

/** Normalized API failure — `status` is the HTTP code, `detail` a human message. */
export class ApiError extends Error {
  status: number
  detail: string
  constructor(status: number, detail: string) {
    super(detail)
    this.name = "ApiError"
    this.status = status
    this.detail = detail
  }
}

/** Pull a human message out of a FastAPI error body. */
function extractDetail(data: unknown, fallback: string): string {
  if (typeof data === "string" && data) return data
  if (data && typeof data === "object") {
    const detail = (data as { detail?: unknown }).detail ?? data
    if (typeof detail === "string") return detail
    // FastAPI validation errors come back as an array of {loc,msg,...}.
    if (Array.isArray(detail)) {
      return detail
        .map((d) => (d as { msg?: string })?.msg ?? JSON.stringify(d))
        .join("; ")
    }
    try {
      return JSON.stringify(detail)
    } catch {
      return fallback
    }
  }
  return fallback
}

export const http: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  // 304s are the backend's ETag path — axios must not treat them as failures.
  validateStatus: (status) => (status >= 200 && status < 300) || status === 304,
})

// --- request: attach the bearer token -------------------------------------
http.interceptors.request.use((config) => {
  const token = getToken()
  if (token) config.headers.set("Authorization", `Bearer ${token}`)
  return config
})

// --- response: normalise errors, drop the session on 401 -------------------
http.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (!axios.isAxiosError(error)) {
      return Promise.reject(
        new ApiError(0, error instanceof Error ? error.message : "Request failed"),
      )
    }
    const status = (error as AxiosError).response?.status ?? 0
    if (status === 401) {
      clearToken()
      onUnauthorized?.()
      return Promise.reject(
        new ApiError(401, "Your session has expired. Please sign in again."),
      )
    }
    if (!error.response) {
      // No response at all — the API is unreachable, not a 4xx/5xx.
      return Promise.reject(
        new ApiError(0, "Cannot reach the server. Is the API running?"),
      )
    }
    return Promise.reject(
      new ApiError(
        status,
        extractDetail(
          error.response.data,
          error.response.statusText || `Request failed (${status})`,
        ),
      ),
    )
  },
)

async function request<T>(config: AxiosRequestConfig): Promise<T> {
  const res = await http.request<T>(config)
  return res.data as T
}

export const apiGet = <T>(path: string, config?: AxiosRequestConfig) =>
  request<T>({ ...config, method: "GET", url: path })

export const apiPost = <T>(path: string, json?: unknown) =>
  request<T>({ method: "POST", url: path, data: json })

export const apiPut = <T>(path: string, json?: unknown) =>
  request<T>({ method: "PUT", url: path, data: json })

export const apiPatch = <T>(path: string, json?: unknown) =>
  request<T>({ method: "PATCH", url: path, data: json })

export const apiDelete = <T = void>(path: string) =>
  request<T>({ method: "DELETE", url: path })

/** Multipart upload (axios sets the multipart boundary Content-Type). */
export const apiUpload = <T>(path: string, form: FormData) =>
  request<T>({ method: "POST", url: path, data: form })

/** Fetch a binary blob (study-material download), with auth + 401 handling. */
export async function apiDownload(path: string): Promise<Blob> {
  return request<Blob>({ method: "GET", url: path, responseType: "blob" })
}

/** Human-readable message for a caught error — the ApiError detail, or a fallback. */
export function errMsg(err: unknown, fallback = "Something went wrong."): string {
  if (err instanceof ApiError) return err.detail
  if (err instanceof Error && err.message) return err.message
  return fallback
}

/**
 * Query-param value: anything nullish, empty, or an empty array is dropped so
 * it never reaches the URL (and never varies a React Query key).
 */
export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | (string | number)[]

/** Build a `?a=1&b=2` query string, skipping null/undefined/empty values. */
export function qs(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue
    if (Array.isArray(value)) {
      // Repeated key form (`?ids=a&ids=b`) — what FastAPI expects for a list.
      for (const item of value) search.append(key, String(item))
    } else {
      search.set(key, String(value))
    }
  }
  const str = search.toString()
  return str ? `?${str}` : ""
}

/** The envelope every paginated list endpoint returns. */
export interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

/** An empty page — a stable default so `data ?? EMPTY_PAGE` never re-renders. */
export const EMPTY_PAGE: Page<never> = Object.freeze({
  items: Object.freeze([]) as never[],
  total: 0,
  page: 1,
  pageSize: 0,
  totalPages: 1,
})

export function emptyPage<T>(): Page<T> {
  return EMPTY_PAGE as unknown as Page<T>
}

/**
 * A stable empty array for `data = EMPTY_ARRAY` defaults on non-paginated list
 * hooks (departments, courses, terms, ...). A fresh `[]` literal at a
 * destructuring default gets a new identity every render, which silently
 * defeats any `useMemo`/`useCallback` depending on it while the query is
 * still loading.
 */
export const EMPTY_ARRAY: never[] = Object.freeze([]) as never[]
