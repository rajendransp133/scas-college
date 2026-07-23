"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, UserCog } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import type { Teacher } from "@/lib/types";
import { EMPTY_ARRAY, errMsg } from "@/lib/api";
import {
  useDeleteTeacher,
  useDepartments,
  useSetHod,
  useTeacherOptions,
} from "@/lib/queries";
import { useAuth } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { CardGridSkeleton } from "@/components/ui/card-skeleton";
import { TeacherFormDialog } from "@/components/teachers/teacher-form-dialog";
import { TeacherRow } from "@/components/teachers/teacher-row";

const ALL = "all";

export default function TeachersPage() {
  const router = useRouter();
  const { data: teachers = EMPTY_ARRAY, isLoading: teachersLoading } = useTeacherOptions();
  const { data: departments = EMPTY_ARRAY, isLoading: deptsLoading } = useDepartments();
  const isLoading = teachersLoading || deptsLoading;
  const deleteTeacher = useDeleteTeacher();
  const setHod = useSetHod();
  const { can, role, departmentId: authDeptId } = useAuth();
  // HODs are locked to their own department (filter preset + disabled).
  const lockedDept = role === "hod" ? authDeptId : null;

  const [dept, setDept] = useState<string>(ALL);
  const [hodOnly, setHodOnly] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Teacher | null>(null);
  const [deleting, setDeleting] = useState<Teacher | null>(null);
  // Teacher pending HOD assignment that would replace an existing HOD.
  const [assigning, setAssigning] = useState<Teacher | null>(null);

  const deptName = useMemo(
    () => Object.fromEntries(departments.map((d) => [d.id, d.name])),
    [departments],
  );

  // Teachers grouped by department, each list sorted by name.
  const teachersByDept = useMemo(() => {
    const map: Record<string, Teacher[]> = {};
    for (const t of teachers) (map[t.departmentId] ??= []).push(t);
    for (const list of Object.values(map))
      list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [teachers]);

  const hodByDept = useMemo(() => {
    const map: Record<string, Teacher> = {};
    for (const t of teachers) if (t.isHod) map[t.departmentId] = t;
    return map;
  }, [teachers]);

  const deptItems = useMemo(
    () => ({
      [ALL]: "All departments",
      ...Object.fromEntries(departments.map((d) => [d.id, d.name])),
    }),
    [departments],
  );

  const deptFilter = lockedDept ?? dept;
  const visibleDepartments = departments.filter(
    (d) => deptFilter === ALL || d.id === deptFilter,
  );

  const toggleHod = useCallback(
    async (t: Teacher, isHod: boolean, message: string) => {
      try {
        await setHod.mutateAsync({ id: t.id, isHod });
        toast.success(message);
      } catch (err) {
        toast.error(errMsg(err));
      }
    },
    [setHod],
  );

  // Stable identities so the memoized TeacherRow below don't re-render on
  // every unrelated page state change.
  const handleView = useCallback(
    (t: Teacher) => router.push(`/teachers/${t.id}`),
    [router],
  );
  const handleEdit = useCallback((t: Teacher) => setEditing(t), []);
  const handleDelete = useCallback((t: Teacher) => setDeleting(t), []);
  const handleRemoveHod = useCallback(
    (t: Teacher) => void toggleHod(t, false, `${t.name} is no longer HOD.`),
    [toggleHod],
  );
  const handleAssignClick = useCallback(
    (t: Teacher) => {
      const existing = hodByDept[t.departmentId];
      if (existing && existing.id !== t.id) {
        setAssigning(t); // confirm replacement
      } else {
        void toggleHod(t, true, `${t.name} is now HOD.`);
      }
    },
    [hodByDept, toggleHod],
  );

  function confirmAssign() {
    if (!assigning) return;
    void toggleHod(assigning, true, `${assigning.name} is now HOD.`);
    setAssigning(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Teachers"
        description="Faculty grouped by department, with each department's HOD highlighted."
        action={
          can.manageAcademics ? (
            <Button
              onClick={() => setCreateOpen(true)}
              disabled={departments.length === 0}
            >
              <Plus size={16} />
              New teacher
            </Button>
          ) : undefined
        }
      />

      {/* Filters */}
      {departments.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <Select
            items={deptItems}
            value={deptFilter}
            disabled={Boolean(lockedDept)}
            onValueChange={(v) => setDept(v ?? ALL)}
          >
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Department" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(deptItems).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
            <Switch
              id="hod-only"
              checked={hodOnly}
              onCheckedChange={(c) => setHodOnly(c)}
            />
            <Label htmlFor="hod-only" className="m-0">
              HODs only
            </Label>
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <CardGridSkeleton cards={4} lines={3} className="lg:grid-cols-2 xl:grid-cols-2" />
      ) : departments.length === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center shadow-sm">
          <UserCog size={24} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm text-muted-foreground">
            Create a department first — teachers belong to one.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {visibleDepartments.map((d) => {
            const all = teachersByDept[d.id] ?? [];
            const hod = hodByDept[d.id];
            const others = hodOnly ? [] : all.filter((t) => !t.isHod);

            return (
              <Card key={d.id}>
                <CardHeader className="flex items-center justify-between">
                  <CardTitle>{d.name}</CardTitle>
                  <CardDescription className="flex items-center gap-2">
                    <Badge variant="secondary" className="font-mono">
                      {d.code}
                    </Badge>
                    <span>{all.length} faculty</span>
                  </CardDescription>
                </CardHeader>

                <CardContent className="flex flex-col gap-3">
                  {/* HOD highlight */}
                  {hod ? (
                    <TeacherRow
                      teacher={hod}
                      canManage={can.manageAcademics}
                      onView={handleView}
                      onEdit={handleEdit}
                      onAssignHod={handleAssignClick}
                      onRemoveHod={handleRemoveHod}
                      onDelete={handleDelete}
                    />
                  ) : null}

                  {/* Other faculty */}
                  {others.length > 0 ? (
                    <ul className="flex flex-col gap-0.5">
                      {others.map((t) => (
                        <TeacherRow
                          key={t.id}
                          teacher={t}
                          canManage={can.manageAcademics}
                          onView={handleView}
                          onEdit={handleEdit}
                          onAssignHod={handleAssignClick}
                          onRemoveHod={handleRemoveHod}
                          onDelete={handleDelete}
                        />
                      ))}
                    </ul>
                  ) : !hodOnly && all.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No faculty yet.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <TeacherFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      <TeacherFormDialog
        open={Boolean(editing)}
        onOpenChange={(o) => !o && setEditing(null)}
        teacher={editing ?? undefined}
      />

      {/* Replace-HOD confirmation */}
      <AlertDialog
        open={Boolean(assigning)}
        onOpenChange={(o) => !o && setAssigning(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace current HOD?</AlertDialogTitle>
            <AlertDialogDescription>
              {assigning && hodByDept[assigning.departmentId] ? (
                <>
                  <strong>{hodByDept[assigning.departmentId]?.name}</strong> is
                  currently HOD of {deptName[assigning.departmentId]}. Assigning{" "}
                  <strong>{assigning.name}</strong> will demote them.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction loading={setHod.isPending} onClick={confirmAssign}>
              Make {assigning?.name} HOD
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete teacher?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes <strong>{deleting?.name}</strong> (
              {deleting?.employeeId}). This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                if (!deleting) return;
                try {
                  await deleteTeacher.mutateAsync(deleting.id);
                  toast.success(`Deleted "${deleting.name}".`);
                } catch (err) {
                  toast.error(errMsg(err));
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
