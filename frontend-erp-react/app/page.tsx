"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Building2,
  CircleCheck,
  Circle,
  GraduationCap,
  Layers,
  ArrowRight,
  ArrowUpNarrowWide,
  CalendarCheck,
  ChevronRight,
  ClipboardList,
  Pencil,
  ShieldCheck,
  TriangleAlert,
  Users,
  UserCog,
  UserPlus,
} from "lucide-react";
import {
  useAssignments,
  useCourses,
  useDashboardStats,
  useDepartments,
  usePrograms,
  useSettings,
  useTerms,
  useUnstaffedCourses,
  useUsers,
} from "@/lib/queries";
import { useAuth } from "@/lib/permissions";
import { COLLEGE_NAME } from "@/lib/branding";
import { EMPTY_ARRAY } from "@/lib/api";
import { useOwnClasses } from "@/components/attendance/my-classes";
import { PageHeader } from "@/components/page-header";
import { StatTilesSkeleton } from "@/components/ui/card-skeleton";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { DEFAULT_MIN_ATTENDANCE } from "@/lib/attendance";
import { semesterInSession } from "@/lib/types";
import { DepartmentFormDialog } from "@/components/departments/department-form-dialog";
import { ProgramFormDialog } from "@/components/programs/program-form-dialog";
import { StudentFormDialog } from "@/components/students/student-form-dialog";

