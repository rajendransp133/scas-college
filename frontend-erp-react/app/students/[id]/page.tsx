"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Pencil } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ApiError, EMPTY_ARRAY, errMsg } from "@/lib/api";
import {
  useStudentBreakdown,
  useCourses,
  useDepartments,
  usePrograms,
  useStudent,
  useToggleStudentActive,
} from "@/lib/queries";
import { useAuth } from "@/lib/permissions";
import { DetailPageSkeleton } from "@/components/ui/card-skeleton";
import { QueryError } from "@/components/query-error";
import { DEFAULT_MIN_ATTENDANCE, pct, pctColor } from "@/lib/attendance";
import { StudentFormDialog } from "@/components/students/student-form-dialog";
import { PageHeader } from "@/components/page-header";

function BackLink() {
  return (
    <Link
      href="/students"
      className="inline-flex items-center gap-2 self-start rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <ArrowLeft size={16} />
      Back to students
    </Link>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{children || "—"}</p>
    </div>
  );
}

function CardTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-4 text-base font-semibold">{children}</h2>;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: student, isLoading, error, refetch } = useStudent(id);
  const { data: departments = EMPTY_ARRAY } = useDepartments();
  const { data: programs = EMPTY_ARRAY } = usePrograms();
  const { data: courses = EMPTY_ARRAY } = useCourses();
  // Per-course tally, aggregated in SQL. This page used to fetch every
  // attendance session in the database and filter it down to one student.
  const { data: attendanceRows = EMPTY_ARRAY } = useStudentBreakdown(id);
  const toggleStudentActive = useToggleStudentActive();
  const { can } = useAuth();
  const [editOpen, setEditOpen] = useState(false);

  const courseName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of courses) map[c.id] = `${c.name} (${c.code})`;
    return map;
  }, [courses]);

  const overall = useMemo(() => {
    const attended = attendanceRows.reduce((s, r) => s + r.attended, 0);
    const held = attendanceRows.reduce((s, r) => s + r.held, 0);
    return { attended, held, pct: pct(attended, held) };
  }, [attendanceRows]);

  // A slow fetch must never flash "not found" — show the page's shape instead.
  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <DetailPageSkeleton />
      </div>
    );
  }

  // A 404 is "not found"; anything else (403, 500, network) is a failure to
  // load, not evidence the student is gone.
  if (!student && error && !(error instanceof ApiError && error.status === 404)) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <QueryError error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  if (!student) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <div className="rounded-xl border bg-card p-8 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">
            Student not found. It may have been deleted.
          </p>
        </div>
      </div>
    );
  }

  const department = departments.find((d) => d.id === student.departmentId);
  const program = programs.find((p) => p.id === student.programId);

  return (
    <div className="flex flex-col gap-6">
      <BackLink />

      <PageHeader
        title={student.name}
        description={`${student.rollNumber} · ${program?.name ?? "Unknown program"}`}
        action={
          can.manageAcademics ? (
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil size={16} />
              Edit
            </Button>
          ) : undefined
        }
      />

      <div className="flex items-center gap-2">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
          {initials(student.name)}
        </div>
        <div className="flex  rounded-lg p-3 gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="detail-active">Active enrolment</Label>
            <p className="text-xs text-muted-foreground">
              Toggling off soft-deletes the student.
            </p>
          </div>
          <Switch
            id="detail-active"
            checked={student.isActive}
            disabled={!can.manageAcademics}
            onCheckedChange={async () => {
              try {
                await toggleStudentActive.mutateAsync(student.id);
                toast.success(
                  student.isActive ? "Marked inactive." : "Marked active.",
                );
              } catch (err) {
                toast.error(errMsg(err));
              }
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <CardTitle>Academic</CardTitle>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Department">{department?.name}</Field>
            <Field label="Program">
              {program ? `${program.name} (${program.code})` : ""}
            </Field>
            <Field label="Current semester">
              Semester {student.currentSemester}
            </Field>
            <Field label="Admission year">{student.admissionYear}</Field>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <CardTitle>Personal &amp; Contact</CardTitle>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Date of birth">{student.dateOfBirth}</Field>
            {/* The span is always truthy, so Field's own "—" fallback would
                never fire — do it here instead. */}
            <Field label="Gender">
              {student.gender ? (
                <span className="capitalize">{student.gender}</span>
              ) : null}
            </Field>
            <Field label="Email">{student.email}</Field>
            <Field label="Phone">{student.phone}</Field>
            <div className="sm:col-span-2">
              <Field label="Address">{student.address}</Field>
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <CardTitle>Parent / Guardian</CardTitle>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name">{student.guardianName}</Field>
            <Field label="Relation">{student.guardianRelation}</Field>
            <Field label="Phone">{student.guardianPhone}</Field>
          </div>
        </div>
      </div>

      {/* Attendance */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <CardTitle>Attendance</CardTitle>
          {overall.pct !== null && (
            <Badge
              variant="outline"
              className={
                overall.pct < DEFAULT_MIN_ATTENDANCE
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
              }
            >
              Overall {overall.pct}% ({overall.attended}/{overall.held})
            </Badge>
          )}
        </div>
        {attendanceRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No attendance recorded yet.
          </p>
        ) : (
          <Table variant="stacked">
            <TableHeader>
              <TableRow>
                <TableHead>Course</TableHead>
                <TableHead className="text-center">Held</TableHead>
                <TableHead className="text-center">Attended</TableHead>
                <TableHead className="text-center">%</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {attendanceRows.map((r) => {
                const short = r.pct !== null && r.pct < DEFAULT_MIN_ATTENDANCE;
                return (
                  <TableRow key={r.courseId}>
                    <TableCell data-label="Course" className="font-medium">
                      {courseName[r.courseId] ?? "Unknown course"}
                    </TableCell>
                    <TableCell
                      data-label="Held"
                      className="text-center tabular-nums"
                    >
                      {r.held}
                    </TableCell>
                    <TableCell
                      data-label="Attended"
                      className="text-center tabular-nums"
                    >
                      {r.attended}
                    </TableCell>
                    <TableCell
                      data-label="%"
                      className={`text-center tabular-nums ${pctColor(r.pct)}`}
                    >
                      {r.pct === null ? "—" : `${r.pct}%`}
                    </TableCell>
                    <TableCell data-label="">
                      {short && (
                        <Badge
                          variant="outline"
                          className="border-red-200 bg-red-50 text-red-700"
                        >
                          Shortfall
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <StudentFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        student={student}
      />
    </div>
  );
}
