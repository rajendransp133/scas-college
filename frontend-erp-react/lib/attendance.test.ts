import { describe, expect, it } from "vitest"
import {
  ATTENDANCE_STATUSES,
  classesNeeded,
  DEFAULT_MIN_ATTENDANCE,
  pct,
  pctColor,
  STATUS_META,
  tally,
} from "@/lib/attendance"
import type { AttendanceStatus } from "@/lib/types"

describe("STATUS_META / ATTENDANCE_STATUSES — status semantics table", () => {
  it("has exactly the four statuses", () => {
    expect(ATTENDANCE_STATUSES.map((m) => m.value).sort()).toEqual(
      ["absent", "late", "od", "present"].sort(),
    )
  })

  it("present counts toward both attended and held", () => {
    expect(STATUS_META.present.countsPresent).toBe(true)
    expect(STATUS_META.present.countsHeld).toBe(true)
  })

  it("late counts toward both attended and held (same as present)", () => {
    expect(STATUS_META.late.countsPresent).toBe(true)
    expect(STATUS_META.late.countsHeld).toBe(true)
  })

  it("absent counts toward held but not attended", () => {
    expect(STATUS_META.absent.countsPresent).toBe(false)
    expect(STATUS_META.absent.countsHeld).toBe(true)
  })

  it("od (on duty) is excused: counts toward neither attended nor held", () => {
    expect(STATUS_META.od.countsPresent).toBe(false)
    expect(STATUS_META.od.countsHeld).toBe(false)
  })
})

describe("tally()", () => {
  it("reduces a mixed array of statuses to attended/held counts", () => {
    const statuses: AttendanceStatus[] = [
      "present",
      "present",
      "absent",
      "late",
      "od",
      "od",
      "absent",
    ]
    // held = present(2) + late(1) + absent(2) = 5 (od excluded)
    // attended = present(2) + late(1) = 3
    expect(tally(statuses)).toEqual({ attended: 3, held: 5 })
  })

  it("returns zero/zero for an empty array", () => {
    expect(tally([])).toEqual({ attended: 0, held: 0 })
  })

  it("returns zero/zero when every status is od", () => {
    expect(tally(["od", "od", "od"])).toEqual({ attended: 0, held: 0 })
  })

  it("held equals length and attended equals zero when every status is absent", () => {
    expect(tally(["absent", "absent"])).toEqual({ attended: 0, held: 2 })
  })
})

describe("pct()", () => {
  it("is null when held is 0 (nothing was held)", () => {
    expect(pct(0, 0)).toBeNull()
  })

  it("computes a percentage to 2dp, matching the SQL in analytics.py", () => {
    expect(pct(3, 4)).toBe(75)
    expect(pct(1, 3)).toBe(33.33)
    expect(pct(2, 3)).toBe(66.67)
  })

  it("does not round its way over the eligibility threshold", () => {
    // 149/200 = 74.5%: a defaulter at the 75% bar. Rounding to a whole number
    // reported this as 75 and coloured it as passing, while the server's
    // unrounded `attended * 100 < minPct * held` counted the same student as
    // short. Both sides must agree on which side of the line this falls.
    expect(pct(149, 200)).toBe(74.5)
    expect(pctColor(pct(149, 200), 75)).toBe("text-amber-600")
  })

  it("is 100 when attended equals held", () => {
    expect(pct(5, 5)).toBe(100)
  })

  it("is 0 when attended is 0 but held is positive", () => {
    expect(pct(0, 5)).toBe(0)
  })
})

describe("pctColor()", () => {
  it("returns the muted color when p is null", () => {
    expect(pctColor(null)).toBe("text-muted-foreground")
  })

  it("returns the default foreground color at or above the threshold", () => {
    expect(pctColor(75, 75)).toBe("text-foreground") // exactly at threshold
    expect(pctColor(90, 75)).toBe("text-foreground") // comfortably above
  })

  it("returns amber within 10 points below the threshold", () => {
    expect(pctColor(74, 75)).toBe("text-amber-600") // 1 point below
    expect(pctColor(65, 75)).toBe("text-amber-600") // exactly 10 points below (boundary)
  })

  it("returns red further than 10 points below the threshold", () => {
    expect(pctColor(64, 75)).toBe("text-red-600") // 11 points below
    expect(pctColor(0, 75)).toBe("text-red-600")
  })

  it("uses DEFAULT_MIN_ATTENDANCE (75) when no threshold is passed", () => {
    expect(DEFAULT_MIN_ATTENDANCE).toBe(75)
    expect(pctColor(80)).toBe("text-foreground")
    expect(pctColor(70)).toBe("text-amber-600")
    expect(pctColor(50)).toBe("text-red-600")
  })
})

describe("classesNeeded()", () => {
  it("is 0 when already at/above the threshold", () => {
    expect(classesNeeded(8, 10, 75)).toBe(0) // 80% >= 75%
    expect(classesNeeded(75, 100, 75)).toBe(0) // exactly at threshold
  })

  it("computes the number of additional (all-present) classes needed", () => {
    // 5/10 = 50%; need k such that (5+k)/(10+k) >= 0.75 -> k = 10.
    expect(classesNeeded(5, 10, 75)).toBe(10)
    // verify by hand: after 10 more presents, 15/20 = 75% exactly.
    expect(pct(5 + 10, 10 + 10)).toBe(75)
  })

  it("is 0 when held is 0, even though pct() would be null", () => {
    expect(classesNeeded(0, 0, 75)).toBe(0)
  })

  it("is Infinity when the threshold is 100% or more", () => {
    expect(classesNeeded(5, 10, 100)).toBe(Infinity)
  })

  it("never returns a negative number", () => {
    expect(classesNeeded(10, 10, 75)).toBe(0)
  })
})
