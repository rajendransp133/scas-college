"use client";

import { memo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useStudentBreakdown, type FlatCourse } from "@/lib/queries";
import { EMPTY_ARRAY } from "@/lib/api";
import { pctColor } from "@/lib/attendance";

interface SummaryBreakdownProps {
  studentId: string;
  termId: string | null;
  threshold: number;
  courseIndex: Record<string, FlatCourse>;
}

/**
 * Per-course tally for one student, shown when a summary row is expanded.
 *
 * Fetched lazily per student rather than bundled into the list response: only
 * a handful of rows are ever expanded, so loading every student's per-course
 * breakdown up front would undo the point of aggregating server-side.
 */
function SummaryBreakdownImpl({
  studentId,
  termId,
  threshold,
  courseIndex,
}: SummaryBreakdownProps) {
  const { data: courses = EMPTY_ARRAY, isLoading } = useStudentBreakdown(studentId, termId);

  if (isLoading) {
    return (
      <p className="px-6 py-3 text-sm text-muted-foreground max-md:px-2">
        Loading course breakdown…
      </p>
    );
  }

  if (courses.length === 0) {
    return (
      <p className="px-6 py-3 text-sm text-muted-foreground max-md:px-2">
        No attendance recorded for this student.
      </p>
    );
  }

  return (
    <div className="px-6 py-3 max-md:px-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Course</TableHead>
            <TableHead className="text-center">Held</TableHead>
            <TableHead className="text-center">Attended</TableHead>
            <TableHead className="text-center">%</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {courses.map((cs) => {
            const ref = courseIndex[cs.courseId];
            const short = cs.pct !== null && cs.pct < threshold;
            return (
              <TableRow key={cs.courseId}>
                <TableCell>
                  <span className="font-medium">
                    {ref?.name ?? "Unknown course"}
                  </span>{" "}
                  <span className="text-xs text-muted-foreground">
                    {ref?.code}
                  </span>
                </TableCell>
                <TableCell className="text-center tabular-nums">
                  {cs.held}
                </TableCell>
                <TableCell className="text-center tabular-nums">
                  {cs.attended}
                </TableCell>
                <TableCell className="text-center tabular-nums">
                  {cs.pct === null ? (
                    "—"
                  ) : cs.corrections > 0 && cs.origPct !== cs.pct ? (
                    <span
                      className="font-medium text-amber-700"
                      title={`As marked: ${cs.origPct ?? "—"}% · ${cs.corrections} correction(s)`}
                    >
                      {cs.origPct === null ? "—" : `${cs.origPct}%`} → {cs.pct}%
                    </span>
                  ) : (
                    <span className={pctColor(cs.pct, threshold)}>{cs.pct}%</span>
                  )}
                </TableCell>
                <TableCell>
                  {short && (
                    <Badge
                      variant="outline"
                      className="border-red-200 bg-red-50 text-red-700"
                    >
                      Short
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export const SummaryBreakdown = memo(SummaryBreakdownImpl);
