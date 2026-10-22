"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, History, Lock, Trash2 } from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { SelectField } from "@/components/select-field";
import { EMPTY_ARRAY, errMsg } from "@/lib/api";
import {
  useRegister,
  useClassRoster,
  useDeleteSession,
  usePrograms,
  useSemesters,
  useSettings,
  useTerms,
  useUserDirectory,
} from "@/lib/queries";
import { useAuth } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { ListCardSkeleton } from "@/components/ui/card-skeleton";
import {
  SessionRosterDialog,
  type RosterRow,
} from "@/components/attendance/session-roster-dialog";
import { STATUS_META } from "@/lib/attendance";
import { semesterInSession } from "@/lib/types";

export default function AttendanceSessionsPage() {
  const { can } = useAuth();
  const { data: programs = EMPTY_ARRAY } = usePrograms();
  const { data: terms = EMPTY_ARRAY } = useTerms();
  const { data: settings } = useSettings();
  const currentTermId = settings?.currentTermId ?? "";
  const lockDate = settings?.lockDate ?? null;
  const { data: directory = EMPTY_ARRAY } = useUserDirectory();
  const deleteAttendanceSession = useDeleteSession();

  const currentTerm = terms.find((t) => t.id === currentTermId);

  const [programId, setProgramId] = useState("");
  const [semesterId, setSemesterId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const { data: semesters = EMPTY_ARRAY } = useSemesters(programId);
  // Sessions for one class in the current term — bounded, so unpaged.
  const { data: attendance = EMPTY_ARRAY, isLoading: sessionsLoading } = useRegister(
    { courseId, termId: currentTermId },
    !!courseId,
  );
  // Names for the session roster: current class members ∪ anyone with saved
  // marks, so a student who left still resolves instead of showing as unknown.
  const { data: rosterStudents = EMPTY_ARRAY } = useClassRoster(
    { courseId, termId: currentTermId },
    !!courseId,
  );

  // Only admin/principal/attendance-manager reach this page (route guard),
  // so the selectors are unscoped.
  const programOptions = useMemo(
    () =>
      programs.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` })),
    [programs],
  );
  // Current-term sessions can only exist for in-session (same-parity) semesters.
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

  const userName = useMemo(
    () => Object.fromEntries(directory.map((u) => [u.id, u.name])),
    [directory],
  );
  const studentById = useMemo(
    () => Object.fromEntries(rosterStudents.map((s) => [s.id, s])),
    [rosterStudents],
  );

  // Saved sessions for the chosen course, current term, newest first.
  const courseSessions = useMemo(
    () =>
      [...attendance].sort(
        (a, b) => b.date.localeCompare(a.date) || b.period - a.period,
      ),
    [attendance],
  );

  // Keep the selection valid when the course (or the data) changes.
  useEffect(() => {
    if (selectedId && !courseSessions.some((s) => s.id === selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, courseSessions]);

  const selectedSession = courseSessions.find((s) => s.id === selectedId);
  const selectedLocked =
    selectedSession != null &&
    lockDate != null &&
    selectedSession.date <= lockDate;
  // overrideLock roles keep editing through the lock (audited); the "Locked"
  // badge stays visible so frozen dates are never edited unknowingly.
  const canEditHere =
    can.editAttendance && (!selectedLocked || can.overrideLock);

  // Roster rows for the open session, sorted by roll number. Records for
  // students since deleted are skipped (the store strips them anyway).
  const rosterRows = useMemo<RosterRow[]>(() => {
    if (!selectedSession) return [];
    return selectedSession.records
      .map((r) => ({ record: r, student: studentById[r.studentId] }))
      .filter((row): row is RosterRow => Boolean(row.student))
      .sort((a, b) => a.student.rollNumber.localeCompare(b.student.rollNumber));
  }, [selectedSession, studentById]);

  const deletingSession = courseSessions.find((s) => s.id === deleting);

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/attendance"
        className="inline-flex items-center gap-2 self-start rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <ArrowLeft size={16} />
        Back to marking
      </Link>

      <PageHeader
        title="Correct Attendance"
        description="Every saved class hour for a course — open one to review or correct it."
      />

      {/* Class selectors */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="ses-program">Program</Label>
          <SelectField
            id="ses-program"
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
          <Label htmlFor="ses-sem">Semester</Label>
          <SelectField
            id="ses-sem"
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
          <Label htmlFor="ses-course">Course</Label>
          <SelectField
            id="ses-course"
            options={courseOptions}
            value={courseId}
            onValueChange={(v) => {
              setCourseId(v);
              setSelectedId(null);
            }}
            placeholder={semesterId ? "Select course" : "Pick a semester first"}
            disabled={!semesterId}
            searchPlaceholder="Search courses…"
          />
        </div>
      </div>

      {!courseId ? (
        <div className="rounded-xl border bg-card p-8 text-center shadow-sm">
          <History size={24} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm text-muted-foreground">
            Select a program, semester and course to see its saved sessions.
          </p>
        </div>
      ) : sessionsLoading ? (
        <ListCardSkeleton rows={6} />
      ) : courseSessions.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-center shadow-sm">
          <History size={24} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm text-muted-foreground">
            No attendance saved for this course in the current term yet.
          </p>
        </div>
      ) : (
        <>
          {/* Saved sessions */}
          <div className="overflow-hidden rounded-xl border bg-card shadow-sm max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:shadow-none">
            <Table variant="stacked">
              <TableHeader>
                <TableRow>
                  <TableHead>Class</TableHead>
                  <TableHead>Marked by</TableHead>
                  <TableHead className="text-center">Present</TableHead>
                  <TableHead className="text-center">Absent</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {courseSessions.map((sess) => {
                  const present = sess.records.filter(
                    (r) => STATUS_META[r.status]?.countsPresent,
                  ).length;
                  const absent = sess.records.filter(
                    (r) => r.status === "absent",
                  ).length;
                  const sessLocked = lockDate != null && sess.date <= lockDate;
                  return (
                    <TableRow
                      key={sess.id}
                      className={
                        sess.id === selectedId ? "bg-accent/40" : undefined
                      }
                    >
                      <TableCell
                        data-label="Class"
                        className="font-medium tabular-nums"
                      >
                        <span className="flex items-center gap-2">
                          {sess.date} · P{sess.period}
                          {sessLocked && (
                            <Lock size={13} className="text-muted-foreground" />
                          )}
                        </span>
                      </TableCell>
                      <TableCell
                        data-label="Marked by"
                        className="text-sm text-muted-foreground"
                      >
                        {sess.markedBy ? userName[sess.markedBy] ?? "—" : "—"}
                      </TableCell>
                      <TableCell
                        data-label="Present"
                        className="text-center tabular-nums text-emerald-700"
                      >
                        {present}
                      </TableCell>
                      <TableCell
                        data-label="Absent"
                        className="text-center tabular-nums text-red-700"
                      >
                        {absent}
                      </TableCell>
                      <TableCell data-label="">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedId(sess.id)}
                          >
                            Open
                          </Button>
                          {can.deleteAttendance &&
                            (!sessLocked || can.overrideLock) && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Delete session"
                              className="hover:text-destructive"
                              onClick={() => setDeleting(sess.id)}
                            >
                              <Trash2 size={16} />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* Roster of the opened session, in a dialog so it never lands off-screen
          below a long session list. Clearing selectedId closes it — including
          the effect above, which fires after the session is deleted. */}
      <SessionRosterDialog
        open={selectedSession != null}
        onOpenChange={(open) => !open && setSelectedId(null)}
        session={selectedSession}
        rows={rosterRows}
        userName={userName}
        canEdit={canEditHere}
        locked={selectedLocked}
      />

      {/* Delete confirmation */}
      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this session?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingSession
                ? `The register for ${deletingSession.date} · P${deletingSession.period} will be removed for the whole class.`
                : "The session will be removed for the whole class."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              loading={deleteAttendanceSession.isPending}
              onClick={async () => {
                if (deleting) {
                  const s = deletingSession;
                  try {
                    await deleteAttendanceSession.mutateAsync(deleting);
                    toast.success(
                      s
                        ? `Removed session ${s.date} · P${s.period}.`
                        : "Session removed.",
                    );
                  } catch (err) {
                    toast.error(errMsg(err));
                  }
                }
                setDeleting(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
