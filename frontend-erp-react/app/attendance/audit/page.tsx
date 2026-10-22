"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Lock,
  LockOpen,
  Pencil,
  ScrollText,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { EMPTY_ARRAY, errMsg } from "@/lib/api";
import {
  useRedFlags,
  useLockHistory,
  useSetLockDate,
  useSettings,
  useUserDirectory,
} from "@/lib/queries";
import { useAuth } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { CardGridSkeleton } from "@/components/ui/card-skeleton";

const fmtWhen = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;

export default function AuditPage() {
  const { can } = useAuth();
  const { data: settings } = useSettings();
  const currentTermId = settings?.currentTermId ?? "";
  const lockDate = settings?.lockDate ?? null;
  const { data: directory = EMPTY_ARRAY } = useUserDirectory();
  const setLockDate = useSetLockDate();

  /**
   * Both warning-sign cards, computed in SQL.
   *
   * The "passing only because of corrections" check (as-marked % below the
   * threshold, corrected % at or above it) used to run here over every session
   * in the term. It is the whole point of the oversight page, so it is now an
   * exact aggregate rather than something the client can only afford to
   * approximate.
   */
  const { data: redFlags, isLoading: flagsLoading } = useRedFlags(
    currentTermId,
    can.viewAudit,
  );
  const flipped = useMemo(
    () => redFlags?.passingOnlyViaCorrections ?? [],
    [redFlags],
  );
  const editsByUser = useMemo(
    () =>
      (redFlags?.correctionsByUser ?? []).map(
        (r) => [r.userId, r.corrections] as const,
      ),
    [redFlags],
  );

  // Every lock/unlock ever made — the freeze card shows this timeline so it's
  // always clear when records were frozen, and by whom. Fetched by action
  // (these entries carry no termId).
  const { data: lockHistory = EMPTY_ARRAY } = useLockHistory(
    can.viewAudit || can.lockAttendance,
  );
  const lastLockEvent = lockHistory[0];

  const [lockInput, setLockInput] = useState("");
  const [confirmLock, setConfirmLock] = useState<"lock" | "unlock" | null>(
    null,
  );

  // Prefill the date input with the current lock date once settings load.
  useEffect(() => {
    if (lockDate) setLockInput(lockDate);
  }, [lockDate]);

  const userName = useMemo(
    () => Object.fromEntries(directory.map((u) => [u.id, u.name])),
    [directory],
  );

  // Route guard already blocks other roles; this is belt-and-braces. The
  // attendance-manager reaches the page through lockAttendance alone: it gets
  // the freeze card, not the warning signs or the log (both need viewAudit,
  // and the server refuses them).
  if (!can.viewAudit && !can.lockAttendance) return null;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/attendance"
        className="inline-flex items-center gap-2 self-start rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <ArrowLeft size={16} />
        Back to attendance
      </Link>

      <PageHeader
        title="Attendance Oversight"
        description={
          can.viewAudit
            ? "Spot suspicious changes and freeze finalized records."
            : "Freeze finalized records."
        }
        action={
          can.viewAudit && (
          <Button
            variant="outline"
            render={<Link href="/attendance/audit/log" />}
            nativeButton={false}
          >
            <ScrollText size={16} />
            Audit log
            <ArrowRight size={14} />
          </Button>
          )
        }
      />

      {/* Warning signs */}
      {!can.viewAudit ? null : flagsLoading ? (
        <CardGridSkeleton cards={2} lines={2} className="md:grid-cols-2 xl:grid-cols-2" />
      ) : (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ShieldAlert size={16} className="text-red-600" />
            Passing only after changes
          </div>
          <p className="mt-1 text-2xl font-bold tabular-nums">
            {flipped.length}
          </p>
          {flipped.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {flipped.slice(0, 4).map((f) => (
                <li key={f.studentId} className="flex justify-between gap-2">
                  <span className="truncate">
                    {f.name} ({f.rollNumber})
                  </span>
                  <span className="whitespace-nowrap font-medium text-amber-700">
                    {f.origPct}% → {f.pct}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Pencil size={16} className="text-amber-600" />
            Corrections made
          </div>
          <p className="mt-1 text-2xl font-bold tabular-nums">
            {editsByUser.reduce((sum, [, n]) => sum + n, 0)}
          </p>
          {editsByUser.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {editsByUser.slice(0, 4).map(([uid, n]) => (
                <li key={uid} className="flex justify-between gap-2">
                  <span className="truncate">{userName[uid] ?? "Unknown"}</span>
                  <span className="font-medium tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      )}

      {/* Freeze records */}
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {lockDate ? (
            <Lock size={16} className="text-emerald-600" />
          ) : (
            <LockOpen size={16} className="text-muted-foreground" />
          )}
          Freeze records
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {lockDate
            ? `Attendance up to ${lockDate} is frozen for teachers and HODs`
            : "Lock a date to make attendance on or before it read-only for teachers and HODs."}
        </p>
        {can.lockAttendance && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={lockInput}
              onChange={(e) => setLockInput(e.target.value)}
              className="h-8 w-auto"
            />
            <Button
              size="sm"
              disabled={!lockInput}
              onClick={() => setConfirmLock("lock")}
            >
              Lock up to this date
            </Button>
            {lockDate && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmLock("unlock")}
              >
                Unlock
              </Button>
            )}
          </div>
        )}
        {lastLockEvent && (
          <p className="mt-3 text-xs text-muted-foreground">
            Last {lastLockEvent.action === "lock" ? "locked" : "unlocked"} by{" "}
            {userName[lastLockEvent.userId] ?? "Unknown"} on{" "}
            {fmtWhen(lastLockEvent.at)}.
          </p>
        )}
      </div>

      {/* Lock/unlock confirmation */}
      <AlertDialog
        open={Boolean(confirmLock)}
        onOpenChange={(o) => !o && setConfirmLock(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmLock === "lock"
                ? "Lock attendance?"
                : "Unlock attendance?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmLock === "lock"
                ? `Attendance on or before ${lockInput} becomes read-only for teachers and HODs. Admins, the principal and attendance managers keep audited correction rights`
                : `Records on or before ${lockDate} become editable again by roles with edit rights. The unlock is recorded in the change history.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              loading={setLockDate.isPending}
              onClick={async () => {
                try {
                  if (confirmLock === "lock") {
                    await setLockDate.mutateAsync(lockInput);
                    toast.success(`Attendance locked up to ${lockInput}.`);
                  } else {
                    await setLockDate.mutateAsync(null);
                    setLockInput("");
                    toast.success("Attendance unlocked.");
                  }
                } catch (err) {
                  toast.error(errMsg(err));
                }
                setConfirmLock(null);
              }}
            >
              {confirmLock === "lock" ? "Lock" : "Unlock"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
