import { useCallback, useRef, useState } from "react";
import type { ComparisonResult, PairwiseComparison, PersonInfo } from "../types";
import { FamilyCard } from "./FamilyCard";
import { FeatureBreakdownPanel } from "./FeatureBreakdownPanel";
import { PersonAvatar } from "./PersonAvatar";
import { ScoreBar } from "./ScoreBar";

interface Props {
  result: ComparisonResult;
  onReset: () => void;
}

interface RankedPair {
  pair: PairwiseComparison;
  otherName: string;
  displayScore: number;
}

interface FeatureHighlight {
  person: string;
  regions: string[];
}

interface ExpandedPairPreview {
  rank: number;
  score: number;
  selectedThumbnail: string | null;
  matchThumbnail: string | null;
}

function scoreLabel(score: number): { text: string; color: string } {
  if (score >= 60) return { text: "Very similar", color: "text-[var(--success)]" };
  if (score >= 40) return { text: "Similar", color: "text-[var(--brown-light)]" };
  if (score >= 20) return { text: "Somewhat similar", color: "text-[var(--text-muted)]" };
  return { text: "Not very similar", color: "text-[var(--text-muted)]" };
}

function mapFaceScore(raw: number | null): number {
  if (raw === null) return 0;
  const minRaw = -0.1;
  const maxRaw = 0.6;
  const clamped = Math.max(minRaw, Math.min(maxRaw, raw));
  return ((clamped - minRaw) / (maxRaw - minRaw)) * 100;
}

function getPairsForFocal(focalName: string, pairwise: PairwiseComparison[]): RankedPair[] {
  const pairs: RankedPair[] = [];
  for (const pair of pairwise) {
    let otherName = "";
    if (pair.person_a === focalName) {
      otherName = pair.person_b;
    } else if (pair.person_b === focalName) {
      otherName = pair.person_a;
    } else {
      continue;
    }

    pairs.push({
      pair,
      otherName,
      displayScore: mapFaceScore(pair.face_similarity),
    });
  }

  pairs.sort((left, right) => right.displayScore - left.displayScore);
  return pairs;
}

function buildFeatureHighlights(pairs: RankedPair[]): FeatureHighlight[] {
  if (pairs.length < 2) {
    return [];
  }

  const regions = ["eyes", "nose", "mouth", "jawline"];
  const regionWinners: Record<string, string[]> = {};

  for (const region of regions) {
    let bestPerson = "";
    let bestScore = -1;
    for (const { pair, otherName } of pairs) {
      const breakdown = pair.feature_breakdown;
      if (!breakdown) {
        continue;
      }
      const featureScore = breakdown.features.find((feature) => feature.region === region);
      if (featureScore && featureScore.similarity > bestScore) {
        bestScore = featureScore.similarity;
        bestPerson = otherName;
      }
    }

    if (!bestPerson) {
      continue;
    }

    if (!regionWinners[bestPerson]) {
      regionWinners[bestPerson] = [];
    }
    regionWinners[bestPerson].push(region);
  }

  return Object.entries(regionWinners)
    .map(([person, winnerRegions]) => ({
      person,
      regions: winnerRegions,
    }))
    .sort((left, right) => right.regions.length - left.regions.length);
}

function getOtherPersonThumbnail(pair: PairwiseComparison, focalName: string): string | null {
  if (pair.person_a === focalName) {
    return pair.person_b_face_thumbnail_b64;
  }
  return pair.person_a_face_thumbnail_b64;
}

function getFocalThumbnail(pair: PairwiseComparison, focalName: string): string | null {
  if (pair.person_a === focalName) {
    return pair.person_a_face_thumbnail_b64;
  }
  return pair.person_b_face_thumbnail_b64;
}

function bestFeatureString(pair: PairwiseComparison): string {
  const breakdown = pair.feature_breakdown;
  if (!breakdown) return "";
  const sorted = [...breakdown.features].sort((a, b) => b.similarity - a.similarity);
  const top = sorted.slice(0, 3).map((f) => f.region);
  return `Strongest match across ${top.join(", ")}.`;
}