export default function DashboardPage() {
  const { role, can, departmentId: authDeptId } = useAuth();
  const { data: allDepartments = EMPTY_ARRAY } = useDepartments();
  const { data: allPrograms = EMPTY_ARRAY } = usePrograms();
  const { data: allCourses = EMPTY_ARRAY } = useCourses();
  const { data: terms = EMPTY_ARRAY } = useTerms();
  const { data: settings } = useSettings();
  const currentTermId = settings?.currentTermId ?? "";
  const lockDate = settings?.lockDate ?? null;
  const { data: allAssignments = EMPTY_ARRAY } = useAssignments(currentTermId);
  // The checklist wants a count, not the accounts — ask for the narrowest page
  // the API will serve and read `total`.
  const { data: userPage } = useUsers({ pageSize: 1 }, can.manageUsers);
  const userCount = userPage?.total ?? 0;
  const myClasses = useOwnClasses();

  const currentTerm = useMemo(
    () => terms.find((t) => t.id === currentTermId),
    [terms, currentTermId],
  );

  /**
   * Every headline number comes from one aggregate request. These used to be
   * derived here from `useAttendance({})` — i.e. by downloading every session
   * in the database on each dashboard load. Department scoping for HODs is
   * applied server-side from the caller's own role.
   */
  const { data: dashboardStats, isLoading: statsLoading } =
    useDashboardStats(currentTermId, !!currentTermId);

  // Semester numbers in session for this term's parity — the parity rule stays
  // client-side (`semesterInSession`); the filtering happens in SQL.
  const inSessionSemesters = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => i + 1).filter((n) =>
        semesterInSession(n, currentTerm),
      ),
    [currentTerm],
  );
  const { data: unstaffed = EMPTY_ARRAY } = useUnstaffedCourses(
    currentTermId,
    inSessionSemesters,
    !!currentTermId && can.manageAcademics,
  );

  // HODs get a compact dashboard scoped to their own department. The lists
  // below are small reference data (10 departments / 30 programs / 576
  // courses), so scoping them on the client is fine.
  const lockedDept = role === "hod" ? authDeptId : null;
  const departments = useMemo(
    () =>
      lockedDept ? allDepartments.filter((d) => d.id === lockedDept) : allDepartments,
    [allDepartments, lockedDept],
  );
  const programs = useMemo(
    () =>
      lockedDept ? allPrograms.filter((p) => p.departmentId === lockedDept) : allPrograms,
    [allPrograms, lockedDept],
  );
  const courses = useMemo(() => {
    if (!lockedDept) return allCourses;
    const ids = new Set(programs.map((p) => p.id));
    return allCourses.filter((c) => ids.has(c.programId));
  }, [allCourses, programs, lockedDept]);

  const currentTermAssignments = useMemo(
    () => allAssignments.filter((a) => a.termId === currentTermId).length,
    [allAssignments, currentTermId],
  );

  const studentCount = dashboardStats?.students ?? 0;
  const teacherCount = dashboardStats?.teachers ?? 0;
  const programCount = dashboardStats?.programs ?? programs.length;
  const markedToday = dashboardStats?.sessionsToday ?? 0;
  const termSessionCount = dashboardStats?.sessionsThisTerm ?? 0;
  const correctionsThisWeek = dashboardStats?.correctionsThisWeek ?? 0;
  const shortfallCount = dashboardStats?.shortfall ?? 0;
  const unstaffedCourses = unstaffed.length;

  const [deptOpen, setDeptOpen] = useState(false);
  const [progOpen, setProgOpen] = useState(false);
  const [studentOpen, setStudentOpen] = useState(false);

  // Four cards per role, every link reachable by that role. Everything else
  // (staffing, sessions, corrections, lock) lives in the "This term" strip —
  // fewer cards, so each one actually gets read.
  const stats: {
    label: string;
    value: number | string;
    icon: typeof Building2;
    href: string;
  }[] = [
    { label: "Students", value: studentCount, icon: Users, href: "/students" },
    { label: "Teachers", value: teacherCount, icon: UserCog, href: "/teachers" },
    lockedDept
      ? { label: "Marked today", value: markedToday, icon: CircleCheck, href: "/attendance/register" }
      : { label: "Programs", value: programCount, icon: GraduationCap, href: "/programs" },
    { label: `In shortfall (< ${DEFAULT_MIN_ATTENDANCE}%)`, value: shortfallCount, icon: TriangleAlert, href: "/attendance/summary" },
  ];

  const quickActions: {
    icon: typeof Building2;
    title: string;
    subtitle: string;
    onClick?: () => void;
    href?: string;
  }[] = [
    {
      icon: Building2,
      title: "New department",
      subtitle: "Add an academic unit",
      onClick: () => setDeptOpen(true),
    },
    {
      icon: Layers,
      title: "New program",
      subtitle: "Link a degree to a department",
      onClick: () => setProgOpen(true),
    },
    {
      icon: UserPlus,
      title: "Enroll student",
      subtitle: "Register into a program",
      onClick: () => setStudentOpen(true),
    },
    {
      icon: ClipboardList,
      title: "Assign teachers",
      subtitle: "Map teachers to courses",
      href: "/assignments",
    },
    {
      icon: CalendarCheck,
      title: "Mark attendance",
      subtitle: "Pick a class and mark it",
      href: "/attendance",
    },
    {
      icon: ArrowUpNarrowWide,
      title: "Promote students",
      subtitle: "Advance or graduate a cohort",
      href: "/promotions",
    },
  ];

  // Initial-setup checklist (admin only): the order data must be entered in.
  // Rendered only while something is missing — a fresh install shows it, a
  // fully populated one doesn't.
  const setupSteps: {
    label: string;
    done: boolean;
    detail: string;
    onClick?: () => void;
    href?: string;
  }[] = [
    {
      label: "Add departments",
      done: departments.length > 0,
      detail: `${departments.length} so far`,
      onClick: () => setDeptOpen(true),
    },
    {
      label: "Create programs (with semesters)",
      done: programs.length > 0,
      detail: `${programs.length} so far`,
      onClick: () => setProgOpen(true),
    },
    {
      label: "Add courses to the semesters",
      done: courses.length > 0,
      detail: `${courses.length} courses`,
      href: "/programs",
    },
    {
      label: "Add teachers",
      done: teacherCount > 0,
      detail: `${teacherCount} so far`,
      href: "/teachers",
    },
    {
      label: "Enroll students",
      done: studentCount > 0,
      detail: `${studentCount} so far`,
      onClick: () => setStudentOpen(true),
    },
    {
      label: "Create login accounts",
      done: userCount > 0,
      detail: `${userCount} accounts`,
      href: "/users",
    },
    {
      label: "Staff the current term",
      done: currentTermAssignments > 0,
      detail: `${currentTermAssignments} assignments`,
      href: "/assignments",
    },
  ];
  const setupDone = setupSteps.filter((s) => s.done).length;
  // Initial data entry is admin territory — principals no longer see it.
  const showSetup = can.manageUsers && setupDone < setupSteps.length;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Dashboard"
        description={[
          lockedDept
            ? `${departments[0]?.name ?? "Department"} overview`
            : COLLEGE_NAME,
          currentTerm ? `Current term: ${currentTerm.name}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      />

      {/* Setup checklist — shown only while initial data entry is incomplete */}
      {showSetup && (
        <Card>
          <CardHeader>
            <CardTitle>Getting started</CardTitle>
            <CardDescription>
              Set up the college in this order — each step builds on the last.
            </CardDescription>
            <CardAction>
              <Badge variant="outline" className="font-mono">
                {setupDone}/{setupSteps.length}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <Progress
              value={(setupDone / setupSteps.length) * 100}
              className="mb-3 [&_[data-slot=progress-track]]:h-2"
            />
            {setupSteps.map((step) => {
              const inner = (
                <>
                  {step.done ? (
                    <CircleCheck size={16} className="shrink-0 text-emerald-600" />
                  ) : (
                    <Circle size={16} className="shrink-0 text-muted-foreground" />
                  )}
                  <span
                    className={cn(
                      "text-sm",
                      step.done && "text-muted-foreground line-through",
                    )}
                  >
                    {step.label}
                  </span>
                  {/* Secondary detail — dropped on phones, where the label
                      and the chevron are what matter. */}
                  <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">
                    {step.detail}
                  </span>
                  <ChevronRight size={14} className="text-muted-foreground" />
                </>
              );
              const rowClass =
                "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent";
              return step.href ? (
                <Link key={step.label} href={step.href} className={rowClass}>
                  {inner}
                </Link>
              ) : (
                <button
                  key={step.label}
                  type="button"
                  onClick={step.onClick}
                  className={rowClass}
                >
                  {inner}
                </button>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Stat cards */}
      {statsLoading ? (
        <StatTilesSkeleton tiles={4} />
      ) : (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="rounded-xl border bg-card p-6 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">{s.label}</span>
                <Icon size={16} className="text-muted-foreground" />
              </div>
              <p
                className={cn(
                  "font-semibold",
                  typeof s.value === "string" ? "truncate py-1 text-xl" : "text-3xl",
                )}
              >
                {s.value}
              </p>
              <Link
                href={s.href}
                className="mt-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                Manage <ArrowRight size={14} />
              </Link>
            </div>
          );
        })}
      </div>
      )}

      {/* My classes — the HOD's own teaching, their actionable daily surface */}
      {lockedDept && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarCheck size={18} className="text-muted-foreground" />
              My classes{currentTerm ? ` · ${currentTerm.name}` : ""}
            </CardTitle>
            <CardDescription>
              Courses assigned to you this term — open one to mark attendance.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {myClasses.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No classes assigned to you this term.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {myClasses.map((c) => (
                  <Link
                    key={c.courseId}
                    href="/attendance"
                    className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent"
                  >
                    <CalendarCheck size={15} className="text-muted-foreground" />
                    <span className="font-medium">{c.label}</span>
                    {c.markedToday && (
                      <span
                        className="ml-auto inline-flex items-center gap-1 text-xs text-emerald-600"
                        title="Attendance already saved for today"
                      >
                        <CircleCheck size={14} />
                        Today
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Insight widgets — admin/principal only (the HOD view ends above) */}
      {!lockedDept && (
      <div className="flex flex-col gap-4">
        {/* Quick actions — admin/principal only (HODs are view-only) */}
        {can.manageAcademics && (
        <Card>
          <CardHeader>
            <CardTitle>Quick actions</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {quickActions.map((a) => {
              const Icon = a.icon;
              const content = (
                <>
                  <span className="flex size-9 items-center justify-center rounded-md bg-muted text-foreground">
                    <Icon size={18} />
                  </span>
                  <span className="flex flex-col items-start">
                    <span className="text-sm font-medium">{a.title}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {a.subtitle}
                    </span>
                  </span>
                  <ChevronRight size={16} className="ml-auto text-muted-foreground" />
                </>
              );
              const className = "h-auto w-full justify-start gap-3 p-3";
              return a.href ? (
                <Button
                  key={a.title}
                  variant="outline"
                  className={className}
                  render={<Link href={a.href} />}
                  nativeButton={false}
                >
                  {content}
                </Button>
              ) : (
                <Button
                  key={a.title}
                  variant="outline"
                  className={className}
                  onClick={a.onClick}
                >
                  {content}
                </Button>
              );
            })}
          </CardContent>
        </Card>
        )}

        {/* This term — staffing, marking, corrections and lock, in one strip */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarCheck size={18} className="text-muted-foreground" />
              This term{currentTerm ? ` · ${currentTerm.name}` : ""}
            </CardTitle>
            <CardDescription>
              Where the term stands right now — staffing, marking and record
              integrity. Every correction is on the record.
            </CardDescription>
            <CardAction>
              <div className="flex items-center gap-2">
                {unstaffedCourses > 0 && can.manageAcademics && (
                  <Button
                    variant="outline"
                    size="sm"
                    render={<Link href="/assignments" />}
                    nativeButton={false}
                  >
                    Staff courses <ArrowRight size={14} />
                  </Button>
                )}
                {can.viewAudit && (
                  <Button
                    variant="outline"
                    size="sm"
                    render={<Link href="/attendance/audit" />}
                    nativeButton={false}
                  >
                    Open oversight <ArrowRight size={14} />
                  </Button>
                )}
              </div>
            </CardAction>
          </CardHeader>
          <CardContent>
            {/* 1 → 2 → 4: each tile is an icon plus two lines of text, which
                is too wide to fit four across at the sm breakpoint. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "flex size-9 items-center justify-center rounded-md",
                    unstaffedCourses > 0
                      ? "bg-amber-50 text-amber-600"
                      : "bg-emerald-50 text-emerald-600",
                  )}
                >
                  <ClipboardList size={16} />
                </span>
                <div>
                  <p className="text-xl font-semibold tabular-nums">
                    {unstaffedCourses}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    courses without a teacher
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <CalendarCheck size={16} />
                </span>
                <div>
                  <p className="text-xl font-semibold tabular-nums">
                    {termSessionCount}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    sessions this term · {markedToday} today
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-md bg-amber-50 text-amber-600">
                  <Pencil size={16} />
                </span>
                <div>
                  <p className="text-xl font-semibold tabular-nums">
                    {correctionsThisWeek}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    corrections this week
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "flex size-9 items-center justify-center rounded-md",
                    lockDate
                      ? "bg-emerald-50 text-emerald-600"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <ShieldCheck size={16} />
                </span>
                <div>
                  <p className="text-xl font-semibold">
                    {lockDate ? "Locked" : "Open"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {lockDate
                      ? `attendance frozen up to ${lockDate}`
                      : "attendance can still be edited"}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

      </div>
      )}

      {/* Quick-action dialogs (only roles that can open them mount them) */}
      {can.manageAcademics && (
        <>
          <DepartmentFormDialog open={deptOpen} onOpenChange={setDeptOpen} />
          <ProgramFormDialog open={progOpen} onOpenChange={setProgOpen} />
          <StudentFormDialog open={studentOpen} onOpenChange={setStudentOpen} />
        </>
      )}
    </div>
  );
}
