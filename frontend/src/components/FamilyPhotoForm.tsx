import { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { areAllFilesCached } from "../utils/faceCache";
import { isHeicFile, convertHeicToJpeg } from "../utils/heicConvert";
import type { ModelPreloadProgress } from "../types";

type ModelPreloadState =
  | { status: "loading"; progress: ModelPreloadProgress }
  | { status: "ready"; progress: ModelPreloadProgress }
  | { status: "error"; message: string };

interface Props {
  loading: boolean;
  modelPreloadState: ModelPreloadState | null;
  onAnalyze: (files: File[]) => void;
  onPhotosAdded?: () => void;
}

const MAX_UPLOAD_IMAGES = 16;
const PHOTO_CACHE_DB = "lookslikeme-photo-cache";
const PHOTO_CACHE_STORE = "photos";

function prefersMobilePicker(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(max-width: 768px), (pointer: coarse)").matches;
}

/* ---- IndexedDB photo cache ---- */
function openPhotoCacheDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(PHOTO_CACHE_DB, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(PHOTO_CACHE_STORE)) {
          db.createObjectStore(PHOTO_CACHE_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function cachePhotos(files: File[]): Promise<void> {
  const db = await openPhotoCacheDb();
  if (!db) return;
  try {
    const entries = await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        type: file.type,
        lastModified: file.lastModified,
        buffer: await file.arrayBuffer(),
      })),
    );
    const tx = db.transaction(PHOTO_CACHE_STORE, "readwrite");
    tx.objectStore(PHOTO_CACHE_STORE).put(entries, "last-photos");
  } catch {
    // cache write failed, not critical
  }
}

