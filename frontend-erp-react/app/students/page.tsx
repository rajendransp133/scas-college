"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowUpNarrowWide,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  Upload,
  Users,
} from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
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
import type { Student } from "@/lib/types";
import { EMPTY_ARRAY, errMsg } from "@/lib/api";
import {
  useDeleteStudent,
  useDepartments,
  usePrograms,
  useStudents,
  useToggleStudentActive,
  type StudentStatus,
} from "@/lib/queries";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { usePagination } from "@/hooks/use-pagination";
import { useAuth } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { TableRowsSkeleton } from "@/components/ui/table-skeleton";
import { QueryError } from "@/components/query-error";
import { StudentFormDialog } from "@/components/students/student-form-dialog";
import dynamic from "next/dynamic";
import { StudentRow } from "@/components/students/student-row";

// ~640 lines of CSV parsing/validation only needed once the dialog opens —
// split out of the page bundle.
const StudentBulkUploadDialog = dynamic(() =>
  import("@/components/students/student-bulk-upload-dialog").then(
    (m) => m.StudentBulkUploadDialog,
  ),
);

const PAGE_SIZE = 25;
const ALL = "all";
// Semesters a program can run. Fixed 1..12 (matching the server's validation
// range) rather than derived from the loaded rows — with server-side paging the
// current page no longer contains every semester in use.
const SEMESTER_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

