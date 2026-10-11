import { cn } from "@/lib/utils"

/**
 * Loading placeholder. Every surface that waits draws the same instrument:
 * a pulsing hairline-bordered block. `className` carries the size and, when
 * the skeleton stands in for a card, the matching surface (`bg-card`).
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-none border bg-muted/30", className)}
      {...props}
    />
  )
}

export { Skeleton }
