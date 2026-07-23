"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { BarChart3, CalendarCheck, Grid3x3, History, Lock, Save, UserCheck, Users } from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectField } from "@/components/select-field";
import { EMPTY_ARRAY, errMsg } from "@/lib/api";
import {
  useAssignments,
  useRegister,
  useRoster,
  useCourses,
  usePrograms,
  useSaveAttendance,
  useSemesters,
  useSettings,
  useTeacherOptions,
  useTerms,
} from "@/lib/queries";
import { isPathAllowed, useAuth } from "@/lib/permissions";
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
import { cn } from "@/lib/utils";
import {
  semesterInSession,
  type AttendanceSession,
  type AttendanceStatus,
  type Student,
} from "@/lib/types";

const todayISO = () => new Date().toISOString().slice(0, 10);

// Stable empty defaults. A `= []` literal allocates a fresh array on every
// render while a query is disabled/pending, which defeats memoisation and — in
// an effect's dependency array — re-runs the effect forever.
const NO_SESSIONS: AttendanceSession[] = [];
const NO_ROSTER: Student[] = [];

const PERIOD_OPTIONS = Array.from({ length: 8 }, (_, i) => ({
  value: String(i + 1),
  label: `Period ${i + 1}`,
}));

export default function AttendancePage() {
  const { role, can, departmentId, ownCourseIds } = useAuth();
  const { data: programs = EMPTY_ARRAY } = usePrograms();
  const { data: allCourses = EMPTY_ARRAY } = useCourses();
  const { data: teachers = EMPTY_ARRAY } = useTeacherOptions();
  const { data: terms = EMPTY_ARRAY } = useTerms();
  const { data: settings } = useSettings();
  const currentTermId = settings?.currentTermId ?? "";
  const lockDate = settings?.lockDate ?? null;
  const { data: assignments = EMPTY_ARRAY } = useAssignments(currentTermId);
  const saveAttendance = useSaveAttendance();

  const currentTerm = terms.find((t) => t.id === currentTermId);

  const [programId, setProgramId] = useState("");
  const [semesterId, setSemesterId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [period, setPeriod] = useState(1);
  const [date, setDate] = useState(todayISO);
  const [statuses, setStatuses] = useState<Record<string, AttendanceStatus>>({});

  // Semesters (with courses) for the selected program; sessions for the course.
  const { data: semesters = EMPTY_ARRAY } = useSemesters(programId);
  // Sessions for this course in the current term — bounded by the class, so
  // it comes back whole. (This page is term-scoped like every other.)
  const { data: courseSessionsRaw = NO_SESSIONS } = useRegister(
    { courseId, termId: currentTermId },
    !!courseId,
  );
  // The roster is the server's derived class list: active, non-graduated
  // students in the course's program and semester.
  const { data: roster = NO_ROSTER, isLoading: rosterLoading } =
    useRoster(courseId);

  // ---- Cascading selectors -------------------------------------------------
  // Role scoping: teachers only see programs/semesters/courses they are
  // assigned to this term; HODs see their own department's programs plus any
  // program where they teach a course (cross-department teaching).
  const ownIds = useMemo(
    () => ownCourseIds(currentTermId),
    [ownCourseIds, currentTermId],
  );
  const hasOwnCourse = useMemo(
    () => (progId: string) =>
      allCourses.some((c) => c.programId === progId && ownIds.has(c.id)),
    [allCourses, ownIds],
  );
  const programOptions = useMemo(
    () =>
      programs
        .filter((p) => {
          if (role === "hod")
            return p.departmentId === departmentId || hasOwnCourse(p.id);
          if (role === "teacher") return hasOwnCourse(p.id);
          return true;
        })
        .map((p) => ({ value: p.id, label: `${p.name} (${p.code})` })),
    [programs, role, departmentId, hasOwnCourse],
  );
  // Only semesters in session for the current term's parity can be marked.
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
      programSemesters
        .filter(
          (s) =>
            role !== "teacher" || s.courses.some((c) => ownIds.has(c.id)),
        )
        .map((s) => ({
          value: s.id,
          label: `Semester ${s.number}`,
        })),
    [programSemesters, role, ownIds],
  );
  const selectedSem = useMemo(
    () => semesters.find((s) => s.id === semesterId),
    [semesters, semesterId],
  );
  const courseOptions = useMemo(
    () =>
      (selectedSem?.courses ?? [])
        .filter((c) => role !== "teacher" || ownIds.has(c.id))
        .map((c) => ({
          value: c.id,
          label: `${c.name} (${c.code})`,
        })),
    [selectedSem, role, ownIds],
  );

  // ---- "My classes" picker (any account with a linked teacher). Teachers
  // pick exclusively from these cards — the cascading selectors are hidden
  // for them.
  const myClasses = useOwnClasses();
  const isTeacher = role === "teacher";

  // ---- Derived: teachers, roster, session history --------------------------
  const assignedTeachers = useMemo(
    () =>
      assignments
        .filter((x) => x.courseId === courseId && x.termId === currentTermId)
        .map((a) => teachers.find((t) => t.id === a.teacherId))
        .filter((t): t is NonNullable<typeof t> => Boolean(t)),
    [assignments, teachers, courseId, currentTermId],
  );

  // Newest first — the saved-sessions list under the marking sheet.
  const courseSessions = useMemo(
    () =>
      [...courseSessionsRaw].sort(
        (a, b) => b.date.localeCompare(a.date) || b.period - a.period,
      ),
    [courseSessionsRaw],
  );

  // Per-student statuses across all sessions of the selected course.
  const studentStatuses = useMemo(() => {
    const map: Record<string, AttendanceStatus[]> = {};
    for (const sess of courseSessions) {
      for (const r of sess.records) {
        (map[r.studentId] ??= []).push(r.status);
      }
    }
    return map;
  }, [courseSessions]);

  // The saved session backing the sheet, if the class hour has been marked
  // before. Derived here so the effect below can depend on the *session*
  // instead of the whole register: React Query's structural sharing keeps this
  // reference stable across refetches that didn't touch this session, so a
  // background refresh never re-seeds the sheet over unsaved roll-call taps.
  const existingSession = useMemo(
    () =>
      courseSessionsRaw.find((a) => a.date === date && a.period === period) ??
      null,
    [courseSessionsRaw, date, period],
  );

  // Initialise the marking sheet from the saved session, defaulting everyone on
  // the roster to present. Both branches must be idempotent — a fresh `{}` on
  // every run would re-render forever.
  useEffect(() => {
    if (!courseId || !date || roster.length === 0) {
      setStatuses((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }
    const next: Record<string, AttendanceStatus> = {};
    for (const s of roster) {
      next[s.id] =
        existingSession?.records.find((r) => r.studentId === s.id)?.status ??
        "present";
    }
    setStatuses(next);
  }, [courseId, date, period, roster, existingSession]);
  const presentCount = roster.filter(
    (s) => STATUS_META[statuses[s.id] ?? "present"].countsPresent,
  ).length;

  // "own"-scope markers (teachers, HODs, any account with a linked teacher)
  // may only mark courses assigned to them, and only the first time — once a
  // session exists it takes editAttendance rights to re-save.
  const canMarkHere =
    can.markScope === "all" ||
    (can.markScope === "own" && ownIds.has(courseId));
  // Any past date may be marked (never future) — the lock is the only time
  // guard, and overrideLock roles can still write through it (audited).
  const dateLocked = lockDate != null && date <= lockDate;
  const lockBlocks = dateLocked && !can.overrideLock;
  const canSave =
    !lockBlocks && (existingSession ? can.editAttendance : canMarkHere);
  const markLocked =
    canMarkHere && Boolean(existingSession) && !can.editAttendance;

  function setAll(status: AttendanceStatus) {
    const next: Record<string, AttendanceStatus> = {};
    for (const s of roster) next[s.id] = status;
    setStatuses(next);
  }

  function handleSave() {
    if (!courseId || !date) {
      toast.error("Pick a course and a date first.");
      return;
    }
    if (!canSave) {
      toast.error(
        lockBlocks
          ? `Attendance up to ${lockDate} is locked.`
          : markLocked
            ? "Attendance for this class is already saved — your role can't modify saved records."
            : "Your role can't save attendance for this course.",
      );
      return;
    }
    if (roster.length === 0) {
      toast.error("No students enrolled in this class.");
      return;
    }
    const records = roster.map((s) => ({
      studentId: s.id,
      status: statuses[s.id] ?? ("present" as AttendanceStatus),
    }));
    void (async () => {
      try {
        await saveAttendance.mutateAsync({
          courseId,
          date,
          period,
          termId: currentTermId,
          records,
        });
        toast.success(
          `Attendance ${existingSession ? "updated" : "saved"} for ${date} · P${period}.`,
        );
      } catch (err) {
        toast.error(errMsg(err));
      }
    })();
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Mark Attendance"
        description="Pick the class you took, then mark each student."
        action={
          <div className="flex items-center gap-2">
            {role && isPathAllowed(role, "/attendance/sessions") && (
              <Button
                variant="outline"
                render={<Link href="/attendance/sessions" />}
                nativeButton={false}
              >
                <History size={16} />
                Correct attendance
              </Button>
            )}
            <Button
              variant="outline"
              render={<Link href="/attendance/register" />}
              nativeButton={false}
            >
              <Grid3x3 size={16} />
              View register
            </Button>
            <Button
              variant="outline"
              render={<Link href="/attendance/summary" />}
              nativeButton={false}
            >
              <BarChart3 size={16} />
              View summary
            </Button>
          </div>
        }
      />

      {/* My classes — one tap from "took a class" to its roster. Teachers
          have no other selector; other linked accounts get it as a shortcut. */}
      {(isTeacher || myClasses.length > 0) && (
        <MyClassesPicker
          classes={myClasses}
          selectedCourseId={courseId}
          onSelect={(c) => {
            setProgramId(c.programId);
            setSemesterId(c.semesterId);
            setCourseId(c.courseId);
            setDate(todayISO());
          }}
        />
      )}

      {/* Class + period + date selectors (teachers pick via the cards above) */}
      <div
        className={cn(
          "grid grid-cols-1 gap-3 sm:grid-cols-2",
          isTeacher ? "lg:grid-cols-4" : "lg:grid-cols-5",
        )}
      >
        {!isTeacher && (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="att-program">Program</Label>
              <SelectField
                id="att-program"
                options={programOptions}
                value={programId}
                onValueChange={(v) => {
                  setProgramId(v);
                  setSemesterId("");
                  setCourseId("");
                }}
                placeholder="Select program"
                searchPlaceholder="Search programs…"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="att-sem">Semester</Label>
              <SelectField
                id="att-sem"
                options={semesterOptions}
                value={semesterId}
                onValueChange={(v) => {
                  setSemesterId(v);
                  setCourseId("");
                }}
                placeholder={programId ? "Select semester" : "Pick a program first"}
                disabled={!programId}
                searchPlaceholder="Search…"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="att-course">Course</Label>
              <SelectField
                id="att-course"
                options={courseOptions}
                value={courseId}
                onValueChange={setCourseId}
                placeholder={semesterId ? "Select course" : "Pick a semester first"}
                disabled={!semesterId}
                searchPlaceholder="Search courses…"
              />
            </div>
          </>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="att-period">Period</Label>
          <SelectField
            id="att-period"
            options={PERIOD_OPTIONS}
            value={String(period)}
            onValueChange={(v) => v && setPeriod(Number(v))}
            placeholder="Period"
            searchPlaceholder="Search…"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="att-date">Date</Label>
          <Input
            id="att-date"
            type="date"
            value={date}
            max={todayISO()}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      </div>

      {dateLocked && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <Lock size={14} />
          {can.overrideLock
            ? `Attendance up to ${lockDate} is locked — you're editing frozen records; every change is audited.`
            : `Attendance up to ${lockDate} is locked — records for this date can't be changed.`}
        </div>
      )}

      {!courseId ? (
        <div className="rounded-xl border bg-card p-8 text-center shadow-sm">
          <CalendarCheck size={24} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm text-muted-foreground">
            {isTeacher
              ? "Pick one of your classes above to mark attendance."
              : "Select a program, semester and course to mark attendance."}
          </p>
        </div>
      ) : rosterLoading ? (
        <ListCardSkeleton rows={8} />
      ) : (
        <>
          {/* Marking toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline">
                <UserCheck size={14} />
                {presentCount}/{roster.length} present
              </Badge>
              <span className="text-muted-foreground">
                {assignedTeachers.length > 0
                  ? `Teacher${assignedTeachers.length > 1 ? "s" : ""}: ${assignedTeachers
                      .map((t) => t.name)
                      .join(", ")}`
                  : "Teacher: Unassigned"}
              </span>
              {existingSession && !markLocked && canMarkHere && (
                <Badge
                  variant="outline"
                  className="border-amber-200 bg-amber-50 text-amber-700"
                >
                  Editing saved session
                </Badge>
              )}
              {markLocked && (
                <Badge
                  variant="outline"
                  className="border-amber-200 bg-amber-50 text-amber-700"
                >
                  Saved — your role can&apos;t edit saved attendance
                </Badge>
              )}
              {!canMarkHere && <Badge variant="outline">View only</Badge>}
            </div>
            {canMarkHere && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAll("present")}
                  disabled={roster.length === 0 || !canSave}
                >
                  All present
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAll("absent")}
                  disabled={roster.length === 0 || !canSave}
                >
                  All absent
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={roster.length === 0 || !canSave}
                >
                  <Save size={16} />
                  Save
                </Button>
              </div>
            )}
          </div>

          {/* Roster — table on desktop, card-per-student on mobile */}
          <div className="hidden overflow-hidden rounded-xl border bg-card shadow-sm md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Roll No.</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-center">Overall</TableHead>
                  <TableHead className="w-56 text-right">Mark</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roster.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="h-32 text-center text-muted-foreground"
                    >
                      <Users size={24} className="mx-auto mb-2 opacity-50" />
                      <p className="text-sm">
                        No active students in this class.
                      </p>
                    </TableCell>
                  </TableRow>
                ) : (
                  roster.map((s) => {
                    const status = statuses[s.id] ?? "present";
                    const t = tally(studentStatuses[s.id] ?? []);
                    const p = pct(t.attended, t.held);
                    return (
                      <TableRow key={s.id}>
                        <TableCell className="font-mono text-sm">
                          {s.rollNumber}
                        </TableCell>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell
                          className={cn(
                            "text-center text-sm tabular-nums",
                            pctColor(p),
                          )}
                        >
                          {p === null ? "—" : `${p}%`}
                        </TableCell>
                        <TableCell>
                          {/* Roll-call chips: one tap per student. */}
                          <div className="flex justify-end gap-1">
                            {ATTENDANCE_STATUSES.map((m) => (
                              <button
                                key={m.value}
                                type="button"
                                title={m.label}
                                disabled={!canSave}
                                onClick={() =>
                                  setStatuses((prev) => ({
                                    ...prev,
                                    [s.id]: m.value,
                                  }))
                                }
                                className={cn(
                                  "h-7 min-w-9 rounded-md border px-2 text-xs font-semibold transition-colors disabled:pointer-events-none disabled:opacity-40",
                                  status === m.value
                                    ? m.badgeClass
                                    : "border-transparent bg-muted/40 text-muted-foreground hover:bg-muted",
                                )}
                              >
                                {m.short}
                              </button>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Mobile roster: one card per student with large P/A/L/OD targets. */}
          <div className="flex flex-col gap-2 md:hidden">
            {roster.length === 0 ? (
              <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground shadow-sm">
                <Users size={24} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">No active students in this class.</p>
              </div>
            ) : (
              roster.map((s) => {
                const status = statuses[s.id] ?? "present";
                const t = tally(studentStatuses[s.id] ?? []);
                const p = pct(t.attended, t.held);
                return (
                  <div
                    key={s.id}
                    className="rounded-xl border bg-card p-3 shadow-sm"
                  >
                    <div className="mb-2 flex items-baseline justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{s.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {s.rollNumber}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 text-sm tabular-nums",
                          pctColor(p),
                        )}
                      >
                        {p === null ? "—" : `${p}%`}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {ATTENDANCE_STATUSES.map((m) => (
                        <button
                          key={m.value}
                          type="button"
                          title={m.label}
                          disabled={!canSave}
                          onClick={() =>
                            setStatuses((prev) => ({
                              ...prev,
                              [s.id]: m.value,
                            }))
                          }
                          className={cn(
                            "h-11 rounded-md border text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-40",
                            status === m.value
                              ? m.badgeClass
                              : "border-transparent bg-muted/40 text-muted-foreground hover:bg-muted",
                          )}
                        >
                          {m.short}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
