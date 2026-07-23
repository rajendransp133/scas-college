"""Convert the college's attendance spreadsheets into one bulk-upload CSV.

Reads the II/III YEAR attendance workbooks and emits `students.csv` in the
exact 15-column schema that `frontend-erp-react/components/students/
student-bulk-upload-dialog.tsx` (`CSV_COLUMNS`) already accepts. That one file
serves two consumers:

  - `backend-erp-fastapi/seed_production.py` reads it when seeding a fresh
    database, so a new deploy comes up with the real roster;
  - the Students page's bulk-upload dialog accepts it as-is, which is how the
    office adds students later without touching a script.

Only the register number, name, program and semester come from these sheets.
The daily attendance columns are deliberately ignored — this tool imports
*people*, not their marks.

    python tools/build_students_csv.py            # -> backend-erp-fastapi/students.csv
    python tools/build_students_csv.py --dry-run  # parse + report, write nothing

No third-party dependency: an .xlsx is a zip of XML, and the stdlib reads it
fine. openpyxl is not installed anywhere on the dev machine and pulling it in
for a one-off conversion would put it in requirements.txt (and so in the
production image) forever.

NOT the admission list. `SASC ADMISSION LIST.xlsx` has no register-number
column at all, and `roll_number` is required and immutable once a student
exists — so the 2026 intake waits until the college issues their numbers. When
it does, add a source entry here; the messy branch spellings in that file
("BLIT TAMIL", "B.SC(FT)", "M,COM") need a normalising map of their own.
"""

from __future__ import annotations

import argparse
import csv
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

REPO = Path(__file__).resolve().parent.parent
DEFAULT_OUT = REPO / "backend-erp-fastapi" / "students.csv"

# Workbook -> the semester its students sit in for term 2026-2027 (Odd).
# This mapping is what ties the output to a *specific* term: II YEAR students
# are in semester 3 of that term, III YEAR in semester 5. Re-running this for a
# later term without changing these numbers would leave everyone a year behind.
SOURCES = [
    ("II YEAR ATTENDANCE SHEET.xlsx", 3),
    ("III YEAR ATTENDANCE SHEET.xlsx", 5),
]

# Sheet name -> (departmentCode, programCode), matched EXACTLY.
# Exact and not prefix/substring: "B.SC PHY.EDU" starts with "B.SC PHY", so a
# prefix match would quietly file all 64 Physical Education students under
# Physics. Totals and semester splits both survive that swap, so it would only
# ever surface as a wrong class roster months later.
SHEET_MAP = {
    "B.LIT": ("TAM", "BA-TAM"),
    "BA ENG": ("ENG", "BA-ENG"),
    "BA DEFENCE": ("DS", "BA-DS"),
    "B.COM": ("COM", "BCOM"),
    "B.COM CA": ("COM-CA", "BCOM-CA"),
    "BBA": ("BA", "BBA"),
    "BCA": ("CA", "BCA"),
    "B.SC CS": ("CS", "BSC-CS"),
    "B.SC MAT": ("MAT", "BSC-MAT"),
    "B.SC MATHS": ("MAT", "BSC-MAT"),
    "B.SC PHY": ("PHY", "BSC-PHY"),
    "B.SC CHE": ("CHE", "BSC-CHE"),
    "B.SC PHY.EDU": ("PE", "BSC-PE"),
    "B.SC FT": ("FT", "BSC-FT"),
}

# A summary sheet of per-department present/absent counts, not a roster.
SKIP_SHEETS = {"ABSTRACT"}

# Known-bad rows in the current spreadsheets: a student name with no register
# number. Asserted so that a parser regression which silently drops rows fails
# loudly instead of just reporting a different number nobody checks.
EXPECTED_REJECTS = 5

COLUMNS = [
    "rollNumber", "name", "departmentCode", "programCode", "currentSemester",
    "admissionYear", "gender", "email", "phone", "dateOfBirth", "address",
    "guardianName", "guardianRelation", "guardianPhone", "isActive",
]

M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PKG = "{http://schemas.openxmlformats.org/package/2006/relationships}"


def open_workbook(path: Path) -> dict[str, list[dict[str, str]]]:
    """Read every sheet into {name: [ {column_letter: text}, ... ]}."""
    z = zipfile.ZipFile(path)

    shared: list[str] = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(M + "si"):
            shared.append("".join(t.text or "" for t in si.iter(M + "t")))

    rels = {
        rel.get("Id"): rel.get("Target")
        for rel in ET.fromstring(
            z.read("xl/_rels/workbook.xml.rels")
        ).iter(PKG + "Relationship")
    }

    sheets: dict[str, list[dict[str, str]]] = {}
    for s in ET.fromstring(z.read("xl/workbook.xml")).iter(M + "sheet"):
        target = rels[s.get(R + "id")].lstrip("/")
        if not target.startswith("xl/"):
            target = "xl/" + target
        sheets[s.get("name")] = _read_sheet(z.read(target), shared)
    return sheets


