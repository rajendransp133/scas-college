"use client";

import { memo } from "react";
import { ExternalLink, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MaterialLinkThumb } from "@/components/materials/material-link-thumb";
import { hostLabel } from "@/lib/material-link";
import type { StudyMaterial } from "@/lib/types";

interface MaterialRowProps {
  material: StudyMaterial;
  /** Resolved display strings are passed in — the row never does its own lookups. */
  uploaderName: string;
  termName: string;
  canDelete: boolean;
  onDelete: (m: StudyMaterial) => void;
}

/**
 * One material link inside a course card's list. Split out and `memo`-wrapped
 * for the same reason as `student-row.tsx`: unrelated page state (filters,
 * the share dialog) shouldn't re-render every material row across every card.
 */
function MaterialRowImpl({
  material: m,
  uploaderName,
  termName,
  canDelete,
  onDelete,
}: MaterialRowProps) {
  return (
    <li className="flex items-center gap-3 p-4">
      <MaterialLinkThumb url={m.url} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{m.title}</p>
        {m.description && (
          <p className="truncate text-xs text-muted-foreground">
            {m.description}
          </p>
        )}
        <p className="truncate text-xs text-muted-foreground">
          {hostLabel(m.url)} · by {uploaderName} · {m.uploadedAt.slice(0, 10)}
        </p>
      </div>
      <Badge variant="outline" className="hidden sm:inline-flex">
        {termName}
      </Badge>
      <Button
        variant="outline"
        size="icon-sm"
        title="Open link"
        aria-label={`Open ${m.title}`}
        render={
          <a href={m.url} target="_blank" rel="noopener noreferrer" />
        }
        nativeButton={false}
      >
        <ExternalLink />
      </Button>
      {canDelete && (
        <Button
          variant="ghost"
          size="icon-sm"
          title="Delete"
          className="text-red-600 hover:text-red-700"
          onClick={() => onDelete(m)}
        >
          <Trash2 />
        </Button>
      )}
    </li>
  );
}

export const MaterialRow = memo(MaterialRowImpl);
