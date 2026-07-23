"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportError } from "@/lib/error-reporting";

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    reportError(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <AlertTriangle className="text-destructive" size={40} />
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Something went wrong</h2>
        <p className="text-sm text-muted-foreground">
          The page hit an unexpected error. You can try again, or head back to
          the dashboard.
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => unstable_retry()}>
          Try again
        </Button>
        <Button render={<Link href="/" />} nativeButton={false}>
          Go to dashboard
        </Button>
      </div>
    </div>
  );
}
