"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Download, Grid3x3, Printer } from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { SelectField } from "@/components/select-field";
import { EMPTY_ARRAY, errMsg } from "@/lib/api";
import {
  useRegister,
  useSessionMonths,
  useClassRoster,
  useCourses,
  usePrograms,
  useSemesters,
  useSetAttendanceStatus,
  useSettings,
  useTerms,
  useUserDirectory,
} from "@/lib/queries";
import { useAuth } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { ListCardSkeleton } from "@/components/ui/card-skeleton";
import {
  MyClassesPicker,
  useOwnClasses,
} from "@/components/attendance/my-classes";
import {
  ATTENDANCE_STATUSES,
  STATUS_META,
  pct,
  pctColor,
  tally,
} from "@/lib/attendance";
import { downloadCsv, toCsv } from "@/lib/export";
import { semesterInSession } from "@/lib/types";

export default function RegisterPage() {
  const { role, can, departmentId, classScope, ownCourseIds } = useAuth();
  const { data: programs = EMPTY_ARRAY } = usePrograms();
  const { data: allCourses = EMPTY_ARRAY } = useCourses();
  const { data: terms = EMPTY_ARRAY } = useTerms();
  const { data: settings } = useSettings();
  const currentTermId = settings?.currentTermId ?? "";
  const lockDate = settings?.lockDate ?? null;
  const { data: directory = EMPTY_ARRAY } = useUserDirectory();
  const setAttendanceStatus = useSetAttendanceStatus();

  const currentTerm = terms.find((t) => t.id === currentTermId);

  // Student reps are locked to their own class (program + semester); teachers
  // pick from their "My classes" cards instead of the cascading selectors.
  const isRep = role === "student-rep";
  const isTeacher = role === "teacher";

  const [programId, setProgramId] = useState(
    isRep ? classScope?.programId ?? "" : "",
  );
  const [semesterId, setSemesterId] = useState("");
  const [courseId, setCourseId] = useState("");

  const { data: semesters = EMPTY_ARRAY } = useSemesters(programId);

  // Month filter — the monthly register cut (matrix, totals, CSV and print all
  // follow it). "all" = the whole term. Declared before the data hooks so the
  // month can be pushed down into the query instead of filtering after.
  const [month, setMonth] = useState("all");
  // The term is switched globally (header), so reset the cut when it changes.
  useEffect(() => setMonth("all"), [currentTermId]);

  // One course's sessions, optionally one month — bounded by the class, so the
  // matrix comes back whole rather than paged.
  const { data: sessions = EMPTY_ARRAY, isLoading: registerLoading } = useRegister(
    {
      courseId,
      termId: currentTermId,
      month: month === "all" ? undefined : month,
    },
    !!courseId,
  );
  // Month options are DISTINCT-ed in SQL, not derived by downloading sessions.
  const { data: availableMonths = EMPTY_ARRAY } = useSessionMonths(courseId, currentTermId);

  // Rep's semester resolves once its program's semesters load.
  const repSemesterId = isRep
    ? semesters.find(
        (s) =>
          s.programId === classScope?.programId &&
          s.number === classScope?.semester,
      )?.id ?? ""
    : "";
  useEffect(() => {
    if (isRep && repSemesterId && !semesterId) setSemesterId(repSemesterId);
  }, [isRep, repSemesterId, semesterId]);

  // Teachers pick their class via cards; the selectors below only render for
  // admin/principal/attendance-manager/HOD.
  const myClasses = useOwnClasses();

  // Role scoping: HODs see their department's programs plus any program where
  // they teach a course (cross-department teaching).
  const ownIds = useMemo(
    () => ownCourseIds(currentTermId),
    [ownCourseIds, currentTermId],
  );
  const programOptions = useMemo(() => {
    const hasOwnCourse = (progId: string) =>
      allCourses.some((c) => c.programId === progId && ownIds.has(c.id));
    return programs
      .filter(
        (p) =>
          role !== "hod" ||
          p.departmentId === departmentId ||
          hasOwnCourse(p.id),
      )
      .map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }));
  }, [programs, allCourses, role, departmentId, ownIds]);
  // Current-term registers only exist for in-session (same-parity) semesters.
  const programSemesters = useMemo(
    () =>
      semesters
        .filter(
          (s) =>
            s.programId === programId &&
            semesterInSession(s.number, currentTerm),
        )
        .sort((a, b) => a.number - b.number),
    [semesters, programId, currentTerm],
  );
  const semesterOptions = useMemo(
    () =>
      programSemesters.map((s) => ({
        value: s.id,
        label: `Semester ${s.number}`,
      })),
    [programSemesters],
  );
  const selectedSem = useMemo(
    () => semesters.find((s) => s.id === semesterId),
    [semesters, semesterId],
  );
  const courseOptions = useMemo(
    () =>
      (selectedSem?.courses ?? []).map((c) => ({
        value: c.id,
        label: `${c.name} (${c.code})`,
      })),
    [selectedSem],
  );

  // Static class label shown to the rep in place of the selects.
  const repClassLabel = useMemo(() => {
    if (!isRep || !classScope) return "";
    const prog = programs.find((p) => p.id === classScope.programId);
    return `${prog?.name ?? "—"} (${prog?.code ?? "—"}) · Semester ${classScope.semester}`;
  }, [isRep, classScope, programs]);
  const selectedCourse = selectedSem?.courses.find((c) => c.id === courseId);

  const monthLabel = (m: string) =>
    new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).toLocaleString(
      "en",
      { month: "long", year: "numeric" },
    );
  const monthOptions = useMemo(
    () => [
      { value: "all", label: "All months" },
      ...[...availableMonths]
        .sort()
        .map((m) => ({ value: m, label: monthLabel(m) })),
    ],
    [availableMonths],
  );

  // Current class members PLUS anyone with saved marks in the scoped sessions
  // (students who left or graduated keep their rows, tagged — history never
  // silently disappears from the register). Resolved server-side.
  const { data: roster = EMPTY_ARRAY } = useClassRoster(
    {
      courseId,
      termId: currentTermId,
      month: month === "all" ? undefined : month,
    },
    !!courseId,
  );

  // Each student's record per session column (null = no record). The full
  // record is kept so corrected cells can show their original status. Records
  // are indexed per session once, so building the matrix is students × sessions
  // lookups rather than a scan of every session's records for every cell.
  const rows = useMemo(() => {
    const bySession = sessions.map(
      (sess) => new Map(sess.records.map((r) => [r.studentId, r])),
    );
    return roster.map((s) => {
        const cells = bySession.map((records) => records.get(s.id) ?? null);
        const t = tally(
          cells
            .filter((c): c is NonNullable<typeof c> => !!c)
            .map((c) => c.status),
        );
        return { student: s, cells, ...t, pct: pct(t.attended, t.held) };
      });
  }, [roster, sessions]);

  const userName = useMemo(
    () => Object.fromEntries(directory.map((u) => [u.id, u.name])),
    [directory],
  );

  function handleExport() {
    const header = [
      "Roll No.",
      "Name",
      "Status",
      ...sessions.map((s) => `${s.date} P${s.period}`),
      "Attended",
      "Held",
      "%",
    ];
    const body = rows.map((r) => [
      r.student.rollNumber,
      r.student.name,
      r.student.graduated ? "Graduated" : r.student.isActive ? "" : "Left",
      ...r.cells.map((c) => (c ? STATUS_META[c.status].short : "")),
      r.attended,
      r.held,
      r.pct === null ? "" : r.pct,
    ]);
    downloadCsv(
      `register-${selectedCourse?.code ?? "course"}${month === "all" ? "" : `-${month}`}.csv`,
      toCsv([header, ...body]),
    );
  }

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
        title="Attendance Register"
        description="The full students × sessions grid for a course."
        action={
          courseId && sessions.length > 0 ? (
            <div className="flex items-center gap-2" data-print-hide>
              <Button variant="outline" onClick={handleExport}>
                <Download size={16} />
                Export CSV
              </Button>
              <Button variant="outline" onClick={() => window.print()}>
                <Printer size={16} />
                Print
              </Button>
            </div>
          ) : undefined
        }
      />

      {/* My classes — teachers pick their class here, no cascading selectors */}
      {isTeacher && (
        <div data-print-hide>
          <MyClassesPicker
            classes={myClasses}
            selectedCourseId={courseId}
            showMarkedToday={false}
            onSelect={(c) => {
              setProgramId(c.programId);
              setSemesterId(c.semesterId);
              setCourseId(c.courseId);
              setMonth("all");
            }}
          />
        </div>
      )}

      {/* Selectors */}
      <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
        data-print-hide
      >
        {!isTeacher && !isRep && (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="reg-program">Program</Label>
              <SelectField
                id="reg-program"
                options={programOptions}
                value={programId}
                onValueChange={(v) => {
                  setProgramId(v);
                  setSemesterId("");
                  setCourseId("");
                  setMonth("all");
                }}
                placeholder="Select program"
                searchPlaceholder="Search programs…"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="reg-sem">Semester</Label>
              <SelectField
                id="reg-sem"
                options={semesterOptions}
                value={semesterId}
                onValueChange={(v) => {
                  setSemesterId(v);
                  setCourseId("");
                  setMonth("all");
                }}
                placeholder={programId ? "Select semester" : "Pick a program first"}
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
        {!isTeacher && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="reg-course">Course</Label>
            <SelectField
              id="reg-course"
              options={courseOptions}
              value={courseId}
              onValueChange={(v) => {
                setCourseId(v);
                setMonth("all");
              }}
              placeholder={semesterId ? "Select course" : "Pick a semester first"}
              disabled={!semesterId}
              searchPlaceholder="Search courses…"
            />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="reg-month">Month</Label>
          <SelectField
            id="reg-month"
            options={monthOptions}
            value={month}
            onValueChange={(v) => setMonth(v || "all")}
            placeholder="All months"
            disabled={!courseId}
            searchPlaceholder="Search months…"
          />
        </div>
      </div>

      {!courseId ? (
        <div className="rounded-xl border bg-card p-8 text-center shadow-sm">
          <Grid3x3 size={24} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm text-muted-foreground">
            Select a course to view its register.
          </p>
        </div>
      ) : registerLoading ? (
        <ListCardSkeleton rows={6} />
      ) : sessions.length === 0 || roster.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-center shadow-sm">
          <Grid3x3 size={24} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm text-muted-foreground">
            {roster.length === 0
              ? "No students in this class."
              : month !== "all"
                ? `No sessions in ${monthLabel(month)} — pick another month.`
                : "No attendance recorded for this course in the selected term."}
          </p>
        </div>
      ) : (
        <>
          {selectedCourse && (
            <p className="text-sm text-muted-foreground">
              {selectedCourse.name} ({selectedCourse.code})
              {month !== "all" && ` · ${monthLabel(month)}`} · {sessions.length}{" "}
              session(s)
              {can.editAttendance && (
                <span data-print-hide>
                  {" "}
                  · click any cell to change its status
                </span>
              )}
            </p>
          )}
          <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  {/* Pinned identity column: this grid is one column per
                      session, so on a phone it is always scrolled sideways and
                      the roll number is the only thing tying a row to a
                      student. `z-10` keeps the session cells from painting
                      over it as they slide underneath; the right border marks
                      the seam once scrolling starts. */}
                  <TableHead className="sticky left-0 z-10 border-r bg-card">
                    Roll No.
                  </TableHead>
                  <TableHead>Name</TableHead>
                  {sessions.map((sess) => (
                    <TableHead
                      key={sess.id}
                      className="text-center text-xs"
                      title={
                        sess.markedBy
                          ? `Marked by ${userName[sess.markedBy] ?? "unknown"}`
                          : undefined
                      }
                    >
                      {sess.date.slice(5)}
                      <br />P{sess.period}
                    </TableHead>
                  ))}
                  <TableHead className="text-center">Att</TableHead>
                  <TableHead className="text-center">Held</TableHead>
                  <TableHead className="text-center">%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.student.id}>
                    <TableCell className="sticky left-0 z-10 border-r bg-card font-mono text-sm">
                      {r.student.rollNumber}
                    </TableCell>
                    <TableCell className="font-medium whitespace-nowrap">
                      {r.student.name}
                      {r.student.graduated ? (
                        <Badge
                          variant="outline"
                          className="ml-1.5 border-violet-200 bg-violet-50 text-violet-700"
                        >
                          Graduated
                        </Badge>
                      ) : !r.student.isActive ? (
                        <Badge
                          variant="outline"
                          className="ml-1.5 text-muted-foreground"
                        >
                          Left
                        </Badge>
                      ) : null}
                    </TableCell>
                    {r.cells.map((c, i) => {
                      const sess = sessions[i];
                      // Corrections are visible to EVERY viewer (incl. the
                      // class's shared login) — an amber dot + who/when.
                      const corrected = Boolean(c?.originalStatus);
                      const cellTitle = c
                        ? corrected
                          ? `${STATUS_META[c.originalStatus!].label} → ${STATUS_META[c.status].label}` +
                            (c.editedBy
                              ? ` · changed by ${userName[c.editedBy] ?? "unknown"}`
                              : "") +
                            (c.editedAt
                              ? ` · ${c.editedAt.slice(0, 10)}`
                              : "")
                          : sess.markedBy
                            ? `Marked by ${userName[sess.markedBy] ?? "unknown"}`
                            : undefined
                        : undefined;
                      const chip = c ? (
                        <span
                          title={cellTitle}
                          className={cn(
                            "relative inline-block min-w-7 rounded border px-1 text-xs font-medium",
                            STATUS_META[c.status].badgeClass,
                          )}
                        >
                          {STATUS_META[c.status].short}
                          {corrected && (
                            <span
                              aria-label="Corrected after marking"
                              className="absolute -right-1 -top-1 size-2 rounded-full border border-card bg-amber-500"
                            />
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">·</span>
                      );
                      const sessLocked =
                        lockDate != null && sess.date <= lockDate;
                      return (
                        <TableCell key={sess.id} className="text-center">
                          {can.editAttendance &&
                          (!sessLocked || can.overrideLock) ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={
                                  <button
                                    type="button"
                                    aria-label="Change status"
                                    className="cursor-pointer rounded px-1 py-0.5 transition-colors hover:bg-accent"
                                  >
                                    {chip}
                                  </button>
                                }
                              />
                              <DropdownMenuContent align="center">
                                {ATTENDANCE_STATUSES.map((m) => (
                                  <DropdownMenuItem
                                    key={m.value}
                                    onClick={async () => {
                                      try {
                                        await setAttendanceStatus.mutateAsync({
                                          sessionId: sessions[i].id,
                                          studentId: r.student.id,
                                          status: m.value,
                                        });
                                      } catch (err) {
                                        toast.error(errMsg(err));
                                      }
                                    }}
                                  >
                                    <span
                                      className={cn(
                                        "inline-block w-7 rounded border text-center text-xs font-medium",
                                        m.badgeClass,
                                      )}
                                    >
                                      {m.short}
                                    </span>
                                    {m.label}
                                    {c?.status === m.value && (
                                      <span className="ml-auto text-xs text-muted-foreground">
                                        current
                                      </span>
                                    )}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : (
                            chip
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-center tabular-nums">
                      {r.attended}
                    </TableCell>
                    <TableCell className="text-center tabular-nums">
                      {r.held}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-center font-semibold tabular-nums",
                        pctColor(r.pct),
                      )}
                    >
                      {r.pct === null ? "—" : `${r.pct}%`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Legend:</span>
            {ATTENDANCE_STATUSES.map((m) => (
              <Badge key={m.value} variant="outline" className={m.badgeClass}>
                {m.short} = {m.label}
              </Badge>
            ))}
            <Badge
              variant="outline"
              className="border-amber-200 bg-amber-50 text-amber-700"
            >
              <span className="size-2 rounded-full bg-amber-500" /> = corrected
              after marking (hover for details)
            </Badge>
          </div>
        </>
      )}
    </div>
  );
}
