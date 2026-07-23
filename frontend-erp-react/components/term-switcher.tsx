"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarRange, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { SelectField } from "@/components/select-field";
import { EMPTY_ARRAY, errMsg } from "@/lib/api";
import {
  useAddTerm,
  useSetCurrentTerm,
  useSettings,
  useTerms,
} from "@/lib/queries";
import { useAuth } from "@/lib/permissions";
import { termLabel, type TermParity } from "@/lib/types";

const PARITY_OPTIONS = [
  { value: "odd", label: "Odd (semesters 1, 3, 5…)" },
  { value: "even", label: "Even (semesters 2, 4, 6…)" },
];

/**
 * Global academic-term control, mounted in the app header. The whole app is
 * scoped to the store's `currentTermId`: admins/principals switch it (and add
 * new terms) here; every other role sees the current term as a read-only badge.
 * A term is defined by its academic year + odd/even half — the name is derived
 * and duplicates of (start year, parity) are rejected.
 */
export function TermSwitcher() {
  const { data: terms = EMPTY_ARRAY } = useTerms();
  const { data: settings } = useSettings();
  const currentTermId = settings?.currentTermId ?? "";
  const setCurrentTerm = useSetCurrentTerm();
  const addTerm = useAddTerm();
  const { can } = useAuth();

  const currentTerm = terms.find((t) => t.id === currentTermId);

  const [addTermOpen, setAddTermOpen] = useState(false);
  const [startYearInput, setStartYearInput] = useState("");
  const [parity, setParity] = useState<TermParity>("odd");

  const termOptions = useMemo(
    () => terms.map((t) => ({ value: t.id, label: t.name })),
    [terms],
  );

  if (terms.length === 0) return null;

  const startYear = Number(startYearInput);
  const yearValid =
    Number.isInteger(startYear) && startYear >= 2000 && startYear <= 2100;

  function openAddTerm() {
    // Sensible default: the current term's academic year.
    setStartYearInput(String(currentTerm?.startYear ?? new Date().getFullYear()));
    setParity("odd");
    setAddTermOpen(true);
  }

  async function handleAddTerm(e: React.FormEvent) {
    e.preventDefault();
    if (!yearValid) {
      toast.error("Enter a start year between 2000 and 2100.");
      return;
    }
    if (terms.some((t) => t.startYear === startYear && t.parity === parity)) {
      toast.error(`Term "${termLabel(startYear, parity)}" already exists.`);
      return;
    }
    try {
      const term = await addTerm.mutateAsync({ startYear, parity });
      await setCurrentTerm.mutateAsync(term.id);
      setAddTermOpen(false);
      toast.success(
        `Added term "${termLabel(startYear, parity)}" and set it as current.`,
      );
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  if (!can.manageAcademics) {
    return (
      <Badge variant="outline" className="gap-1.5">
        <CalendarRange size={13} />
        {currentTerm?.name ?? "—"}
      </Badge>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <CalendarRange
        size={15}
        className="hidden shrink-0 text-muted-foreground sm:block"
      />
      <SelectField
        id="global-term"
        options={termOptions}
        value={currentTermId}
        onValueChange={(v) => v && setCurrentTerm.mutate(v)}
        placeholder="Select term"
        searchPlaceholder="Search terms…"
        className="w-32 sm:w-44"
      />
      <Button
        variant="outline"
        size="sm"
        onClick={openAddTerm}
        aria-label="Add term"
        className="shrink-0"
      >
        <Plus size={16} />
        <span className="hidden sm:inline">Add term</span>
      </Button>

      {/* Add term dialog */}
      <Dialog open={addTermOpen} onOpenChange={setAddTermOpen}>
        <DialogContent>
          <form onSubmit={handleAddTerm} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Add academic term</DialogTitle>
              <DialogDescription>
                Pick the academic year and the odd/even half. New terms start
                with no teacher assignments; the app switches to the new term
                immediately.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="term-start-year">Start year</Label>
                  <Input
                    id="term-start-year"
                    type="number"
                    min={2000}
                    max={2100}
                    value={startYearInput}
                    onChange={(e) => setStartYearInput(e.target.value)}
                    placeholder="e.g. 2026"
                    autoFocus
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="term-end-year">End year</Label>
                  <Input
                    id="term-end-year"
                    value={yearValid ? String(startYear + 1) : ""}
                    placeholder="—"
                    disabled
                  />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="term-parity">Semester half</Label>
                <SelectField
                  id="term-parity"
                  options={PARITY_OPTIONS}
                  value={parity}
                  onValueChange={(v) => setParity((v as TermParity) || "odd")}
                  placeholder="Select half"
                />
                <p className="text-xs text-muted-foreground">
                  Only {parity === "odd" ? "odd" : "even"}-numbered semesters
                  run during this term — staffing and attendance apply to them
                  alone.
                </p>
              </div>
              {yearValid && (
                <p className="text-sm text-muted-foreground">
                  Term will be created as{" "}
                  <span className="font-medium text-foreground">
                    {termLabel(startYear, parity)}
                  </span>
                  .
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddTermOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit">Add term</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
