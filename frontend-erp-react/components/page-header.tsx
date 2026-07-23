import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      {/* min-w-0 lets the text block shrink instead of forcing the row wider
          than the viewport when a description has no break opportunities. */}
      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          {title}
        </h1>
        {/* Hidden on phones: the title already says where you are, and on a
            narrow screen the description just pushes the content down. */}
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground max-md:hidden">
            {description}
          </p>
        ) : null}
      </div>

      {action ? (
        <div className="flex flex-wrap items-center gap-2">{action}</div>
      ) : null}
    </div>
  );
}
