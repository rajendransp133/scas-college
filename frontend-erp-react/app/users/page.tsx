"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Ban,
  CheckCircle2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectField } from "@/components/select-field";
import { USER_ROLES, USER_ROLE_LABELS, type UserRole } from "@/lib/types";
import { EMPTY_ARRAY, errMsg } from "@/lib/api";
import {
  useDeleteUser,
  usePrograms,
  useTeacherOptions,
  useToggleUserActive,
  useUsers,
  type UserResponse,
} from "@/lib/queries";
import { canManageRole, useAuth } from "@/lib/permissions";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { usePagination } from "@/hooks/use-pagination";
import { PageHeader } from "@/components/page-header";
import { TableRowsSkeleton } from "@/components/ui/table-skeleton";
import { UserFormDialog } from "@/components/users/user-form-dialog";
import { QueryError } from "@/components/query-error";

const PAGE_SIZE = 25;

export default function UsersPage() {
  const { data: teachers = EMPTY_ARRAY } = useTeacherOptions();
  const { data: programs = EMPTY_ARRAY } = usePrograms();
  const deleteUser = useDeleteUser();
  const toggleActive = useToggleUserActive();
  const { can, role, user: currentUser } = useAuth();
  const currentUserId = currentUser?.id ?? null;

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<UserResponse | null>(null);
  const [deleting, setDeleting] = useState<UserResponse | null>(null);
  // Disabling signs the account out everywhere (the server revokes its tokens),
  // so it is confirmed like a delete; re-enabling is harmless and immediate.
  const [disabling, setDisabling] = useState<UserResponse | null>(null);

  async function setActive(u: UserResponse, isActive: boolean) {
    try {
      await toggleActive.mutateAsync({ id: u.id, isActive });
      toast.success(isActive ? `Enabled "${u.name}".` : `Disabled "${u.name}".`);
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  // The input stays instant; only the request waits.
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const [page, setPage] = usePagination(
    JSON.stringify([debouncedSearch, roleFilter]),
  );

  const { data, isLoading, isFetching, isPlaceholderData, error, refetch } = useUsers({
    search: debouncedSearch || undefined,
    role: (roleFilter || undefined) as UserRole | undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  const users = data?.items ?? EMPTY_ARRAY;
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  // Admin accounts are invisible below admin (the backend leaves them out of
  // the list), so a principal isn't offered an "Admin" filter either.
  const roleOptions = useMemo(
    () =>
      USER_ROLES.filter((r) => r !== "admin" || role === "admin").map((r) => ({
        value: r,
        label: USER_ROLE_LABELS[r],
      })),
    [role],
  );

  const teacherName = useMemo(
    () => Object.fromEntries(teachers.map((t) => [t.id, t.name])),
    [teachers],
  );
  const programCode = useMemo(
    () => Object.fromEntries(programs.map((p) => [p.id, p.code])),
    [programs],
  );

  // Route guard already blocks roles without the capability; belt-and-braces.
  if (!can.manageUsers) return null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="User Accounts"
        description="Login accounts and their roles. Teacher and HOD accounts are linked to a teacher record."
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={16} />
            New user
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-2 lg:col-span-2">
          <Label htmlFor="usr-search">Search</Label>
          <div className="relative">
            <Search
              size={16}
              className="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="usr-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or email…"
              className="pl-8"
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="usr-role">Role</Label>
          <SelectField
            id="usr-role"
            options={roleOptions}
            value={roleFilter}
            onValueChange={setRoleFilter}
            placeholder="All roles"
            searchPlaceholder="Search roles…"
          />
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {total.toLocaleString()} account(s)
        {isFetching && isPlaceholderData ? " · updating…" : ""}
      </p>

      <div className="rounded-xl border bg-card shadow-sm max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        <Table variant="stacked">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Linked to</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRowsSkeleton rows={6} cols={5} />}
            {!isLoading && error && (
              <TableRow>
                <TableCell colSpan={5}>
                  <QueryError
                    error={error}
                    onRetry={() => void refetch()}
                    className="flex flex-col items-center gap-2 py-8 text-center"
                  />
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !error && users.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="h-32 text-center text-muted-foreground"
                >
                  <Users size={24} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No accounts match your filters.</p>
                </TableCell>
              </TableRow>
            )}
            {users.map((u) => {
              // Principals see admin accounts but can't act on them — the API
              // refuses either way, so don't offer the buttons.
              const editable = canManageRole(role, u.role);
              return (
              <TableRow key={u.id} className={u.isActive === false ? "opacity-60" : undefined}>
                <TableCell data-label="Name" className="font-medium">
                  {u.name}
                  {u.id === currentUserId ? (
                    <Badge variant="outline" className="ml-2">
                      You
                    </Badge>
                  ) : null}
                  {u.isActive === false ? (
                    <Badge variant="secondary" className="ml-2">
                      Disabled
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell data-label="Email" className="text-muted-foreground">
                  {u.email}
                </TableCell>
                <TableCell data-label="Role">
                  <Badge variant="secondary">{USER_ROLE_LABELS[u.role]}</Badge>
                </TableCell>
                <TableCell
                  data-label="Linked to"
                  className="text-muted-foreground"
                >
                  {u.teacherId
                    ? teacherName[u.teacherId] ?? "—"
                    : u.role === "student-rep" && u.programId
                      ? `${programCode[u.programId] ?? "—"} · Sem ${u.classSemester ?? "—"}`
                      : "—"}
                </TableCell>
                <TableCell data-label="">
                  {editable ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button variant="ghost" size="icon-sm" aria-label="Actions">
                            <MoreHorizontal size={16} />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditing(u)}>
                          <Pencil size={16} />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          // Only this row waits on its own toggle.
                          disabled={
                            u.id === currentUserId ||
                            (toggleActive.isPending &&
                              toggleActive.variables?.id === u.id)
                          }
                          onClick={() =>
                            u.isActive === false
                              ? void setActive(u, true)
                              : setDisabling(u)
                          }
                        >
                          {u.isActive === false ? (
                            <>
                              <CheckCircle2 size={16} />
                              Enable
                            </>
                          ) : (
                            <>
                              <Ban size={16} />
                              Disable
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={u.id === currentUserId}
                          onClick={() => setDeleting(u)}
                        >
                          <Trash2 size={16} />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </TableCell>
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {total > 0
            ? `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total.toLocaleString()}`
            : ""}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <span className="tabular-nums">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </Button>
        </div>
      </div>

      <UserFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      <UserFormDialog
        open={Boolean(editing)}
        onOpenChange={(o) => !o && setEditing(null)}
        user={editing ?? undefined}
      />

      <AlertDialog
        open={Boolean(disabling)}
        onOpenChange={(o) => !o && setDisabling(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable account?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{disabling?.name}</strong> ({disabling?.email}) will be
              signed out on every device and can&apos;t log in until the account
              is enabled again. Their records are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              loading={toggleActive.isPending}
              onClick={async () => {
                if (!disabling) return;
                await setActive(disabling, false);
                setDisabling(null);
              }}
            >
              Disable
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the login for{" "}
              <strong>{deleting?.name}</strong> ({deleting?.email}). This cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              loading={deleteUser.isPending}
              onClick={async () => {
                if (!deleting) return;
                try {
                  await deleteUser.mutateAsync(deleting.id);
                  toast.success(`Deleted "${deleting.name}".`);
                } catch (err) {
                  toast.error(errMsg(err));
                }
                setDeleting(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
