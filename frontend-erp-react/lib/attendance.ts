// Single source of truth for attendance status semantics + percentage math.
// Every screen (marking, register, summary, profile, dashboard) routes through
// these helpers so the rules stay consistent.

import type { AttendanceStatus } from "@/lib/types"

export interface StatusMeta {
  value: AttendanceStatus
  label: string
  /** Short code shown in the register grid. */
  short: string
  /** Counts toward "attended" (numerator). */
  countsPresent: boolean
  /** Counts toward "held" (denominator). OD is excused → false. */
  countsHeld: boolean
  /** Tailwind classes for a Badge / cell. */
  badgeClass: string
}

export const ATTENDANCE_STATUSES: StatusMeta[] = [
  {
    value: "present",
    label: "Present",
    short: "P",
    countsPresent: true,
    countsHeld: true,
    badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  {
    value: "absent",
    label: "Absent",
    short: "A",
    countsPresent: false,
    countsHeld: true,
    badgeClass: "border-red-200 bg-red-50 text-red-700",
  },
  {
    value: "late",
    label: "Late",
    short: "L",
    countsPresent: true,
    countsHeld: true,
    badgeClass: "border-amber-200 bg-amber-50 text-amber-700",
  },
  {
    value: "od",
    label: "On Duty",
    short: "OD",
    countsPresent: false,
    countsHeld: false,
    badgeClass: "border-sky-200 bg-sky-50 text-sky-700",
  },
]

export const STATUS_META: Record<AttendanceStatus, StatusMeta> =
  ATTENDANCE_STATUSES.reduce(
    (acc, m) => {
      acc[m.value] = m
      return acc
    },
    {} as Record<AttendanceStatus, StatusMeta>,
  )

/** Default minimum attendance % for eligibility / shortfall flags. */
export const DEFAULT_MIN_ATTENDANCE = 75

/** Reduce a list of statuses to attended (present-equivalent) + held counts. */
export function tally(statuses: AttendanceStatus[]): {
  attended: number
  held: number
} {
  let attended = 0
  let held = 0
  for (const s of statuses) {
    const m = STATUS_META[s]
    if (!m) continue
    if (m.countsHeld) held += 1
    if (m.countsPresent) attended += 1
  }
  return { attended, held }
}

/**
 * Percentage to 2 decimal places, or null when nothing was held.
 *
 * The 2dp must match `services/analytics.py::_pct` exactly, because the same
 * student's figure is computed here on some pages (register, student detail)
 * and in SQL on others (`/attendance/summary`). Rounding to a whole number here
 * used to make them disagree at the only boundary anyone cares about: 74.6%
 * displayed as "75%" in passing colour on the profile, while the summary called
 * the same student a defaulter. The eligibility decision itself is the server's
 * (`attended * 100 < minPct * held`, no rounding at all) — this value must not
 * round its way past that.
 */
export function pct(attended: number, held: number): number | null {
  return held > 0 ? Math.round((attended / held) * 10000) / 100 : null
}

/**
 * Shared text color for a percentage against the minimum threshold:
 * comfortable → default, within 10 points below → amber, further → red.
 */
export function pctColor(
  p: number | null,
  threshold: number = DEFAULT_MIN_ATTENDANCE,
): string {
  if (p == null) return "text-muted-foreground"
  if (p >= threshold) return "text-foreground"
  if (p >= threshold - 10) return "text-amber-600"
  return "text-red-600"
}

/**
 * Minimal number of future classes a student must attend (all present) to reach
 * `threshold`% — assuming each adds to both attended and held. 0 if already met.
 */
export function classesNeeded(
  attended: number,
  held: number,
  threshold: number,
): number {
  const t = threshold / 100
  if (t >= 1) return Infinity
  if (held > 0 && attended / held >= t) return 0
  const k = Math.ceil((t * held - attended) / (1 - t))
  return Math.max(0, k)
}
