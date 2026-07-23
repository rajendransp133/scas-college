"use client";

import { memo } from "react";
import Link from "next/link";
import {
  ChevronRight,
  Crown,
  MoreHorizontal,
  Pencil,
  Star,
  StarOff,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Teacher } from "@/lib/types";

interface TeacherRowProps {
  teacher: Teacher;
  canManage: boolean;
  onView: (t: Teacher) => void;
  onEdit: (t: Teacher) => void;
  onAssignHod: (t: Teacher) => void;
  onRemoveHod: (t: Teacher) => void;
  onDelete: (t: Teacher) => void;
}

/**
 * One teacher entry — rendered either as the department's HOD highlight
 * block or as a regular faculty list item, mirroring the two call sites on
 * the Teachers page. Split out and `memo`-wrapped for the same reason as
 * `student-row.tsx`: department cards shouldn't re-render every faculty row
 * (and its dropdown) when unrelated page state changes.
 */
function TeacherRowImpl({
  teacher: t,
  canManage,
  onView,
  onEdit,
  onAssignHod,
  onRemoveHod,
  onDelete,
}: TeacherRowProps) {
  const actions = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Actions">
            <MoreHorizontal size={16} />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onView(t)}>
          <ChevronRight size={16} />
          View detail
        </DropdownMenuItem>
        {canManage && (
          <>
            <DropdownMenuItem onClick={() => onEdit(t)}>
              <Pencil size={16} />
              Edit
            </DropdownMenuItem>
            {t.isHod ? (
              <DropdownMenuItem onClick={() => onRemoveHod(t)}>
                <StarOff size={16} />
                Remove as HOD
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => onAssignHod(t)}>
                <Star size={16} />
                Assign as HOD
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => onDelete(t)}>
              <Trash2 size={16} />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (t.isHod) {
    return (
      <div className="flex items-center justify-between gap-2  ">
        <div className="min-w-0">
          <Link
            href={`/teachers/${t.id}`}
            className="flex items-center gap-1.5 font-medium  hover:underline"
          >
            <Crown size={14} className="shrink-0 text-amber-600" />
            <span className="truncate">{t.name}</span>
          </Link>
          <p className="text-xs ">
            HOD · {t.designation}
            {t.qualification ? ` · ${t.qualification}` : ""}
          </p>
        </div>
        {actions}
      </div>
    );
  }

  return (
    <li>
      <div className="-mx-2 flex items-center justify-between gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent">
        <div className="min-w-0">
          <Link
            href={`/teachers/${t.id}`}
            className="block truncate text-sm font-medium hover:underline"
          >
            {t.name}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {t.designation}
            {t.qualification ? ` · ${t.qualification}` : ""}
          </p>
        </div>
        {actions}
      </div>
    </li>
  );
}

export const TeacherRow = memo(TeacherRowImpl);
