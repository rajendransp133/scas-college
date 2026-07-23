"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { TriangleAlert } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { SelectField } from "@/components/select-field";
import { DESIGNATIONS, type Designation, type Teacher } from "@/lib/types";
import { EMPTY_ARRAY, errMsg } from "@/lib/api";
import {
  useCreateTeacher,
  useDepartments,
  useTeacherOptions,
  useUpdateTeacher,
} from "@/lib/queries";

/**
 * Teacher's optional fields are `string | null`, but a controlled <input>
 * cannot take null — so the draft narrows them to plain strings and uses ""
 * for "empty". The API normalises "" back to null on the way in.
 */
type Draft = Omit<Teacher, "id" | "email" | "phone" | "qualification" | "joiningDate"> & {
  email: string;
  phone: string;
  qualification: string;
  joiningDate: string;
};

const emptyDraft = (): Draft => ({
  employeeId: "",
  name: "",
  email: "",
  phone: "",
  departmentId: "",
  designation: "Assistant Professor",
  qualification: "",
  joiningDate: "",
  isHod: false,
});

/** A saved teacher's nullable fields → "" so the inputs stay controlled. */
const toDraft = (t: Teacher): Draft => ({
  ...t,
  email: t.email ?? "",
  phone: t.phone ?? "",
  qualification: t.qualification ?? "",
  joiningDate: t.joiningDate ?? "",
});

const DESIGNATION_OPTIONS = DESIGNATIONS.map((d) => ({ value: d, label: d }));

/** Marks a field the API will accept as blank — see TeacherBase's docstring. */
const Optional = () => (
  <span className="font-normal text-muted-foreground">(optional)</span>
);

export function TeacherFormDialog({
  open,
  onOpenChange,
  teacher,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teacher?: Teacher;
}) {
  const { data: teachers = EMPTY_ARRAY } = useTeacherOptions();
  const { data: departments = EMPTY_ARRAY } = useDepartments();
  const createTeacher = useCreateTeacher();
  const updateTeacher = useUpdateTeacher();
  const isEdit = Boolean(teacher);
  const pending = createTeacher.isPending || updateTeacher.isPending;

  const [draft, setDraft] = useState<Draft>(emptyDraft);

  useEffect(() => {
    if (open) setDraft(teacher ? toDraft(teacher) : emptyDraft());
  }, [open, teacher]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const deptOptions = departments.map((d) => ({
    value: d.id,
    label: `${d.name} (${d.code})`,
  }));

  // Who currently holds HOD in the selected department (other than this teacher)?
  const existingHod = teachers.find(
    (t) => t.departmentId === draft.departmentId && t.isHod && t.id !== teacher?.id,
  );
  const willReplaceHod = draft.isHod && Boolean(existingHod);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const employeeId = draft.employeeId.trim();
    const name = draft.name.trim();

    if (!employeeId || !name) {
      toast.error("Employee ID and name are required.");
      return;
    }
    if (!draft.departmentId) {
      toast.error("Please choose a department.");
      return;
    }
    if (
      !isEdit &&
      teachers.some((t) => t.employeeId.toLowerCase() === employeeId.toLowerCase())
    ) {
      toast.error(`Employee ID "${employeeId}" is already in use.`);
      return;
    }

    const payload: Draft = { ...draft, employeeId, name };
    void (async () => {
      try {
        if (isEdit && teacher) {
          await updateTeacher.mutateAsync({ id: teacher.id, input: payload });
          toast.success("Teacher updated.");
        } else {
          await createTeacher.mutateAsync(payload);
          toast.success("Teacher created.");
        }
        onOpenChange(false);
      } catch (err) {
        toast.error(errMsg(err));
      }
    })();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={handleSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit teacher" : "New teacher"}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Update faculty details. Employee ID cannot be changed."
                : "Add a faculty member to a department."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto py-2">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="t-emp">Employee ID</Label>
                <Input
                  id="t-emp"
                  value={draft.employeeId}
                  onChange={(e) => set("employeeId", e.target.value)}
                  disabled={isEdit}
                  placeholder="e.g. EMP021"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="t-name">Full name</Label>
                <Input
                  id="t-name"
                  value={draft.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="e.g. Dr. Ramesh Kumar"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="t-email">Email <Optional /></Label>
                <Input
                  id="t-email"
                  type="email"
                  value={draft.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="faculty@example.edu"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="t-phone">Phone <Optional /></Label>
                <Input
                  id="t-phone"
                  value={draft.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="+91 ..."
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="t-dept">Department</Label>
                <SelectField
                  id="t-dept"
                  options={deptOptions}
                  value={draft.departmentId}
                  onValueChange={(v) => set("departmentId", v)}
                  placeholder="Select a department"
                  searchPlaceholder="Search departments…"
                  emptyText="No departments found."
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="t-desig">Designation <Optional /></Label>
                <SelectField
                  id="t-desig"
                  options={DESIGNATION_OPTIONS}
                  value={draft.designation}
                  onValueChange={(v) =>
                    set("designation", (v || "Assistant Professor") as Designation)
                  }
                  placeholder="Select a designation"
                  searchPlaceholder="Search designations…"
                />
              </div>
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor="t-qual">Qualification <Optional /></Label>
                <Input
                  id="t-qual"
                  value={draft.qualification}
                  onChange={(e) => set("qualification", e.target.value)}
                  placeholder="e.g. Ph.D in Computer Science"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="t-join">Joining date <Optional /></Label>
                <Input
                  id="t-join"
                  type="date"
                  value={draft.joiningDate}
                  onChange={(e) => set("joiningDate", e.target.value)}
                />
              </div>
            </div>

            {/* HOD */}
            <div className="flex flex-col gap-3 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="t-hod">Head of Department</Label>
                  <p className="text-xs text-muted-foreground">
                    Each department can have only one HOD.
                  </p>
                </div>
                <Switch
                  id="t-hod"
                  checked={draft.isHod}
                  onCheckedChange={(checked) => set("isHod", checked)}
                  disabled={!draft.departmentId}
                />
              </div>
              {willReplaceHod ? (
                <div className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
                  <TriangleAlert size={14} className="mt-px shrink-0" />
                  <span>
                    <strong>{existingHod?.name}</strong> is currently HOD of this department.
                    Saving will demote them and make this teacher the HOD.
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              {isEdit ? "Save changes" : "Create teacher"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