function SelectorChip({
  person,
  active,
}: {
  person: PersonInfo;
  active: boolean;
}) {
  return (
    <span className="flex items-center justify-center">
      <PersonAvatar
        name={person.name}
        thumbnail={person.thumbnail_b64}
        sizeClass="h-12 w-12 sm:h-14 sm:w-14"
        textClass="text-sm"
        roundedClass="rounded-2xl"
      />
      {active && <span className="sr-only">Selected</span>}
    </span>
  );
}

function FacePreview({
  thumbnail,
  alt,
}: {
  thumbnail: string | null;
  alt: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border)] bg-white/85">
      {thumbnail ? (
        <img
          src={thumbnail}
          alt={alt}
          className="aspect-[4/5] w-full object-cover"
        />
      ) : (
        <div className="flex aspect-[4/5] items-center justify-center bg-[var(--cream)]">
          <PersonAvatar
            name={alt}
            thumbnail={null}
            sizeClass="h-20 w-20"
            textClass="text-base"
            roundedClass="rounded-2xl"
          />
        </div>
      )}
    </div>
  );
}

function RunnerUpPairButton({
  rank,
  score,
  selectedThumbnail,
  matchThumbnail,
  onClick,
}: {
  rank: number;
  score: number;
  selectedThumbnail: string | null;
  matchThumbnail: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl border border-[var(--border)] bg-white/85 px-3 py-2.5 text-left transition-colors hover:bg-white"
    >
      <span className="theme-accent-pill inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-[11px] font-semibold">
        #{rank}
      </span>
      <div className="flex items-center gap-2">
        <PersonAvatar
          name={`runner-up-selected-${rank}`}
          thumbnail={selectedThumbnail}
          sizeClass="h-14 w-14"
          textClass="text-xs"
          roundedClass="rounded-2xl"
        />
        <span className="text-base font-semibold text-[var(--peach)]">{"\u2192"}</span>
        <PersonAvatar
          name={`runner-up-match-${rank}`}
          thumbnail={matchThumbnail}
          sizeClass="h-14 w-14"
          textClass="text-xs"
          roundedClass="rounded-2xl"
        />
      </div>
      <span className="ml-auto text-sm font-semibold text-[var(--text)]">
        {score.toFixed(0)}%
      </span>
    </button>
  );
}

function FeatureHighlightChip({
  regions,
  thumbnail,
}: {
  regions: string[];
  thumbnail: string | null;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-white/85 px-3 py-1.5 text-xs font-medium text-[var(--text)] ring-1 ring-[var(--border)]">
      <PersonAvatar
        name="feature"
        thumbnail={thumbnail}
        sizeClass="h-8 w-8"
        textClass="text-[10px]"
        roundedClass="rounded-full"
      />
      <span>
        {regions.map((region) => region.charAt(0).toUpperCase() + region.slice(1)).join(" + ")}
      </span>
    </span>
  );
}

function PairPreviewDialog({
  preview,
  onClose,
}: {
  preview: ExpandedPairPreview;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--text)]/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-[var(--radius)] bg-[var(--warm-white)] p-4 shadow-2xl sm:p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[1.8px] text-[var(--text-muted)]">
              Close match #{preview.rank}
            </p>
            <p className="mt-1 text-2xl font-bold text-[var(--text)]">
              {preview.score.toFixed(0)}%
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-[var(--cream)] px-3 py-1.5 text-sm font-semibold text-[var(--text-muted)] transition-colors hover:bg-[var(--border)]"
          >
            Close
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <FacePreview alt="Selected face preview" thumbnail={preview.selectedThumbnail} />
          <FacePreview alt="Close match face preview" thumbnail={preview.matchThumbnail} />
        </div>
      </div>
    </div>
  );
}

/* Toast notification */
function Toast({ message, visible }: { message: string; visible: boolean }) {
  return (
    <div
      className={`fixed bottom-8 left-1/2 z-[1000] flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-[var(--radius-sm)] bg-[var(--text)] px-5 py-3 text-sm font-medium text-white shadow-lg transition-all duration-300 ${
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-20 opacity-0"
      }`}
    >
      <svg
        className="h-4 w-4 shrink-0 text-[#4CAF50]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
      {message}
    </div>
  );
}

