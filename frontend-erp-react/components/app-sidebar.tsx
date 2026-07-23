"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CalendarCheck,
  ClipboardCheck,
  ClipboardList,
  FolderOpen,
  GraduationCap,
  Grid3x3,
  History,
  KeyRound,
  LayoutDashboard,
  LogOut,
  ScrollText,
  ShieldCheck,
  Users,
  UserCog,
} from "lucide-react";
import { useAuthSession } from "@/lib/auth-provider";
import { COLLEGE_LOGO, COLLEGE_SHORT_NAME } from "@/lib/branding";
import { isPathAllowed, useAuth } from "@/lib/permissions";
import { USER_ROLE_LABELS } from "@/lib/types";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ChangePasswordDialog } from "@/components/users/change-password-dialog";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

// Nav sections: a group is hidden when the role can visit none of its items.
// Labels aim to read as "what you do here", not just the route name, so the
// sidebar stays self-explanatory without visiting each page first.
// Promotions is deliberately nav-less (reached from Students + Semester close);
// Departments merged into the Programs page.
const navGroups = [
  {
    label: "Overview",
    items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard, exact: true }],
  },
  {
    label: "Academics",
    items: [
      { href: "/programs", label: "Programs & Curriculum", icon: GraduationCap },
      { href: "/students", label: "Students", icon: Users },
      { href: "/teachers", label: "Teachers", icon: UserCog },
    ],
  },
  {
    label: "Classes",
    items: [
      { href: "/assignments", label: "Teacher Assignments", icon: ClipboardList },
      { href: "/attendance", label: "Mark Attendance", icon: CalendarCheck, exact: true },
      { href: "/attendance/sessions", label: "Correct Attendance", icon: History },
      { href: "/attendance/register", label: "Attendance Register", icon: Grid3x3 },
      { href: "/attendance/summary", label: "Attendance Summary", icon: BarChart3 },
      { href: "/materials", label: "Study Materials", icon: FolderOpen },
    ],
  },
  {
    label: "Oversight",
    items: [
      { href: "/attendance/audit", label: "Attendance Oversight", icon: ShieldCheck, exact: true },
      { href: "/attendance/audit/log", label: "Audit Log", icon: ScrollText },
      { href: "/semester-close", label: "Semester Close-Out", icon: ClipboardCheck },
      { href: "/users", label: "User Accounts", icon: KeyRound },
    ],
  },
];

const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export function AppSidebar() {
  const pathname = usePathname();
  const { logout } = useAuthSession();
  const { user, role } = useAuth();
  const [passwordOpen, setPasswordOpen] = useState(false);
  // Class-rep logins are shared by a whole class — one student rotating the
  // password would lock out the rest, so the backend refuses it (403) and the
  // menu entry stays hidden. Admins reset those via the Users page instead.
  const canChangePassword = role !== null && role !== "student-rep";

  // Only show routes the signed-in role may visit; drop empty groups.
  const groups = role
    ? navGroups
        .map((g) => ({
          ...g,
          items: g.items.filter((item) => isPathAllowed(role, item.href)),
        }))
        .filter((g) => g.items.length > 0)
    : [];

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-3 px-1 py-1.5">
          <div className="relative size-8 shrink-0">
            <Image
              src={COLLEGE_LOGO}
              alt=""
              fill
              sizes="32px"
              className="object-contain"
              priority
            />
          </div>
          <div className="leading-tight group-data-[collapsible=icon]:hidden">
            <p className="text-sm font-bold">{COLLEGE_SHORT_NAME} ERP</p>
            <p className="truncate text-xs text-muted-foreground">
              Arts &amp; Science
            </p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = item.exact
                    ? pathname === item.href
                    : pathname === item.href ||
                      pathname.startsWith(item.href + "/");
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={active}
                        tooltip={item.label}
                        render={<Link href={item.href} />}
                      >
                        <Icon />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        {user && (
          <div className="flex items-center gap-2 rounded-md border p-2 group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:p-0">
            <Avatar size="sm">
              <AvatarFallback>{initials(user.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
              <p className="truncate text-xs font-medium">{user.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {USER_ROLE_LABELS[user.role]}
              </p>
            </div>
            {canChangePassword ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Account menu"
                      className="group-data-[collapsible=icon]:hidden"
                    >
                      <UserCog />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setPasswordOpen(true)}>
                    <KeyRound size={16} />
                    Change password
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void logout()}>
                    <LogOut size={16} />
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void logout()}
                title="Log out"
                className="group-data-[collapsible=icon]:hidden"
              >
                <LogOut />
              </Button>
            )}
          </div>
        )}
        <ChangePasswordDialog
          open={passwordOpen}
          onOpenChange={setPasswordOpen}
        />
        <p className="px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          {COLLEGE_SHORT_NAME} ERP
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
