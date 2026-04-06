import { useCallback, useEffect, useRef, useState } from "react";
import { FamilyPhotoForm } from "./components/FamilyPhotoForm";
import { ResultsPanel } from "./components/ResultsPanel";
import {
  ProcessingOverlay,
  type ProcessingOverlayVariant,
  type ProcessingPerson,
} from "./components/ProcessingOverlay";
import { Privacy } from "./components/Privacy";
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
            href="https://ente.com"
            target="_blank"
            rel="noopener"
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
          <FamilyPhotoForm loading={loading} modelPreloadState={modelPreloadState} onAnalyze={handleFamilyAnalyze} onPhotosAdded={startModelPreload} />
        )}

        {/* Footer */}
        <footer className="mt-10 space-y-4 text-center">
          <a
            href="https://github.com/ente-toys/lookslikeme"
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--terracotta)]"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            Open source on GitHub
          </a>

          <div>
            <a
              href="https://ente.io"
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(92,61,46,0.05)] px-4 py-2 text-xs font-medium text-[var(--brown-light)] transition-colors hover:bg-[rgba(92,61,46,0.1)] hover:text-[var(--terracotta)]"
            >
              Your family photos, safe forever &mdash;
              <strong className="font-semibold">Ente Photos</strong>
            </a>
          </div>

          <Privacy />

          <p className="text-[10px] text-neutral-400">v{__APP_VERSION__}</p>
        </footer>
      </div>
    </div>
  );
}

export default App;
