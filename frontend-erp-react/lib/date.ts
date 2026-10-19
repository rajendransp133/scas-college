/**
 * Today's date as `YYYY-MM-DD` in the *browser's* timezone.
 *
 * Not `new Date().toISOString().slice(0, 10)`: that is the UTC date, which for
 * an IST user is still yesterday until 05:30 — so the attendance date picker
 * defaulted to, and capped at, the previous day, and "Today ✓" checked the
 * wrong register. The server applies the same rule in the college's zone
 * (`services/util.py::today_local`).
 */
export function todayLocal(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}
