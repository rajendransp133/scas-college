"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  Download,
  FileWarning,
  Upload,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import type { Gender, Student } from "@/lib/types";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost, EMPTY_ARRAY, errMsg } from "@/lib/api";
import { useDepartments, usePrograms, useRollNumbers } from "@/lib/queries";
import { toCsv, downloadCsv, parseCsv } from "@/lib/export";

type Draft = Omit<Student, "id">;

/** Column schema for the CSV — drives the constraints table, the
 * downloadable template, and header matching on upload. */
const CSV_COLUMNS: {
  key: string;
  required: boolean;
  type: string;
  constraint: string;
}[] = [
  {
    key: "rollNumber",
    required: true,
    type: "text",
    constraint: "Unique across all students. Locked once created.",
  },
  {
    key: "name",
    required: true,
    type: "text",
    constraint: "Full name.",
  },
  {
    key: "departmentCode",
    required: true,
    type: "text",
    constraint: "Must match an existing department code (see below).",
  },
  {
    key: "programCode",
    required: true,
    type: "text",
    constraint: "Must match a program code within that department.",
  },
  {
    key: "currentSemester",
    required: true,
    type: "integer",
    constraint: "1–12.",
  },
  {
    key: "admissionYear",
    required: false,
    type: "integer",
    constraint: "2000–2100. Left unrecorded if blank.",
  },
  {
    key: "gender",
    required: false,
    type: "male / female / other",
    constraint: "Left unrecorded if blank.",
  },
  {
    key: "email",
    required: false,
    type: "email",
    constraint: 'Must contain "@" if provided.',
  },
  {
    key: "phone",
    required: false,
    type: "text",
    constraint: "—",
  },
  {
    key: "dateOfBirth",
    required: false,
    type: "date",
    constraint: "ISO format, YYYY-MM-DD.",
  },
  {
    key: "address",
    required: false,
    type: "text",
    constraint: "—",
  },
  {
    key: "guardianName",
    required: false,
    type: "text",
    constraint: "—",
  },
  {
    key: "guardianRelation",
    required: false,
    type: "text",
    constraint: "e.g. Father, Mother.",
  },
  {
    key: "guardianPhone",
    required: false,
    type: "text",
    constraint: "—",
  },
  {
    key: "isActive",
    required: false,
    type: "true / false",
    constraint: "Defaults to true if blank.",
  },
];

const GENDERS: Gender[] = ["male", "female", "other"];

type RowResult = {
  rowNumber: number;
  rollNumber: string;
  name: string;
  errors: string[];
  draft: Draft | null;
};

function normalizeHeader(h: string) {
  return h.trim().toLowerCase();
}

function parseBool(raw: string, fallback: boolean): boolean | null {
  const v = raw.trim().toLowerCase();
  if (v === "") return fallback;
  if (["true", "1", "yes"].includes(v)) return true;
  if (["false", "0", "no"].includes(v)) return false;
  return null;
}

