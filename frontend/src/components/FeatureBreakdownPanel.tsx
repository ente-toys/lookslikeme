import type { FeatureBreakdown } from "../types";

interface Props {
  breakdown: FeatureBreakdown;
}

const REGION_LABELS: Record<string, string> = {
  eyes: "Eyes",
  nose: "Nose",
  mouth: "Mouth",
  jawline: "Jawline",
};

export function FeatureBreakdownPanel({ breakdown }: Props) {
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <span className="inline-flex items-center rounded-full bg-[var(--sage-light)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--success)]">
          Best: {REGION_LABELS[breakdown.best_matching_feature] || breakdown.best_matching_feature}
        </span>
        <span className="inline-flex items-center rounded-full bg-[rgba(212,96,58,0.1)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--terracotta)]">
          Weakest: {REGION_LABELS[breakdown.least_matching_feature] || breakdown.least_matching_feature}
        </span>
      </div>
    </div>
  );
}