export function ResultsPanel({ result, onReset }: Props) {
  const [focalName, setFocalName] = useState(result.persons[0]?.name || "");
  const [expandedPairPreview, setExpandedPairPreview] =
    useState<ExpandedPairPreview | null>(null);
  const [toast, setToast] = useState<{ message: string; visible: boolean }>({
    message: "",
    visible: false,
  });
  const resultCanvasRef = useRef<HTMLDivElement>(null);

  const pairs = getPairsForFocal(focalName, result.pairwise);
  const bestPair = pairs[0];
  const highlights = buildFeatureHighlights(pairs);
  const bestPairLabel = bestPair ? scoreLabel(bestPair.displayScore) : null;

  const showToast = useCallback((message: string) => {
    setToast({ message, visible: true });
    setTimeout(() => setToast((prev) => ({ ...prev, visible: false })), 2800);
  }, []);

  const buildResultCanvas = useCallback(async (): Promise<HTMLCanvasElement | null> => {
    if (!bestPair) return null;

    const loadImg = (src: string): Promise<HTMLImageElement> =>
      new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });

    const scale = 3;
    const W = 400;
    const pad = 28;

    // Pre-calculate dynamic height based on content
    const runnerUps = pairs.slice(1, 3);
    const breakdown = bestPair.pair.feature_breakdown;
    let dynamicH = 310; // base: header + faces + headline + score bar
    if (runnerUps.length > 0) dynamicH += 20 + runnerUps.length * 44; // section label + rows
    if (breakdown) dynamicH += 50; // family traits section
    dynamicH += 36; // branding footer
    const H = dynamicH;

    const canvas = document.createElement("canvas");
    canvas.width = W * scale;
    canvas.height = H * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);

    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, "#FFFCF7");
    grad.addColorStop(1, "#FFF5EB");
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, 20);
    ctx.fillStyle = grad;
    ctx.fill();

    // Soft blob top-right
    const rg = ctx.createRadialGradient(W - 40, 40, 0, W - 40, 40, 100);
    rg.addColorStop(0, "rgba(251,224,195,0.6)");
    rg.addColorStop(1, "rgba(251,224,195,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);

    // Brand text
    ctx.font = "600 10px sans-serif";
    ctx.letterSpacing = "2px";
    ctx.fillStyle = "#D4603A";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("LooksLikeMe.fyi", pad, pad + 10);

    // Face placeholder circles
    const faceY = pad + 36;
    const faceR = 36;

    const focalThumb = getFocalThumbnail(bestPair.pair, focalName);
    const matchThumb = getOtherPersonThumbnail(bestPair.pair, focalName);

    const drawFaceCircle = (cx: number, cy: number, r: number, fallbackColor: string) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = fallbackColor;
      ctx.fill();
    };

    const focalCx = pad + faceR;
    const focalCy = faceY + faceR;
    drawFaceCircle(focalCx, focalCy, faceR, "#FBE0C3");

    // Match arrow circle
    const arrowX = pad + faceR * 2 + 18;
    ctx.beginPath();
    ctx.arc(arrowX + 14, focalCy, 14, 0, Math.PI * 2);
    ctx.fillStyle = "#F4A261";
    ctx.fill();
    ctx.font = "bold 16px sans-serif";
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("\u2194", arrowX + 14, focalCy);

    const rfX = arrowX + 46;
    const matchCx = rfX + faceR;
    drawFaceCircle(matchCx, focalCy, faceR, "#D4E4F7");

    // Reset alignment
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    // Headline
    const headY = faceY + faceR * 2 + 32;
    ctx.font = "bold 19px Georgia, serif";
    ctx.fillStyle = "#3A2A1E";
    ctx.fillText("Looks most like", pad, headY);

    // Detail
    ctx.font = "13px sans-serif";
    ctx.fillStyle = "#8B7B6E";
    const featureStr = bestFeatureString(bestPair.pair) || "Strongest match across facial features.";
    ctx.fillText(featureStr, pad, headY + 24);

    // Score bar
    const barY = headY + 44;
    const barW = W - pad * 2;
    const barH = 8;
    ctx.beginPath();
    ctx.roundRect(pad, barY, barW, barH, 4);
    ctx.fillStyle = "#F0E6DA";
    ctx.fill();
    const barGrad = ctx.createLinearGradient(pad, 0, pad + barW * (bestPair.displayScore / 100), 0);
    barGrad.addColorStop(0, "#F4A261");
    barGrad.addColorStop(1, "#D4603A");
    ctx.beginPath();
    ctx.roundRect(pad, barY, barW * (bestPair.displayScore / 100), barH, 4);
    ctx.fillStyle = barGrad;
    ctx.fill();

    // Score label
    ctx.font = "12px sans-serif";
    ctx.fillStyle = "#8B7B6E";
    ctx.fillText("Resemblance", pad, barY + 24);
    ctx.font = "bold 14px sans-serif";
    ctx.fillStyle = "#D4603A";
    ctx.textAlign = "right";
    ctx.fillText(`${bestPair.displayScore.toFixed(0)}%`, W - pad, barY + 24);

    // --- Other close matches ---
    let cursorY = barY + 40;
    if (runnerUps.length > 0) {
      cursorY += 12;
      // Divider line
      ctx.beginPath();
      ctx.moveTo(pad, cursorY);
      ctx.lineTo(W - pad, cursorY);
      ctx.strokeStyle = "#E8DDD0";
      ctx.lineWidth = 1;
      ctx.stroke();
      cursorY += 16;

      ctx.textAlign = "left";
      ctx.font = "600 9px sans-serif";
      ctx.letterSpacing = "1.5px";
      ctx.fillStyle = "#8B7B6E";
      ctx.fillText("OTHER CLOSE MATCHES", pad, cursorY);
      cursorY += 16;

      const miniR = 16;
      for (const entry of runnerUps) {
        // Runner-up row: rank badge + two small face circles + arrow + score
        const rowY = cursorY + miniR;

        // Rank badge
        ctx.beginPath();
        ctx.roundRect(pad, cursorY + 4, 24, 24, 12);
        ctx.fillStyle = "rgba(244,162,97,0.15)";
        ctx.fill();
        ctx.font = "bold 10px sans-serif";
        ctx.fillStyle = "#D4603A";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const rankIdx = pairs.indexOf(entry) + 1;
        ctx.fillText(`#${rankIdx}`, pad + 12, rowY);

        // Focal face mini circle
        const f1Cx = pad + 40 + miniR;
        drawFaceCircle(f1Cx, rowY, miniR, "#FBE0C3");

        // Arrow
        ctx.font = "bold 13px sans-serif";
        ctx.fillStyle = "#F4A261";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("\u2192", f1Cx + miniR + 12, rowY);

        // Match face mini circle
        const f2Cx = f1Cx + miniR + 24 + miniR;
        drawFaceCircle(f2Cx, rowY, miniR, "#D4E4F7");

        // Score
        ctx.font = "bold 13px sans-serif";
        ctx.fillStyle = "#3A2A1E";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(`${entry.displayScore.toFixed(0)}%`, W - pad, rowY);

        // Load runner-up face images
        const ruFocalThumb = getFocalThumbnail(entry.pair, focalName);
        const ruMatchThumb = getOtherPersonThumbnail(entry.pair, focalName);
        try {
          if (ruFocalThumb) {
            const img = await loadImg(ruFocalThumb);
            ctx.save();
            ctx.beginPath();
            ctx.arc(f1Cx, rowY, miniR - 1, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(img, f1Cx - miniR, rowY - miniR, miniR * 2, miniR * 2);
            ctx.restore();
          }
          if (ruMatchThumb) {
            const img = await loadImg(ruMatchThumb);
            ctx.save();
            ctx.beginPath();
            ctx.arc(f2Cx, rowY, miniR - 1, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(img, f2Cx - miniR, rowY - miniR, miniR * 2, miniR * 2);
            ctx.restore();
          }
        } catch {
          // fallback circles already drawn
        }

        cursorY += miniR * 2 + 12;
      }
    }

    // --- Family traits ---
    if (breakdown) {
      cursorY += 4;
      // Divider line
      ctx.beginPath();
      ctx.moveTo(pad, cursorY);
      ctx.lineTo(W - pad, cursorY);
      ctx.strokeStyle = "#E8DDD0";
      ctx.lineWidth = 1;
      ctx.stroke();
      cursorY += 16;

      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.font = "600 9px sans-serif";
      ctx.letterSpacing = "1.5px";
      ctx.fillStyle = "#8B7B6E";
      ctx.fillText("FAMILY TRAITS", pad, cursorY);
      cursorY += 14;

      // Best trait pill
      const bestFeature = breakdown.best_matching_feature;
      const worstFeature = breakdown.least_matching_feature;
      if (bestFeature) {
        ctx.beginPath();
        ctx.roundRect(pad, cursorY, 90, 22, 11);
        ctx.fillStyle = "rgba(74,103,65,0.12)";
        ctx.fill();
        ctx.font = "bold 10px sans-serif";
        ctx.fillStyle = "#4A6741";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`Best: ${bestFeature.charAt(0).toUpperCase() + bestFeature.slice(1)}`, pad + 45, cursorY + 11);
      }
      if (worstFeature) {
        ctx.beginPath();
        ctx.roundRect(pad + 100, cursorY, 110, 22, 11);
        ctx.fillStyle = "rgba(212,96,58,0.12)";
        ctx.fill();
        ctx.font = "bold 10px sans-serif";
        ctx.fillStyle = "#D4603A";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`Weakest: ${worstFeature.charAt(0).toUpperCase() + worstFeature.slice(1)}`, pad + 155, cursorY + 11);
      }
      cursorY += 30;
    }

    // --- Branding footer ---
    cursorY += 4;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = "11px sans-serif";
    ctx.fillStyle = "#8B7B6E";
    ctx.letterSpacing = "0px";
    ctx.fillText("lookslikeme.fyi", W / 2, cursorY + 12);

    // Load face images onto canvas for best match
    try {
      if (focalThumb) {
        const img = await loadImg(focalThumb);
        ctx.save();
        ctx.beginPath();
        ctx.arc(focalCx, focalCy, faceR - 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, focalCx - faceR, focalCy - faceR, faceR * 2, faceR * 2);
        ctx.restore();
      }
      if (matchThumb) {
        const img = await loadImg(matchThumb);
        ctx.save();
        ctx.beginPath();
        ctx.arc(matchCx, focalCy, faceR - 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, matchCx - faceR, focalCy - faceR, faceR * 2, faceR * 2);
        ctx.restore();
      }
    } catch {
      // Images failed to load onto canvas, fallback circles are already drawn
    }

    return canvas;
  }, [bestPair, pairs, focalName]);

  const handleCopyImage = useCallback(async () => {
    const canvas = await buildResultCanvas();
    if (!canvas) return;

    // Try clipboard, then download
    try {
      if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
        const blobPromise: Promise<Blob> = new Promise((resolve) =>
          canvas.toBlob((b) => resolve(b!), "image/png"),
        );
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blobPromise }),
        ]);
        showToast("Copied! Paste it anywhere.");
        return;
      }
    } catch {
      // clipboard blocked
    }

    try {
      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = "looks-like-me-result.png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast("Saved as image!");
    } catch {
      showToast("Couldn't export \u2014 try a screenshot.");
    }
  }, [buildResultCanvas, showToast]);

  const handleShare = useCallback(async () => {
    try {
      const canvas = await buildResultCanvas();
      if (!canvas) {
        await handleCopyImage();
        return;
      }
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), "image/png"),
      );
      const file = new File([blob], "looks-like-me.png", { type: "image/png" });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: "LooksLikeMe.fyi",
          text: "See who looks like who in our family!",
          url: "https://lookslikeme.fyi",
          files: [file],
        });
        return;
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
    }

    // Fallback to copy
    await handleCopyImage();
  }, [buildResultCanvas, handleCopyImage]);

  return (
    <div className="space-y-5">
      {/* Person selector */}
      <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--warm-white)] p-4">
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-[1.8px] text-[var(--text-muted)]">
          Who are we comparing?
        </p>
        <div className="flex flex-wrap gap-2">
          {result.persons.map((person, index) => (
            <button
              key={person.name}
              type="button"
              onClick={() => setFocalName(person.name)}
              className={`rounded-2xl p-1.5 transition-colors ${
                person.name === focalName
                  ? "bg-[var(--terracotta)] shadow-sm"
                  : "bg-[var(--cream)] hover:bg-[var(--border)]"
              }`}
              aria-label={`Select face ${index + 1}`}
            >
              <SelectorChip person={person} active={person.name === focalName} />
            </button>
          ))}
        </div>
      </div>

      {/* Main result card */}
      {bestPair && bestPairLabel && (
        <div
          className="overflow-hidden rounded-[var(--radius)] shadow-[var(--shadow-medium)]"
          style={{ animation: "cardIn 0.5s ease 0.2s backwards" }}
        >
          {/* Shareable canvas area */}
          <div
            ref={resultCanvasRef}
            className="relative bg-gradient-to-br from-[var(--warm-white)] to-[#fff5eb] p-6"
          >
            {/* Decorative blob */}
            <div className="pointer-events-none absolute right-0 top-0 h-[120px] w-[120px] opacity-60"
              style={{ background: "radial-gradient(circle at top right, var(--peach-light) 0%, transparent 70%)" }}
            />

            <div className="relative mb-4 flex items-center justify-between">
              <p className="text-[10px] font-semibold tracking-[2px] text-[var(--terracotta)]">
                LooksLikeMe.fyi
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleCopyImage}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-white/70 text-[var(--text-muted)] transition-colors hover:bg-white hover:text-[var(--terracotta)]"
                  aria-label="Copy image"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={handleShare}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-white/70 text-[var(--text-muted)] transition-colors hover:bg-white hover:text-[var(--terracotta)]"
                  aria-label="Share"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Face pair */}
            <div className="relative mb-5 flex items-center gap-4">
              <div className="flex h-[96px] w-[96px] shrink-0 items-center justify-center overflow-hidden rounded-full border-[3px] border-[var(--warm-white)] bg-[var(--peach-light)] shadow-[0_2px_12px_rgba(0,0,0,0.1)]">
                {getFocalThumbnail(bestPair.pair, focalName) ? (
                  <img
                    src={getFocalThumbnail(bestPair.pair, focalName)!}
                    alt="Selected face"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-3xl">{"\u{1F464}"}</span>
                )}
              </div>

              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--peach)] shadow-[0_2px_8px_rgba(244,162,97,0.4)]">
                <svg
                  className="h-[18px] w-[18px] text-white"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M8 3v3a2 2 0 0 1-2 2H3" />
                  <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
                  <path d="M3 16h3a2 2 0 0 1 2 2v3" />
                  <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
                </svg>
              </div>

              <div className="flex h-[96px] w-[96px] shrink-0 items-center justify-center overflow-hidden rounded-full border-[3px] border-[var(--warm-white)] bg-[#d4e4f7] shadow-[0_2px_12px_rgba(0,0,0,0.1)]">
                {getOtherPersonThumbnail(bestPair.pair, focalName) ? (
                  <img
                    src={getOtherPersonThumbnail(bestPair.pair, focalName)!}
                    alt="Closest match face"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-3xl">{"\u{1F464}"}</span>
                )}
              </div>
            </div>

            {/* Result headline */}
            <div className="relative">
              <p className="theme-editorial text-xl font-bold leading-snug text-[var(--text)]">
                Looks most like
              </p>
              <p className="mt-1 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
                {bestFeatureString(bestPair.pair) || `${bestPairLabel.text} resemblance across facial features.`}
              </p>
            </div>

            {/* Score bar */}
            <div className="mt-[18px]">
              <div className="h-2 overflow-hidden rounded-[10px] bg-[var(--cream)]">
                <div
                  className="h-full rounded-[10px] transition-[width] duration-1000"
                  style={{
                    width: `${bestPair.displayScore}%`,
                    background: "linear-gradient(90deg, var(--peach) 0%, var(--terracotta) 100%)",
                  }}
                />
              </div>
              <div className="mt-1.5 flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)]">Resemblance</span>
                <strong className="text-sm font-bold text-[var(--terracotta)]">
                  {bestPair.displayScore.toFixed(0)}%
                </strong>
              </div>
            </div>
          </div>

          {/* Other close matches — inside the main card */}
          {pairs.length > 1 && (
            <div className="border-t border-[var(--border)] bg-gradient-to-br from-[var(--warm-white)] to-[#fff5eb] px-6 py-5">
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-[1.8px] text-[var(--text-muted)]">
                Other close matches
              </p>
              <div className="flex flex-col gap-2">
                {pairs.slice(1, 3).map((entry, index) => (
                  <RunnerUpPairButton
                    key={entry.otherName}
                    rank={index + 2}
                    score={entry.displayScore}
                    selectedThumbnail={getFocalThumbnail(entry.pair, focalName)}
                    matchThumbnail={getOtherPersonThumbnail(entry.pair, focalName)}
                    onClick={() =>
                      setExpandedPairPreview({
                        rank: index + 2,
                        score: entry.displayScore,
                        selectedThumbnail: getFocalThumbnail(entry.pair, focalName),
                        matchThumbnail: getOtherPersonThumbnail(entry.pair, focalName),
                      })
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {/* Family traits — inside the main card */}
          {(bestPair.pair.feature_breakdown || highlights.length > 0) && (
            <div className="space-y-3 border-t border-[var(--border)] bg-gradient-to-br from-[var(--warm-white)] to-[#fff5eb] px-6 py-5">
              {bestPair.pair.feature_breakdown && (
                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[1.8px] text-[var(--text-muted)]">
                    Family traits
                  </p>
                  <FeatureBreakdownPanel breakdown={bestPair.pair.feature_breakdown} />
                </div>
              )}

              {highlights.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {highlights.map((highlight) => {
                    const pair = pairs.find((entry) => entry.otherName === highlight.person);
                    return (
                      <FeatureHighlightChip
                        key={highlight.person}
                        regions={highlight.regions}
                        thumbnail={pair ? getOtherPersonThumbnail(pair.pair, focalName) : null}
                      />
                    );
                  })}
                </div>
              )}

              <div className="mt-1">
                <ScoreBar
                  label="Face match"
                  value={bestPair.displayScore / 100}
                  color="bg-[var(--peach)]"
                  showLabel={false}
                  showValue={false}
                  showStrength={false}
                />
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2.5 border-t border-[var(--border)] bg-[var(--warm-white)] px-6 pt-4 pb-4">
            <button
              type="button"
              onClick={handleCopyImage}
              className="flex flex-1 items-center justify-center gap-2 rounded-[var(--radius-sm)] border-[1.5px] border-[var(--terracotta)] bg-[var(--terracotta)] px-3 py-3.5 text-sm font-semibold text-white transition-all hover:bg-[var(--terracotta-dark)] hover:border-[var(--terracotta-dark)] active:scale-[0.97]"
            >
              <svg
                className="h-[18px] w-[18px]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy Image
            </button>
            <button
              type="button"
              onClick={handleShare}
              className="flex flex-1 items-center justify-center gap-2 rounded-[var(--radius-sm)] border-[1.5px] border-[var(--border)] bg-[var(--warm-white)] px-3 py-3.5 text-sm font-semibold text-[var(--text)] transition-all hover:border-[var(--peach)] hover:bg-[rgba(244,162,97,0.05)] active:scale-[0.97]"
            >
              <svg
                className="h-[18px] w-[18px] text-[var(--terracotta)]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
              Share
            </button>
          </div>
        </div>
      )}

      {/* Family overview card */}
      {result.persons.length > 2 && (
        <FamilyCard result={result} />
      )}

      <div className="text-center">
        <button
          type="button"
          onClick={onReset}
          className="rounded-2xl bg-[var(--text)] px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:opacity-90"
        >
          Compare different photos
        </button>
      </div>

      {expandedPairPreview && (
        <PairPreviewDialog
          preview={expandedPairPreview}
          onClose={() => setExpandedPairPreview(null)}
        />
      )}

      <Toast message={toast.message} visible={toast.visible} />
    </div>
  );
}
