"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { BookUser, Layers, X } from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SelectField } from "@/components/select-field";
import { EMPTY_ARRAY, errMsg } from "@/lib/api";
import type { Teacher } from "@/lib/types";
import {
  useAssignments,
  useAssignTeacher,
  useDepartments,
  usePrograms,
  useSemesters,
  useSettings,
  useTeacherOptions,
  useTerms,
  useUnassignTeacher,
} from "@/lib/queries";
import { PageHeader } from "@/components/page-header";
import { ListCardSkeleton } from "@/components/ui/card-skeleton";
import { semesterInSession } from "@/lib/types";

const NO_TEACHERS: Teacher[] = [];

export default function AssignmentsPage() {
  const { data: programs = EMPTY_ARRAY } = usePrograms();
  const { data: departments = EMPTY_ARRAY } = useDepartments();
  // `?? NO_TEACHERS` rather than `= []`: a fresh [] on every render while
  // the query is loading would give the memo below a new dependency each
  // time, defeating it exactly when the page is busiest.
  const { data: teachers = NO_TEACHERS } = useTeacherOptions();
  const { data: terms = EMPTY_ARRAY } = useTerms();
  const { data: settings } = useSettings();
  const currentTermId = settings?.currentTermId ?? "";
  const { data: assignments = EMPTY_ARRAY, isLoading } = useAssignments(currentTermId);
  const assignTeacher = useAssignTeacher();
  const unassignTeacher = useUnassignTeacher();

  const currentTerm = terms.find((t) => t.id === currentTermId);

  const [programId, setProgramId] = useState("");
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);

  const { data: semesters = EMPTY_ARRAY } = useSemesters(programId);

  async function handleAssign(courseId: string, teacherId: string, code: string) {
    try {
      await assignTeacher.mutateAsync({ courseId, teacherId, termId: currentTermId });
      toast.success(`Added ${teacherById[teacherId]?.name ?? "teacher"} to ${code}.`);
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  async function handleUnassign(
    courseId: string,
    teacherId: string,
    code: string,
    name: string,
  ) {
    try {
      await unassignTeacher.mutateAsync({ courseId, teacherId, termId: currentTermId });
      toast.success(`Removed ${name} from ${code}.`);
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  const programOptions = useMemo(
    () => programs.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` })),
    [programs],
  );

  const deptCode = useMemo(
    () => Object.fromEntries(departments.map((d) => [d.id, d.code])),
    [departments],
  );
  const teacherById = useMemo(
    () => Object.fromEntries(teachers.map((t) => [t.id, t])),
    [teachers],
  );
  // Teachers per course (a course can have several), scoped to the current term.
  const teachersForCourse = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const a of assignments) {
      if (a.termId === currentTermId) (map[a.courseId] ??= []).push(a.teacherId);
    }
    return map;
  }, [assignments, currentTermId]);

  // Only semesters in session this term need staffing: an odd term runs the
  // odd-numbered semesters, an even term the even ones.
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

  // Coverage across the selected program's courses for this term.
  const { totalCourses, assignedCourses } = useMemo(() => {
    let total = 0;
    let assigned = 0;
    for (const sem of programSemesters) {
      for (const c of sem.courses) {
        total += 1;
        if (teachersForCourse[c.id]?.length) assigned += 1;
      }
    }
    return { totalCourses: total, assignedCourses: assigned };
  }, [programSemesters, teachersForCourse]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Teacher Assignments"
        description={`Assign one or more teachers to each course for the current term — cross-department teaching is allowed; all of a course's teachers share one register. ${
          currentTerm
            ? `${currentTerm.parity === "odd" ? "Even" : "Odd"} semesters are out of session in a${
                currentTerm.parity === "odd" ? "n odd" : "n even"
              } term, so only ${currentTerm.parity} semesters are listed.`
            : ""
        }`}
      />

      {/* Program + coverage */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-2 lg:max-w-md lg:flex-1">
          <Label htmlFor="asg-program">Program</Label>
          <SelectField
            id="asg-program"
            options={programOptions}
            value={programId}
            onValueChange={setProgramId}
            placeholder="Select a program"
            searchPlaceholder="Search programs…"
            emptyText="No programs found."
          />
        </div>
        {programId && totalCourses > 0 && (
          <div className="flex items-center gap-4">
            <Badge variant="outline">
              {assignedCourses}/{totalCourses} courses assigned
            </Badge>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={onlyUnassigned}
                onCheckedChange={setOnlyUnassigned}
              />
              Show only unassigned
            </label>
          </div>
        )}
      </div>

      {!programId ? (
        <div className="rounded-xl border bg-card p-8 text-center shadow-sm">
          <BookUser size={24} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm text-muted-foreground">
            Choose a program to assign teachers to its courses.
          </p>
        </div>
      ) : isLoading ? (
        <ListCardSkeleton rows={5} />
      ) : programSemesters.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-center shadow-sm">
          <Layers size={24} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm text-muted-foreground">
            This program has no semesters in session this term.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {programSemesters.map((sem) => {
            const courses = onlyUnassigned
              ? sem.courses.filter((c) => !teachersForCourse[c.id]?.length)
              : sem.courses;
            if (courses.length === 0) return null;
            return (
              <div
                key={sem.id}
                className="overflow-hidden rounded-xl border bg-card shadow-sm"
              >
                <div className="flex items-center gap-2 border-b px-6 py-4">
                  <Layers size={16} className="text-muted-foreground" />
                  <h2 className="text-base font-semibold">
                    Semester {sem.number}
                  </h2>
                  <span className="text-sm text-muted-foreground">
                    · {courses.length} course(s)
                  </span>
                </div>
                <Table variant="stacked">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">Code</TableHead>
                      <TableHead>Course</TableHead>
                      <TableHead className="w-96">Teachers</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {courses.map((c) => {
                      const assigned = teachersForCourse[c.id] ?? [];
                      // Any teacher, minus those already on this course.
                      const addOptions = teachers
                        .filter((t) => !assigned.includes(t.id))
                        .map((t) => ({
                          value: t.id,
                          label: `${t.name} · ${deptCode[t.departmentId] ?? "—"}`,
                        }));
                      return (
                        <TableRow key={c.id}>
                          <TableCell data-label="Code" className="font-mono text-sm">
                            {c.code}
                          </TableCell>
                          <TableCell data-label="Course" className="font-medium">
                            {c.name}
                          </TableCell>
                          <TableCell data-label="">
                            <div className="flex flex-col gap-2">
                              {assigned.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                  {assigned.map((tid) => {
                                    const t = teacherById[tid];
                                    return (
                                      <Badge key={tid} variant="secondary">
                                        {t ? t.name : "—"}
                                        {t && (
                                          <span className="text-muted-foreground">
                                            · {deptCode[t.departmentId] ?? "—"}
                                          </span>
                                        )}
                                        <button
                                          type="button"
                                          aria-label={`Remove ${t?.name ?? "teacher"}`}
                                          className="ml-0.5 rounded-sm opacity-60 transition-opacity hover:opacity-100"
                                          onClick={() =>
                                            void handleUnassign(
                                              c.id,
                                              tid,
                                              c.code,
                                              t?.name ?? "teacher",
                                            )
                                          }
                                        >
                                          <X size={12} />
                                        </button>
                                      </Badge>
                                    );
                                  })}
                                </div>
                              )}
                              <SelectField
                                options={addOptions}
                                value=""
                                onValueChange={(v) => {
                                  if (!v) return;
                                  void handleAssign(c.id, v, c.code);
                                }}
                                placeholder={
                                  assigned.length > 0
                                    ? "Add another teacher…"
                                    : "Assign a teacher…"
                                }
                                searchPlaceholder="Search teachers…"
                                emptyText="No teachers found."
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
