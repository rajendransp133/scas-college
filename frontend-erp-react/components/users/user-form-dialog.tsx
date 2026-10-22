"use client";

import { useEffect, useMemo, useState } from "react";
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
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { SelectField } from "@/components/select-field";
import {
  USER_ROLES,
  USER_ROLE_LABELS,
  type User,
  type UserRole,
} from "@/lib/types";
import { EMPTY_ARRAY, errMsg } from "@/lib/api";
import { canManageRole, useAuth } from "@/lib/permissions";
import {
  useCreateUser,
  usePrograms,
  useSemesters,
  useTeacherOptions,
  useUpdateUser,
} from "@/lib/queries";

type Draft = Omit<User, "id">;

const emptyDraft = (): Draft => ({
  name: "",
  email: "",
  password: "",
  role: "teacher",
});


/** Roles whose account must be linked to a Teacher record. */
const needsTeacher = (role: UserRole) => role === "teacher" || role === "hod";
/** Roles that may optionally link one (e.g. a principal who also teaches). */
const allowsTeacher = (role: UserRole) =>
  needsTeacher(role) || role === "principal";

export function UserFormDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Accounts from the API carry no password field.
  user?: Omit<User, "password">;
}) {
  const { role: actorRole } = useAuth();
  const { data: teachers = EMPTY_ARRAY } = useTeacherOptions();
  const { data: programs = EMPTY_ARRAY } = usePrograms();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const isEdit = Boolean(user);
  const pending = createUser.isPending || updateUser.isPending;

  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const { data: semesters = EMPTY_ARRAY } = useSemesters(draft.programId);

  // A principal manages accounts but not administrator ones — don't offer a
  // role the API would reject (services/users.py::assert_may_manage).
  const roleOptions = useMemo(
    () =>
      USER_ROLES.filter((r) => canManageRole(actorRole, r)).map((r) => ({
        value: r,
        label: USER_ROLE_LABELS[r],
      })),
    [actorRole],
  );

  useEffect(() => {
    if (open) setDraft(user ? { ...user, password: "" } : emptyDraft());
  }, [open, user]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  // HOD accounts link to a department's HOD; teacher accounts to any teacher.
  const teacherOptions = teachers
    .filter((t) => (draft.role === "hod" ? t.isHod : true))
    .map((t) => ({ value: t.id, label: `${t.name} (${t.employeeId})` }));

  const programOptions = programs.map((p) => ({
    value: p.id,
    label: `${p.name} (${p.code})`,
  }));
  const semesterOptions = semesters
    .filter((s) => s.programId === draft.programId)
    .sort((a, b) => a.number - b.number)
    .map((s) => ({ value: String(s.number), label: `Semester ${s.number}` }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = draft.name.trim();
    const email = draft.email.trim();

    if (!name || !email || (!isEdit && !draft.password)) {
      toast.error("Name, email and password are required.");
      return;
    }
    if (needsTeacher(draft.role) && !draft.teacherId) {
      toast.error(
        draft.role === "hod"
          ? "Choose the HOD's teacher record."
          : "Choose the teacher this account belongs to.",
      );
      return;
    }
    // Email uniqueness and one-rep-per-class are enforced server-side
    // (services/users.py) and come back as a 409 that `errMsg` already
    // surfaces — there is no full account list on the client to pre-check
    // against now that /users is paginated.
    if (draft.role === "student-rep" && (!draft.programId || draft.classSemester == null)) {
      toast.error("Choose the class (program + semester) for this account.");
      return;
    }

    const isRep = draft.role === "student-rep";
    const payload: Draft = {
      ...draft,
      name,
      email,
      // Drop stale links when the role doesn't allow them.
      teacherId: allowsTeacher(draft.role) ? draft.teacherId : undefined,
      programId: isRep ? draft.programId : undefined,
      classSemester: isRep ? draft.classSemester : undefined,
    };
    void (async () => {
      try {
        if (isEdit && user) {
          // Blank password on edit = keep the existing one (omit from the update).
          const { password, ...rest } = payload;
          const input = password ? payload : rest;
          await updateUser.mutateAsync({ id: user.id, input });
          toast.success("User updated.");
        } else {
          await createUser.mutateAsync(payload);
          toast.success("User created.");
        }
        onOpenChange(false);
      } catch (err) {
        toast.error(errMsg(err));
      }
    })();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit user" : "New user"}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Update this login account."
                : "Create a login account. Teacher and HOD accounts must be linked to a teacher record."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="u-name">Full name</Label>
              <Input
                id="u-name"
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="e.g. Dr. Ramesh Kumar"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="u-email">Email</Label>
                <Input
                  id="u-email"
                  type="email"
                  value={draft.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="user@scascollege.ac.in"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="u-password">Password</Label>
                <PasswordInput
                  id="u-password"
                  autoComplete="new-password"
                  value={draft.password}
                  onChange={(e) => set("password", e.target.value)}
                  placeholder={isEdit ? "Leave blank to keep" : "Password"}
                />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="u-role">Role</Label>
              <SelectField
                id="u-role"
                options={roleOptions}
                value={draft.role}
                onValueChange={(v) => set("role", (v || "teacher") as UserRole)}
                placeholder="Select a role"
                searchPlaceholder="Search roles…"
              />
            </div>
            {allowsTeacher(draft.role) ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="u-teacher">
                  {draft.role === "hod"
                    ? "HOD teacher record"
                    : draft.role === "principal"
                      ? "Teacher record (optional)"
                      : "Teacher record"}
                </Label>
                <SelectField
                  id="u-teacher"
                  options={teacherOptions}
                  value={draft.teacherId ?? ""}
                  onValueChange={(v) => set("teacherId", v || undefined)}
                  placeholder="Select a teacher"
                  searchPlaceholder="Search teachers…"
                  emptyText={
                    draft.role === "hod"
                      ? "No HODs found — assign one on the Teachers page first."
                      : "No teachers found."
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {draft.role === "hod"
                    ? "The account's department is taken from this teacher. HODs can also take attendance for this teacher's assigned courses."
                    : draft.role === "principal"
                      ? "Link a teacher record if the principal also takes classes."
                      : "The account can only mark attendance for this teacher's assigned courses."}
                </p>
              </div>
            ) : null}
            {draft.role === "student-rep" ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="u-program">Program</Label>
                  <SelectField
                    id="u-program"
                    options={programOptions}
                    value={draft.programId ?? ""}
                    onValueChange={(v) =>
                      setDraft((d) => ({
                        ...d,
                        programId: v || undefined,
                        classSemester: undefined,
                      }))
                    }
                    placeholder="Select program"
                    searchPlaceholder="Search programs…"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="u-semester">Semester</Label>
                  <SelectField
                    id="u-semester"
                    options={semesterOptions}
                    value={
                      draft.classSemester != null
                        ? String(draft.classSemester)
                        : ""
                    }
                    onValueChange={(v) =>
                      set("classSemester", v ? Number(v) : undefined)
                    }
                    placeholder={
                      draft.programId ? "Select semester" : "Pick a program first"
                    }
                    disabled={!draft.programId}
                    searchPlaceholder="Search…"
                    emptyText="This program has no semesters yet."
                  />
                </div>
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  One shared, read-only login for the whole class — only one
                  account is allowed per class. Students use it to view their
                  class attendance register and summary.
                </p>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              {isEdit ? "Save changes" : "Create user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
