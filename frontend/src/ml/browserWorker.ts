import type {
  ComparisonResult,
  FamilyAnalysisResult,
  FamilyClusterSelection,
  ModelPreloadProgress,
} from "../types";
import { createId } from "../utils/createId";

type SerializedFile = {
  name: string;
  type: string;
  bytes: ArrayBuffer;
};

type AnalyzeFamilyMessage = {
  type: "analyze-family";
  requestId: string;
  files: SerializedFile[];
};

type CompareFamilyClustersMessage = {
  type: "compare-family-clusters";
  requestId: string;
  sessionId: string;
  selections: FamilyClusterSelection[];
};

type PreloadModelsMessage = {
  type: "preload-models";
  requestId: string;
};

type ConfigureModelFamilyMessage = {
  type: "configure-model-family";
  modelFamily: "buffalo_l" | "buffalo_s";
};

type WorkerMessage =
  | ConfigureModelFamilyMessage
  | PreloadModelsMessage
  | AnalyzeFamilyMessage
  | CompareFamilyClustersMessage;

type RequestMessage = Exclude<WorkerMessage, ConfigureModelFamilyMessage>;

type WorkerReply =
  | {
      type: "preload-progress";
      requestId: string;
      progress: ModelPreloadProgress;
    }
  | {
      type: "preload-result";
      requestId: string;
    }
  | {
      type: "compare-result";
      requestId: string;
      result: ComparisonResult;
    }
  | {
      type: "family-analysis-result";
      requestId: string;
      result: FamilyAnalysisResult;
    }
  | {
      type: "error";
      requestId: string;
      error: string;
    };

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: ModelPreloadProgress) => void;
};

let worker: Worker | null = null;
const pending = new Map<string, PendingRequest>();

function isMobileDevice(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(max-width: 768px), (pointer: coarse)").matches;
}

function getPreferredModelFamily(): "buffalo_l" | "buffalo_s" {
  if (typeof window === "undefined") {
    return "buffalo_l";
  }

  const mobile = isMobileDevice();

  // Always use the small model on mobile regardless of overrides
  if (mobile) {
    return "buffalo_s";
  }

  const params = new URLSearchParams(window.location.search);
  const queryValue = params.get("model");
  if (queryValue === "buffalo_l" || queryValue === "buffalo_s") {
    window.localStorage.setItem("llu:model-family", queryValue);
    return queryValue;
  }

  const storedValue = window.localStorage.getItem("llu:model-family");
  if (storedValue === "buffalo_l" || storedValue === "buffalo_s") {
    return storedValue;
  }

  return "buffalo_l";
}

const preferredModelFamily = getPreferredModelFamily();
(globalThis as typeof globalThis & { __LLU_MODEL_FAMILY__?: string }).__LLU_MODEL_FAMILY__ =
  preferredModelFamily;

function rejectAllPending(error: Error) {
  for (const request of pending.values()) {
    request.reject(error);
  }
  pending.clear();
}

function getWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });

  worker.addEventListener("message", (event: MessageEvent<WorkerReply>) => {
    const message = event.data;
    const request = pending.get(message.requestId);
    if (!request) {
      return;
    }

    if (message.type === "preload-progress") {
      request.onProgress?.(message.progress);
      return;
    }

    pending.delete(message.requestId);
    if (message.type === "compare-result" || message.type === "family-analysis-result") {
      request.resolve(message.result);
      return;
    }

    if (message.type === "preload-result") {
      request.resolve(undefined);
      return;
    }

    request.reject(new Error(message.error));
  });

  worker.addEventListener("error", (event) => {
    rejectAllPending(new Error(event.message || "Browser ML worker crashed"));
  });

  worker.addEventListener("messageerror", () => {
    rejectAllPending(new Error("Browser ML worker could not deserialize a message"));
  });

  worker.postMessage({
    type: "configure-model-family",
    modelFamily: preferredModelFamily,
  } satisfies ConfigureModelFamilyMessage);

  return worker;
}

function isHeicFile(file: File): boolean {
  if (file.type === "image/heic" || file.type === "image/heif") return true;
  const name = file.name.toLowerCase();
  return name.endsWith(".heic") || name.endsWith(".heif");
}

async function convertHeicToJpeg(file: File): Promise<File> {
  const heic2any = (await import("heic2any")).default;
  const result = await heic2any({
    blob: file,
    toType: "image/jpeg",
    quality: 0.9,
  });
  const jpegBlob = Array.isArray(result) ? result[0] : result;
  const jpegName = file.name.replace(/\.heic$/i, ".jpg").replace(/\.heif$/i, ".jpg");
  return new File([jpegBlob], jpegName, { type: "image/jpeg" });
}

async function serializeFiles(files: File[]): Promise<SerializedFile[]> {
  return Promise.all(
    files.map(async (file) => {
      let resolved = file;
      if (isHeicFile(file)) {
        try {
          resolved = await convertHeicToJpeg(file);
        } catch {
          throw new Error(
            `Failed to convert ${file.name} from HEIC. Try converting it to JPEG first.`,
          );
        }
      }
      return {
        name: resolved.name,
        type: resolved.type,
        bytes: await resolved.arrayBuffer(),
      };
    }),
  );
}

function postWorkerMessage<T>(
  message: RequestMessage,
  transferList: Transferable[] = [],
  onProgress?: (progress: ModelPreloadProgress) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pending.set(message.requestId, {
      resolve: (result) => resolve(result as T),
      reject,
      onProgress,
    });
    getWorker().postMessage(message, transferList);
  });
}

export async function preloadModelsInBrowserWorker(
  onProgress?: (progress: ModelPreloadProgress) => void,
): Promise<void> {
  return postWorkerMessage<void>(
    {
      type: "preload-models",
      requestId: createId(),
    },
    [],
    onProgress,
  );
}

export async function analyzeFamilyInBrowserWorker(
  files: File[],
): Promise<FamilyAnalysisResult> {
  const requestId = createId();
  const payloadFiles = await serializeFiles(files);
  const message: AnalyzeFamilyMessage = {
    type: "analyze-family",
    requestId,
    files: payloadFiles,
  };
  const transferList = payloadFiles.map((file) => file.bytes);
  return postWorkerMessage<FamilyAnalysisResult>(message, transferList);
}

export async function compareFamilyClustersInBrowserWorker(
  sessionId: string,
  selections: FamilyClusterSelection[],
): Promise<ComparisonResult> {
  return postWorkerMessage<ComparisonResult>({
    type: "compare-family-clusters",
    requestId: createId(),
    sessionId,
    selections,
  });
}
