import { useCallback, useState } from "react";
import type { ComparisonResult, PairwiseComparison } from "../types";
import { PersonAvatar } from "./PersonAvatar";

interface Props {
  result: ComparisonResult;
}

interface RankedPair {
  pair: PairwiseComparison;
  displayScore: number;
  nameA: string;
  nameB: string;
  thumbA: string | null;
  thumbB: string | null;
}

function mapFaceScore(raw: number | null): number {
  if (raw === null) return 0;
  const minRaw = -0.1;
  const maxRaw = 0.6;
  const clamped = Math.max(minRaw, Math.min(maxRaw, raw));
  return ((clamped - minRaw) / (maxRaw - minRaw)) * 100;
}

function getTopPairs(result: ComparisonResult): RankedPair[] {
  const seen = new Set<string>();

  return result.pairwise
    .map((pair) => {
      const key = [pair.person_a, pair.person_b].sort().join("|");
      if (seen.has(key)) return null;
      seen.add(key);

      return {
        pair,
        displayScore: mapFaceScore(pair.face_similarity),
        nameA: pair.person_a,
        nameB: pair.person_b,
        thumbA: pair.person_a_face_thumbnail_b64,
        thumbB: pair.person_b_face_thumbnail_b64,
      };
    })
    .filter((entry): entry is RankedPair => entry !== null)
    .sort((a, b) => b.displayScore - a.displayScore)
    .slice(0, 4);
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

function CopyIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function buildFamilyCanvas(
  topPairs: RankedPair[],
): Promise<HTMLCanvasElement | null> {
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
  const pad = 24;
  const rowH = 52;
  const headerH = 80;
  const footerH = 40;
  const H = headerH + topPairs.length * rowH + 16 + footerH;

  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);

  // Background
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#FFFCF7");
  grad.addColorStop(1, "#FFF5EB");
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, 20);
  ctx.fillStyle = grad;
  ctx.fill();

  // Decorative blob
  const blobGrad = ctx.createRadialGradient(W, 0, 0, W, 0, 120);
  blobGrad.addColorStop(0, "rgba(251,224,195,0.6)");
  blobGrad.addColorStop(1, "rgba(251,224,195,0)");
  ctx.fillStyle = blobGrad;
  ctx.fillRect(W - 120, 0, 120, 120);

  // Branding
  ctx.font = "600 10px sans-serif";
  ctx.fillStyle = "#D4603A";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.letterSpacing = "2px";
  ctx.fillText("LooksLikeMe.fyi", pad, 28);

  // Title
  ctx.letterSpacing = "0px";
  ctx.font = "bold 18px Georgia, serif";
  ctx.fillStyle = "#3A2A1E";
  ctx.fillText("Who looks like who", pad, 56);

  let cursorY = headerH;

  // Draw rows (without images first, images loaded async)
  const facePositions: Array<{
    ax: number; bx: number; y: number; r: number;
    thumbA: string | null; thumbB: string | null;
  }> = [];

  for (let i = 0; i < topPairs.length; i++) {
    const entry = topPairs[i];
    const rowY = cursorY + rowH / 2;
    const avatarR = 16;

    // Row bg
    ctx.beginPath();
    ctx.roundRect(pad, cursorY + 4, W - pad * 2, rowH - 8, 14);
    ctx.fillStyle = "rgba(92,61,46,0.03)";
    ctx.fill();

    // Rank
    ctx.beginPath();
    ctx.roundRect(pad + 10, rowY - 10, 20, 20, 10);
    ctx.fillStyle = "rgba(244,162,97,0.15)";
    ctx.fill();
    ctx.font = "bold 10px sans-serif";
    ctx.fillStyle = "#D4603A";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${i + 1}`, pad + 20, rowY);

    // Face A circle
    const ax = pad + 52;
    ctx.beginPath();
    ctx.arc(ax, rowY, avatarR, 0, Math.PI * 2);
    ctx.fillStyle = "#FBE0C3";
    ctx.fill();

    // Arrow
    ctx.font = "bold 14px sans-serif";
    ctx.fillStyle = "#F4A261";
    ctx.textAlign = "center";
    ctx.fillText("\u2192", ax + avatarR + 14, rowY);

    // Face B circle
    const bx = ax + avatarR * 2 + 28;
    ctx.beginPath();
    ctx.arc(bx, rowY, avatarR, 0, Math.PI * 2);
    ctx.fillStyle = "#D4E4F7";
    ctx.fill();

    facePositions.push({
      ax, bx, y: rowY, r: avatarR,
      thumbA: entry.thumbA, thumbB: entry.thumbB,
    });

    // Score bar
    const barX = bx + avatarR + 16;
    const barW = 80;
    ctx.beginPath();
    ctx.roundRect(barX, rowY - 3, barW, 6, 3);
    ctx.fillStyle = "rgba(232,221,208,0.6)";
    ctx.fill();

    const fillW = (entry.displayScore / 100) * barW;
    if (fillW > 0) {
      const barGrad = ctx.createLinearGradient(barX, 0, barX + fillW, 0);
      barGrad.addColorStop(0, "#F4A261");
      barGrad.addColorStop(1, "#D4603A");
      ctx.beginPath();
      ctx.roundRect(barX, rowY - 3, fillW, 6, 3);
      ctx.fillStyle = barGrad;
      ctx.fill();
    }

    // Score text
    ctx.font = "bold 12px sans-serif";
    ctx.fillStyle = "#3A2A1E";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(`${entry.displayScore.toFixed(0)}%`, W - pad - 8, rowY);

    cursorY += rowH;
  }

  // Footer branding
  cursorY += 8;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = "11px sans-serif";
  ctx.fillStyle = "#8B7B6E";
  ctx.letterSpacing = "0px";
  ctx.fillText("lookslikeme.fyi", W / 2, cursorY + 12);

  // Load face images
  return (async () => {
    for (const pos of facePositions) {
      try {
        if (pos.thumbA) {
          const img = await loadImg(pos.thumbA);
          ctx.save();
          ctx.beginPath();
          ctx.arc(pos.ax, pos.y, pos.r - 1, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(img, pos.ax - pos.r, pos.y - pos.r, pos.r * 2, pos.r * 2);
          ctx.restore();
        }
        if (pos.thumbB) {
          const img = await loadImg(pos.thumbB);
          ctx.save();
          ctx.beginPath();
          ctx.arc(pos.bx, pos.y, pos.r - 1, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(img, pos.bx - pos.r, pos.y - pos.r, pos.r * 2, pos.r * 2);
          ctx.restore();
        }
      } catch {
        // fallback circles already drawn
      }
    }
    return canvas;
  })();
}

export function FamilyCard({ result }: Props) {
  const topPairs = getTopPairs(result);
  const [toast, setToast] = useState("");

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2800);
  }, []);

  const handleCopyImage = useCallback(async () => {
    const canvas = await buildFamilyCanvas(topPairs);
    if (!canvas) return;

    try {
      if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
        const blobPromise: Promise<Blob> = new Promise((resolve) =>
          canvas.toBlob((b) => resolve(b!), "image/png"),
        );
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blobPromise }),
        ]);
        showToast("Copied!");
        return;
      }
    } catch { /* clipboard blocked */ }

    try {
      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = "family-overview.png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast("Saved as image!");
    } catch {
      showToast("Couldn't export.");
    }
  }, [topPairs, showToast]);

  const handleShare = useCallback(async () => {
    try {
      const canvas = await buildFamilyCanvas(topPairs);
      if (!canvas) { await handleCopyImage(); return; }
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), "image/png"),
      );
      const file = new File([blob], "family-overview.png", { type: "image/png" });
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
    await handleCopyImage();
  }, [topPairs, handleCopyImage]);

  if (topPairs.length < 2) return null;

  return (
    <div
      className="overflow-hidden rounded-[var(--radius)] shadow-[var(--shadow-medium)]"
      style={{ animation: "cardIn 0.5s ease 0.4s backwards" }}
    >
      <div className="relative bg-gradient-to-br from-[var(--warm-white)] to-[#fff5eb] px-5 pt-5 pb-4">
        {/* Decorative blob */}
        <div
          className="pointer-events-none absolute right-0 top-0 h-[120px] w-[120px] opacity-60"
          style={{ background: "radial-gradient(circle at top right, var(--peach-light) 0%, transparent 70%)" }}
        />

        {/* Header: branding + actions */}
        <div className="relative mb-3 flex items-center justify-between">
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
              <CopyIcon />
            </button>
            <button
              type="button"
              onClick={handleShare}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/70 text-[var(--text-muted)] transition-colors hover:bg-white hover:text-[var(--terracotta)]"
              aria-label="Share"
            >
              <ShareIcon />
            </button>
          </div>
        </div>

        <p className="relative theme-editorial text-xl font-bold text-[var(--text)]">
          Who looks like who
        </p>
      </div>

      {/* Top pairs */}
      <div className="bg-gradient-to-br from-[var(--warm-white)] to-[#fff5eb] px-5 pb-2">
        <div className="space-y-2">
          {topPairs.map((entry, index) => (
            <div
              key={`${entry.nameA}-${entry.nameB}`}
              className="flex items-center gap-2.5 rounded-2xl bg-[rgba(92,61,46,0.03)] px-3 py-2.5"
            >
              <span className="theme-accent-pill flex h-6 min-w-6 items-center justify-center rounded-full text-[10px] font-bold">
                {index + 1}
              </span>
              <PersonAvatar
                name={entry.nameA}
                thumbnail={entry.thumbA}
                sizeClass="h-10 w-10"
                textClass="text-[10px]"
                roundedClass="rounded-xl"
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
              <PersonAvatar
                name={entry.nameB}
                thumbnail={entry.thumbB}
                sizeClass="h-10 w-10"
                textClass="text-[10px]"
                roundedClass="rounded-xl"
              />
              <div className="ml-auto flex items-center gap-2">
                <div className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-[var(--cream)] sm:block">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${entry.displayScore}%`,
                      background: "linear-gradient(90deg, var(--peach) 0%, var(--terracotta) 100%)",
                    }}
                  />
                </div>
                <ScorePill score={entry.displayScore} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Branding footer */}
      <div className="border-t border-[var(--border)] bg-[var(--warm-white)] px-6 pt-3 pb-0 text-center">
        <a href="https://lookslikeme.fyi" className="text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--terracotta)]">
          lookslikeme.fyi
        </a>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2.5 bg-[var(--warm-white)] px-5 pt-2 pb-4">
        <button
          type="button"
          onClick={handleCopyImage}
          className="flex flex-1 items-center justify-center gap-2 rounded-[var(--radius-sm)] border-[1.5px] border-[var(--terracotta)] bg-[var(--terracotta)] px-3 py-3.5 text-sm font-semibold text-white transition-all hover:bg-[var(--terracotta-dark)] hover:border-[var(--terracotta-dark)] active:scale-[0.97]"
        >
          <CopyIcon />
          Copy Image
        </button>
        <button
          type="button"
          onClick={handleShare}
          className="flex flex-1 items-center justify-center gap-2 rounded-[var(--radius-sm)] border-[1.5px] border-[var(--border)] bg-[var(--warm-white)] px-3 py-3.5 text-sm font-semibold text-[var(--text)] transition-all hover:border-[var(--peach)] hover:bg-[rgba(244,162,97,0.05)] active:scale-[0.97]"
        >
          <ShareIcon />
          Share
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-8 left-1/2 z-[1000] flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-[var(--radius-sm)] bg-[var(--text)] px-5 py-3 text-sm font-medium text-white shadow-lg">
          <svg className="h-4 w-4 shrink-0 text-[#4CAF50]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {toast}
        </div>
      )}
    </div>
  );
}