export default function StudentsPage() {
  const router = useRouter();
  const { data: departments = EMPTY_ARRAY } = useDepartments();
  const { data: programs = EMPTY_ARRAY } = usePrograms();
  const deleteStudent = useDeleteStudent();
  const toggleStudentActive = useToggleStudentActive();
  const { can, role, departmentId: authDeptId } = useAuth();
  // HODs are locked to their own department (filter preset + disabled).
  const lockedDept = role === "hod" ? authDeptId : null;

  const [search, setSearch] = useState("");
  const [dept, setDept] = useState<string>(ALL);
  const [program, setProgram] = useState<string>(ALL);
  const [semester, setSemester] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);

  const [createOpen, setCreateOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [deleting, setDeleting] = useState<Student | null>(null);

  const deptFilter = lockedDept ?? dept;
  // The input stays instant; only the request waits for a pause in typing.
  const debouncedSearch = useDebouncedValue(search.trim(), 300);

  // Any filter change puts us back on page 1.
  const [page, setPage] = usePagination(
    JSON.stringify([debouncedSearch, deptFilter, program, semester, status]),
  );

  // Search, filters, sort and paging all execute in the database — the page
  // only ever holds the rows it renders.
  const { data, isLoading, isFetching, isPlaceholderData, error, refetch } = useStudents({
    search: debouncedSearch || undefined,
    departmentId: deptFilter === ALL ? undefined : deptFilter,
    programId: program === ALL ? undefined : program,
    semester: semester === ALL ? undefined : Number(semester),
    status: status === ALL ? undefined : (status as StudentStatus),
    page,
    pageSize: PAGE_SIZE,
  });

  const pageItems = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const deptName = useMemo(
    () => Object.fromEntries(departments.map((d) => [d.id, d.name])),
    [departments],
  );
  const progName = useMemo(
    () =>
      Object.fromEntries(programs.map((p) => [p.id, `${p.name} (${p.code})`])),
    [programs],
  );

  // Programs shown in the filter depend on the chosen department.
  const filterPrograms = useMemo(
    () =>
      deptFilter === ALL
        ? programs
        : programs.filter((p) => p.departmentId === deptFilter),
    [programs, deptFilter],
  );

  // Item maps so each filter Select shows its chosen label.
  const deptItems = useMemo(
    () => ({
      [ALL]: "All departments",
      ...Object.fromEntries(departments.map((d) => [d.id, d.name])),
    }),
    [departments],
  );
  // Annotated (like statusItems below) so it can be indexed by an arbitrary
  // program id — the inferred type is just the literal `all` key.
  const programItems: Record<string, string> = useMemo(
    () => ({
      [ALL]: "All programs",
      ...Object.fromEntries(filterPrograms.map((p) => [p.id, p.code])),
    }),
    [filterPrograms],
  );
  const semesterItems = useMemo(
    () => ({
      [ALL]: "All semesters",
      ...Object.fromEntries(
        SEMESTER_OPTIONS.map((n) => [String(n), `Semester ${n}`]),
      ),
    }),
    [],
  );
  // Lifecycle filter — end-of-course housekeeping (find graduated/inactive).
  const statusItems: Record<string, string> = useMemo(
    () => ({
      [ALL]: "All statuses",
      active: "Active",
      inactive: "Inactive",
      graduated: "Graduated",
    }),
    [],
  );

  const currentPage = data?.page ?? page;

  // What the count is counting. Spelling the active filters out next to the
  // number is the point of the feature: "53 students" means nothing on its own,
  // "53 students · BCA · Semester 3" answers the actual question.
  const activeFilters = useMemo(() => {
    const parts: string[] = [];
    if (debouncedSearch) parts.push(`matching "${debouncedSearch}"`);
    if (deptFilter !== ALL) parts.push(deptName[deptFilter] ?? "—");
    if (program !== ALL) parts.push(programItems[program] ?? "—");
    if (semester !== ALL) parts.push(`Semester ${semester}`);
    if (status !== ALL) parts.push(statusItems[status] ?? "—");
    return parts;
  }, [
    debouncedSearch, deptFilter, program, semester, status,
    deptName, programItems, statusItems,
  ]);

  // The HOD's department filter is preset and disabled, so it isn't theirs to
  // clear — exclude it from both the reset and the "any filters?" test.
  const clearableFilters =
    activeFilters.length - (lockedDept && deptFilter !== ALL ? 1 : 0);

  const clearFilters = useCallback(() => {
    setSearch("");
    if (!lockedDept) setDept(ALL);
    setProgram(ALL);
    setSemester(ALL);
    setStatus(ALL);
  }, [lockedDept]);

  const confirmDelete = useCallback(async () => {
    if (!deleting) return;
    try {
      await deleteStudent.mutateAsync(deleting.id);
      toast.success(`Deleted "${deleting.name}".`);
    } catch (err) {
      toast.error(errMsg(err));
    }
    setDeleting(null);
  }, [deleting, deleteStudent]);

  // Stable identities so the memoized rows below don't re-render on every
  // keystroke in the search box.
  const handleToggleActive = useCallback(
    async (s: Student) => {
      try {
        await toggleStudentActive.mutateAsync(s.id);
        toast.success(s.isActive ? "Marked inactive." : "Marked active.");
      } catch (err) {
        toast.error(errMsg(err));
      }
    },
    [toggleStudentActive],
  );

  const handleView = useCallback(
    (s: Student) => router.push(`/students/${s.id}`),
    [router],
  );
  const handleEdit = useCallback((s: Student) => setEditing(s), []);
  const handleDelete = useCallback((s: Student) => setDeleting(s), []);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Students"
        description="Search, filter and manage student enrolment."
        action={
          can.manageAcademics ? (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                render={<Link href="/promotions" />}
                nativeButton={false}
              >
                <ArrowUpNarrowWide size={16} />
                Promotions
              </Button>
              <Button
                variant="outline"
                onClick={() => setBulkOpen(true)}
                disabled={programs.length === 0}
              >
                <Upload size={16} />
                Bulk upload
              </Button>
              <Button
                onClick={() => setCreateOpen(true)}
                disabled={programs.length === 0}
              >
                <Plus size={16} />
                New student
              </Button>
            </div>
          ) : undefined
        }
      />

      {/* Toolbar: search + filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative lg:max-w-xs lg:flex-1">
          <Search
            size={16}
            className="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or roll number..."
            className="pl-8"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            items={deptItems}
            value={deptFilter}
            disabled={Boolean(lockedDept)}
            onValueChange={(v) => {
              setDept(v ?? ALL);
              setProgram(ALL); // reset dependent program filter
            }}
          >
            <SelectTrigger className="w-44">
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
          <Select
            items={programItems}
            value={program}
            onValueChange={(v) => setProgram(v ?? ALL)}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Program" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(programItems).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            items={semesterItems}
            value={semester}
            onValueChange={(v) => setSemester(v ?? ALL)}
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Semester" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(semesterItems).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            items={statusItems}
            value={status}
            onValueChange={(v) => setStatus(v ?? ALL)}
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(statusItems).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* How many students match, right beside the filters that decide it —
          the answer to "how big is this cohort?" without paging to the end. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="text-sm">
          {isLoading ? (
            <span className="text-muted-foreground">Counting…</span>
          ) : (
            <>
              <span className="font-medium tabular-nums">
                {total.toLocaleString()}
              </span>{" "}
              <span className="text-muted-foreground">
                {total === 1 ? "student" : "students"}
                {activeFilters.length > 0 ? ` · ${activeFilters.join(" · ")}` : ""}
              </span>
            </>
          )}
          {isFetching && isPlaceholderData ? (
            <span className="text-muted-foreground"> · updating…</span>
          ) : null}
        </p>
        {clearableFilters > 0 ? (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        <Table variant="stacked">
          <TableHeader>
            <TableRow>
              <TableHead>Roll No.</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Program</TableHead>
              <TableHead className="text-center">Sem</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRowsSkeleton rows={8} cols={6} />
            ) : error && pageItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <QueryError
                    error={error}
                    onRetry={() => void refetch()}
                    className="flex flex-col items-center gap-2 py-8 text-center"
                  />
                </TableCell>
              </TableRow>
            ) : pageItems.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-32 text-center text-muted-foreground"
                >
                  <Users size={24} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No students match your filters.</p>
                </TableCell>
              </TableRow>
            ) : (
              pageItems.map((s) => (
                <StudentRow
                  key={s.id}
                  student={s}
                  departmentName={
                    s.departmentId ? (deptName[s.departmentId] ?? "—") : "—"
                  }
                  programName={s.programId ? (progName[s.programId] ?? "—") : "—"}
                  canManage={can.manageAcademics}
                  onView={handleView}
                  onEdit={handleEdit}
                  onToggleActive={handleToggleActive}
                  onDelete={handleDelete}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination — the total lives above with the filters now, so this only
          says which slice you're looking at. */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>
          {total > 0
            ? `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(
                currentPage * PAGE_SIZE,
                total,
              )} of ${total.toLocaleString()}`
            : ""}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft size={16} />
            Previous
          </Button>
          <span className="tabular-nums">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>

      <StudentFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      <StudentBulkUploadDialog open={bulkOpen} onOpenChange={setBulkOpen} />
      <StudentFormDialog
        open={Boolean(editing)}
        onOpenChange={(o) => !o && setEditing(null)}
        student={editing ?? undefined}
      />

      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete student?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes <strong>{deleting?.name}</strong> (
              {deleting?.rollNumber}) and strips their marks from every saved
              attendance session; only audit-log entries remain. For a student
              who discontinued, use <em>Deactivate</em> instead — their
              attendance history stays visible, tagged &quot;Left&quot;.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              loading={deleteStudent.isPending}
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
