"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
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
import { SelectField } from "@/components/select-field";
import { MaterialShareDialog } from "@/components/materials/material-share-dialog";
import { MaterialLinkThumb } from "@/components/materials/material-link-thumb";
import { CardGridSkeleton } from "@/components/ui/card-skeleton";
import { EMPTY_ARRAY, errMsg } from "@/lib/api";
import {
  useCourses,
  useDeleteMaterial,
  useMaterials,
  usePrograms,
  useSettings,
  useTerms,
  useUserDirectory,
} from "@/lib/queries";
import { useAuth } from "@/lib/permissions";
import { hostLabel } from "@/lib/material-link";
import type { StudyMaterial } from "@/lib/types";

interface CourseInfo {
  name: string;
  code: string;
  programId: string;
  programName: string;
  semNumber: number;
}

export default function MaterialsPage() {
  const { user, role, can, classScope, departmentId, ownCourseIds } = useAuth();
  const { data: programs = EMPTY_ARRAY } = usePrograms();
  const { data: courses = EMPTY_ARRAY } = useCourses();
  // Paginated server-side; a generous page keeps the grouped-by-course layout
  // intact. Rows are just link metadata, so they stay small.
  const { data: materialPage, isLoading } = useMaterials({ pageSize: 200 });
  const materials = useMemo(() => materialPage?.items ?? [], [materialPage]);
  const { data: terms = EMPTY_ARRAY } = useTerms();
  // The directory is id→name for any authenticated user, so the uploader name
  // resolves for every role (/users is admin-only and now paginated besides).
  const { data: users = EMPTY_ARRAY } = useUserDirectory();
  const { data: settings } = useSettings();
  const currentTermId = settings?.currentTermId ?? "";
  const deleteMaterial = useDeleteMaterial();

  // Admin/principal browse filters (other roles are scoped automatically).
  const [programId, setProgramId] = useState("");
  const [semesterId, setSemesterId] = useState("");
  /** Share dialog: null = closed, "" = open without a preselected course. */
  const [uploadCourse, setUploadCourse] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<StudyMaterial | null>(null);

  const ownIds = useMemo(
    () => ownCourseIds(currentTermId),
    [ownCourseIds, currentTermId],
  );

  const courseInfo = useMemo(() => {
    const map = new Map<string, CourseInfo>();
    const progById = new Map(programs.map((p) => [p.id, p]));
    for (const c of courses) {
      const prog = progById.get(c.programId);
      map.set(c.id, {
        name: c.name,
        code: c.code,
        programId: c.programId,
        programName: prog ? prog.name : "—",
        semNumber: c.semesterNumber,
      });
    }
    return map;
  }, [courses, programs]);

  const userName = useMemo(
    () => new Map(users.map((u) => [u.id, u.name])),
    [users],
  );
  const termName = useMemo(
    () => new Map(terms.map((t) => [t.id, t.name])),
    [terms],
  );

  // Which course cards to render, per role:
  //  - student-rep: their class's courses (always, even when empty)
  //  - teacher: own assigned courses this term (always)
  //  - hod: own courses (always) + department courses that have materials
  //  - admin/principal: courses with materials, or every course of the
  //    selected program/semester filter
  const listedCourseIds = useMemo(() => {
    const withMaterials = new Set(materials.map((m) => m.courseId));
    const listed = new Set<string>();
    if (classScope) {
      for (const c of courses)
        if (
          c.programId === classScope.programId &&
          c.semesterNumber === classScope.semester
        )
          listed.add(c.id);
    } else if (role === "teacher") {
      for (const id of ownIds) listed.add(id);
    } else if (role === "hod") {
      for (const id of ownIds) listed.add(id);
      const deptProgs = new Set(
        programs.filter((p) => p.departmentId === departmentId).map((p) => p.id),
      );
      for (const c of courses)
        if (deptProgs.has(c.programId) && withMaterials.has(c.id)) listed.add(c.id);
    } else {
      for (const c of courses) {
        if (programId && c.programId !== programId) continue;
        if (semesterId && c.semesterId !== semesterId) continue;
        if (programId || withMaterials.has(c.id)) listed.add(c.id);
      }
    }
    return listed;
  }, [
    materials,
    classScope,
    role,
    ownIds,
    programs,
    courses,
    departmentId,
    programId,
    semesterId,
  ]);

  // Courses the current account may upload to.
  const uploadableIds = useMemo(() => {
    if (can.materialScope === "all") return new Set(courseInfo.keys());
    if (can.materialScope === "own") return ownIds;
    return new Set<string>();
  }, [can.materialScope, courseInfo, ownIds]);

  const courseLabel = (id: string) => {
    const info = courseInfo.get(id);
    return info
      ? `${info.name} (${info.code}) · ${info.programName} · Sem ${info.semNumber}`
      : "Unknown course";
  };

  const uploadOptions = useMemo(
    () =>
      [...uploadableIds]
        .filter((id) => courseInfo.has(id))
        .map((id) => ({ value: id, label: courseLabel(id) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uploadableIds, courseInfo],
  );

  const cards = useMemo(() => {
    const byCourse = new Map<string, StudyMaterial[]>();
    for (const id of listedCourseIds) byCourse.set(id, []);
    for (const m of materials)
      if (byCourse.has(m.courseId)) byCourse.get(m.courseId)!.push(m);
    return [...byCourse.entries()]
      .map(([courseId, items]) => ({
        courseId,
        info: courseInfo.get(courseId),
        items: items.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)),
      }))
      .filter((c) => c.info)
      .sort((a, b) => {
        const ai = a.info!;
        const bi = b.info!;
        return (
          ai.programName.localeCompare(bi.programName) ||
          ai.semNumber - bi.semNumber ||
          ai.name.localeCompare(bi.name)
        );
      });
  }, [listedCourseIds, materials, courseInfo]);

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await deleteMaterial.mutateAsync(deleting.id);
      toast.success("Material deleted.");
    } catch (err) {
      toast.error(errMsg(err));
    }
    setDeleting(null);
  }

  const canDelete = (m: StudyMaterial) =>
    can.manageAllMaterials || (user != null && m.uploadedBy === user.id);

  const showFilters = can.materialScope === "all";
  const programOptions = programs.map((p) => ({
    value: p.id,
    label: `${p.name} (${p.code})`,
  }));
  const semesterOptions = useMemo(() => {
    const byId = new Map<string, number>();
    for (const c of courses)
      if (c.programId === programId) byId.set(c.semesterId, c.semesterNumber);
    return [...byId.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([id, num]) => ({ value: id, label: `Semester ${num}` }));
  }, [courses, programId]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Study Materials"
        description={
          classScope
            ? "Links your teachers shared with your class."
            : "Share links to notes, slides, recordings and handouts."
        }
        action={
          uploadOptions.length > 0 ? (
            <Button onClick={() => setUploadCourse("")}>
              <Plus size={16} />
              Share material
            </Button>
          ) : undefined
        }
      />

      {showFilters && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex w-56 flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Program
            </span>
            <SelectField
              options={programOptions}
              value={programId}
              onValueChange={(v) => {
                setProgramId(v);
                setSemesterId("");
              }}
              placeholder="All programs"
            />
          </div>
          <div className="flex w-44 flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Semester
            </span>
            <SelectField
              options={semesterOptions}
              value={semesterId}
              onValueChange={setSemesterId}
              placeholder="All semesters"
              disabled={!programId}
            />
          </div>
          {!programId && (
            <p className="pb-2 text-xs text-muted-foreground">
              Showing courses that have materials. Pick a program to browse
              all of its courses.
            </p>
          )}
        </div>
      )}

      {isLoading ? (
        <CardGridSkeleton cards={4} lines={3} />
      ) : cards.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">
            No materials yet.
            {uploadOptions.length > 0 && " Share the first one."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {cards.map(({ courseId, info, items }) => (
            <div
              key={courseId}
              className="flex flex-col rounded-xl border bg-card shadow-sm"
            >
              <div className="flex items-start justify-between gap-3 border-b p-4">
                <div>
                  <h2 className="text-sm font-semibold">
                    {info!.name}{" "}
                    <span className="font-normal text-muted-foreground">
                      ({info!.code})
                    </span>
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {info!.programName} · Semester {info!.semNumber}
                  </p>
                </div>
                {uploadableIds.has(courseId) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setUploadCourse(courseId)}
                  >
                    <Plus size={16} />
                    Add
                  </Button>
                )}
              </div>
              {items.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">
                  No materials for this course yet.
                </p>
              ) : (
                <ul className="divide-y">
                  {items.map((m) => {
                    return (
                      <li key={m.id} className="flex items-center gap-3 p-4">
                        <MaterialLinkThumb url={m.url} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {m.title}
                          </p>
                          {m.description && (
                            <p className="truncate text-xs text-muted-foreground">
                              {m.description}
                            </p>
                          )}
                          <p className="truncate text-xs text-muted-foreground">
                            {hostLabel(m.url)} · by{" "}
                            {userName.get(m.uploadedBy) ?? "—"} ·{" "}
                            {m.uploadedAt.slice(0, 10)}
                          </p>
                        </div>
                        <Badge variant="outline" className="hidden sm:inline-flex">
                          {termName.get(m.termId) ?? "—"}
                        </Badge>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          title="Open link"
                          aria-label={`Open ${m.title}`}
                          render={
                            <a
                              href={m.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            />
                          }
                          nativeButton={false}
                        >
                          <ExternalLink />
                        </Button>
                        {canDelete(m) && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            title="Delete"
                            className="text-red-600 hover:text-red-700"
                            onClick={() => setDeleting(m)}
                          >
                            <Trash2 />
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      <MaterialShareDialog
        open={uploadCourse !== null}
        onOpenChange={(open) => !open && setUploadCourse(null)}
        courseOptions={uploadOptions}
        defaultCourseId={uploadCourse || undefined}
      />

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete material?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting
                ? `"${deleting.title}" will be removed for everyone in the class. The linked material itself is not affected.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              loading={deleteMaterial.isPending}
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
