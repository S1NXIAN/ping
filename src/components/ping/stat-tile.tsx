import { cn } from "@/lib/utils";

/**
 * The compact label/value tile used inside sheets and settings sections
 * (the smaller sibling of StatCard, which carries an icon and a caption).
 * One source for the tile chrome; `valueClassName` carries the tone and
 * the size step a denser row needs.
 */
export function StatTile({
  label,
  value,
  valueClassName,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  valueClassName?: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-none border bg-card/60 px-3 py-2.5", className)}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={cn("mt-1 text-base font-semibold tabular-nums leading-tight", valueClassName)}>
        {value}
      </div>
    </div>
  );
}
