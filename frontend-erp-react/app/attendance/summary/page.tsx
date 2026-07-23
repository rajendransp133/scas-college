"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronRight,
  Download,
  Printer,
  Search,
  Users,
} from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/select-field";
import {
  useAttendanceSummary,
  useCourses,
  usePrograms,
  useSemesters,
  useSettings,
  useTerms,
  type AttendanceSummaryRow,
} from "@/lib/queries";
import { apiGet, EMPTY_ARRAY, qs, type Page } from "@/lib/api";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { usePagination } from "@/hooks/use-pagination";
import { SummaryBreakdown } from "@/components/attendance/summary-breakdown";
import { useAuth } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { TableRowsSkeleton } from "@/components/ui/table-skeleton";
import {
  DEFAULT_MIN_ATTENDANCE,
  classesNeeded,
  pctColor,
} from "@/lib/attendance";
import { downloadCsv, toCsv } from "@/lib/export";
import { semesterInSession } from "@/lib/types";

const PAGE_SIZE = 25;

export default function AttendanceSummaryPage() {
  const { role, departmentId, classScope, ownCourseIds } = useAuth();
  const { data: programs = EMPTY_ARRAY } = usePrograms();
  const { data: courses = EMPTY_ARRAY } = useCourses();
  const { data: terms = EMPTY_ARRAY } = useTerms();
  const { data: settings } = useSettings();
  const currentTermId = settings?.currentTermId ?? "";

  const currentTerm = useMemo(
    () => terms.find((t) => t.id === currentTermId),
    [terms, currentTermId],
  );

  // Student reps are locked to their own class (program + semester) — no
  // browsing other semesters; teachers pick from class chips instead of the
  // generic program/semester selects.
  const isRep = role === "student-rep";
  const isTeacher = role === "teacher";

  const [programId, setProgramId] = useState(
    isRep ? (classScope?.programId ?? "") : "",
  );
  const [semesterId, setSemesterId] = useState("");
  const [search, setSearch] = useState("");
  const [defaultersOnly, setDefaultersOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: semesters = EMPTY_ARRAY } = useSemesters(programId);

  // Rep's semester resolves once its program's semesters load.
  const repSemesterId = isRep
    ? (semesters.find(
        (s) =>
          s.programId === classScope?.programId &&
          s.number === classScope?.semester,
      )?.id ?? "")
    : "";
  useEffect(() => {
    if (isRep && repSemesterId && !semesterId) setSemesterId(repSemesterId);
  }, [isRep, repSemesterId, semesterId]);

  // The college's minimum attendance is a fixed rule (75%), not a per-viewer
  // preference — it's shown, never asked for, so every page and every export
  // agrees on who is detained.
  const threshold = DEFAULT_MIN_ATTENDANCE;

  // Flat index of every course for labeling + program/semester lookup.
  const courseIndex = useMemo(
    () => Object.fromEntries(courses.map((c) => [c.id, c])),
    [courses],
  );

  // One chip per class the teacher takes this term ("BCA Sem 3"), replacing
  // the generic program/semester selects for the teacher role.
  const teacherClassChips = useMemo(() => {
    if (!isTeacher) return [];
    const seen = new Set<string>();
    const chips: { programId: string; semesterId: string; label: string }[] = [];
    for (const courseId of ownCourseIds(currentTermId)) {
      const ref = courseIndex[courseId];
      if (!ref) continue;
      const key = `${ref.programId}:${ref.semesterNumber}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const prog = programs.find((p) => p.id === ref.programId);
      chips.push({
        programId: ref.programId,
        semesterId: ref.semesterId,
        label: `${prog?.code ?? "—"} Sem ${ref.semesterNumber}`,
      });
    }
    return chips.sort((a, b) => a.label.localeCompare(b.label));
  }, [isTeacher, ownCourseIds, currentTermId, courseIndex, programs]);

  // Cascading selectors (admin/principal/attendance-manager/HOD only — HODs
  // are scoped to their own department's programs).
  const programOptions = useMemo(
    () =>
      programs
        .filter((p) => role !== "hod" || p.departmentId === departmentId)
        .map((p) => ({ value: p.id, label: `${p.name} (${p.code})` })),
    [programs, role, departmentId],
  );
  // Only semesters in session for the current term's parity are listed.
  const semesterOptions = useMemo(
    () =>
      semesters
        .filter(
          (s) =>
            s.programId === programId &&
            semesterInSession(s.number, currentTerm),
        )
        .sort((a, b) => a.number - b.number)
        .map((s) => ({ value: s.id, label: `Semester ${s.number}` })),
    [semesters, programId, currentTerm],
  );
  const selectedSemNumber = useMemo(
    () => semesters.find((s) => s.id === semesterId)?.number ?? null,
    [semesters, semesterId],
  );

  const programById = useMemo(
    () => Object.fromEntries(programs.map((p) => [p.id, p])),
    [programs],
  );

  // The filename says which class and term the sheet covers, so a folder of
  // exports stays sortable instead of being attendance-summary(3).csv.
  const exportFilename = useMemo(() => {
    const slug = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const parts = ["attendance-summary"];
    const prog = programId ? programById[programId] : undefined;
    if (prog) parts.push(slug(prog.code));
    if (selectedSemNumber !== null) parts.push(`sem${selectedSemNumber}`);
    if (currentTerm) parts.push(`${currentTerm.startYear}-${currentTerm.parity}`);
    if (defaultersOnly) parts.push("defaulters");
    return `${parts.join("-")}.csv`;
  }, [programId, programById, selectedSemNumber, currentTerm, defaultersOnly]);

  // Static class label shown to the rep in place of the selects.
  const repClassLabel = useMemo(() => {
    if (!isRep || !classScope) return "";
    const prog = programs.find((p) => p.id === classScope.programId);
    return `${prog?.name ?? "—"} (${prog?.code ?? "—"}) · Semester ${classScope.semester}`;
  }, [isRep, classScope, programs]);

  const debouncedSearch = useDebouncedValue(search.trim(), 300);

  // Any filter change puts us back on page 1.
  const [page, setPage] = usePagination(
    JSON.stringify([
      debouncedSearch,
      programId,
      semesterId,
      defaultersOnly,
      threshold,
      currentTermId,
    ]),
  );

  // A teacher with no class chip selected sees exactly the courses they teach;
  // everyone else is scoped by program/semester (and HODs by department).
  const teacherCourseIds = useMemo(
    () =>
      isTeacher && !programId ? Array.from(ownCourseIds(currentTermId)) : undefined,
    [isTeacher, programId, ownCourseIds, currentTermId],
  );

  // Everything below is computed by the database: the per-student tally, the
  // as-marked comparison, the defaulter filter and the totals.
  const summaryFilters = useMemo(
    () => ({
      termId: currentTermId || undefined,
      programId: programId || undefined,
      semester: selectedSemNumber ?? undefined,
      courseIds: teacherCourseIds,
      departmentId: role === "hod" ? (departmentId ?? undefined) : undefined,
      search: debouncedSearch || undefined,
      minPct: threshold,
      defaultersOnly,
      page,
      pageSize: PAGE_SIZE,
    }),
    [
      currentTermId,
      programId,
      selectedSemNumber,
      teacherCourseIds,
      role,
      departmentId,
      debouncedSearch,
      threshold,
      defaultersOnly,
      page,
    ],
  );

  const { data, isLoading, isFetching, isPlaceholderData } =
    useAttendanceSummary(summaryFilters, !!currentTermId);

  const displayed = useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const shortfallCount = data?.totals.defaulters ?? 0;

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** A row's eligibility verdict — left/graduated students are historical
   *  traces, not live shortfalls, so they get no verdict. */
  const verdictOf = useCallback(
    (r: AttendanceSummaryRow) => {
      const left = !r.isActive || r.graduated;
      const shortfall = !left && r.pct !== null && r.pct < threshold;
      return {
        left,
        shortfall,
        needed: shortfall ? classesNeeded(r.attended, r.held, threshold) : 0,
      };
    },
    [threshold],
  );

  const [exporting, setExporting] = useState(false);

  /**
   * CSV covers the whole filtered set, not the visible page — so it fetches
   * once at export time with paging widened, rather than the page keeping
   * every row in memory just in case someone clicks Export.
   */
  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      // Every row carries its own context (term, class, threshold) so a sheet
      // that gets forwarded, filtered or pasted into another workbook still
      // says what it is. The "as marked" trio sits beside the current one
      // because the gap between them *is* the tamper-evidence signal — export
      // one without the other and the corrections become invisible again.
      const header = [
        "Roll No.",
        "Name",
        "Program",
        "Semester",
        "Enrolment",
        "Classes held",
        "Attended",
        "Absent",
        "Attendance %",
        "As marked held",
        "As marked attended",
        "As marked %",
        "Corrections",
        "Eligibility",
        "Classes needed",
        "Min required %",
        "Term",
      ];
      const all: AttendanceSummaryRow[] = [];
      const EXPORT_PAGE = 200; // the server's max page size
      for (let p = 1; ; p += 1) {
        const chunk = await apiGet<Page<AttendanceSummaryRow>>(
          `/attendance/summary${qs({
            ...summaryFilters,
            page: p,
            pageSize: EXPORT_PAGE,
          })}`,
        );
        all.push(...chunk.items);
        if (p >= chunk.totalPages || chunk.items.length === 0) break;
      }
      const body = all.map((r) => {
        const v = verdictOf(r);
        const prog = r.programId ? programById[r.programId] : undefined;
        return [
          r.rollNumber,
          r.name,
          prog ? `${prog.name} (${prog.code})` : "—",
          r.currentSemester,
          // Kept separate from Eligibility: a student can be both "Left" and
          // short of the threshold, and folding the two loses one of them.
          r.graduated ? "Graduated" : r.isActive ? "Active" : "Left",
          r.held,
          r.attended,
          r.held - r.attended,
          r.pct === null ? "" : r.pct,
          r.origHeld,
          r.origAttended,
          r.origPct === null ? "" : r.origPct,
          r.corrections,
          v.left
            ? r.graduated
              ? "Graduated"
              : "Left"
            : r.pct === null
              ? "No data"
              : v.shortfall
                ? "Detained"
                : "Eligible",
          v.shortfall ? v.needed : "",
          threshold,
          currentTerm?.name ?? "",
        ];
      });
      downloadCsv(exportFilename, toCsv([header, ...body]));
    } finally {
      setExporting(false);
    }
  }, [
    summaryFilters, verdictOf, programById, threshold, currentTerm,
    exportFilename,
  ]);

  return (
    <div className="flex flex-col gap-6">
      {!isRep && (
        <Link
          href="/attendance"
          className="inline-flex items-center gap-2 self-start rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          data-print-hide
        >
          <ArrowLeft size={16} />
          Back to attendance
        </Link>
      )}

      <PageHeader
        title="Attendance Summary"
        description="Attendance %, shortfalls and exam eligibility by student."
        action={
          <div className="flex items-center gap-2" data-print-hide>
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={exporting || total === 0}
            >
              <Download size={16} />
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
            {/* Print is a desktop action — a phone can't produce the wide
                report this lays out, and the button only costs header room. */}
            <Button
              variant="outline"
              className="max-md:hidden"
              onClick={() => window.print()}
            >
              <Printer size={16} />
              Print
            </Button>
          </div>
        }
      />

      {/* Class chips — teachers switch between their classes with one tap. */}
      {isTeacher && teacherClassChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" data-print-hide>
          <Button
            size="sm"
            variant={!programId ? "default" : "outline"}
            className="rounded-full"
            onClick={() => {
              setProgramId("");
              setSemesterId("");
            }}
          >
            All my classes
          </Button>
          {teacherClassChips.map((chip) => (
            <Button
              key={chip.semesterId}
              size="sm"
              variant={semesterId === chip.semesterId ? "default" : "outline"}
              className="rounded-full"
              onClick={() => {
                setProgramId(chip.programId);
                setSemesterId(chip.semesterId);
              }}
            >
              {chip.label}
            </Button>
          ))}
        </div>
      )}

      {/* Filters */}
      <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        data-print-hide
      >
        {!isTeacher && !isRep && (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="sum-program">Program</Label>
              <SelectField
                id="sum-program"
                options={programOptions}
                value={programId}
                onValueChange={(v) => {
                  setProgramId(v);
                  setSemesterId("");
                }}
                placeholder="All programs"
                searchPlaceholder="Search programs…"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="sum-sem">Semester</Label>
              <SelectField
                id="sum-sem"
                options={semesterOptions}
                value={semesterId}
                onValueChange={setSemesterId}
                placeholder={programId ? "All semesters" : "Pick a program first"}
                disabled={!programId}
                searchPlaceholder="Search…"
              />
            </div>
          </>
        )}
        {isRep && (
          <div className="flex flex-col gap-2">
            <Label>Class</Label>
            <div className="flex h-9 items-center rounded-md border bg-muted/50 px-3 text-sm">
              {repClassLabel}
            </div>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="sum-search">Search</Label>
          <div className="relative">
            <Search
              size={16}
              className="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="sum-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or roll number…"
              className="pl-8"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {total.toLocaleString()} student(s) ·{" "}
          <span className={shortfallCount > 0 ? "font-medium text-red-700" : ""}>
            {shortfallCount.toLocaleString()} detained (&lt; {threshold}%)
          </span>
          {isFetching && isPlaceholderData ? " · updating…" : ""}
        </p>
        <label className="flex items-center gap-2 text-sm" data-print-hide>
          <Switch checked={defaultersOnly} onCheckedChange={setDefaultersOnly} />
          Defaulters only
        </label>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        <Table variant="stacked">
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Roll No.</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="text-center">Held</TableHead>
              <TableHead className="text-center">Attended</TableHead>
              <TableHead className="text-center">Overall</TableHead>
              <TableHead>Eligibility</TableHead>
              <TableHead className="text-center">Need</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRowsSkeleton rows={8} cols={8} />
            ) : displayed.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="h-32 text-center text-muted-foreground"
                >
                  <Users size={24} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No students match your filters.</p>
                </TableCell>
              </TableRow>
            ) : (
              displayed.map((row) => {
                const isOpen = expanded.has(row.studentId);
                const hasData = row.held > 0 || row.attended > 0;
                const v = verdictOf(row);
                return (
                  <Fragment key={row.studentId}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => hasData && toggle(row.studentId)}
                    >
                      <TableCell data-label="" className="max-md:hidden">
                        {hasData && (
                          <ChevronRight
                            size={16}
                            className={`text-muted-foreground transition-transform ${
                              isOpen ? "rotate-90" : ""
                            }`}
                          />
                        )}
                      </TableCell>
                      <TableCell
                        data-label="Roll No."
                        className="font-mono text-sm"
                      >
                        {row.rollNumber}
                      </TableCell>
                      <TableCell data-label="Name" className="font-medium">
                        <Link
                          href={`/students/${row.studentId}`}
                          className="hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {row.name}
                        </Link>
                        {hasData && (
                          <ChevronRight
                            size={16}
                            className={`ml-1 hidden text-muted-foreground transition-transform max-md:inline ${
                              isOpen ? "rotate-90" : ""
                            }`}
                          />
                        )}
                      </TableCell>
                      {/* data-compact: on mobile these three share one line
                          inside the stacked card instead of taking a row each. */}
                      <TableCell
                        data-label="Held"
                        data-compact="third"
                        className="text-center tabular-nums max-md:text-left"
                      >
                        {row.held}
                      </TableCell>
                      <TableCell
                        data-label="Attended"
                        data-compact="third"
                        className="text-center tabular-nums max-md:text-left"
                      >
                        {row.attended}
                      </TableCell>
                      <TableCell
                        data-label="Overall"
                        data-compact="third"
                        data-compact-end=""
                        className="text-center tabular-nums max-md:text-left"
                      >
                        {row.pct === null ? (
                          "—"
                        ) : row.corrections > 0 && row.origPct !== row.pct ? (
                          // % changed by post-marking corrections — show the
                          // as-marked value so the change is never invisible.
                          <span
                            className="font-medium text-amber-700"
                            title={`As marked: ${row.origPct ?? "—"}% · after ${row.corrections} correction(s): ${row.pct}%`}
                          >
                            {row.origPct === null ? "—" : `${row.origPct}%`} →{" "}
                            {row.pct}%
                          </span>
                        ) : (
                          <span className={pctColor(row.pct, threshold)}>
                            {row.pct}%
                            {row.corrections > 0 && (
                              <span
                                className="text-xs text-muted-foreground"
                                title={`${row.corrections} correction(s) after marking`}
                              >
                                {" "}
                                ·{row.corrections}✎
                              </span>
                            )}
                          </span>
                        )}
                      </TableCell>
                      {/* Eligibility + Need pair up 50/50 on mobile. */}
                      <TableCell data-label="Eligibility" data-compact="">
                        {v.left ? (
                          row.graduated ? (
                            <Badge
                              variant="outline"
                              className="border-violet-200 bg-violet-50 text-violet-700"
                            >
                              Graduated
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-muted-foreground"
                            >
                              Left
                            </Badge>
                          )
                        ) : row.pct === null ? (
                          <Badge variant="outline">No data</Badge>
                        ) : v.shortfall ? (
                          <Badge
                            variant="outline"
                            className="border-red-200 bg-red-50 text-red-700"
                          >
                            Detained
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-emerald-200 bg-emerald-50 text-emerald-700"
                          >
                            Eligible
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell
                        data-label="Need"
                        data-compact=""
                        data-compact-end=""
                        className="text-center tabular-nums max-md:text-left"
                      >
                        {v.shortfall ? v.needed : "—"}
                      </TableCell>
                    </TableRow>
                    {isOpen && hasData && (
                      <TableRow>
                        <TableCell colSpan={8} className="bg-muted/30 p-0">
                          <SummaryBreakdown
                            studentId={row.studentId}
                            termId={currentTermId || null}
                            threshold={threshold}
                            courseIndex={courseIndex}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination — stacks on a phone, where the range text and three
          controls don't fit on one line. */}
      <div
        className="flex flex-col-reverse items-center justify-between gap-3 text-sm text-muted-foreground sm:flex-row"
        data-print-hide
      >
        <span>
          {total > 0
            ? `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total.toLocaleString()}`
            : ""}
        </span>
        <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <span className="tabular-nums">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
