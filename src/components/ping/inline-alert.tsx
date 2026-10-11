import { cn } from "@/lib/utils";

const TONE = {
  down: "bg-down/10 text-down",
  warn: "bg-warn/10 text-warn",
  up: "bg-up/10 text-up",
} as const;

const BORDER = {
  down: "border border-down/30",
  warn: "border border-warn/30",
  up: "border border-up/30",
} as const;

/**
 * An inline message tinted by state — the one place the alert alpha washes
 * live. `bordered` draws the hairline the page-level banners carry; the
 * quiet form-field error omits it. Size, spacing and margins come from
 * `className` (the callers' contexts differ).
 */
export function InlineAlert({
  tone = "down",
  bordered = false,
  className,
  children,
  ...props
}: {
  tone?: keyof typeof TONE;
  bordered?: boolean;
  className?: string;
  children: React.ReactNode;
} & React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn(
        "rounded-none px-3 py-2 text-xs",
        TONE[tone],
        bordered && BORDER[tone],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
