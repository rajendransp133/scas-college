"use client";

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowRight, Circle, CircleCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ListCardSkeleton } from "@/components/ui/card-skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useAssignments,
  useAttendance,
  useCourses,
  useDashboardStats,
  useSettings,
  useTerms,
} from "@/lib/queries";
import { useAuth } from "@/lib/permissions";
import { apiGet, EMPTY_ARRAY, qs, type Page } from "@/lib/api";
import { qk } from "@/lib/queries/keys";
import { DEFAULT_MIN_ATTENDANCE } from "@/lib/attendance";
import { semesterInSession, type Student } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function SemesterClosePage() {
  const { can } = useAuth();
  const { data: courses = EMPTY_ARRAY } = useCourses();
  const { data: terms = EMPTY_ARRAY } = useTerms();
  const { data: settings } = useSettings();
  const currentTermId = settings?.currentTermId ?? "";
  const lockDate = settings?.lockDate ?? null;

  // The term after the current one, chronologically (odd precedes even within
  // an academic year). It used to be "any other term with no assignments",
  // which by definition had nothing staffed — so step 5 could never complete,
  // and it could pick an old, abandoned term instead of the next one.
  const nextTerm = useMemo(() => {
    const ordered = [...terms].sort(
      (a, b) =>
        a.startYear - b.startYear ||
        (a.parity === b.parity ? 0 : a.parity === "odd" ? -1 : 1),
    );
    const i = ordered.findIndex((t) => t.id === currentTermId);
    return i >= 0 ? (ordered[i + 1] ?? null) : null;
  }, [terms, currentTermId]);
  const { data: nextTermAssignments = EMPTY_ARRAY } = useAssignments(
    nextTerm?.id,
    !!nextTerm,
  );

  // Session counts + the shortfall figure come from the aggregate endpoint —
  // this checklist used to derive them from every session in the database.
  const { data: stats, isLoading } = useDashboardStats(currentTermId, !!currentTermId);

  // The single most recent session of the term tells us how far marking got,
  // which is what the freeze check compares the lock date against.
  const termSessionCount = stats?.sessionsThisTerm ?? 0;
  const { data: lastSessionPage } = useAttendance(
    {
      termId: currentTermId,
      page: Math.max(1, termSessionCount),
      pageSize: 1,
    },
    !!currentTermId && termSessionCount > 0,
  );
  // Sessions are ordered by (date, period), so the final page holds the latest.
  const maxSessionDate = lastSessionPage?.items[0]?.date ?? "";

  // Students in their program's final semester, ready to graduate.
  const maxSemByProgram = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of courses) {
      map[c.programId] = Math.max(map[c.programId] ?? 0, c.semesterNumber);
    }
    return map;
  }, [courses]);
  // Counted per program: one program's final semester is another's middle one.
  // A single `semesters: [6, 8]` filter across the college counted a student in
  // sem 6 of an 8-semester program as "ready to graduate".
  const finalSemQueries = useQueries({
    queries: Object.entries(maxSemByProgram)
      .filter(([, sem]) => sem > 0)
      .map(([programId, semester]) => {
        const filters = { programId, semester, status: "active" as const, pageSize: 1 };
        return {
          queryKey: qk.students(filters),
          queryFn: () => apiGet<Page<Student>>(`/students${qs({ ...filters })}`),
        };
      }),
  });
  const finalSemStudents = finalSemQueries.reduce(
    (n, q) => n + (q.data?.total ?? 0),
    0,
  );

  const currentTerm = terms.find((t) => t.id === currentTermId);
  const canFreeze = can.lockAttendance;

  const steps = useMemo(() => {
    // 1 — registers exist for the term.
    const marked = termSessionCount > 0;

    // 2 — everything marked so far is frozen (for teachers; oversight roles
    // keep audited correction rights).
    const locked =
      marked &&
      lockDate != null &&
      maxSessionDate !== "" &&
      lockDate >= maxSessionDate;

    // 3 — students below the threshold this term (server-computed; excludes
    // students who left or graduated).
    const shortfall = stats?.shortfall ?? 0;

    // 5 — the next term exists and is being staffed. The target counts only
    // courses of semesters in session for *that* term's odd/even parity.
    const inSessionNext = new Set(
      courses
        .filter((c) => nextTerm && semesterInSession(c.semesterNumber, nextTerm))
        .map((c) => c.id),
    );
    const totalCourses = inSessionNext.size;
    const nextTermStaffed = new Set(
      nextTermAssignments
        .map((a) => a.courseId)
        .filter((id) => inSessionNext.has(id)),
    ).size;

    const list: {
      title: string;
      detail: string;
      done: boolean;
      /** Null when this viewer can see the step's status but can't act on it. */
      href: string | null;
      linkLabel: string;
    }[] = [
      {
        title: "Finish marking attendance",
        detail: marked
          ? `${termSessionCount} sessions saved — the latest is ${maxSessionDate}.`
          : "No attendance has been saved for this term yet.",
        done: marked,
        href: "/attendance",
        linkLabel: "Mark attendance",
      },
      {
        title: "Freeze the records",
        detail: locked
          ? `Attendance up to ${lockDate} is frozen for teachers.`
          : lockDate
            ? `Locked only up to ${lockDate}, but classes ran until ${maxSessionDate || "—"}.`
            : canFreeze
              ? "Records are still open — lock them once marking is finished."
              : "Records are still open — the attendance manager freezes them once marking is finished.",
        done: locked,
        // Freezing is the administrator's step; everyone else sees the status
        // but has nowhere to act (they can't reach the oversight page).
        href: canFreeze ? "/attendance/audit" : null,
        linkLabel: "Freeze records",
      },
      {
        title: "Check who is short on attendance",
        detail:
          shortfall > 0
            ? `${shortfall} student(s) are below ${DEFAULT_MIN_ATTENDANCE}%.`
            : marked
              ? `Everyone is at or above ${DEFAULT_MIN_ATTENDANCE}%.`
              : "Waiting on attendance to be marked.",
        done: marked && shortfall === 0,
        href: "/attendance/summary",
        linkLabel: "See shortfalls",
      },
      {
        title: "Move students up (or graduate them)",
        detail:
          finalSemStudents > 0
            ? `${finalSemStudents} student(s) in their final semester are ready to graduate.`
            : "No cohort is waiting to move up or graduate.",
        done: finalSemStudents === 0,
        href: "/promotions",
        linkLabel: "Promote students",
      },
      {
        title: "Set up the next term",
        detail: nextTerm
          ? `${nextTerm.name} — ${nextTermStaffed} of ${totalCourses} courses have a teacher so far.`
          : "Add the next term from the term switcher at the top, then assign its teachers.",
        done: nextTerm != null && nextTermStaffed > 0,
        href: "/assignments",
        linkLabel: "Assign teachers",
      },
    ];
    return list;
  }, [
    termSessionCount,
    maxSessionDate,
    lockDate,
    canFreeze,
    stats,
    finalSemStudents,
    courses,
    nextTerm,
    nextTermAssignments,
  ]);

  // Belt-and-braces: AuthGate already blocks disallowed roles. The checklist is
  // admin + principal (the only roles with manageAcademics); only its "Freeze
  // the records" step is administrator-only.
  if (!can.manageAcademics) return null;

  // The one step to point the user at: the first unfinished step they can
  // actually act on (a principal can't freeze, so don't send them there).
  const nextIndex = steps.findIndex((s) => !s.done && s.href);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Semester Close-Out"
        description={
          currentTerm
            ? `Five steps to wrap up ${currentTerm.name}, in order. Start with the highlighted one.`
            : "Five steps to wrap up the term, in order."
        }
      />

      {isLoading ? (
        <ListCardSkeleton rows={5} />
      ) : (
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        {steps.map((step, i) => {
          const isNext = i === nextIndex;
          return (
            <div
              key={step.title}
              className={cn(
                "flex flex-wrap items-center gap-3 px-4 py-3",
                i > 0 && "border-t",
                isNext && "bg-accent/50",
              )}
            >
              {step.done ? (
                <CircleCheck size={18} className="shrink-0 text-emerald-600" />
              ) : (
                <Circle size={18} className="shrink-0 text-muted-foreground/40" />
              )}
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-sm font-medium",
                    step.done && "text-muted-foreground",
                  )}
                >
                  {i + 1}. {step.title}
                  {isNext && <Badge className="ml-2">Do this next</Badge>}
                </p>
                <p className="text-xs text-muted-foreground">{step.detail}</p>
              </div>
              {step.href && (
                <Button
                  variant={isNext ? "default" : "outline"}
                  size="sm"
                  render={<Link href={step.href} />}
                  nativeButton={false}
                >
                  {step.linkLabel} <ArrowRight size={14} />
                </Button>
              )}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}
