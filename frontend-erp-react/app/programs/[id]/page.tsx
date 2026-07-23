"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  Layers,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { EMPTY_ARRAY, errMsg } from "@/lib/api";
import {
  useAddCourse,
  useAddSemester,
  useDeleteCourse,
  useDeleteSemester,
  useDepartments,
  useProgram,
} from "@/lib/queries";
import { useAuth } from "@/lib/permissions";
import { DetailPageSkeleton } from "@/components/ui/card-skeleton";
import { COURSE_TYPES, type CourseType } from "@/lib/types";
import { SelectField } from "@/components/select-field";
import { ProgramFormDialog } from "@/components/programs/program-form-dialog";
import { PageHeader } from "@/components/page-header";

const COURSE_TYPE_OPTIONS = COURSE_TYPES.map((t) => ({ value: t, label: t }));

function BackLink() {
  return (
    <Link
      href="/programs"
      className="inline-flex items-center gap-2 self-start rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <ArrowLeft size={16} />
      Back to programs
    </Link>
  );
}

export default function ProgramDetailPage() {
  const params = useParams<{ id: string }>();
  const programId = params.id;

  const { data: program, isLoading } = useProgram(programId);
  const { data: departments = EMPTY_ARRAY } = useDepartments();
  const addSemester = useAddSemester();
  const deleteSemester = useDeleteSemester();
  const addCourse = useAddCourse();
  const deleteCourse = useDeleteCourse();
  const { can } = useAuth();

  const department = departments.find((d) => d.id === program?.departmentId);

  const programSemesters = useMemo(
    () => [...(program?.semesters ?? [])].sort((a, b) => a.number - b.number),
    [program],
  );

  const [editOpen, setEditOpen] = useState(false);
  const [semDialogOpen, setSemDialogOpen] = useState(false);
  const [semNumber, setSemNumber] = useState("");
  // Course dialog: which semester we're adding to.
  const [courseSemesterId, setCourseSemesterId] = useState<string | null>(null);
  const [courseName, setCourseName] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [courseCredits, setCourseCredits] = useState("3");
  const [courseType, setCourseType] = useState<CourseType>("Core");

  // A slow fetch must never flash "not found" — show the page's shape instead.
  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <DetailPageSkeleton />
      </div>
    );
  }

  if (!program) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <div className="rounded-xl border bg-card p-8 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">
            Program not found. It may have been deleted.
          </p>
        </div>
      </div>
    );
  }

  async function handleAddSemester(e: React.FormEvent) {
    e.preventDefault();
    const num = Number(semNumber);
    if (!Number.isInteger(num) || num < 1) {
      toast.error("Enter a valid semester number.");
      return;
    }
    // Enforce unique (number, programId).
    if (programSemesters.some((s) => s.number === num)) {
      toast.error(`Semester ${num} already exists for this program.`);
      return;
    }
    try {
      await addSemester.mutateAsync({ programId, number: num });
      toast.success(`Semester ${num} added.`);
      setSemNumber("");
      setSemDialogOpen(false);
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  function openCourseDialog(semesterId: string) {
    setCourseSemesterId(semesterId);
    setCourseName("");
    setCourseCode("");
    setCourseCredits("3");
    setCourseType("Core");
  }

  async function handleAddCourse(e: React.FormEvent) {
    e.preventDefault();
    if (!courseSemesterId) return;
    const name = courseName.trim();
    const code = courseCode.trim().toUpperCase();
    const credits = Number(courseCredits);
    if (!name || !code) {
      toast.error("Course name and code are required.");
      return;
    }
    if (!Number.isFinite(credits) || credits <= 0) {
      toast.error("Credits must be a positive number.");
      return;
    }
    try {
      await addCourse.mutateAsync({
        semesterId: courseSemesterId,
        input: { name, code, credits, type: courseType },
      });
      toast.success("Course added.");
      setCourseSemesterId(null);
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  async function handleDeleteSemester(semesterId: string, number: number) {
    try {
      await deleteSemester.mutateAsync(semesterId);
      toast.success(`Semester ${number} removed.`);
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  async function handleDeleteCourse(semesterId: string, courseId: string) {
    try {
      await deleteCourse.mutateAsync({ semesterId, courseId });
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  const nextSemesterNumber =
    programSemesters.length > 0
      ? Math.max(...programSemesters.map((s) => s.number)) + 1
      : 1;

  return (
    <div className="flex flex-col gap-6">
      <BackLink />

      <PageHeader
        title={`${program.name} (${program.code})`}
        description={
          department ? `${department.name} (${department.code})` : undefined
        }
        action={
          can.manageAcademics ? (
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil size={16} />
              Edit program
            </Button>
          ) : undefined
        }
      />

      {/* Semesters */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Semesters</h2>
          <Badge variant="outline">
            <Layers size={14} />
            {programSemesters.length} semester(s)
          </Badge>
        </div>
        {can.manageAcademics && (
          <Button
            size="sm"
            onClick={() => {
              setSemNumber(String(nextSemesterNumber));
              setSemDialogOpen(true);
            }}
          >
            <Plus size={16} />
            Add semester
          </Button>
        )}
      </div>

      {programSemesters.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-center shadow-sm">
          <Layers size={24} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm text-muted-foreground">
            No semesters defined yet.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {programSemesters.map((sem) => {
            const totalCredits = sem.courses.reduce(
              (sum, c) => sum + c.credits,
              0,
            );
            return (
              <Collapsible
                key={sem.id}
                className="rounded-xl border bg-card shadow-sm"
              >
                <div className="flex items-center justify-between p-6">
                  <CollapsibleTrigger className="group flex flex-1 items-center gap-2 text-left outline-none">
                    <ChevronRight
                      size={18}
                      className="shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90"
                    />
                    <h3 className="text-base font-semibold">
                      Semester {sem.number}
                    </h3>
                    <span className="text-sm text-muted-foreground">
                      · {sem.courses.length} course(s) · {totalCredits} credits
                    </span>
                  </CollapsibleTrigger>
                  {can.manageAcademics && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openCourseDialog(sem.id)}
                      >
                        <Plus size={16} />
                        Add course
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Delete semester"
                        className="hover:text-destructive"
                        onClick={() =>
                          void handleDeleteSemester(sem.id, sem.number)
                        }
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  )}
                </div>
                <CollapsibleContent>
                  {sem.courses.length === 0 ? (
                    <p className="px-6 pb-6 text-sm text-muted-foreground">
                      No courses yet.
                    </p>
                  ) : (
                    <Table variant="stacked">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Code</TableHead>
                          <TableHead>Course</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead className="text-right">Credits</TableHead>
                          <TableHead className="w-12" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sem.courses.map((c) => (
                          <TableRow key={c.id}>
                            <TableCell data-label="Code">{c.code}</TableCell>
                            <TableCell data-label="Course" className="font-medium">
                              {c.name}
                            </TableCell>
                            <TableCell
                              data-label="Type"
                              className="text-muted-foreground"
                            >
                              {c.type ?? "—"}
                            </TableCell>
                            <TableCell
                              data-label="Credits"
                              className="text-right tabular-nums"
                            >
                              {c.credits}
                            </TableCell>
                            <TableCell data-label="">
                              {can.manageAcademics && (
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label="Delete course"
                                  className="hover:text-destructive"
                                  onClick={() =>
                                    void handleDeleteCourse(sem.id, c.id)
                                  }
                                >
                                  <Trash2 size={16} />
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      )}

      <ProgramFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        program={program}
      />

      {/* Add semester dialog */}
      <Dialog open={semDialogOpen} onOpenChange={setSemDialogOpen}>
        <DialogContent>
          <form onSubmit={handleAddSemester} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Add semester</DialogTitle>
              <DialogDescription>
                Semester numbers must be unique within this program.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2 py-2">
              <Label htmlFor="sem-number">Semester number</Label>
              <Input
                id="sem-number"
                type="number"
                min={1}
                value={semNumber}
                onChange={(e) => setSemNumber(e.target.value)}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSemDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit">Add</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add course dialog */}
      <Dialog
        open={Boolean(courseSemesterId)}
        onOpenChange={(o) => !o && setCourseSemesterId(null)}
      >
        <DialogContent>
          <form onSubmit={handleAddCourse} className="grid gap-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <BookOpen size={16} />
                Add course
              </DialogTitle>
              <DialogDescription>
                Add a course to this semester.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="course-name">Name</Label>
                <Input
                  id="course-name"
                  value={courseName}
                  onChange={(e) => setCourseName(e.target.value)}
                  placeholder="e.g. Data Structures"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="course-code">Code</Label>
                  <Input
                    id="course-code"
                    value={courseCode}
                    onChange={(e) => setCourseCode(e.target.value)}
                    placeholder="e.g. BCA201"
                    className="uppercase"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="course-credits">Credits</Label>
                  <Input
                    id="course-credits"
                    type="number"
                    min={1}
                    value={courseCredits}
                    onChange={(e) => setCourseCredits(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="course-type">Type</Label>
                <SelectField
                  id="course-type"
                  options={COURSE_TYPE_OPTIONS}
                  value={courseType}
                  onValueChange={(v) => setCourseType((v || "Core") as CourseType)}
                  placeholder="Select type"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCourseSemesterId(null)}
              >
                Cancel
              </Button>
              <Button type="submit">Add course</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
