import { cn } from "@/lib/utils";

/**
 * An inline error banner — the one place the alert alpha wash lives.
 * `bordered` draws the hairline page-level banners carry; quiet form-field
 * errors omit it.
 */
export function InlineAlert({
  bordered = false,
  className,
  children,
  ...props
}: {
  bordered?: boolean;
  className?: string;
  children: React.ReactNode;
} & React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn(
        "rounded-none bg-down/10 px-3 py-2 text-xs text-down",
        bordered && "border border-down/30",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
