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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SelectField } from "@/components/select-field";
import { semesterInSession, type Gender, type Student } from "@/lib/types";
import { EMPTY_ARRAY, errMsg } from "@/lib/api";
import {
  useCreateStudent,
  useDepartments,
  usePrograms,
  useSettings,
  useTerms,
  useUpdateStudent,
} from "@/lib/queries";

/**
 * Form state, deliberately *not* `Omit<Student, "id">`.
 *
 * Every optional field is a plain string here: a controlled input can't hold
 * null, and "" is what an untouched input submits anyway. `toPayload()` maps
 * blanks back to null on the way out, so "left empty" round-trips as absent
 * rather than as an empty string sitting in the column.
 */
type Draft = {
  rollNumber: string;
  name: string;
  departmentId: string;
  programId: string;
  currentSemester: number;
  email: string;
  phone: string;
  address: string;
  dateOfBirth: string;
  gender: Gender | "";
  admissionYear: string;
  guardianName: string;
  guardianRelation: string;
  guardianPhone: string;
  isActive: boolean;
  graduated?: boolean;
};

const emptyDraft = (): Draft => ({
  rollNumber: "",
  name: "",
  departmentId: "",
  programId: "",
  currentSemester: 1,
  email: "",
  phone: "",
  address: "",
  dateOfBirth: "",
  gender: "",
  admissionYear: "",
  guardianName: "",
  guardianRelation: "",
  guardianPhone: "",
  isActive: true,
});

const toDraft = (s: Student): Draft => ({
  rollNumber: s.rollNumber,
  name: s.name,
  departmentId: s.departmentId ?? "",
  programId: s.programId ?? "",
  currentSemester: s.currentSemester,
  email: s.email ?? "",
  phone: s.phone ?? "",
  address: s.address ?? "",
  dateOfBirth: s.dateOfBirth ?? "",
  gender: s.gender ?? "",
  admissionYear: s.admissionYear != null ? String(s.admissionYear) : "",
  guardianName: s.guardianName ?? "",
  guardianRelation: s.guardianRelation ?? "",
  guardianPhone: s.guardianPhone ?? "",
  isActive: s.isActive,
  graduated: s.graduated,
});

/** "" → null, so an untouched field is stored as absent, not as an empty string. */
const blank = (v: string): string | null => (v.trim() ? v.trim() : null);

const toPayload = (d: Draft): Omit<Student, "id"> => ({
  rollNumber: d.rollNumber.trim(),
  name: d.name.trim(),
  departmentId: d.departmentId,
  programId: d.programId,
  currentSemester: d.currentSemester,
  email: blank(d.email),
  phone: blank(d.phone),
  address: blank(d.address),
  dateOfBirth: blank(d.dateOfBirth),
  gender: d.gender || null,
  admissionYear: d.admissionYear.trim() ? Number(d.admissionYear) : null,
  guardianName: blank(d.guardianName),
  guardianRelation: blank(d.guardianRelation),
  guardianPhone: blank(d.guardianPhone),
  isActive: d.isActive,
  graduated: d.graduated,
});

const GENDER_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
];

/** Marks the fields that may be left blank at intake. */
function Optional() {
  return (
    <span className="ml-1 text-xs font-normal text-muted-foreground">
      (optional)
    </span>
  );
}

