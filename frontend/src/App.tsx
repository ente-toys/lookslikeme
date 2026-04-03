import { useCallback, useEffect, useRef, useState } from "react";
import { FamilyPhotoForm } from "./components/FamilyPhotoForm";
import { ResultsPanel } from "./components/ResultsPanel";
import {
  ProcessingOverlay,
  type ProcessingOverlayVariant,
  type ProcessingPerson,
} from "./components/ProcessingOverlay";
import {
  analyzeFamilyUpload,
  compareFamilySelection,
  preloadModels,
} from "./api/client";
import type {
  ComparisonResult,
  FamilyClusterSelection,
  ModelPreloadProgress,
} from "./types";

type ModelPreloadState =
  | { status: "loading"; progress: ModelPreloadProgress }
  | { status: "ready"; progress: ModelPreloadProgress }
  | { status: "error"; message: string };

type PageHeader = {
  eyebrow: string;
  titleHtml: React.ReactNode;
  subtitle: string;
};

type DebugEntry = {
  time: string;
  event: string;
  details?: Record<string, unknown>;
};

const MIN_COMPARE_GROUPS = 2;

function debugLog(event: string, details?: Record<string, unknown>) {
  const entry: DebugEntry = {
    time: new Date().toISOString(),
    event,
    details,
  };

  const globalState = globalThis as typeof globalThis & {
    __LLU_DEBUG_LOGS__?: DebugEntry[];
  };

  if (!globalState.__LLU_DEBUG_LOGS__) {
    globalState.__LLU_DEBUG_LOGS__ = [];
  }
  globalState.__LLU_DEBUG_LOGS__.push(entry);
  if (globalState.__LLU_DEBUG_LOGS__.length > 100) {
    globalState.__LLU_DEBUG_LOGS__.shift();
  }

  console.info(`[LLU] ${event}`, details ?? {});
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function formatModelProgressSummary(state: ModelPreloadState): string {
  if (state.status === "error") {
    return state.message;
  }

  const { loaded_bytes: loadedBytes, total_bytes: totalBytes } = state.progress;
  if (totalBytes > 0) {
    return `${formatMegabytes(loadedBytes)} of ${formatMegabytes(totalBytes)}`;
  }

  if (state.status === "ready") {
    return "Download complete";
  }

  if (loadedBytes > 0) {
    return `${formatMegabytes(loadedBytes)} downloaded`;
  }

  return "Preparing download";
}

function buildAutoSelections(
  clusters: Array<{ id: string; included_by_default: boolean }>,
): FamilyClusterSelection[] {
  const selections = clusters.map((cluster) => ({
    cluster_id: cluster.id,
    name: "",
    included: cluster.included_by_default,
  }));

  let includedCount = selections.filter((selection) => selection.included).length;
  if (includedCount >= MIN_COMPARE_GROUPS) {
    return selections;
  }

  for (const selection of selections) {
    if (selection.included) {
      continue;
    }
    selection.included = true;
    includedCount += 1;
    if (includedCount >= MIN_COMPARE_GROUPS) {
      break;
    }
  }

  return selections;
}

function getPageHeader({
  loading,
  result,
  error,
  processingVariant,
}: {
  loading: boolean;
  result: ComparisonResult | null;
  error: string | null;
  processingVariant: ProcessingOverlayVariant;
}): PageHeader {
  if (result) {
    return {
      eyebrow: "Looks Like Me",
      titleHtml: "",
      subtitle: "Pick any face to see the closest match.",
    };
  }

  if (loading) {
    if (processingVariant === "family-analysis") {
      return {
        eyebrow: "Looks Like Me",
        titleHtml: "Sorting your family photos",
        subtitle: "We're finding faces and grouping the same people together.",
      };
    }

    if (processingVariant === "family-compare") {
      return {
        eyebrow: "Looks Like Me",
        titleHtml: "Finding the family resemblance",
        subtitle: "We're comparing each face to see who looks most alike.",
      };
    }
  }

  if (error) {
    return {
      eyebrow: "Looks Like Me",
      titleHtml: "Try another set of photos",
      subtitle: "A few clear family photos usually works best.",
    };
  }

  return {
    eyebrow: "Looks Like Me",
    titleHtml: (
      <>
        She has your eyes.
        <br />
        But <em className="font-medium italic text-[var(--terracotta)]">whose</em> nose?
      </>
    ),
    subtitle:
      "Add a few family photos and we'll show you who looks like who.",
  };
}


function App() {
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processingPersons, setProcessingPersons] = useState<ProcessingPerson[]>([]);
  const [processingVariant, setProcessingVariant] =
    useState<ProcessingOverlayVariant>("family-analysis");
  const [modelPreloadState, setModelPreloadState] = useState<ModelPreloadState | null>(null);
  const [showModelBanner, setShowModelBanner] = useState(false);
  const modelPreloadStarted = useRef(false);

  // Error listeners
  useEffect(() => {
    const handleWindowError = (event: ErrorEvent) => {
      debugLog("Window error", {
        message: event.message,
        file: event.filename,
        line: event.lineno,
        column: event.colno,
      });
    };
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      debugLog("Unhandled rejection", {
        reason:
          event.reason instanceof Error
            ? `${event.reason.message}${event.reason.stack ? `\n${event.reason.stack}` : ""}`
            : String(event.reason),
      });
    };

    debugLog("App mounted");
    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  // Start model preload — called once when user first adds photos
  const startModelPreload = useCallback(() => {
    if (modelPreloadStarted.current) return;
    modelPreloadStarted.current = true;

    setModelPreloadState({
      status: "loading",
      progress: {
        stage: "Starting model download",
        loaded_bytes: 0,
        total_bytes: 0,
      },
    });
    setShowModelBanner(true);

    preloadModels((progress) => {
      setModelPreloadState({
        status: "loading",
        progress,
      });
    })
      .then(() => {
        setModelPreloadState((current) => {
          if (current && "progress" in current) {
            return {
              status: "ready",
              progress: {
                ...current.progress,
                stage: "Models ready",
              },
            };
          }
          return {
            status: "ready",
            progress: { stage: "Models ready", loaded_bytes: 0, total_bytes: 0 },
          };
        });

        setTimeout(() => setShowModelBanner(false), 2500);
      })
      .catch((preloadError) => {
        setModelPreloadState({
          status: "error",
          message:
            preloadError instanceof Error
              ? preloadError.message
              : "Model download failed",
        });
      });
  }, []);

  const handleFamilyAnalyze = async (files: File[]) => {
    debugLog("Family analyze requested", {
      files: files.length,
      fileNames: files.map((file) => file.name),
    });
    setProcessingPersons(
      files.map((file, index) => ({
        name: `Photo ${index + 1}`,
        imageUrls: [URL.createObjectURL(file)],
      })),
    );
    setProcessingVariant("family-analysis");
    setLoading(true);
    setError(null);

    try {
      const analysis = await analyzeFamilyUpload(files);
      debugLog("Family analysis complete", {
        sessionId: analysis.session_id,
        uploadedImages: analysis.metadata.uploaded_images_count,
        facesDetected: analysis.metadata.faces_detected,
        clustersDetected: analysis.metadata.clusters_detected,
        defaultIncluded: analysis.clusters.filter((cluster) => cluster.included_by_default).length,
      });
      const selections = buildAutoSelections(analysis.clusters);
      debugLog("Auto selections prepared", {
        included: selections.filter((selection) => selection.included).length,
        total: selections.length,
      });
      const selectedPersons = selections
        .filter((selection) => selection.included)
        .map((selection, index) => {
          const cluster = analysis.clusters.find(
            (candidate) => candidate.id === selection.cluster_id,
          );
          return cluster
            ? {
                name: `Photo ${index + 1}`,
                imageUrls: cluster.all_thumbnails_b64,
              }
            : null;
        })
        .filter((person): person is ProcessingPerson => person !== null);

      if (selectedPersons.length < MIN_COMPARE_GROUPS) {
        debugLog("Family compare blocked", {
          selectedPersons: selectedPersons.length,
        });
        throw new Error("We need at least 2 different people to compare. Try adding a few more family photos.");
      }

      setProcessingPersons(selectedPersons);
      setProcessingVariant("family-compare");
      debugLog("Family compare starting", {
        selectedPersons: selectedPersons.length,
      });

      const res = await compareFamilySelection(analysis.session_id, selections);
      debugLog("Family compare complete", {
        persons: res.persons.length,
        pairwise: res.pairwise.length,
      });
      setResult(res);
    } catch (e) {
      debugLog("Family analyze failed", {
        message: e instanceof Error ? e.message : "Unknown error",
      });
      setError(e instanceof Error ? e.message : "Could not analyze the photos");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    debugLog("Reset to upload");
    setResult(null);
    setError(null);
    setProcessingPersons([]);
  };
  const pageHeader = getPageHeader({
    loading,
    result,
    error,
    processingVariant,
  });

  return (
    <div className="relative min-h-screen" style={{ zIndex: 1 }}>
      <div className="mx-auto max-w-[440px] px-5 pb-10 pt-5">
        {/* Ente referral bar */}
        <div className="mb-4 text-center">
          <a
            href="https://ente.com/?utm_source=lookslikeme"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(92,61,46,0.06)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--brown-light)] transition-colors hover:bg-[rgba(92,61,46,0.1)] hover:text-[var(--terracotta)]"
          >
            Made with
            <svg className="h-3.5 w-3.5 text-[var(--terracotta)]" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
            by <strong className="font-semibold">Ente</strong>
          </a>
        </div>

        <header className="mb-8 text-center">
          <div className="mb-5 text-[11px] font-semibold uppercase tracking-[2.5px] text-[var(--terracotta)]">
            {pageHeader.eyebrow}
          </div>
          {pageHeader.titleHtml && (
            <h1 className="theme-editorial text-4xl font-bold text-[var(--text)]">
              {pageHeader.titleHtml}
            </h1>
          )}
          <p className={`mx-auto max-w-xs text-base leading-relaxed text-[var(--text-muted)] ${pageHeader.titleHtml ? "mt-3.5" : "mt-1"}`}>
            {pageHeader.subtitle}
          </p>

        </header>

        {showModelBanner && modelPreloadState && modelPreloadState.status !== "error" && (
          <div className="theme-soft-card mb-5 rounded-[var(--radius)] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[1.8px] text-[var(--text-muted)]">
                  On-device models
                </p>
                <p className="mt-1 text-sm font-medium text-[var(--text)]">
                  {modelPreloadState.progress.stage}
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {formatModelProgressSummary(modelPreloadState)}
                </p>
              </div>

              {modelPreloadState.status === "ready" && (
                <span className="theme-success-pill rounded-full px-3 py-1 text-xs font-semibold">
                  Ready
                </span>
              )}
            </div>

            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[rgba(255,255,255,0.9)]">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  modelPreloadState.status === "ready"
                    ? "bg-[var(--success)]"
                    : "bg-[var(--terracotta)]"
                }`}
                style={{
                  width:
                    modelPreloadState.progress.total_bytes > 0
                      ? `${Math.max(
                          6,
                          Math.min(
                            100,
                            (modelPreloadState.progress.loaded_bytes /
                              modelPreloadState.progress.total_bytes) *
                              100,
                          ),
                        )}%`
                      : "18%",
                }}
              />
            </div>
          </div>
        )}

        {modelPreloadState && modelPreloadState.status === "error" && (
          <div className="mb-5 rounded-[var(--radius-sm)] border border-[rgba(212,96,58,0.28)] bg-[rgba(255,247,240,0.92)] px-4 py-3 text-sm text-[var(--terracotta)]">
            Model preload failed: {modelPreloadState.message}
          </div>
        )}

        {error && (
          <div className="mb-5 rounded-[var(--radius-sm)] border border-[rgba(212,96,58,0.28)] bg-[rgba(255,247,240,0.92)] p-4 text-sm text-[var(--terracotta)]">
            {error}
          </div>
        )}

        {loading ? (
          <ProcessingOverlay
            key={`${processingVariant}:${processingPersons.length}`}
            persons={processingPersons}
            variant={processingVariant}
          />
        ) : result ? (
          <ResultsPanel result={result} onReset={handleReset} />
        ) : (
          <FamilyPhotoForm loading={loading} onAnalyze={handleFamilyAnalyze} onPhotosAdded={startModelPreload} />
        )}

      </div>
    </div>
  );
}

export default App;
