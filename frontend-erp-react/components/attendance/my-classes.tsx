"use client";

import { useMemo } from "react";
import { CalendarCheck, CircleCheck } from "lucide-react";
import {
  useAttendance,
  useCourses,
  usePrograms,
  useSettings,
  useTerms,
} from "@/lib/queries";
import { useAuth } from "@/lib/permissions";
import { EMPTY_ARRAY } from "@/lib/api";
import { semesterInSession } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface OwnClass {
  courseId: string;
  /** "{course} · {program code} Sem {n}" */
  label: string;
  programId: string;
  semesterId: string;
  semesterNumber: number;
  /** True when a session for this course exists dated today. */
  markedToday: boolean;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

/**
 * Classes assigned to the logged-in account's linked teacher for the current
 * term. Empty for accounts without a linked teacher (att-manager, rep…).
 * Classes in semesters that are out of session for the current term's parity
 * are dropped — an odd term only runs odd-numbered semesters.
 */
export function useOwnClasses(): OwnClass[] {
  const { data: settings } = useSettings();
  const currentTermId = settings?.currentTermId ?? "";
  const { data: courses = EMPTY_ARRAY } = useCourses();
  const { data: programs = EMPTY_ARRAY } = usePrograms();
  const { data: terms = EMPTY_ARRAY } = useTerms();
  const today = todayISO();
  // Today's sessions for the term drive the "Today ✓" marker.
  // Today only, so a single generous page covers every class in the college.
  const { data: todayPage } = useAttendance(
    { termId: currentTermId, date: today, pageSize: 200 },
    !!currentTermId,
  );
  const todaySessions = useMemo(() => todayPage?.items ?? [], [todayPage]);
  const { ownCourseIds } = useAuth();

  return useMemo(() => {
    const ownIds = ownCourseIds(currentTermId);
    if (ownIds.size === 0) return [];
    const currentTerm = terms.find((t) => t.id === currentTermId) ?? null;
    const progById = new Map(programs.map((p) => [p.id, p]));
    const out: OwnClass[] = [];
    for (const c of courses) {
      if (!ownIds.has(c.id)) continue;
      if (!semesterInSession(c.semesterNumber, currentTerm)) continue;
      const prog = progById.get(c.programId);
      out.push({
        courseId: c.id,
        label: `${c.name} · ${prog?.code ?? "—"} Sem ${c.semesterNumber}`,
        programId: c.programId,
        semesterId: c.semesterId,
        semesterNumber: c.semesterNumber,
        markedToday: todaySessions.some((a) => a.courseId === c.id),
      });
    }
    return out;
  }, [ownCourseIds, currentTermId, terms, courses, programs, todaySessions]);
}

/**
 * Card picker over `useOwnClasses()` — how teacher-style accounts choose a
 * class instead of the generic Program → Semester → Course selectors.
 * Deliberately not a daily to-do list (there is no timetable): the "Today ✓"
 * check only appears once today's session is saved; unmarked classes carry
 * no nag.
 */
export function MyClassesPicker({
  classes,
  selectedCourseId,
  onSelect,
  showMarkedToday = true,
}: {
  classes: OwnClass[];
  selectedCourseId: string;
  onSelect: (cls: OwnClass) => void;
  showMarkedToday?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-muted-foreground">
        My classes
      </h2>
      {classes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No classes assigned to you this term.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {classes.map((c) => (
            <button
              key={c.courseId}
              type="button"
              onClick={() => onSelect(c)}
              className={cn(
                "flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-left text-sm shadow-sm transition-colors hover:bg-accent",
                selectedCourseId === c.courseId && "border-ring",
              )}
            >
              <CalendarCheck size={15} className="text-muted-foreground" />
              <span className="font-medium">{c.label}</span>
              {showMarkedToday && c.markedToday && (
                <span
                  className="inline-flex items-center gap-1 text-xs text-emerald-600"
                  title="Attendance already saved for today"
                >
                  <CircleCheck size={14} />
                  Today
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
