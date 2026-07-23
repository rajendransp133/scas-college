"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowUpNarrowWide,
  GraduationCap,
  Layers,
  TriangleAlert,
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  useGraduateStudents,
  usePrograms,
  usePromoteStudents,
  useSemesters,
  useSettings,
  useStudents,
  useTerms,
} from "@/lib/queries";
import { PageHeader } from "@/components/page-header";
import { ListCardSkeleton } from "@/components/ui/card-skeleton";
import { semesterInSession, type Student } from "@/lib/types";

type PendingAction = {
  type: "promote" | "graduate";
  sem: number;
  students: Student[];
};

export default function PromotionsPage() {
  const { data: programs = EMPTY_ARRAY } = usePrograms();
  const { data: terms = EMPTY_ARRAY } = useTerms();
  const { data: settings } = useSettings();
  const currentTermId = settings?.currentTermId ?? "";
  const promoteStudents = usePromoteStudents();
  const graduateStudents = useGraduateStudents();

  const [programId, setProgramId] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);

  const { data: semesters = EMPTY_ARRAY } = useSemesters(programId);

  const currentTerm = useMemo(
    () => terms.find((t) => t.id === currentTermId),
    [terms, currentTermId],
  );

  // Semester numbers that are OUT of session for this term's parity — an odd
  // term runs odd semesters, so even cohorts are the ones still waiting.
  const outOfSessionSemesters = useMemo(
    () =>
      currentTerm
        ? Array.from({ length: 12 }, (_, i) => i + 1).filter(
            (n) => !semesterInSession(n, currentTerm),
          )
        : [],
    [currentTerm],
  );

  // College-wide count of students sitting in an out-of-session semester.
  // Only the total is needed, so this asks for a single row.
  const { data: outOfSessionPage } = useStudents({
    status: "active",
    semesters: outOfSessionSemesters,
    pageSize: 1,
  });
  const outOfSessionCount = currentTerm ? (outOfSessionPage?.total ?? 0) : 0;

  // Enrolled students of the selected program — one program is a few hundred
  // rows, so a single generous page covers every cohort on the page.
  const { data: enrolledPage, isLoading } = useStudents({
    programId: programId || undefined,
    status: "active",
    pageSize: 200,
  });
  const { data: graduatedPage } = useStudents({
    programId: programId || undefined,
    status: "graduated",
    pageSize: 1,
  });

  const programOptions = useMemo(
    () => programs.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` })),
    [programs],
  );

  // The highest defined semester number for this program (its final semester).
  const maxSemester = useMemo(() => {
    const nums = semesters
      .filter((s) => s.programId === programId)
      .map((s) => s.number);
    return nums.length > 0 ? Math.max(...nums) : 0;
  }, [semesters, programId]);

  const enrolled = useMemo(
    () => (programId ? (enrolledPage?.items ?? []) : []),
    [enrolledPage, programId],
  );

  const graduatedCount = programId ? (graduatedPage?.total ?? 0) : 0;

  // Group enrolled students into cohorts by current semester.
  const cohorts = useMemo(() => {
    const map = new Map<number, Student[]>();
    for (const s of enrolled) {
      const list = map.get(s.currentSemester) ?? [];
      list.push(s);
      map.set(s.currentSemester, list);
    }
    return [...map.entries()]
      .map(([sem, list]) => ({ sem, list }))
      .sort((a, b) => a.sem - b.sem);
  }, [enrolled]);

  async function confirmPending() {
    if (!pending) return;
    const ids = pending.students.map((s) => s.id);
    try {
      if (pending.type === "promote") {
        const { repsRemoved } = await promoteStudents.mutateAsync(ids);
        toast.success(
          `Promoted ${ids.length} student(s) to semester ${pending.sem + 1}.`,
          // The old login is gone the moment the class leaves the semester —
          // the admin has to create the new one, so say so plainly rather than
          // letting them find out when the reps can't sign in.
          repsRemoved
            ? {
                description: `${repsRemoved} class-rep login(s) retired. Create a new one for semester ${pending.sem + 1} in Users.`,
              }
            : undefined,
        );
      } else {
        const { repsRemoved } = await graduateStudents.mutateAsync(ids);
        toast.success(
          `Graduated ${ids.length} student(s).`,
          repsRemoved
            ? { description: `${repsRemoved} class-rep login(s) retired.` }
            : undefined,
        );
      }
    } catch (err) {
      toast.error(errMsg(err));
    }
    setPending(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Promotions"
        description="Advance a semester's cohort to the next semester, or graduate the final-year batch."
      />

      {outOfSessionCount > 0 && currentTerm && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
          <p>
            The current term is <strong>{currentTerm.name}</strong>:{" "}
            {outOfSessionCount} student(s) are still in{" "}
            {currentTerm.parity === "odd" ? "even" : "odd"} semesters, which are
            out of session. Promote or graduate them so every class matches the
            term.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2 lg:max-w-md">
        <Label htmlFor="promo-program">Program</Label>
        <SelectField
          id="promo-program"
          options={programOptions}
          value={programId}
          onValueChange={setProgramId}
          placeholder="Select a program"
          searchPlaceholder="Search programs…"
          emptyText="No programs found."
        />
      </div>

      {!programId ? (
        <div className="rounded-xl border bg-card p-8 text-center shadow-sm">
          <ArrowUpNarrowWide size={24} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm text-muted-foreground">
            Choose a program to see its semester cohorts.
          </p>
        </div>
      ) : isLoading ? (
        <ListCardSkeleton rows={4} />
      ) : cohorts.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-center shadow-sm">
          <Users size={24} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm text-muted-foreground">
            No active students enrolled in this program.
          </p>
          {graduatedCount > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {graduatedCount} graduated.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border bg-card shadow-sm max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:shadow-none">
            <Table variant="stacked">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40">Semester</TableHead>
                  <TableHead>Students</TableHead>
                  <TableHead className="w-72 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cohorts.map(({ sem, list }) => {
                  const isFinal = maxSemester > 0 && sem >= maxSemester;
                  return (
                    <TableRow key={sem}>
                      <TableCell data-label="">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">
                            <Layers size={14} />
                            Sem {sem}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            Year {Math.ceil(sem / 2)}
                          </span>
                          {!semesterInSession(sem, currentTerm) && (
                            <Badge
                              variant="outline"
                              className="border-amber-200 bg-amber-50 text-amber-700"
                            >
                              Out of session
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell data-label="Students">
                        <span className="font-medium tabular-nums">
                          {list.length}
                        </span>{" "}
                        <span className="text-sm text-muted-foreground">
                          · {list.map((s) => s.name).join(", ")}
                        </span>
                      </TableCell>
                      <TableCell data-label="">
                        <div className="flex items-center justify-end gap-2 max-md:justify-stretch max-md:[&>*]:flex-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setPending({ type: "promote", sem, students: list })
                            }
                          >
                            <ArrowUpNarrowWide size={16} />
                            To Sem {sem + 1}
                          </Button>
                          <Button
                            variant={isFinal ? "default" : "outline"}
                            size="sm"
                            onClick={() =>
                              setPending({ type: "graduate", sem, students: list })
                            }
                          >
                            <GraduationCap size={16} />
                            Graduate
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {graduatedCount > 0 && (
            <p className="text-sm text-muted-foreground">
              {graduatedCount} student(s) already graduated from this program.
            </p>
          )}
        </>
      )}

      <AlertDialog
        open={Boolean(pending)}
        onOpenChange={(o) => !o && setPending(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.type === "promote"
                ? `Promote semester ${pending?.sem} cohort?`
                : `Graduate semester ${pending?.sem} cohort?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.type === "promote" ? (
                <>
                  This moves <strong>{pending?.students.length}</strong>{" "}
                  student(s) from semester {pending?.sem} to semester{" "}
                  {(pending?.sem ?? 0) + 1}.
                </>
              ) : (
                <>
                  This marks <strong>{pending?.students.length}</strong>{" "}
                  student(s) as graduated. They are removed from class rosters
                  but keep their records.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {/* A cohort can be hundreds of students — this is the slowest
                mutation in the app, so it must not look like a dead click. */}
            <AlertDialogAction
              onClick={confirmPending}
              loading={promoteStudents.isPending || graduateStudents.isPending}
            >
              {pending?.type === "promote" ? "Promote" : "Graduate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
