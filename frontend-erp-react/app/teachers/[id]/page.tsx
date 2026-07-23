"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Crown, Pencil, Star, StarOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EMPTY_ARRAY, errMsg } from "@/lib/api";
import {
  useDepartments,
  useSetHod,
  useTeacher,
  useTeacherOptions,
} from "@/lib/queries";
import { useAuth } from "@/lib/permissions";
import { DetailPageSkeleton } from "@/components/ui/card-skeleton";
import { TeacherFormDialog } from "@/components/teachers/teacher-form-dialog";
import { PageHeader } from "@/components/page-header";

function BackLink() {
  return (
    <Link
      href="/teachers"
      className="inline-flex items-center gap-2 self-start rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <ArrowLeft size={16} />
      Back to teachers
    </Link>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{children || "—"}</p>
    </div>
  );
}

function CardTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-4 text-base font-semibold">{children}</h2>;
}

export default function TeacherDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: teacher, isLoading } = useTeacher(id);
  const { data: teachers = EMPTY_ARRAY } = useTeacherOptions();
  const { data: departments = EMPTY_ARRAY } = useDepartments();
  const setHod = useSetHod();
  const { can } = useAuth();
  const [editOpen, setEditOpen] = useState(false);

  async function toggleHod(isHod: boolean, message: string) {
    if (!teacher) return;
    try {
      await setHod.mutateAsync({ id: teacher.id, isHod });
      toast.success(message);
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  // A slow fetch must never flash "not found" — show the page's shape instead.
  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <DetailPageSkeleton />
      </div>
    );
  }

  if (!teacher) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <div className="rounded-xl border bg-card p-8 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">
            Teacher not found. It may have been deleted.
          </p>
        </div>
      </div>
    );
  }

  const department = departments.find((d) => d.id === teacher.departmentId);
  const currentHod = teachers.find(
    (t) => t.departmentId === teacher.departmentId && t.isHod,
  );

  return (
    <div className="flex flex-col gap-6">
      <BackLink />

      <PageHeader
        title={teacher.name}
        description={`${teacher.employeeId} · ${teacher.designation}`}
        action={
          can.manageAcademics ? (
          <div className="flex gap-2">
            {teacher.isHod ? (
              <Button
                variant="outline"
                onClick={() =>
                  void toggleHod(false, `${teacher.name} is no longer HOD.`)
                }
              >
                <StarOff size={16} />
                Remove as HOD
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() =>
                  void toggleHod(true, `${teacher.name} is now HOD.`)
                }
              >
                <Star size={16} />
                Assign as HOD
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil size={16} />
              Edit
            </Button>
          </div>
          ) : undefined
        }
      />

      {teacher.isHod ? (
        <div>
          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
            <Crown size={12} />
            Head of {department?.name ?? "Department"}
          </Badge>
        </div>
      ) : currentHod ? (
        <p className="text-sm text-muted-foreground">
          Current HOD of {department?.name}:{" "}
          <span className="font-semibold text-foreground">{currentHod.name}</span>
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <CardTitle>Employment</CardTitle>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Department">{department?.name}</Field>
            <Field label="Designation">{teacher.designation}</Field>
            <Field label="Qualification">{teacher.qualification}</Field>
            <Field label="Joining date">{teacher.joiningDate}</Field>
            <Field label="HOD">{teacher.isHod ? "Yes" : "No"}</Field>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <CardTitle>Contact</CardTitle>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Email">{teacher.email}</Field>
            <Field label="Phone">{teacher.phone}</Field>
          </div>
        </div>
      </div>

      <TeacherFormDialog open={editOpen} onOpenChange={setEditOpen} teacher={teacher} />
    </div>
  );
}