def _read_sheet(blob: bytes, shared: list[str]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for row in ET.fromstring(blob).iter(M + "row"):
        cells: dict[str, str] = {}
        for c in row.iter(M + "c"):
            column = "".join(ch for ch in (c.get("r") or "") if ch.isalpha())
            v, inline = c.find(M + "v"), c.find(M + "is")
            if c.get("t") == "s" and v is not None:
                value = shared[int(v.text)]
            elif inline is not None:
                value = "".join(t.text or "" for t in inline.iter(M + "t"))
            elif v is not None:
                value = v.text
            else:
                value = None
            if value:
                cells[column] = str(value)
        rows.append(cells)
    return rows


def find_header(rows: list[dict[str, str]]) -> tuple[int, str, str]:
    """Locate the header row and the register/name columns.

    Both are found by content rather than position: the sheets carry a title
    block of one to three lines above the header, and the columns land on B/C
    in most sheets but C/D in others.
    """
    for i, row in enumerate(rows):
        joined = " ".join(row.values()).upper()
        if "REG" in joined and "NAME" in joined:
            reg = next((c for c, v in row.items() if "REG" in v.upper()), None)
            name = next((c for c, v in row.items() if "NAME" in v.upper()), None)
            if reg and name:
                return i, reg, name
    raise ValueError("no header row containing both REG and NAME")


def convert(strict: bool = False) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    students: list[dict[str, str]] = []
    rejects: list[dict[str, str]] = []
    per_class: dict[tuple[str, int], int] = {}

    for filename, semester in SOURCES:
        path = REPO / filename
        if not path.exists():
            sys.exit(f"error: missing source workbook {path}")

        book = open_workbook(path)
        kept = 0
        for sheet_name, rows in book.items():
            if sheet_name.strip().upper() in SKIP_SHEETS:
                continue
            key = sheet_name.strip().upper()
            if key not in SHEET_MAP:
                sys.exit(
                    f"error: {filename} sheet {sheet_name!r} has no program "
                    f"mapping. Add it to SHEET_MAP — refusing to guess."
                )
            dept_code, prog_code = SHEET_MAP[key]

            header, reg_col, name_col = find_header(rows)
            for offset, row in enumerate(rows[header + 1:], start=header + 2):
                name = (row.get(name_col) or "").strip()
                # Excel marks long numeric text with a leading apostrophe.
                reg = (row.get(reg_col) or "").strip().lstrip("'").strip()
                if not name and not reg:
                    continue  # trailing blank row
                if not reg or not name:
                    rejects.append({
                        "file": filename, "sheet": sheet_name, "row": str(offset),
                        "rollNumber": reg, "name": name,
                        "reason": "no register number" if name else "no name",
                    })
                    continue

                students.append({
                    "rollNumber": reg,
                    "name": name,
                    "departmentCode": dept_code,
                    "programCode": prog_code,
                    "currentSemester": str(semester),
                    # First two digits of the register number are the intake
                    # year: 25 -> 2025 (now in semester 3), 24 -> 2024 (sem 5).
                    "admissionYear": str(2000 + int(reg[:2])) if reg[:2].isdigit() else "",
                    "gender": "", "email": "", "phone": "", "dateOfBirth": "",
                    "address": "", "guardianName": "", "guardianRelation": "",
                    "guardianPhone": "", "isActive": "",
                })
                kept += 1
                per_class[(prog_code, semester)] = per_class.get((prog_code, semester), 0) + 1

        print(f"  {filename}: semester {semester} -> {kept} students")

    seen: dict[str, str] = {}
    for s in students:
        if s["rollNumber"] in seen:
            sys.exit(
                f"error: duplicate register number {s['rollNumber']} "
                f"({seen[s['rollNumber']]} and {s['name']})"
            )
        seen[s["rollNumber"]] = s["name"]

    print("\n  per class:")
    for (prog, sem), n in sorted(per_class.items()):
        print(f"    {prog:<8} sem {sem}  {n:>4}")
    print(f"\n  total: {len(students)} students, {len(rejects)} rejected")

    if len(rejects) != EXPECTED_REJECTS:
        message = (
            f"expected {EXPECTED_REJECTS} rejected rows, got {len(rejects)} — "
            f"the spreadsheets changed or the parser regressed"
        )
        if strict:
            sys.exit(f"error: {message}")
        print(f"  WARNING: {message}")

    return students, rejects


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--dry-run", action="store_true", help="report only, write nothing")
    ap.add_argument("--strict", action="store_true", help="exit non-zero if any row is rejected")
    args = ap.parse_args()

    print("Reading attendance workbooks:")
    students, rejects = convert(strict=args.strict)

    if rejects:
        print(
            "\n  These students have a name but no register number, so they "
            "cannot be\n  imported (roll number is required and unique). The "
            "office needs to\n  supply their numbers; add them through the app "
            "afterwards:"
        )
        for r in rejects:
            print(f"    {r['file'][:3]} {r['sheet']:<10} row {r['row']:<4} {r['name']}")

    if args.dry_run:
        print("\n--dry-run: nothing written")
        return

    args.out.parent.mkdir(parents=True, exist_ok=True)
    # Plain utf-8, NOT utf-8-sig: lib/export.ts::parseCsv does no BOM stripping,
    # so a BOM turns the first header into "﻿rollnumber" and the upload
    # dialog rejects a perfectly good file with "missing required column".
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(students)
    print(f"\n  wrote {args.out}  ({len(students)} students)")

    if rejects:
        rej = args.out.with_name("students-rejected.csv")
        with open(rej, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(
                f, fieldnames=["file", "sheet", "row", "rollNumber", "name", "reason"]
            )
            w.writeheader()
            w.writerows(rejects)
        print(f"  wrote {rej}  ({len(rejects)} rejected)")

    if args.strict and rejects:
        sys.exit(1)


if __name__ == "__main__":
    main()