async function loadCachedPhotos(): Promise<File[]> {
  const db = await openPhotoCacheDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(PHOTO_CACHE_STORE, "readonly");
      const request = tx.objectStore(PHOTO_CACHE_STORE).get("last-photos");
      request.onsuccess = () => {
        const entries = request.result;
        if (!Array.isArray(entries) || entries.length === 0) {
          resolve([]);
          return;
        }
        const files = entries.map(
          (entry: { name: string; type: string; lastModified: number; buffer: ArrayBuffer }) =>
            new File([entry.buffer], entry.name, {
              type: entry.type,
              lastModified: entry.lastModified,
            }),
        );
        resolve(files);
      };
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

async function clearCachedPhotos(): Promise<void> {
  const db = await openPhotoCacheDb();
  if (!db) return;
  try {
    const tx = db.transaction(PHOTO_CACHE_STORE, "readwrite");
    tx.objectStore(PHOTO_CACHE_STORE).delete("last-photos");
  } catch {
    // not critical
  }
}

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function FamilyPhotoForm({ loading, modelPreloadState, onAnalyze, onPhotosAdded }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [allCached, setAllCached] = useState(false);
  const [converting, setConverting] = useState<{ done: number; total: number } | null>(null);
  const [isMobilePicker, setIsMobilePicker] = useState(prefersMobilePicker);
  const cacheLoaded = useRef(false);

  // Load cached photos on mount
  useEffect(() => {
    if (cacheLoaded.current) return;
    cacheLoaded.current = true;
    loadCachedPhotos().then((cached) => {
      if (cached.length > 0) {
        setFiles(cached);
        onPhotosAdded?.();
      }
    });
  }, [onPhotosAdded]);

  // Cache photos whenever they change
  useEffect(() => {
    if (!cacheLoaded.current) return;
    if (files.length > 0) {
      cachePhotos(files);
    } else {
      clearCachedPhotos();
    }
  }, [files]);

  // Check if all current files have cached face data
  useEffect(() => {
    if (files.length < 2) {
      setAllCached(false);
      return;
    }
    let cancelled = false;
    areAllFilesCached(files).then((result) => {
      if (!cancelled) setAllCached(result);
    });
    return () => { cancelled = true; };
  }, [files]);

  const onDrop = useCallback(async (accepted: File[]) => {
    const heicFiles = accepted.filter(isHeicFile);
    const nonHeicFiles = accepted.filter((f) => !isHeicFile(f));

    if (heicFiles.length === 0) {
      setFiles((current) => {
        const next = [...current, ...nonHeicFiles].slice(0, MAX_UPLOAD_IMAGES);
        if (current.length === 0 && next.length > 0) onPhotosAdded?.();
        return next;
      });
      return;
    }

    // Add non-HEIC files immediately
    if (nonHeicFiles.length > 0) {
      setFiles((current) => {
        const next = [...current, ...nonHeicFiles].slice(0, MAX_UPLOAD_IMAGES);
        if (current.length === 0 && next.length > 0) onPhotosAdded?.();
        return next;
      });
    }

    // Convert HEIC files one by one with progress
    setConverting({ done: 0, total: heicFiles.length });
    for (let i = 0; i < heicFiles.length; i++) {
      try {
        const converted = await convertHeicToJpeg(heicFiles[i]);
        setFiles((current) => {
          const next = [...current, converted].slice(0, MAX_UPLOAD_IMAGES);
          if (current.length === 0 && next.length > 0) onPhotosAdded?.();
          return next;
        });
      } catch {
        // Skip files that fail to convert
      }
      setConverting({ done: i + 1, total: heicFiles.length });
    }
    setConverting(null);
  }, [onPhotosAdded]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(max-width: 768px), (pointer: coarse)");
    const handleChange = () => setIsMobilePicker(mediaQuery.matches);
    handleChange();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: { "image/*": [], "image/heic": [".heic", ".heif"] },
    maxSize: 10 * 1024 * 1024,
    maxFiles: MAX_UPLOAD_IMAGES,
    noClick: isMobilePicker,
    noKeyboard: isMobilePicker,
  });

  const removeFile = (index: number) => {
    setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
  };

  const modelsReady = modelPreloadState?.status === "ready";
  const ready = modelsReady || allCached;
  const ctaDisabled = loading || files.length < 2 || !ready || converting !== null;
  const ctaLabel = loading
    ? "Scanning faces..."
    : files.length < 2
      ? "Add at least 2 photos"
      : "Show me the resemblance";

  const showModelStatus = files.length >= 2 && !allCached && modelPreloadState && modelPreloadState.status !== "error";
  const modelProgress = modelPreloadState && "progress" in modelPreloadState ? modelPreloadState.progress : null;
  const progressPct = modelProgress && modelProgress.total_bytes > 0
    ? Math.min(100, (modelProgress.loaded_bytes / modelProgress.total_bytes) * 100)
    : 0;

  return (
    <div className="space-y-5">
      <input {...getInputProps({ className: "hidden" })} />

      {/* Upload card */}
      <div
        className="theme-card rounded-[var(--radius)] p-6"
        style={{ animation: "cardIn 0.5s ease 0.3s backwards" }}
      >
        <span className="text-[10px] font-semibold uppercase tracking-[1.8px] text-[var(--text-muted)]">
          Family Photos
        </span>

        {files.length === 0 ? (
          <>
            <h2 className="theme-editorial mt-2 text-[22px] font-medium leading-snug text-[var(--text)]">
              Add your family photos
            </h2>
            <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--text-muted)]">
              We'll find the faces and show you who looks like who.
            </p>

            {/* Drop zone / picker */}
            {isMobilePicker ? (
              <div className="mt-5">
                <button
                  type="button"
                  onClick={open}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[var(--border)] px-5 py-9 text-center transition-all hover:border-[var(--peach)] hover:bg-[rgba(244,162,97,0.04)]"
                >
                  <div>
                    <div className="mx-auto mb-3.5 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--peach-light)]">
                      <svg
                        className="text-[var(--terracotta)]"
                        width="22"
                        height="22"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                    </div>
                    <p className="text-[15px] font-medium text-[var(--text)]">
                      Tap to add photos
                    </p>
                  </div>
                </button>
              </div>
            ) : (
              <div
                {...getRootProps()}
                className={`mt-5 cursor-pointer rounded-2xl border-2 border-dashed px-5 py-9 text-center transition-all ${
                  isDragActive
                    ? "scale-[1.01] border-[var(--peach)] bg-[rgba(244,162,97,0.04)] shadow-[0_0_0_4px_rgba(244,162,97,0.1)]"
                    : "border-[var(--border)] hover:border-[var(--peach)] hover:bg-[rgba(244,162,97,0.04)]"
                }`}
              >
                <div className="mx-auto mb-3.5 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--peach-light)] transition-transform hover:scale-[1.08]">
                  <svg
                    className="text-[var(--terracotta)]"
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
                <p className="text-[15px] font-medium text-[var(--text)]">
                  Drop photos here or{" "}
                  <span className="text-[var(--terracotta)] underline underline-offset-2">
                    browse
                  </span>
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            {/* File preview grid */}
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-[var(--text)]">
                {files.length} photo{files.length === 1 ? "" : "s"} ready
              </p>
              <button
                type="button"
                onClick={() => setFiles([])}
                className="text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text)]"
              >
                Clear
              </button>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2.5">
              {files.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
                  className="group relative overflow-hidden rounded-[var(--radius-sm)]"
                  style={{ animation: `popIn 0.3s ease ${index * 0.05}s backwards` }}
                >
                  <img
                    src={URL.createObjectURL(file)}
                    alt={`Upload ${index + 1}`}
                    className="aspect-square w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeFile(index)}
                    className="absolute right-1.5 top-1.5 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-black/55 text-[14px] text-white backdrop-blur-sm transition-colors hover:bg-black/75"
                  >
                    &times;
                  </button>
                </div>
              ))}

              {/* Add more tile */}
              {files.length < MAX_UPLOAD_IMAGES && (
                <button
                  type="button"
                  onClick={open}
                  className="flex aspect-square items-center justify-center rounded-[var(--radius-sm)] border-2 border-dashed border-[var(--border)] transition-all hover:border-[var(--peach)] hover:bg-[rgba(244,162,97,0.04)]"
                  style={{ animation: `popIn 0.3s ease ${files.length * 0.05}s backwards` }}
                >
                  <svg
                    className="h-7 w-7 text-[var(--text-muted)]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Status + CTA Button */}
      <div style={{ animation: "cardIn 0.5s ease 0.5s backwards" }}>
        {converting && (
          <div className="mb-3 rounded-xl bg-[rgba(92,61,46,0.05)] px-4 py-3">
            <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
              <span>Converting HEIC to JPEG…</span>
              <span>{converting.done} / {converting.total}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.9)]">
              <div
                className="h-full rounded-full bg-[var(--terracotta)] transition-all duration-300"
                style={{ width: `${Math.max(4, (converting.done / converting.total) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {!converting && showModelStatus && !modelsReady && modelProgress && (
          <div className="mb-3 rounded-xl bg-[rgba(92,61,46,0.05)] px-4 py-3">
            <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
              <span>{modelProgress.stage}</span>
              {modelProgress.total_bytes > 0 && (
                <span>{formatMB(modelProgress.loaded_bytes)} / {formatMB(modelProgress.total_bytes)}</span>
              )}
            </div>
            {modelProgress.total_bytes > 0 && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.9)]">
                <div
                  className="h-full rounded-full bg-[var(--terracotta)] transition-all duration-300"
                  style={{ width: `${Math.max(4, progressPct)}%` }}
                />
              </div>
            )}
          </div>
        )}

        {modelPreloadState?.status === "error" && (
          <div className="mb-3 rounded-xl border border-[rgba(212,96,58,0.28)] bg-[rgba(255,247,240,0.92)] px-4 py-3 text-xs text-[var(--terracotta)]">
            Model download failed. Please refresh and try again.
          </div>
        )}

        <button
          type="button"
          onClick={() => onAnalyze(files)}
          disabled={ctaDisabled}
          className="flex w-full items-center justify-center gap-2.5 rounded-2xl border-none px-5 py-[18px] text-base font-semibold transition-all theme-primary-button disabled:cursor-not-allowed"
        >
          {ctaLabel}
          {!loading && (
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="transition-transform group-hover:translate-x-0.5"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          )}
        </button>
      </div>

      {/* Trust footer */}
      <div
        className="px-5 text-center"
        style={{ animation: "cardIn 0.5s ease 0.7s backwards" }}
      >
        <div className="flex items-center justify-center gap-2 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
          <span className="theme-success-pill inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold">
            <svg
              className="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            On-device
          </span>
          <span>Nothing leaves your device.{" "}
            <a href="#" className="theme-link">
              Learn more
            </a>
          </span>
        </div>
      </div>

      {/* How it works (only when empty) */}
      {files.length === 0 && (
        <div className="mt-4 pt-2" style={{ animation: "cardIn 0.5s ease 0.8s backwards" }}>
          <p className="mb-4.5 text-center text-[10px] font-semibold uppercase tracking-[1.8px] text-[var(--text-muted)]">
            How it works
          </p>
          <div className="flex flex-col">
            {[
              {
                step: "1",
                title: "Add a few family photos",
                desc: "Group shots, selfies, old scanned prints \u2014 anything works.",
              },
              {
                step: "2",
                title: "We detect every face",
                desc: "Faces are found and grouped automatically, right on your device.",
              },
              {
                step: "3",
                title: "See who looks like who",
                desc: "We compare every pair and show you the strongest resemblances.",
              },
            ].map((item, i, arr) => (
              <div key={item.step} className="flex gap-3.5">
                <div className="flex shrink-0 flex-col items-center">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--terracotta)] font-['Fraunces',serif] text-sm font-bold text-[var(--warm-white)]">
                    {item.step}
                  </div>
                  {i < arr.length - 1 && (
                    <div className="min-h-5 w-0.5 flex-1 bg-[var(--border)]" />
                  )}
                </div>
                <div className={i < arr.length - 1 ? "pb-6" : ""}>
                  <p className="text-[14.5px] font-semibold leading-8 text-[var(--text)]">
                    {item.title}
                  </p>
                  <p className="text-[13.5px] leading-relaxed text-[var(--text-muted)]">
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
