import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Indeterminate activity indicator for in-flight work.
 *
 * Use it for *mutations and refetches* — something is happening to content
 * that already exists. For a first load, where there is no content yet, use a
 * skeleton instead (`components/ui/skeleton.tsx` and friends): it reserves the
 * final layout, so the page doesn't jump when the data lands.
 *
 * `aria-hidden` because a spinner is decorative: the accessible signal is
 * `aria-busy` / the disabled state on the control that owns it.
 */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2
      role="status"
      aria-hidden
      data-slot="spinner"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
