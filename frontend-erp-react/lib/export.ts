// Pure client-side CSV export. No backend.

// A cell whose text starts with one of these is evaluated as a formula by
// Excel / Sheets / LibreOffice. A student named `=HYPERLINK("http://…")` (or
// anything typed into a free-text field) would otherwise run in whoever opens
// the export. Numbers are passed as numbers and never guarded, so `-3` stays a
// number.
const FORMULA_TRIGGER = /^[=+\-@\t\r]/

function neutralise(cell: string | number): string {
  const s = String(cell ?? "")
  return typeof cell === "string" && FORMULA_TRIGGER.test(s) ? `'${s}` : s
}

/** Build a CSV string from rows of cells, quote-escaping as needed. */
export function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const s = neutralise(cell)
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        })
        .join(","),
    )
    .join("\n")
}

// Excel opens a BOM-less UTF-8 CSV as the system codepage, which garbles every
// non-ASCII name (Tamil script, accented Latin) in the export.
const UTF8_BOM = "﻿"

/** Trigger a browser download of `csv` as `filename`. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([UTF8_BOM, csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Parse a CSV string into rows of string cells. Handles quoted fields
 * (commas/newlines inside quotes, `""` as an escaped quote), both `\n` and
 * `\r\n` line endings, and a leading UTF-8 BOM (which our own exports — and
 * Excel's "CSV UTF-8" — write). Blank trailing lines are dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let inQuotes = false
  const src = text
    .replace(/^﻿/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")

  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cell += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ",") {
      row.push(cell)
      cell = ""
    } else if (c === "\n") {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ""
    } else {
      cell += c
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""))
}
