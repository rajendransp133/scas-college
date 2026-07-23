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
import { SelectField } from "@/components/select-field";
import {
  PROGRAM_LEVELS,
  PROGRAM_LEVEL_LABELS,
  type Program,
  type ProgramLevel,
} from "@/lib/types";
import { EMPTY_ARRAY, errMsg } from "@/lib/api";
import {
  useAddSemester,
  useCreateProgram,
  useDepartments,
  usePrograms,
  useSemesters,
  useUpdateProgram,
} from "@/lib/queries";

const LEVEL_OPTIONS = PROGRAM_LEVELS.map((l) => ({
  value: l,
  label: `${PROGRAM_LEVEL_LABELS[l]} (${l})`,
}));

export function ProgramFormDialog({
  open,
  onOpenChange,
  program,
  defaultDepartmentId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  program?: Program;
  defaultDepartmentId?: string;
}) {
  const { data: departments = EMPTY_ARRAY } = useDepartments();
  const { data: programs = EMPTY_ARRAY } = usePrograms();
  const { data: programSemesters = EMPTY_ARRAY } = useSemesters(program?.id);
  const createProgram = useCreateProgram();
  const updateProgram = useUpdateProgram();
  const addSemester = useAddSemester();
  const isEdit = Boolean(program);
  const pending =
    createProgram.isPending || updateProgram.isPending || addSemester.isPending;

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [level, setLevel] = useState<ProgramLevel>("UG");
  const [semesterCount, setSemesterCount] = useState(1);

  useEffect(() => {
    if (open) {
      setName(program?.name ?? "");
      setCode(program?.code ?? "");
      setDepartmentId(program?.departmentId ?? defaultDepartmentId ?? "");
      setLevel(program?.level ?? "UG");
      setSemesterCount(program ? programSemesters.length : 1);
    }
  }, [open, program, defaultDepartmentId, programSemesters]);

  const deptOptions = departments.map((d) => ({
    value: d.id,
    label: `${d.name} (${d.code})`,
  }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedCode = code.trim().toUpperCase();

    if (!trimmedName || !trimmedCode) {
      toast.error("Name and code are required.");
      return;
    }
    if (!departmentId) {
      toast.error("Please choose a department.");
      return;
    }

    const count = Number(semesterCount);
    if (!Number.isInteger(count) || count < 1) {
      toast.error("Semester count must be at least 1.");
      return;
    }

    const clash = programs.some(
      (p) => p.code.toUpperCase() === trimmedCode && p.id !== program?.id,
    );
    if (clash) {
      toast.error(`Code "${trimmedCode}" is already in use.`);
      return;
    }

    try {
      if (isEdit && program) {
        await updateProgram.mutateAsync({
          id: program.id,
          input: { name: trimmedName, code: trimmedCode, departmentId, level },
        });
        // Backend has no "semester count" on update — append any new ones.
        const existingNums = programSemesters.map((s) => s.number);
        const maxExisting = existingNums.length > 0 ? Math.max(...existingNums) : 0;
        for (let i = maxExisting + 1; i <= count; i++) {
          await addSemester.mutateAsync({ programId: program.id, number: i });
        }
        toast.success("Program updated.");
      } else {
        // Create seeds semesters 1..N server-side via semesterCount.
        await createProgram.mutateAsync({
          name: trimmedName,
          code: trimmedCode,
          departmentId,
          level,
          semesterCount: count,
        });
        toast.success("Program created.");
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
            <DialogTitle>{isEdit ? "Edit program" : "New program"}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Update the program details."
                : "Create a program and assign it to a department."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="prog-name">Name</Label>
              <Input
                id="prog-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Bachelor of Computer Applications"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="prog-code">Code</Label>
              <Input
                id="prog-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. BCA"
                className="uppercase"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="prog-dept">Department</Label>
              <SelectField
                id="prog-dept"
                options={deptOptions}
                value={departmentId}
                onValueChange={setDepartmentId}
                placeholder="Select a department"
                searchPlaceholder="Search departments…"
                emptyText="No departments found."
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="prog-level">Level</Label>
              <SelectField
                id="prog-level"
                options={LEVEL_OPTIONS}
                value={level}
                onValueChange={(v) => setLevel((v || "UG") as ProgramLevel)}
                placeholder="Select a level"
                searchPlaceholder="Search levels…"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="prog-semesters">Number of semesters</Label>
              <Input
                id="prog-semesters"
                type="number"
                min={1}
                value={semesterCount}
                onChange={(e) => setSemesterCount(Number(e.target.value))}
              />
              {isEdit && (
                <p className="text-xs text-muted-foreground">
                  Existing semesters are kept; increase to add more.
                </p>
              )}
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
