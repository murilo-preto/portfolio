import type { ReactNode } from "react";

/**
 * Emphasis sets a panel's place in the visual hierarchy:
 *   primary — the focus of the page (raised, stronger border)
 *   default — supporting analysis
 *   flush   — detail/reference; no chrome, just a titled band
 */
type PanelEmphasis = "primary" | "default" | "flush";

type PanelProps = {
  title?: string;
  action?: ReactNode;
  emphasis?: PanelEmphasis;
  className?: string;
  children: ReactNode;
};

const emphasisStyles: Record<PanelEmphasis, string> = {
  primary:
    "bg-surface rounded-xl shadow-md border border-default p-3 md:p-4 flex flex-col",
  default:
    "bg-surface rounded-xl shadow-sm border border-subtle p-4 md:p-5 flex flex-col",
  flush: "flex flex-col",
};

export function Panel({
  title,
  action,
  emphasis = "default",
  className = "",
  children,
}: PanelProps) {
  const headerSpacing =
    emphasis === "flush" ? "pb-3 mb-4 border-b border-subtle" : "mb-4";

  return (
    <section className={`${emphasisStyles[emphasis]} ${className}`.trim()}>
      {title && (
        <div
          className={`flex shrink-0 items-center justify-between gap-3 ${headerSpacing}`}
        >
          <h2 className="text-base font-semibold text-primary">{title}</h2>
          {action}
        </div>
      )}
      {/* Centres the body when the panel is stretched to match a taller
          neighbour; a no-op when the panel sizes to its content. */}
      <div className="flex flex-1 min-h-0 flex-col justify-center">{children}</div>
    </section>
  );
}
