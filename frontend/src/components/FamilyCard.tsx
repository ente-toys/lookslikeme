import type { ComparisonResult, PairwiseComparison, PersonInfo } from "../types";
import { PersonAvatar } from "./PersonAvatar";

interface Props {
  result: ComparisonResult;
}

interface GlobalRankedPair {
  pair: PairwiseComparison;
  displayScore: number;
  personA: PersonInfo;
  personB: PersonInfo;
}

function mapFaceScore(raw: number | null): number {
  if (raw === null) return 0;
  const minRaw = -0.1;
  const maxRaw = 0.6;
  const clamped = Math.max(minRaw, Math.min(maxRaw, raw));
  return ((clamped - minRaw) / (maxRaw - minRaw)) * 100;
}

function getTopPairs(result: ComparisonResult, count: number): GlobalRankedPair[] {
  const personMap = new Map(result.persons.map((p) => [p.name, p]));

  return result.pairwise
    .map((pair) => ({
      pair,
      displayScore: mapFaceScore(pair.face_similarity),
      personA: personMap.get(pair.person_a)!,
      personB: personMap.get(pair.person_b)!,
    }))
    .filter((entry) => entry.personA && entry.personB)
    .sort((a, b) => b.displayScore - a.displayScore)
    .slice(0, count);
}

function getBestMatch(
  person: PersonInfo,
  pairwise: PairwiseComparison[],
  persons: PersonInfo[],
): { match: PersonInfo; score: number } | null {
  const personMap = new Map(persons.map((p) => [p.name, p]));
  let best: { match: PersonInfo; score: number } | null = null;

  for (const pair of pairwise) {
    let otherName = "";
    if (pair.person_a === person.name) otherName = pair.person_b;
    else if (pair.person_b === person.name) otherName = pair.person_a;
    else continue;

    const score = mapFaceScore(pair.face_similarity);
    const other = personMap.get(otherName);
    if (other && (!best || score > best.score)) {
      best = { match: other, score };
    }
  }

  return best;
}

function ScorePill({ score }: { score: number }) {
  const color =
    score >= 60
      ? "bg-[rgba(74,103,65,0.12)] text-[var(--success)]"
      : score >= 40
        ? "bg-[rgba(244,162,97,0.12)] text-[var(--terracotta)]"
        : "bg-[rgba(139,123,110,0.1)] text-[var(--text-muted)]";

  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${color}`}>
      {score.toFixed(0)}%
    </span>
  );
}

export function FamilyCard({ result }: Props) {
  const topPairs = getTopPairs(result, 4);
  const { persons, pairwise } = result;

  if (persons.length < 2) return null;

  return (
    <div
      className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--warm-white)]"
      style={{ animation: "cardIn 0.5s ease 0.4s backwards" }}
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-3">
        <p className="text-[10px] font-semibold uppercase tracking-[1.8px] text-[var(--text-muted)]">
          Family Overview
        </p>
        <p className="mt-1 theme-editorial text-lg font-bold text-[var(--text)]">
          Who looks like who
        </p>
      </div>

      {/* Person rows — each person + their best match */}
      <div className="px-5 pb-2">
        <div className="space-y-2">
          {persons.map((person) => {
            const best = getBestMatch(person, pairwise, persons);
            if (!best) return null;

            return (
              <div
                key={person.name}
                className="flex items-center gap-3 rounded-2xl bg-[rgba(92,61,46,0.03)] px-3 py-2.5"
              >
                <PersonAvatar
                  name={person.name}
                  thumbnail={person.thumbnail_b64}
                  sizeClass="h-10 w-10"
                  textClass="text-[10px]"
                  roundedClass="rounded-xl"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-[var(--text-muted)]">
                    Best match
                  </p>
                </div>
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
                <PersonAvatar
                  name={best.match.name}
                  thumbnail={best.match.thumbnail_b64}
                  sizeClass="h-10 w-10"
                  textClass="text-[10px]"
                  roundedClass="rounded-xl"
                />
                <ScorePill score={best.score} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Top matching pairs */}
      {topPairs.length > 0 && (
        <div className="border-t border-[var(--border)] px-5 py-4">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[1.8px] text-[var(--text-muted)]">
            Top matching pairs
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {topPairs.map((entry, index) => (
              <div
                key={`${entry.pair.person_a}-${entry.pair.person_b}`}
                className="flex items-center gap-2.5 rounded-2xl border border-[var(--border)] bg-white/70 px-3 py-2.5"
              >
                <span className="theme-accent-pill flex h-5 min-w-5 items-center justify-center rounded-full text-[10px] font-bold">
                  {index + 1}
                </span>
                <div className="flex items-center gap-1.5">
                  <PersonAvatar
                    name={entry.personA.name}
                    thumbnail={entry.pair.person_a_face_thumbnail_b64}
                    sizeClass="h-9 w-9"
                    textClass="text-[9px]"
                    roundedClass="rounded-xl"
                  />
                  <svg
                    className="h-3 w-3 shrink-0 text-[var(--peach)]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                  <PersonAvatar
                    name={entry.personB.name}
                    thumbnail={entry.pair.person_b_face_thumbnail_b64}
                    sizeClass="h-9 w-9"
                    textClass="text-[9px]"
                    roundedClass="rounded-xl"
                  />
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-[var(--cream)] sm:block">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${entry.displayScore}%`,
                        background: "linear-gradient(90deg, var(--peach) 0%, var(--terracotta) 100%)",
                      }}
                    />
                  </div>
                  <span className="text-xs font-bold text-[var(--text)]">
                    {entry.displayScore.toFixed(0)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
