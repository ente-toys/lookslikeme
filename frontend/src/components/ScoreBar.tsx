interface Props {
  label: string;
  value: number | null;
  max?: number;
  color?: string;
  showLabel?: boolean;
  showValue?: boolean;
  showStrength?: boolean;
}

export function ScoreBar({
  label,
  value,
  max = 1,
  color = "bg-[var(--peach)]",
  showLabel = true,
  showValue = true,
  showStrength = true,
}: Props) {
  if (value === null) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-white/80 px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          {showLabel ? (
            <p className="text-[10px] font-semibold uppercase tracking-[1.8px] text-[var(--text-muted)]">
              {label}
            </p>
          ) : (
            <span />
          )}
          <span className="text-sm font-medium italic text-[var(--text-muted)]">N/A</span>
        </div>
      </div>
    );
  }

  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const activeSegments = pct === 0 ? 0 : Math.max(1, Math.round((pct / 100) * 8));
  const strengthLabel =
    pct >= 60 ? "Strong" : pct >= 40 ? "Clear" : pct >= 20 ? "Soft" : "Weak";

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-white/80 px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {showLabel && (
            <p className="text-[10px] font-semibold uppercase tracking-[1.8px] text-[var(--text-muted)]">
              {label}
            </p>
          )}
          <div className={`${showLabel ? "mt-2" : ""} grid grid-cols-8 gap-1`}>
            {Array.from({ length: 8 }).map((_, index) => (
              <span
                key={index}
                className={`h-2 rounded-full transition-colors duration-500 ${
                  index < activeSegments ? color : "bg-[var(--border)]"
                }`}
              />
            ))}
          </div>
        </div>
        {(showValue || showStrength) && (
          <div className="shrink-0 text-right">
            {showValue && (
              <div className="text-lg font-semibold leading-none text-[var(--text)]">
                {pct.toFixed(0)}%
              </div>
            )}
            {showStrength && (
              <div className="mt-1 text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                {strengthLabel}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
