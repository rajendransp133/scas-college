"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Department } from "@/lib/types";
import { EMPTY_ARRAY, errMsg } from "@/lib/api";
import {
  useCreateDepartment,
  useDepartments,
  useUpdateDepartment,
} from "@/lib/queries";

export function DepartmentFormDialog({
  open,
  onOpenChange,
  department,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Provided when editing; omit to create. */
  department?: Department;
}) {
  const { data: departments = EMPTY_ARRAY } = useDepartments();
  const createDepartment = useCreateDepartment();
  const updateDepartment = useUpdateDepartment();
  const isEdit = Boolean(department);
  const pending = createDepartment.isPending || updateDepartment.isPending;

  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  // Reset fields whenever the dialog opens.
  useEffect(() => {
    if (open) {
      setName(department?.name ?? "");
      setCode(department?.code ?? "");
    }
  }, [open, department]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedCode = code.trim().toUpperCase();

    if (!trimmedName || !trimmedCode) {
      toast.error("Name and code are both required.");
      return;
    }

    // Enforce a unique code (case-insensitive), ignoring the row being edited.
    const clash = departments.some(
      (d) => d.code.toUpperCase() === trimmedCode && d.id !== department?.id,
    );
    if (clash) {
      toast.error(`Code "${trimmedCode}" is already in use.`);
      return;
    }

    try {
      if (isEdit && department) {
        await updateDepartment.mutateAsync({
          id: department.id,
          input: { name: trimmedName, code: trimmedCode },
        });
        toast.success("Department updated.");
      } else {
        await createDepartment.mutateAsync({
          name: trimmedName,
          code: trimmedCode,
        });
        toast.success("Department created.");
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit department" : "New department"}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Update the department name or code."
                : "Add a department with a name and a unique code."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="dept-name">Name</Label>
              <Input
                id="dept-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Computer Science"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="dept-code">Code</Label>
              <Input
                id="dept-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. CS"
                className="uppercase"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              {isEdit ? "Save changes" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
