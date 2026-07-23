"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Building2, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import type { Department, Program } from "@/lib/types";
import { EMPTY_ARRAY, errMsg } from "@/lib/api";
import { useDeleteDepartment, useDepartments, usePrograms } from "@/lib/queries";
import { DepartmentFormDialog } from "@/components/departments/department-form-dialog";

/**
 * Department CRUD, housed on the Programs page since departments are only
 * touched during initial setup (the standalone /departments page was merged
 * away). One nested dialog at a time: list → add/edit form or delete confirm.
 */
export function ManageDepartmentsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: departments = EMPTY_ARRAY } = useDepartments();
  const { data: programs = EMPTY_ARRAY } = usePrograms();
  const deleteDepartment = useDeleteDepartment();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [deleting, setDeleting] = useState<Department | null>(null);

  const programsByDept = useMemo(() => {
    const map: Record<string, Program[]> = {};
    for (const p of programs) (map[p.departmentId] ??= []).push(p);
    return map;
  }, [programs]);

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await deleteDepartment.mutateAsync(deleting.id);
      toast.success(`Deleted "${deleting.name}".`);
    } catch (err) {
      toast.error(errMsg(err));
    }
    setDeleting(null);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Departments</DialogTitle>
            <DialogDescription>
              Every program belongs to a department. Deleting a department
              cascades to its programs.
            </DialogDescription>
          </DialogHeader>

          {departments.length === 0 ? (
            <div className="rounded-lg border p-6 text-center">
              <Building2 size={20} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm text-muted-foreground">
                No departments yet.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col divide-y rounded-lg border">
              {departments.map((d) => {
                const count = programsByDept[d.id]?.length ?? 0;
                return (
                  <li key={d.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{d.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {count} program{count === 1 ? "" : "s"}
                      </p>
                    </div>
                    <Badge variant="secondary" className="font-mono">
                      {d.code}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Edit"
                      onClick={() => setEditing(d)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Delete"
                      className="text-red-600 hover:text-red-700"
                      onClick={() => setDeleting(d)}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}

          <Button
            variant="outline"
            className="self-start"
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={16} />
            New department
          </Button>
        </DialogContent>
      </Dialog>

      <DepartmentFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      <DepartmentFormDialog
        open={Boolean(editing)}
        onOpenChange={(o) => !o && setEditing(null)}
        department={editing ?? undefined}
      />

      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete department?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && (programsByDept[deleting.id]?.length ?? 0) > 0 ? (
                <>
                  <strong>{deleting?.name}</strong> has{" "}
                  {programsByDept[deleting.id]?.length} program(s). Deleting it
                  will also remove those programs and their semesters. This
                  cannot be undone.
                </>
              ) : (
                <>
                  This will permanently remove <strong>{deleting?.name}</strong>
                  . This cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