export function StudentBulkUploadDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Only the roll numbers, and only while the dialog is open.
  const { data: existingRolls = EMPTY_ARRAY } = useRollNumbers(open);
  const { data: departments = EMPTY_ARRAY } = useDepartments();
  const { data: programs = EMPTY_ARRAY } = usePrograms();
  const queryClient = useQueryClient();

  const scrollRef = useRef<HTMLDivElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [rows, setRows] = useState<RowResult[]>([]);
  const [importing, setImporting] = useState(false);

  // Always start scrolled to the top when the dialog opens.
  useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [open]);

  const codeReference = useMemo(
    () =>
      departments.map((d) => ({
        code: d.code,
        name: d.name,
        programCodes: programs
          .filter((p) => p.departmentId === d.id)
          .map((p) => p.code),
      })),
    [departments, programs],
  );

  function reset() {
    setFileName(null);
    setHeaderError(null);
    setRows([]);
    setImporting(false);
  }

  function handleOpenChange(o: boolean) {
    if (!o) reset();
    onOpenChange(o);
  }

  function downloadTemplate() {
    const header = CSV_COLUMNS.map((c) => c.key);
    const sampleDept = departments[0];
    const sampleProgram = sampleDept
      ? programs.find((p) => p.departmentId === sampleDept.id)
      : undefined;
    const year = new Date().getFullYear();
    const example = [
      "BCA2026099",
      "Aarav Sharma",
      sampleDept?.code ?? "CS",
      sampleProgram?.code ?? "BCA",
      "1",
      String(year),
      "male",
      "aarav@example.edu",
      "9876543210",
      "2007-05-14",
      "123 MG Road, Chennai",
      "Suresh Sharma",
      "Father",
      "9876500000",
      "true",
    ];
    downloadCsv("student-upload-template.csv", toCsv([header, example]));
  }

  function handleFile(file: File) {
    setFileName(file.name);
    setHeaderError(null);
    setRows([]);

    const reader = new FileReader();
    reader.onerror = () => setHeaderError("Could not read the file.");
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const table = parseCsv(text);
      if (table.length === 0) {
        setHeaderError("The file is empty.");
        return;
      }

      const header = table[0].map(normalizeHeader);
      const missing = CSV_COLUMNS.filter(
        (c) => c.required && !header.includes(c.key.toLowerCase()),
      );
      if (missing.length > 0) {
        setHeaderError(
          `Missing required column(s): ${missing.map((c) => c.key).join(", ")}.`,
        );
        return;
      }

      const colIndex = (key: string) => header.indexOf(key.toLowerCase());
      const dataRows = table.slice(1);
      const seenRoll = new Set(existingRolls.map((r) => r.toLowerCase()));
      const seenInFile = new Set<string>();

      const results: RowResult[] = dataRows.map((cells, i) => {
        const get = (key: string) => {
          const idx = colIndex(key);
          return idx === -1 ? "" : (cells[idx] ?? "").trim();
        };
        const errors: string[] = [];

        const rollNumber = get("rollNumber");
        const name = get("name");
        if (!rollNumber) errors.push("Roll number is required.");
        else if (seenRoll.has(rollNumber.toLowerCase()))
          errors.push(`Roll number "${rollNumber}" already exists.`);
        else if (seenInFile.has(rollNumber.toLowerCase()))
          errors.push(`Duplicate roll number "${rollNumber}" in file.`);
        if (rollNumber) seenInFile.add(rollNumber.toLowerCase());

        if (!name) errors.push("Name is required.");

        const deptCode = get("departmentCode");
        const department = departments.find(
          (d) => d.code.toLowerCase() === deptCode.toLowerCase(),
        );
        if (!deptCode) errors.push("Department code is required.");
        else if (!department)
          errors.push(`Unknown department code "${deptCode}".`);

        const progCode = get("programCode");
        const program = department
          ? programs.find(
              (p) =>
                p.departmentId === department.id &&
                p.code.toLowerCase() === progCode.toLowerCase(),
            )
          : undefined;
        if (!progCode) errors.push("Program code is required.");
        else if (department && !program)
          errors.push(
            `Unknown program code "${progCode}" for department "${deptCode}".`,
          );

        const semRaw = get("currentSemester");
        const currentSemester = Number(semRaw);
        if (
          !semRaw ||
          !Number.isInteger(currentSemester) ||
          currentSemester < 1 ||
          currentSemester > 12
        )
          errors.push("currentSemester must be an integer between 1 and 12.");

        // Blank now means "not recorded" and is stored as null. These fields
        // used to be NOT NULL, so a blank cell had to be invented into
        // something (this year / "male"); guessing is worse than absent.
        const yearRaw = get("admissionYear");
        const admissionYear = yearRaw ? Number(yearRaw) : null;
        if (
          admissionYear !== null &&
          (!Number.isInteger(admissionYear) ||
            admissionYear < 2000 ||
            admissionYear > 2100)
        )
          errors.push(
            "admissionYear must be an integer between 2000 and 2100.",
          );

        const genderRaw = get("gender").toLowerCase();
        const gender = genderRaw ? (genderRaw as Gender) : null;
        if (gender && !GENDERS.includes(gender))
          errors.push('gender must be one of "male", "female", "other".');

        const email = get("email");
        if (email && !email.includes("@"))
          errors.push("email is not a valid email address.");

        const dateOfBirth = get("dateOfBirth");
        if (dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth))
          errors.push("dateOfBirth must be in YYYY-MM-DD format.");

        const activeRaw = get("isActive");
        const isActive = parseBool(activeRaw, true);
        if (isActive === null) errors.push("isActive must be true or false.");

        const draft: Draft | null =
          errors.length > 0
            ? null
            : {
                rollNumber,
                name,
                email: email || null,
                phone: get("phone") || null,
                address: get("address") || null,
                dateOfBirth: dateOfBirth || null,
                gender,
                departmentId: department!.id,
                programId: program!.id,
                currentSemester,
                admissionYear,
                guardianName: get("guardianName") || null,
                guardianRelation: get("guardianRelation") || null,
                guardianPhone: get("guardianPhone") || null,
                isActive: isActive ?? true,
              };

        return { rowNumber: i + 2, rollNumber, name, errors, draft };
      });

      setRows(results);
    };
    reader.readAsText(file);
  }

  const validRows = rows.filter((r) => r.draft);
  const invalidCount = rows.length - validRows.length;

  async function handleImport() {
    if (validRows.length === 0) return;
    setImporting(true);
    let imported = 0;
    let lastError = "";
    for (const r of validRows) {
      if (!r.draft) continue;
      try {
        await apiPost("/students", r.draft);
        imported++;
      } catch (err) {
        lastError = errMsg(err);
      }
    }
    // One refetch after the whole batch instead of per row.
    queryClient.invalidateQueries({ queryKey: ["students"] });
    setImporting(false);

    const rejected = validRows.length - imported + invalidCount;
    if (imported > 0) {
      toast.success(
        rejected > 0
          ? `Imported ${imported} student(s). Skipped ${rejected} row(s).`
          : `Imported ${imported} student(s).`,
      );
      handleOpenChange(false);
    } else {
      toast.error(lastError || "No students were imported.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Bulk upload students</DialogTitle>
          <DialogDescription>
            Review the schema below, download the template, fill it in, then
            upload it here.
          </DialogDescription>
        </DialogHeader>

        <div
          ref={scrollRef}
          className="flex min-w-0 max-h-[65vh] flex-col gap-6 overflow-x-hidden overflow-y-auto"
        >
          {/* Sticky topbar: download + upload, always visible while scrolling */}
          <div className="sticky top-0 z-10 -mx-4 flex flex-col gap-3 border-b bg-popover px-4 pt-1 pb-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="bulk-file"
                className="text-xs text-muted-foreground"
              >
                Upload filled CSV
              </Label>
              <Input
                id="bulk-file"
                type="file"
                accept=".csv"
                className="max-w-64"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              onClick={downloadTemplate}
            >
              <Download size={16} />
              Download CSV template
            </Button>
          </div>

          {/* Schema & constraints */}
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-muted-foreground">
              Column schema &amp; constraints
            </p>
            <div className="overflow-hidden rounded-lg border">
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-32">Column</TableHead>
                    <TableHead className="w-24">Required</TableHead>
                    <TableHead className="w-36">Type / format</TableHead>
                    <TableHead>Constraint</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {CSV_COLUMNS.map((c) => (
                    <TableRow key={c.key}>
                      <TableCell className="whitespace-normal font-mono text-xs break-words">
                        {c.key}
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        {c.required ? (
                          <Badge
                            variant="outline"
                            className="border-amber-200 bg-amber-50 text-amber-700"
                          >
                            Required
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Optional
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-normal text-xs text-muted-foreground break-words">
                        {c.type}
                      </TableCell>
                      <TableCell className="whitespace-normal text-xs text-muted-foreground break-words">
                        {c.constraint}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Valid department/program codes */}
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-muted-foreground">
              Valid department &amp; program codes
            </p>
            {codeReference.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No departments exist yet — create one before importing.
              </p>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-36">Department code</TableHead>
                      <TableHead className="w-48">Name</TableHead>
                      <TableHead>Program codes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {codeReference.map((d) => (
                      <TableRow key={d.code}>
                        <TableCell className="whitespace-normal font-mono text-xs break-words">
                          {d.code}
                        </TableCell>
                        <TableCell className="whitespace-normal text-xs text-muted-foreground break-words">
                          {d.name}
                        </TableCell>
                        <TableCell className="whitespace-normal font-mono text-xs text-muted-foreground break-words">
                          {d.programCodes.length > 0
                            ? d.programCodes.join(", ")
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          {/* Results */}
          {headerError ? (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <FileWarning size={16} className="shrink-0" />
              {headerError}
            </div>
          ) : null}

          {rows.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-muted-foreground">
                  Preview — {fileName}
                </p>
                <span className="text-xs text-muted-foreground">
                  <span className="text-emerald-600">
                    {validRows.length} valid
                  </span>
                  {" · "}
                  <span className={invalidCount > 0 ? "text-destructive" : ""}>
                    {invalidCount} invalid
                  </span>
                </span>
              </div>
              <div className="max-h-56 overflow-y-auto rounded-lg border">
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Row</TableHead>
                      <TableHead className="w-28">Roll No.</TableHead>
                      <TableHead className="w-32">Name</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.rowNumber}>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.rowNumber}
                        </TableCell>
                        <TableCell className="whitespace-normal font-mono text-xs break-words">
                          {r.rollNumber || "—"}
                        </TableCell>
                        <TableCell className="whitespace-normal text-xs break-words">
                          {r.name || "—"}
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          {r.errors.length === 0 ? (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                              <CheckCircle2 size={14} />
                              OK
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-start gap-1 text-xs break-words text-destructive"
                              title={r.errors.join(" ")}
                            >
                              <XCircle size={14} className="mt-0.5 shrink-0" />
                              {r.errors.join(" ")}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={validRows.length === 0 || importing}
            onClick={handleImport}
          >
            <Upload size={16} />
            {importing ? "Importing…" : `Import ${validRows.length} student(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
