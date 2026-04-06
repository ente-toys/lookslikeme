interface SamplePair {
  rank: number;
  nameA: string;
  avatarA: string;
  nameB: string;
  avatarB: string;
  score: number;
  bestFeature?: string;
  weakestFeature?: string;
}

const SAMPLE_PAIRS: SamplePair[] = [
  { rank: 1, nameA: "Daughter", avatarA: "/avatars/daughter.svg", nameB: "Mom", avatarB: "/avatars/mom.svg", score: 72, bestFeature: "Eyes", weakestFeature: "Jawline" },
  { rank: 2, nameA: "Son", avatarA: "/avatars/son.svg", nameB: "Dad", avatarB: "/avatars/dad.svg", score: 58, bestFeature: "Jawline", weakestFeature: "Nose" },
  { rank: 3, nameA: "Daughter", avatarA: "/avatars/daughter.svg", nameB: "Grandma", avatarB: "/avatars/grandma.svg", score: 41 },
];

function ScorePill({ score }: { score: number }) {
  const color =
    score >= 60
      ? "bg-[rgba(74,103,65,0.12)] text-[var(--success)]"
      : score >= 40
        ? "bg-[rgba(244,162,97,0.12)] text-[var(--terracotta)]"
        : "bg-[rgba(139,123,110,0.1)] text-[var(--text-muted)]";

  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${color}`}>
      {score}%
    </span>
  );
}

export function SampleResultPreview({ onTryIt }: { onTryIt: () => void }) {
  return (
    <div
      className="mt-6 overflow-hidden rounded-[var(--radius)] border border-dashed border-[var(--peach)] bg-gradient-to-br from-[var(--warm-white)] to-[#fff5eb]"
      style={{ animation: "cardIn 0.5s ease 1s backwards" }}
    >
      {/* Header */}
      <div className="px-5 pt-4 pb-1">
        <p className="mb-1 text-center text-[10px] font-semibold uppercase tracking-[2px] text-[var(--terracotta)]">
          Here's what you'll get
        </p>
        <p className="theme-editorial text-center text-lg font-bold text-[var(--text)]">
          Who looks like who
        </p>
      </div>

      {/* Pair rows */}
      <div className="space-y-2 px-5 py-3">
        {SAMPLE_PAIRS.map((pair) => (
          <div key={`${pair.nameA}-${pair.nameB}`}>
            <div className="flex items-center gap-2.5 rounded-2xl bg-[rgba(92,61,46,0.03)] px-3 py-2.5">
              <span className="theme-accent-pill flex h-6 min-w-6 items-center justify-center rounded-full text-[10px] font-bold">
                {pair.rank}
              </span>
              <img
                src={pair.avatarA}
                alt={pair.nameA}
                className="h-10 w-10 shrink-0 rounded-xl border border-white/80 object-cover"
              />
              <svg
                className="h-3.5 w-3.5 shrink-0 text-[var(--peach)]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
              <img
                src={pair.avatarB}
                alt={pair.nameB}
                className="h-10 w-10 shrink-0 rounded-xl border border-white/80 object-cover"
              />
              <div className="ml-auto flex items-center gap-2">
                <div className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-[var(--cream)] sm:block">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${pair.score}%`,
                      background: "linear-gradient(90deg, var(--peach) 0%, var(--terracotta) 100%)",
                    }}
                  />
                </div>
                <ScorePill score={pair.score} />
              </div>
            </div>
            {pair.bestFeature && (
              <div className="mt-1.5 flex flex-wrap gap-1.5 pl-12">
                <span className="inline-flex items-center rounded-full bg-[var(--sage-light)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--success)]">
                  Best: {pair.bestFeature}
                </span>
                <span className="inline-flex items-center rounded-full bg-[rgba(212,96,58,0.1)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--terracotta)]">
                  Weakest: {pair.weakestFeature}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* CTA */}
      <div className="px-5 pb-4">
        <button
          type="button"
          onClick={onTryIt}
          className="w-full rounded-[var(--radius-sm)] border-[1.5px] border-[var(--terracotta)] bg-[var(--terracotta)] px-3 py-3 text-sm font-semibold text-white transition-all hover:bg-[var(--terracotta-dark)] hover:border-[var(--terracotta-dark)] active:scale-[0.97]"
        >
          Try with your photos
        </button>
      </div>

      {/* Attribution */}
      <p className="border-t border-[var(--border)] bg-[var(--warm-white)] px-5 py-2.5 text-center text-[10px] text-[var(--text-muted)]">
        Avatars by{" "}
        <a
          href="https://www.figma.com/community/file/1184595184137881796"
          target="_blank"
          rel="noopener"
          className="underline decoration-dotted underline-offset-2"
        >
          Lisa Wischofsky
        </a>
        {" "}&middot; CC BY 4.0
      </p>
    </div>
  );
}
