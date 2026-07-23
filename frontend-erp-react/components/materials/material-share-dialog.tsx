"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SelectField } from "@/components/select-field";
import { errMsg } from "@/lib/api";
import { useCreateMaterial, useSettings } from "@/lib/queries";
import { MaterialLinkThumb } from "@/components/materials/material-link-thumb";
import { hostLabel, suggestTitle } from "@/lib/material-link";

/** Mirrors the server's rule: absolute http(s) only. */
function isShareableUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname;
  } catch {
    return false;
  }
}

export function MaterialShareDialog({
  open,
  onOpenChange,
  courseOptions,
  defaultCourseId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Courses the current account may share to. */
  courseOptions: { value: string; label: string }[];
  defaultCourseId?: string;
}) {
  const { data: settings } = useSettings();
  const currentTermId = settings?.currentTermId ?? null;
  const createMaterial = useCreateMaterial();

  const [courseId, setCourseId] = useState("");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const saving = createMaterial.isPending;

  useEffect(() => {
    if (open) {
      setCourseId(defaultCourseId ?? "");
      setUrl("");
      setTitle("");
      setDescription("");
    }
  }, [open, defaultCourseId]);

  // Preview the link exactly as the card will render it, so what you paste is
  // what the class sees.
  const validUrl = isShareableUrl(url);

  function handleUrlBlur() {
    // Suggest a title from the link, but never overwrite one the user typed.
    if (!title.trim() && isShareableUrl(url)) setTitle(suggestTitle(url.trim()));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!courseId) {
      toast.error("Please choose a course.");
      return;
    }
    if (!validUrl) {
      toast.error("Enter a full link starting with http:// or https://.");
      return;
    }
    if (!title.trim()) {
      toast.error("Title is required.");
      return;
    }
    if (!currentTermId) {
      toast.error("No current term set.");
      return;
    }

    try {
      await createMaterial.mutateAsync({
        courseId,
        termId: currentTermId,
        title: title.trim(),
        description: description.trim() || undefined,
        url: url.trim(),
      });
      toast.success("Material shared.");
      onOpenChange(false);
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Course labels are long ("STRATEGIC STUDY OF INDIA (CODE1) · B.A.
          Defence and Strategic Studies · Sem 1"), so this dialog needs more
          room than the default `sm:max-w-sm`.
          The two `minmax(0,…)` tracks are load-bearing, not decoration: a grid
          item defaults to `min-width/min-height: auto` and so refuses to
          shrink below its content, which is what pushed the select and the
          input out past the card's right edge. Clamping both axes lets the
          fields shrink to the card instead — width truncates, height scrolls. */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-hidden sm:max-w-2xl">
        <form onSubmit={handleSubmit} className="flex min-h-0 min-w-0 flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Share study material</DialogTitle>
            <DialogDescription>
              Paste a link to the material — a Drive folder, a recorded lecture,
              a PDF. Nothing is uploaded; the class opens the link directly.
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto py-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="mat-course">Course</Label>
              <SelectField
                id="mat-course"
                options={courseOptions}
                value={courseId}
                onValueChange={setCourseId}
                placeholder="Select a course"
                searchPlaceholder="Search courses…"
                emptyText="No courses available."
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="mat-url">Link</Label>
              <Input
                id="mat-url"
                type="url"
                inputMode="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onBlur={handleUrlBlur}
                placeholder="https://drive.google.com/…"
              />
              {validUrl ? (
                <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2">
                  <MaterialLinkThumb url={url.trim()} />
                  {/* min-w-0: a flex child won't shrink below its content
                      width without it, so `truncate` alone doesn't hold. */}
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    {hostLabel(url.trim())}
                  </span>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  A full address starting with http:// or https://.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="mat-title">Title</Label>
              <Input
                id="mat-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Unit 2 — JavaScript notes"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="mat-desc">Description (optional)</Label>
              <Textarea
                id="mat-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this material cover?"
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Sharing…" : "Share"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
