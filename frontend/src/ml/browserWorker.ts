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

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
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
worker.postMessage({
  type: "configure-model-family",
  modelFamily: preferredModelFamily,
} satisfies ConfigureModelFamilyMessage);

(globalThis as typeof globalThis & { __LLU_MODEL_FAMILY__?: string }).__LLU_MODEL_FAMILY__ =
  preferredModelFamily;

function rejectAllPending(error: Error) {
  for (const request of pending.values()) {
    request.reject(error);
  }
  pending.clear();
}

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

async function serializeFiles(files: File[]): Promise<SerializedFile[]> {
  return Promise.all(
    files.map(async (file) => ({
      name: file.name,
      type: file.type,
      bytes: await file.arrayBuffer(),
    })),
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
    worker.postMessage(message, transferList);
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