export function StudentFormDialog({
  open,
  onOpenChange,
  student,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student?: Student;
}) {
  const { data: departments = EMPTY_ARRAY } = useDepartments();
  const { data: programs = EMPTY_ARRAY } = usePrograms();
  const { data: terms = EMPTY_ARRAY } = useTerms();
  const { data: settings } = useSettings();
  const createStudent = useCreateStudent();
  const updateStudent = useUpdateStudent();
  const isEdit = Boolean(student);
  const pending = createStudent.isPending || updateStudent.isPending;
  const currentTerm = terms.find((t) => t.id === settings?.currentTermId);

  const [draft, setDraft] = useState<Draft>(emptyDraft);

  useEffect(() => {
    if (open) setDraft(student ? toDraft(student) : emptyDraft());
  }, [open, student]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  // Programs available for the chosen department.
  const availablePrograms = programs.filter(
    (p) => p.departmentId === draft.departmentId,
  );

  const deptOptions = departments.map((d) => ({
    value: d.id,
    label: `${d.name} (${d.code})`,
  }));
  const programOptions = availablePrograms.map((p) => ({
    value: p.id,
    label: `${p.name} (${p.code})`,
  }));

  function handleDepartmentChange(departmentId: string) {
    setDraft((d) => {
      // Drop the program if it no longer belongs to the selected department.
      const keepProgram = programs.some(
        (p) => p.id === d.programId && p.departmentId === departmentId,
      );
      return { ...d, departmentId, programId: keepProgram ? d.programId : "" };
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const rollNumber = draft.rollNumber.trim();
    const name = draft.name.trim();

    if (!rollNumber || !name) {
      toast.error("Roll number and name are required.");
      return;
    }
    if (!draft.departmentId || !draft.programId) {
      toast.error("Department and program are required.");
      return;
    }
    // Roll-number uniqueness is enforced by the database (a 409 surfaces as a
    // toast below). It used to be pre-checked here against the full student
    // list — which meant this dialog downloaded every student just to open.

    const payload = toPayload(draft);
    void (async () => {
      try {
        if (isEdit && student) {
          await updateStudent.mutateAsync({ id: student.id, input: payload });
          toast.success("Student updated.");
        } else {
          await createStudent.mutateAsync(payload);
          toast.success("Student created.");
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
            <DialogTitle>{isEdit ? "Edit student" : "New student"}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Update student details. Roll number cannot be changed."
                : "Roll number, name and class placement are required — everything else can be filled in later."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex max-h-[65vh] flex-col gap-6 overflow-y-auto py-2">
            {/* Identity */}
            <div className="flex flex-col gap-4">
              <p className="text-sm font-semibold text-muted-foreground">
                Identity
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="st-roll">Roll number</Label>
                  <Input
                    id="st-roll"
                    value={draft.rollNumber}
                    onChange={(e) => set("rollNumber", e.target.value)}
                    disabled={isEdit}
                    placeholder="e.g. BCA2024001"
                  />
                  {isEdit ? (
                    <p className="text-xs text-muted-foreground">
                      Locked — roll numbers can&apos;t change once assigned.
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="st-name">Full name</Label>
                  <Input
                    id="st-name"
                    value={draft.name}
                    onChange={(e) => set("name", e.target.value)}
                    placeholder="e.g. Aarav Sharma"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="st-dob">
                    Date of birth
                    <Optional />
                  </Label>
                  <Input
                    id="st-dob"
                    type="date"
                    value={draft.dateOfBirth}
                    onChange={(e) => set("dateOfBirth", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="st-gender">
                    Gender
                    <Optional />
                  </Label>
                  <SelectField
                    id="st-gender"
                    options={GENDER_OPTIONS}
                    value={draft.gender}
                    onValueChange={(v) => set("gender", (v ?? "") as Gender | "")}
                    placeholder="Select gender"
                    searchPlaceholder="Search…"
                  />
                </div>
              </div>
            </div>

            {/* Contact */}
            <div className="flex flex-col gap-4">
              <p className="text-sm font-semibold text-muted-foreground">
                Contact
                <Optional />
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="st-email">Email</Label>
                  <Input
                    id="st-email"
                    type="email"
                    value={draft.email}
                    onChange={(e) => set("email", e.target.value)}
                    placeholder="student@example.edu"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="st-phone">Phone</Label>
                  <Input
                    id="st-phone"
                    value={draft.phone}
                    onChange={(e) => set("phone", e.target.value)}
                    placeholder="+91 ..."
                  />
                </div>
                <div className="flex flex-col gap-2 sm:col-span-2">
                  <Label htmlFor="st-address">Address</Label>
                  <Textarea
                    id="st-address"
                    value={draft.address}
                    onChange={(e) => set("address", e.target.value)}
                    placeholder="Street, city"
                    rows={2}
                  />
                </div>
              </div>
            </div>

            {/* Academic */}
            <div className="flex flex-col gap-4">
              <p className="text-sm font-semibold text-muted-foreground">
                Academic
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="st-dept">Department</Label>
                  <SelectField
                    id="st-dept"
                    options={deptOptions}
                    value={draft.departmentId}
                    onValueChange={handleDepartmentChange}
                    placeholder="Select a department"
                    searchPlaceholder="Search departments…"
                    emptyText="No departments found."
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="st-prog">Program</Label>
                  <SelectField
                    id="st-prog"
                    options={programOptions}
                    value={draft.programId}
                    onValueChange={(v) => set("programId", v)}
                    disabled={!draft.departmentId}
                    placeholder={
                      draft.departmentId
                        ? "Select a program"
                        : "Pick a department first"
                    }
                    searchPlaceholder="Search programs…"
                    emptyText="No programs found."
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="st-sem">Current semester</Label>
                  <Input
                    id="st-sem"
                    type="number"
                    min={1}
                    max={12}
                    value={draft.currentSemester}
                    onChange={(e) =>
                      set("currentSemester", Number(e.target.value))
                    }
                  />
                  {draft.currentSemester >= 1 &&
                    !semesterInSession(draft.currentSemester, currentTerm) && (
                      <p className="text-xs text-amber-700">
                        Sem {draft.currentSemester} is out of session this term
                        ({currentTerm?.name}) — the student won&apos;t appear
                        in any class roster until promoted.
                      </p>
                    )}
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="st-year">
                    Admission year
                    <Optional />
                  </Label>
                  <Input
                    id="st-year"
                    type="number"
                    min={2000}
                    max={2100}
                    value={draft.admissionYear}
                    onChange={(e) => set("admissionYear", e.target.value)}
                    placeholder={String(new Date().getFullYear())}
                  />
                </div>
              </div>
            </div>

            {/* Guardian */}
            <div className="flex flex-col gap-4">
              <p className="text-sm font-semibold text-muted-foreground">
                Parent / Guardian
                <Optional />
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="st-gname">Name</Label>
                  <Input
                    id="st-gname"
                    value={draft.guardianName}
                    onChange={(e) => set("guardianName", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="st-grel">Relation</Label>
                  <Input
                    id="st-grel"
                    value={draft.guardianRelation}
                    onChange={(e) => set("guardianRelation", e.target.value)}
                    placeholder="Father / Mother / ..."
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="st-gphone">Phone</Label>
                  <Input
                    id="st-gphone"
                    value={draft.guardianPhone}
                    onChange={(e) => set("guardianPhone", e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Status */}
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <Label htmlFor="st-active">Active</Label>
                <p className="text-xs text-muted-foreground">
                  Inactive students are soft-deleted (kept, but flagged).
                </p>
              </div>
              <Switch
                id="st-active"
                checked={draft.isActive}
                onCheckedChange={(checked) => set("isActive", checked)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              {isEdit ? "Save changes" : "Create student"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
