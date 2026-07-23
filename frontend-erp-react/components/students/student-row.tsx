"use client";

import { memo } from "react";
import Link from "next/link";
import {
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Trash2,
  UserCheck,
  UserX,
} from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Student } from "@/lib/types";

interface StudentRowProps {
  student: Student;
  /** Resolved names are passed in — the row never does its own lookups. */
  departmentName: string;
  programName: string;
  canManage: boolean;
  onView: (s: Student) => void;
  onEdit: (s: Student) => void;
  onToggleActive: (s: Student) => void;
  onDelete: (s: Student) => void;
}

/**
 * One row of the students table.
 *
 * Split out and wrapped in `memo` so typing in the page's search box — which
 * re-renders the page on every keystroke — doesn't re-render 25 rows with
 * their dropdown menus. The callbacks are `useCallback`-stable on the parent,
 * which is what makes the memo actually hold.
 */
function StudentRowImpl({
  student: s,
  departmentName,
  programName,
  canManage,
  onView,
  onEdit,
  onToggleActive,
  onDelete,
}: StudentRowProps) {
  return (
    <TableRow className={s.isActive ? undefined : "opacity-60"}>
      <TableCell data-label="Roll No." className="font-mono text-sm">
        {s.rollNumber}
      </TableCell>
      <TableCell data-label="Name">
        <Link href={`/students/${s.id}`} className="font-medium hover:underline">
          {s.name}
        </Link>
        <p className="text-xs text-muted-foreground">{departmentName}</p>
      </TableCell>
      <TableCell data-label="Program" className="text-muted-foreground">
        {programName}
      </TableCell>
      <TableCell data-label="Sem" className="text-center tabular-nums">
        {s.currentSemester}
      </TableCell>
      <TableCell data-label="Status">
        {s.graduated ? (
          <Badge
            variant="outline"
            className="border-violet-200 bg-violet-50 text-violet-700"
          >
            Graduated
          </Badge>
        ) : s.isActive ? (
          <Badge
            variant="outline"
            className="border-emerald-200 bg-emerald-50 text-emerald-700"
          >
            Active
          </Badge>
        ) : (
          <Badge variant="outline">Inactive</Badge>
        )}
      </TableCell>
      <TableCell data-label="">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label="Actions">
                <MoreHorizontal size={16} />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onView(s)}>
              <ChevronRight size={16} />
              View detail
            </DropdownMenuItem>
            {canManage && (
              <>
                <DropdownMenuItem onClick={() => onEdit(s)}>
                  <Pencil size={16} />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onToggleActive(s)}>
                  {s.isActive ? <UserX size={16} /> : <UserCheck size={16} />}
                  {s.isActive ? "Inactive" : "Active"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => onDelete(s)}
                >
                  <Trash2 size={16} />
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

export const StudentRow = memo(StudentRowImpl);
