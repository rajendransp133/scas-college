import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios"
import { apiGet, apiPost, ApiError, getToken, http, setToken, setUnauthorizedHandler } from "./api"

/** Make every request fail with `status`, as the server would. */
function respondWith(status: number, data: unknown) {
  http.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const response = { status, data, statusText: "", headers: {}, config } as AxiosResponse
    throw new AxiosError("fail", String(status), config, null, response)
  }
}

describe("401 handling", () => {
  const onUnauthorized = vi.fn()
  const originalAdapter = http.defaults.adapter

  beforeEach(() => {
    localStorage.clear()
    onUnauthorized.mockReset()
    setUnauthorizedHandler(onUnauthorized)
  })
  afterEach(() => {
    http.defaults.adapter = originalAdapter
    setUnauthorizedHandler(null)
  })

  it("drops the session when the token we hold is rejected", async () => {
    setToken("tok-1")
    respondWith(401, { detail: "Token has been revoked" })
    await expect(apiGet("/auth/me")).rejects.toBeInstanceOf(ApiError)
    expect(getToken()).toBeNull()
    expect(onUnauthorized).toHaveBeenCalledOnce()
  })

  it("keeps a rotated token when an in-flight request on the old one 401s", async () => {
    setToken("old")
    http.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      // The password change lands (new token stored) while this request,
      // already sent with the old token, is in flight.
      setToken("new")
      const response = { status: 401, data: {}, statusText: "", headers: {}, config } as AxiosResponse
      throw new AxiosError("fail", "401", config, null, response)
    }
    await expect(apiGet("/students")).rejects.toBeInstanceOf(ApiError)
    expect(getToken()).toBe("new")
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it("a wrong password at login surfaces the server's message, not 'session expired'", async () => {
    respondWith(401, { detail: "Invalid email or password" })
    await expect(apiPost("/auth/login", { email: "a@b.c", password: "x" })).rejects.toMatchObject({
      status: 401,
      detail: "Invalid email or password",
    })
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
})
