"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ApiError } from "@/lib/api";
import { COLLEGE_SHORT_NAME } from "@/lib/branding";
import { QueryProvider } from "@/lib/query-provider";
import { AuthProvider, useAuthSession } from "@/lib/auth-provider";
import { useMe } from "@/lib/queries";
import { homePath, isPathAllowed, useAuth } from "@/lib/permissions";
import { AppSidebar } from "@/components/app-sidebar";
import { LoginPage } from "@/components/login-page";
import { TermSwitcher } from "@/components/term-switcher";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";

/**
 * Client-side providers + app shell.
 *
 * React Query + the JWT `AuthProvider` sit at the top; `AuthGate` shows the
 * login screen when signed out, waits on `/auth/me` while a token resolves, and
 * redirects users who navigate to a route their role can't access. The
 * collapsible sidebar plus main content area live here.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <AuthProvider>
        <TooltipProvider>
          <AuthGate>{children}</AuthGate>
        </TooltipProvider>
        <Toaster richColors position="top-right" />
      </AuthProvider>
    </QueryProvider>
  );
}

function FullScreen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center p-6 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/** Whole-app boot state: no shell exists yet, so there's no layout to skeleton. */
function FullScreenLoading({ label }: { label: string }) {
  return (
    <FullScreen>
      <span className="flex items-center gap-2">
        <Spinner />
        {label}
      </span>
    </FullScreen>
  );
}

function AuthGate({ children }: { children: ReactNode }) {
  const { token, initialized } = useAuthSession();
  const me = useMe();
  const { user, role } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const allowed = role !== null && isPathAllowed(role, pathname);

  // Redirect away from routes this role can't access.
  useEffect(() => {
    if (user && role && !allowed) router.replace(homePath(role));
  }, [user, role, allowed, router]);

  // Waiting to read the persisted token (avoids a login flash on refresh).
  if (!initialized) return <FullScreenLoading label="Starting…" />;

  // No session → login screen.
  if (!token) return <LoginPage />;

  // Token present but rejected: a 401 already cleared it; other errors (server
  // unreachable) surface a message instead of a blank screen.
  if (me.isError) {
    const status = me.error instanceof ApiError ? me.error.status : 0;
    if (status === 401) return <LoginPage />;
    return (
      <FullScreen>
        <div className="flex flex-col items-center gap-3 text-center">
          <p>Couldn&apos;t reach the server. Please try again shortly.</p>
          <Button
            variant="outline"
            loading={me.isFetching}
            onClick={() => void me.refetch()}
          >
            Retry
          </Button>
        </div>
      </FullScreen>
    );
  }

  // Token present, /me still resolving.
  if (!user) return <FullScreenLoading label="Signing you in…" />;

  if (!allowed) return null;

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header
          className="flex h-14 shrink-0 items-center gap-2 border-b px-4"
          data-print-hide
        >
          <SidebarTrigger />
          <span className="hidden truncate text-sm font-medium text-muted-foreground sm:inline">
            {COLLEGE_SHORT_NAME} ERP
          </span>
          <div className="ml-auto min-w-0">
            <TermSwitcher />
          </div>
        </header>
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 md:px-10 md:py-10">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
