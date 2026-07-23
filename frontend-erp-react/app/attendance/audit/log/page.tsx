"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SelectField } from "@/components/select-field";
import {
  useAudit,
  useCourses,
  useSettings,
  useStudentLookup,
  useUserDirectory,
} from "@/lib/queries";
import { useAuth } from "@/lib/permissions";
import { EMPTY_ARRAY } from "@/lib/api";
import { usePagination } from "@/hooks/use-pagination";
import { PageHeader } from "@/components/page-header";
import { TableRowsSkeleton } from "@/components/ui/table-skeleton";
import { STATUS_META } from "@/lib/attendance";
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTIONS,
  type AuditAction,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const ACTION_BADGE: Record<AuditAction, string> = {
  mark: "border-emerald-200 bg-emerald-50 text-emerald-700",
  edit: "border-amber-200 bg-amber-50 text-amber-700",
  // Both destructive actions share the red badge — a removal is as severe as
  // dropping the whole session, just narrower.
  "remove-record": "border-red-200 bg-red-50 text-red-700",
  "delete-session": "border-red-200 bg-red-50 text-red-700",
  lock: "border-slate-200 bg-slate-50 text-slate-700",
  unlock: "border-slate-200 bg-slate-50 text-slate-700",
};

const fmtWhen = (iso: string) =>
  `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;

const PAGE_SIZE = 50;

export default function AuditLogPage() {
  const { can } = useAuth();
  const { data: courses = EMPTY_ARRAY } = useCourses();
  const { data: settings } = useSettings();
  const currentTermId = settings?.currentTermId ?? "";
  const { data: directory = EMPTY_ARRAY } = useUserDirectory();

  const [actionFilter, setActionFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");

  // Any filter change puts us back on page 1.
  const [page, setPage] = usePagination(
    JSON.stringify([actionFilter, userFilter, currentTermId]),
  );

  // The log is 200k+ rows: term scoping, the action/user filters and paging all
  // run in the database. Lock/unlock entries have no termId and the server
  // keeps them visible in every term.
  const { data: auditPage, isFetching, isLoading } = useAudit(
    {
      termId: currentTermId || undefined,
      action: (actionFilter || undefined) as AuditAction | undefined,
      userId: userFilter || undefined,
      page,
      pageSize: PAGE_SIZE,
    },
    can.viewAudit,
  );
  const entries = useMemo(() => auditPage?.items ?? [], [auditPage]);
  const total = auditPage?.total ?? 0;
  const totalPages = auditPage?.totalPages ?? 1;

  // Only the students referenced by the entries actually on screen.
  const studentIds = useMemo(
    () =>
      entries
        .map((e) => e.studentId)
        .filter((id): id is string => typeof id === "string"),
    [entries],
  );
  const { data: studentRefs = EMPTY_ARRAY } = useStudentLookup(studentIds);

  const userName = useMemo(
    () => Object.fromEntries(directory.map((u) => [u.id, u.name])),
    [directory],
  );
  const studentName = useMemo(
    () =>
      Object.fromEntries(
        studentRefs.map((s) => [s.id, `${s.name} (${s.rollNumber})`]),
      ),
    [studentRefs],
  );
  const courseLabel = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of courses) map[c.id] = `${c.name} (${c.code})`;
    return map;
  }, [courses]);

  const actionOptions = useMemo(
    () =>
      AUDIT_ACTIONS.map((a) => ({ value: a, label: AUDIT_ACTION_LABELS[a] })),
    [],
  );
  const userOptions = useMemo(
    () => directory.map((u) => ({ value: u.id, label: u.name })),
    [directory],
  );

  // Route guard already blocks other roles; this is belt-and-braces.
  if (!can.viewAudit) return null;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/attendance/audit"
        className="inline-flex items-center gap-2 self-start rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <ArrowLeft size={16} />
        Back to oversight
      </Link>

      <PageHeader
        title="Audit Log"
        description="Every mark, correction and deletion — newest first. This log can never be edited or erased."
      />

      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="aud-action">Show action</Label>
          <SelectField
            id="aud-action"
            options={actionOptions}
            value={actionFilter}
            onValueChange={setActionFilter}
            placeholder="All actions"
            searchPlaceholder="Search…"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="aud-user">Show user</Label>
          <SelectField
            id="aud-user"
            options={userOptions}
            value={userFilter}
            onValueChange={setUserFilter}
            placeholder="All users"
            searchPlaceholder="Search users…"
          />
        </div>
      </div>

      {/* The log */}
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        <Table variant="stacked">
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Student</TableHead>
              <TableHead>Course · class</TableHead>
              <TableHead>Change</TableHead>
              <TableHead>Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRowsSkeleton rows={8} cols={7} />
            ) : entries.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="h-32 text-center text-sm text-muted-foreground"
                >
                  No audit entries match your filters.
                </TableCell>
              </TableRow>
            ) : (
              entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell
                    data-label="When"
                    className="whitespace-nowrap font-mono text-xs text-muted-foreground"
                  >
                    {fmtWhen(e.at)}
                  </TableCell>
                  <TableCell data-label="Who" className="font-medium">
                    {userName[e.userId] ?? "Unknown"}
                  </TableCell>
                  <TableCell data-label="Action">
                    <Badge variant="outline" className={ACTION_BADGE[e.action]}>
                      {AUDIT_ACTION_LABELS[e.action]}
                    </Badge>
                  </TableCell>
                  <TableCell data-label="Student" className="text-sm">
                    {e.studentId ? studentName[e.studentId] ?? "—" : "—"}
                  </TableCell>
                  <TableCell
                    data-label="Course · class"
                    className="text-sm text-muted-foreground"
                  >
                    {e.courseId ? courseLabel[e.courseId] ?? "—" : "—"}
                    {e.date && (
                      <span className="whitespace-nowrap">
                        {" "}
                        · {e.date}
                        {e.period != null && ` P${e.period}`}
                      </span>
                    )}
                  </TableCell>
                  <TableCell data-label="Change">
                    {e.from && e.to ? (
                      <span className="inline-flex items-center gap-1">
                        <span
                          className={cn(
                            "inline-block min-w-7 rounded border px-1 text-center text-xs font-medium",
                            STATUS_META[e.from].badgeClass,
                          )}
                        >
                          {STATUS_META[e.from].short}
                        </span>
                        <ArrowRight
                          size={12}
                          className="text-muted-foreground"
                        />
                        <span
                          className={cn(
                            "inline-block min-w-7 rounded border px-1 text-center text-xs font-medium",
                            STATUS_META[e.to].badgeClass,
                          )}
                        >
                          {STATUS_META[e.to].short}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell
                    data-label="Note"
                    className="max-w-64 truncate text-sm text-muted-foreground max-md:max-w-none"
                  >
                    {e.note ?? "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {total.toLocaleString()} entr{total === 1 ? "y" : "ies"}
          {total > 0
            ? ` · showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)}`
            : ""}
          {isFetching ? " · updating…" : ""}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <span className="tabular-nums">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
