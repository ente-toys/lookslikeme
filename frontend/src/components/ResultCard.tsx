import type { PairwiseComparison } from "../types";
import { PersonAvatar } from "./PersonAvatar";
import { ScoreBar } from "./ScoreBar";
import { FeatureBreakdownPanel } from "./FeatureBreakdownPanel";

interface Props {
  pair: PairwiseComparison;
  selectedThumbnail: string | null;
  matchThumbnail: string | null;
  displayScore: number; // 0-100
  rank: number;
  isBestMatch: boolean;
}

function scoreLabel(score: number): { text: string; color: string } {
  if (score >= 60) return { text: "Very similar", color: "text-[var(--success)]" };
  if (score >= 40) return { text: "Similar", color: "text-[var(--brown-light)]" };
  if (score >= 20) return { text: "Somewhat similar", color: "text-[var(--text-muted)]" };
  return { text: "Not very similar", color: "text-[var(--text-muted)]" };
}

function FacePreview({
  thumbnail,
  alt,
}: {
  thumbnail: string | null;
  alt: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--cream)] p-3">
      {thumbnail ? (
        <img
          src={thumbnail}
          alt={alt}
          className="aspect-[4/5] w-full rounded-2xl border border-white/80 object-cover"
        />
      ) : (
        <div className="flex aspect-[4/5] items-center justify-center rounded-2xl bg-white">
          <PersonAvatar name={alt} thumbnail={null} sizeClass="h-16 w-16" textClass="text-sm" />
        </div>
      )}
    </div>
  );
}

export function ResultCard({
  pair,
  selectedThumbnail,
  matchThumbnail,
  displayScore,
  rank,
  isBestMatch,
}: Props) {
  const label = scoreLabel(displayScore);

  return (
    <div
      className={`rounded-[var(--radius)] border p-4 sm:p-5 ${
        isBestMatch
          ? "border-[var(--peach)] bg-[var(--warm-white)] shadow-sm"
          : "border-[var(--border)] bg-[var(--warm-white)]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="theme-accent-pill inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-xs font-semibold">
              #{rank}
            </span>
            <PersonAvatar
              name={`match-${rank}`}
              thumbnail={matchThumbnail}
              sizeClass="h-10 w-10"
              textClass="text-[11px]"
            />
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-2xl font-bold leading-none text-[var(--text)]">
            {displayScore.toFixed(0)}%
          </div>
          <div className={`mt-1 text-[11px] font-semibold uppercase tracking-wide ${label.color}`}>
            {label.text}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <FacePreview thumbnail={selectedThumbnail} alt="Selected face preview" />
        <FacePreview thumbnail={matchThumbnail} alt="Matched face preview" />
      </div>

      <div className="mt-3">
        <ScoreBar
          label="Face match"
          value={displayScore / 100}
          color={isBestMatch ? "bg-[var(--peach)]" : "bg-[var(--brown-light)]"}
          showValue={false}
          showStrength={false}
        />
      </div>

      {pair.feature_breakdown && (
        <div className="mt-4 border-t border-[var(--border)] pt-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[1.8px] text-[var(--text-muted)]">
            Feature match
          </p>
          <FeatureBreakdownPanel breakdown={pair.feature_breakdown} />
        </div>
      )}
    </div>
  );
}
