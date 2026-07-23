"use client";

// The roster of one saved attendance session, opened from the Correct
// Attendance table. It lives in a dialog so the roster never gets pushed off
// screen under a long list of sessions.

import { toast } from "sonner";
import { Lock } from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { errMsg } from "@/lib/api";
import { useSetAttendanceStatus } from "@/lib/queries";
import { ATTENDANCE_STATUSES, STATUS_META } from "@/lib/attendance";
import type { AttendanceRecord, AttendanceSession, Student } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface RosterRow {
  record: AttendanceRecord;
  student: Student;
}

interface SessionRosterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: AttendanceSession | undefined;
  rows: RosterRow[];
  /** userId → display name, for the "corrected by" hover title. */
  userName: Record<string, string>;
  /** False when the viewer may only read (no rights, or a lock they can't override). */
  canEdit: boolean;
  locked: boolean;
}

/** The hover text on a corrected record's amber dot: what changed, by whom, when. */
function correctionTitle(
  record: AttendanceRecord,
  userName: Record<string, string>,
): string | undefined {
  if (!record.originalStatus) return undefined;
  const from =
    STATUS_META[record.originalStatus]?.label ?? record.originalStatus;
  const to = STATUS_META[record.status]?.label ?? record.status;
  const by = record.editedBy
    ? ` by ${userName[record.editedBy] ?? "unknown"}`
    : "";
  const on = record.editedAt ? ` on ${record.editedAt.slice(0, 10)}` : "";
  return `Corrected: ${from} → ${to}${by}${on}`;
}

/** "Left" / "Graduated" tag — history never silently disappears. */
function StudentTag({ student }: { student: Student }) {
  if (student.graduated) {
    return (
      <Badge
        variant="outline"
        className="shrink-0 border-violet-200 bg-violet-50 text-violet-700"
      >
        Graduated
      </Badge>
    );
  }
  if (!student.isActive) {
    return (
      <Badge variant="outline" className="shrink-0 text-muted-foreground">
        Left
      </Badge>
    );
  }
  return null;
}

export function SessionRosterDialog({
  open,
  onOpenChange,
  session,
  rows,
  userName,
  canEdit,
  locked,
}: SessionRosterDialogProps) {
  const setAttendanceStatus = useSetAttendanceStatus();

  async function correct(row: RosterRow, to: (typeof ATTENDANCE_STATUSES)[number]) {
    if (!session || to.value === row.record.status) return;
    const was = STATUS_META[row.record.status]?.label ?? row.record.status;
    try {
      await setAttendanceStatus.mutateAsync({
        sessionId: session.id,
        studentId: row.student.id,
        status: to.value,
      });
      toast.success(`${row.student.name}: ${was} → ${to.label}.`);
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {session ? `${session.date} · Period ${session.period}` : "Session"}
            {locked && (
              <Badge
                variant="outline"
                className="border-amber-200 bg-amber-50 text-amber-700"
              >
                <Lock size={12} />
                Locked
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {canEdit
              ? "Tap a status to correct it. Every change is stamped and stays on the audit log."
              : "This session is read-only for your role."}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-6 max-h-[60svh] overflow-y-auto px-6">
          {/* Desktop roster */}
          <div className="hidden overflow-hidden rounded-xl border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Roll No.</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead
                    className={cn("w-56", canEdit ? "text-right" : "text-center")}
                  >
                    Status
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const { record, student } = row;
                  const meta = STATUS_META[record.status];
                  const title = correctionTitle(record, userName);
                  return (
                    <TableRow key={student.id}>
                      <TableCell className="font-mono text-sm">
                        {student.rollNumber}
                      </TableCell>
                      <TableCell className="font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          {student.name}
                          <StudentTag student={student} />
                          {title && (
                            <span
                              title={title}
                              className="size-2 shrink-0 rounded-full bg-amber-500"
                            />
                          )}
                        </span>
                      </TableCell>
                      <TableCell>
                        {canEdit ? (
                          <div className="flex justify-end gap-1">
                            {ATTENDANCE_STATUSES.map((m) => (
                              <button
                                key={m.value}
                                type="button"
                                title={m.label}
                                onClick={() => void correct(row, m)}
                                className={cn(
                                  "h-7 min-w-9 rounded-md border px-2 text-xs font-semibold transition-colors",
                                  record.status === m.value
                                    ? m.badgeClass
                                    : "border-transparent bg-muted/40 text-muted-foreground hover:bg-muted",
                                )}
                              >
                                {m.short}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center">
                            <Badge
                              variant="outline"
                              className={meta?.badgeClass}
                              title={title}
                            >
                              {meta?.label ?? record.status}
                            </Badge>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile roster: one card per student. */}
          <div className="flex flex-col gap-2 md:hidden">
            {rows.map((row) => {
              const { record, student } = row;
              const meta = STATUS_META[record.status];
              const title = correctionTitle(record, userName);
              return (
                <div key={student.id} className="rounded-xl border p-3">
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate font-medium">
                        {student.name}
                        {title && (
                          <span
                            title={title}
                            className="size-2 shrink-0 rounded-full bg-amber-500"
                          />
                        )}
                      </p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {student.rollNumber}
                      </p>
                    </div>
                    <StudentTag student={student} />
                  </div>
                  {canEdit ? (
                    <div className="grid grid-cols-4 gap-2">
                      {ATTENDANCE_STATUSES.map((m) => (
                        <button
                          key={m.value}
                          type="button"
                          title={m.label}
                          onClick={() => void correct(row, m)}
                          className={cn(
                            "h-11 rounded-md border text-sm font-semibold transition-colors",
                            record.status === m.value
                              ? m.badgeClass
                              : "border-transparent bg-muted/40 text-muted-foreground hover:bg-muted",
                          )}
                        >
                          {m.short}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Badge
                      variant="outline"
                      className={meta?.badgeClass}
                      title={title}
                    >
                      {meta?.label ?? record.status}
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
