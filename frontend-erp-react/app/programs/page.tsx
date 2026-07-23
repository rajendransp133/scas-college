"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Building2,
  GraduationCap,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
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
import {
  PROGRAM_LEVELS,
  PROGRAM_LEVEL_LABELS,
  type Program,
  type ProgramLevel,
} from "@/lib/types";
import { EMPTY_ARRAY, errMsg } from "@/lib/api";
import {
  useDeleteProgram,
  useDepartments,
  usePrograms,
  useSemesters,
} from "@/lib/queries";
import { useAuth } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { TableRowsSkeleton } from "@/components/ui/table-skeleton";
import { ProgramFormDialog } from "@/components/programs/program-form-dialog";
import { ManageDepartmentsDialog } from "@/components/departments/manage-departments-dialog";

type GroupBy = "none" | "department" | "level";

const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "none", label: "None" },
  { value: "department", label: "Department" },
  { value: "level", label: "UG / PG / PhD" },
];

const LEVEL_BADGE: Record<ProgramLevel, string> = {
  UG: "border-sky-200 bg-sky-50 text-sky-700",
  PG: "border-violet-200 bg-violet-50 text-violet-700",
  PhD: "border-amber-200 bg-amber-50 text-amber-700",
};

const COLS = 5;

export default function ProgramsPage() {
  const router = useRouter();
  const { data: allPrograms = EMPTY_ARRAY, isLoading } = usePrograms();
  const { data: departments = EMPTY_ARRAY } = useDepartments();
  const deleteProgram = useDeleteProgram();
  const { can, role, departmentId: authDeptId } = useAuth();

  // HODs only see their own department's programs.
  const programs = useMemo(
    () =>
      role === "hod"
        ? allPrograms.filter((p) => p.departmentId === authDeptId)
        : allPrograms,
    [allPrograms, role, authDeptId],
  );

  const [groupBy, setGroupBy] = useState<GroupBy>("department");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Program | null>(null);
  const [deleting, setDeleting] = useState<Program | null>(null);
  const [deptDialogOpen, setDeptDialogOpen] = useState(false);
  // Department to pre-select when adding a program from its group header.
  const [addProgramForDept, setAddProgramForDept] = useState<string | null>(null);

  const deptName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const d of departments) map[d.id] = d.name;
    return map;
  }, [departments]);

  // Fetch semesters only for the program being deleted (for the confirm copy).
  const { data: deletingSemesters = EMPTY_ARRAY } = useSemesters(deleting?.id);

  // Build the (optionally grouped) sections to render in the table.
  const groups = useMemo<{ key: string; label: string | null; items: Program[] }[]>(() => {
    if (groupBy === "department") {
      const known = departments.map((d) => ({
        key: d.id,
        label: d.name,
        items: programs.filter((p) => p.departmentId === d.id),
      }));
      const orphans = programs.filter(
        (p) => !departments.some((d) => d.id === p.departmentId),
      );
      return [
        ...known,
        ...(orphans.length ? [{ key: "unassigned", label: "Unassigned", items: orphans }] : []),
      ].filter((g) => g.items.length > 0);
    }
    if (groupBy === "level") {
      return PROGRAM_LEVELS.map((lvl) => ({
        key: lvl,
        label: `${PROGRAM_LEVEL_LABELS[lvl]} · ${lvl}`,
        items: programs.filter((p) => p.level === lvl),
      })).filter((g) => g.items.length > 0);
    }
    return [{ key: "all", label: null, items: programs }];
  }, [groupBy, programs, departments]);

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await deleteProgram.mutateAsync(deleting.id);
      toast.success(`Deleted "${deleting.name}".`);
    } catch (err) {
      toast.error(errMsg(err));
    }
    setDeleting(null);
  }

  function renderRow(p: Program) {
    return (
      <TableRow key={p.id}>
        <TableCell data-label="Name">
          <Link
            href={`/programs/${p.id}`}
            className="group inline-flex items-center gap-1 font-medium hover:underline"
          >
            {p.name}
            <ChevronRight
              size={14}
              className="opacity-0 transition-opacity group-hover:opacity-60"
            />
          </Link>
        </TableCell>
        <TableCell data-label="Level">
          <Badge variant="outline" className={LEVEL_BADGE[p.level]}>
            {p.level}
          </Badge>
        </TableCell>
        <TableCell data-label="Code">
          <Badge variant="secondary" className="font-mono">
            {p.code}
          </Badge>
        </TableCell>
        <TableCell data-label="Department" className="text-muted-foreground">
          {deptName[p.departmentId] ?? "—"}
        </TableCell>
        <TableCell data-label="">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label="Actions">
                  <MoreHorizontal size={16} />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => router.push(`/programs/${p.id}`)}>
                <ChevronRight size={16} />
                View detail
              </DropdownMenuItem>
              {can.manageAcademics && (
                <>
                  <DropdownMenuItem onClick={() => setEditing(p)}>
                    <Pencil size={16} />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onClick={() => setDeleting(p)}>
                    <Trash2 size={16} />
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Programs & Curriculum"
        description="Degree programs offered, each linked to a department."
        action={
          can.manageAcademics ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setDeptDialogOpen(true)}>
                <Building2 size={16} />
                Departments
              </Button>
              <Button onClick={() => setCreateOpen(true)} disabled={departments.length === 0}>
                <Plus size={16} />
                New program
              </Button>
            </div>
          ) : undefined
        }
      />

      {departments.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">
            Create a department first — programs must belong to one.
          </p>
          {can.manageAcademics && (
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => setDeptDialogOpen(true)}
            >
              <Building2 size={16} />
              Manage departments
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* Group-by controls */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Group by</span>
            {GROUP_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                size="sm"
                variant={groupBy === opt.value ? "default" : "outline"}
                onClick={() => setGroupBy(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </div>

          <div className="overflow-hidden rounded-xl border bg-card shadow-sm max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:shadow-none">
            <Table variant="stacked">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRowsSkeleton rows={8} cols={COLS} />
                ) : programs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={COLS} className="h-32 text-center text-muted-foreground">
                      <GraduationCap size={24} className="mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No programs yet.</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  groups.map((group) => (
                    <Fragment key={group.key}>
                      {group.label !== null ? (
                        <TableRow className="bg-muted/50 hover:bg-muted/50">
                          <TableCell colSpan={COLS} className="py-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                                {group.label}
                                <span className="ml-1.5 font-normal normal-case">
                                  ({group.items.length})
                                </span>
                              </span>
                              {groupBy === "department" &&
                                group.key !== "unassigned" &&
                                can.manageAcademics && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 text-muted-foreground"
                                    onClick={() => setAddProgramForDept(group.key)}
                                  >
                                    <Plus size={14} />
                                    Program
                                  </Button>
                                )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : null}
                      {group.items.map(renderRow)}
                    </Fragment>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <ProgramFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      <ProgramFormDialog
        open={Boolean(editing)}
        onOpenChange={(o) => !o && setEditing(null)}
        program={editing ?? undefined}
      />
      {/* Add a program pre-scoped to a department group */}
      <ProgramFormDialog
        open={Boolean(addProgramForDept)}
        onOpenChange={(o) => !o && setAddProgramForDept(null)}
        defaultDepartmentId={addProgramForDept ?? undefined}
      />
      <ManageDepartmentsDialog
        open={deptDialogOpen}
        onOpenChange={setDeptDialogOpen}
      />

      <AlertDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete program?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove <strong>{deleting?.name}</strong> and its{" "}
              {deletingSemesters.length} semester(s). This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              loading={deleteProgram.isPending}
              onClick={confirmDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
