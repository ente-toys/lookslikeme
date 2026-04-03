import { useEffect, useState } from "react";

export interface ProcessingPerson {
  name: string;
  imageUrls: string[];
}

export type ProcessingOverlayVariant =
  | "family-analysis"
  | "family-compare";

interface Props {
  persons: ProcessingPerson[];
  variant?: ProcessingOverlayVariant;
}

const STAGES_BY_VARIANT: Record<
  ProcessingOverlayVariant,
  Array<{ message: string; duration: number }>
> = {
  "family-analysis": [
    { message: "Loading photos", duration: 1000 },
    { message: "Detecting faces", duration: 1600 },
    { message: "Grouping similar faces", duration: 1600 },
    { message: "Preparing family matches", duration: 1500 },
    { message: "Almost there\u2026", duration: 7000 },
  ],
  "family-compare": [
    { message: "Loading selected faces", duration: 700 },
    { message: "Comparing facial structure", duration: 1600 },
    { message: "Ranking resemblances", duration: 1400 },
    { message: "Almost there\u2026", duration: 7000 },
  ],
};

function PersonCard({
  person,
  isActive,
  scanY,
}: {
  person: ProcessingPerson;
  isActive: boolean;
  scanY: number;
}) {
  const [photoIdx, setPhotoIdx] = useState(0);
  const hasImages = person.imageUrls.length > 0;

  useEffect(() => {
    if (person.imageUrls.length <= 1) return;
    const interval = setInterval(() => {
      setPhotoIdx((p) => (p + 1) % person.imageUrls.length);
    }, 1200);
    return () => clearInterval(interval);
  }, [person.imageUrls.length]);

  return (
    <div
      className={`transition-all duration-300 ease-in-out ${
        isActive ? "z-10 scale-105 opacity-100" : "scale-90 opacity-30"
      }`}
    >
      <div
        className={`relative h-24 w-24 overflow-hidden rounded-[var(--radius)] border-2 transition-all duration-300 sm:h-32 sm:w-32 ${
          isActive
            ? "border-[var(--terracotta)] shadow-lg shadow-[rgba(212,96,58,0.14)]"
            : "border-[var(--border)]"
        }`}
      >
        {hasImages ? (
          <>
            {person.imageUrls.map((url, i) => (
              <img
                key={i}
                src={url}
                alt={`${person.name} ${i + 1}`}
                className="absolute inset-0 h-full w-full object-cover"
                style={{
                  opacity: i === photoIdx ? 1 : 0,
                  transition: "opacity 0.5s ease-in-out",
                }}
              />
            ))}
          </>
        ) : (
          <div
            className={`flex h-full w-full items-center justify-center transition-colors duration-300 ${
              isActive
                ? "bg-[rgba(244,162,97,0.15)]"
                : "bg-[var(--cream)]"
            }`}
          >
            <span
              className={`text-2xl font-bold transition-colors duration-300 ${
                isActive ? "text-[var(--terracotta)]" : "text-[var(--text-muted)]"
              }`}
            >
              {person.name
                .split(" ")
                .map((w) => w[0])
                .join("")}
            </span>
          </div>
        )}

        {/* Scan effect on active card */}
        {isActive && (
          <>
            <div
              className="absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[var(--terracotta)] to-transparent"
              style={{ top: `${scanY}%`, filter: "blur(0.5px)" }}
            />
            <div
              className="pointer-events-none absolute left-0 right-0 h-12"
              style={{
                top: `${Math.max(0, scanY - 8)}%`,
                background:
                  "linear-gradient(180deg, transparent 0%, rgba(212,96,58,0.06) 40%, rgba(212,96,58,0.06) 60%, transparent 100%)",
              }}
            />
            <div className="pointer-events-none absolute inset-2">
              <div className="absolute left-0 top-0 h-3 w-3 rounded-tl border-l-2 border-t-2 border-[var(--terracotta)]" />
              <div className="absolute right-0 top-0 h-3 w-3 rounded-tr border-r-2 border-t-2 border-[var(--terracotta)]" />
              <div className="absolute bottom-0 left-0 h-3 w-3 rounded-bl border-b-2 border-l-2 border-[var(--terracotta)]" />
              <div className="absolute bottom-0 right-0 h-3 w-3 rounded-br border-b-2 border-r-2 border-[var(--terracotta)]" />
            </div>
          </>
        )}
      </div>
      <p
        className={`mt-2 text-center text-xs font-medium transition-colors duration-300 ${
          isActive ? "text-[var(--terracotta)]" : "text-[var(--text-muted)]"
        }`}
      >
        {person.name}
      </p>
    </div>
  );
}

export function ProcessingOverlay({ persons, variant = "family-analysis" }: Props) {
  const [stageIdx, setStageIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const [activePerson, setActivePerson] = useState(0);
  const [scanY, setScanY] = useState(0);
  const stages = STAGES_BY_VARIANT[variant];
  const totalDuration = stages.reduce((sum, stage) => sum + stage.duration, 0);

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;

      const linear = Math.min(elapsed / totalDuration, 1);
      const dp =
        linear < 0.85
          ? linear * 100
          : 85 + 10 * (1 - Math.exp(-3 * ((linear - 0.85) / 0.15)));
      setProgress(Math.min(dp, 95));

      let acc = 0;
      for (let i = 0; i < stages.length; i++) {
        acc += stages[i].duration;
        if (elapsed < acc) {
          setStageIdx(i);
          break;
        }
        if (i === stages.length - 1) setStageIdx(i);
      }

      const t = (elapsed % 1800) / 1800;
      setScanY(50 + 45 * Math.sin(t * Math.PI * 2 - Math.PI / 2));
    }, 30);
    return () => clearInterval(interval);
  }, [stages, totalDuration]);

  useEffect(() => {
    if (persons.length <= 1) return;
    const interval = setInterval(() => {
      setActivePerson((p) => (p + 1) % persons.length);
    }, 1800);
    return () => clearInterval(interval);
  }, [persons.length]);

  const safeStageIdx = Math.min(stageIdx, Math.max(stages.length - 1, 0));
  const stage = stages[safeStageIdx] ?? { message: "Preparing results", duration: 1000 };

  return (
    <div className="theme-card space-y-8 rounded-[var(--radius)] p-8">
      {/* Person cards */}
      <div className="flex flex-wrap items-end justify-center gap-4 sm:gap-5">
        {persons.map((person, i) => (
          <PersonCard
            key={person.name}
            person={person}
            isActive={i === activePerson}
            scanY={scanY}
          />
        ))}
      </div>

      {/* Stage message */}
      <div className="text-center">
        <p className="theme-editorial text-[2rem] font-semibold tracking-tight text-[var(--text)]">
          {stage.message}
        </p>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          This usually takes a few seconds
        </p>
      </div>

      {/* Progress bar */}
      <div className="mx-auto max-w-sm">
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--cream)]">
          <div
            className="h-full rounded-full transition-all duration-300 ease-out"
            style={{
              width: `${progress}%`,
              background: "linear-gradient(90deg, var(--peach) 0%, var(--terracotta) 100%)",
            }}
          />
        </div>
      </div>
    </div>
  );
}
