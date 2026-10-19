import { describe, expect, it } from "vitest"
import { todayLocal } from "./date"

describe("todayLocal", () => {
  it("formats the local calendar date, zero-padded", () => {
    expect(todayLocal(new Date(2026, 0, 5, 12, 0))).toBe("2026-01-05")
  })

  it("uses the local date just after local midnight, not the UTC one", () => {
    // 00:30 local — in any zone east of UTC this is still the previous day in
    // UTC, which is exactly the case toISOString() got wrong.
    expect(todayLocal(new Date(2026, 9, 19, 0, 30))).toBe("2026-10-19")
  })
})
