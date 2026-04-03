import type {
  ComparisonResult,
  FamilyAnalysisResult,
  FamilyClusterSelection,
  ModelPreloadProgress,
} from "../types";
import {
  analyzeFamilyPhotosInBrowser,
  compareFamilyClustersInBrowser,
  getBrowserModelFamily,
  preloadModelsInBrowser,
  setBrowserModelFamily,
} from "./pipeline";

type WorkerFile = {
  name: string;
  type: string;
  bytes: ArrayBuffer;
};

type PreloadModelsMessage = {
  type: "preload-models";
  requestId: string;
};

type ConfigureModelFamilyMessage = {
  type: "configure-model-family";
  modelFamily: "buffalo_l" | "buffalo_s";
};

type AnalyzeFamilyMessage = {
  type: "analyze-family";
  requestId: string;
  files: WorkerFile[];
};

type CompareFamilyClustersMessage = {
  type: "compare-family-clusters";
  requestId: string;
  sessionId: string;
  selections: FamilyClusterSelection[];
};

type WorkerMessage =
  | ConfigureModelFamilyMessage
  | PreloadModelsMessage
  | AnalyzeFamilyMessage
  | CompareFamilyClustersMessage;

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

function postError(requestId: string, error: string) {
  const message: WorkerReply = { type: "error", requestId, error };
  self.postMessage(message);
}

function postPreloadProgress(requestId: string, progress: ModelPreloadProgress) {
  const message: WorkerReply = { type: "preload-progress", requestId, progress };
  self.postMessage(message);
}

self.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
});

self.addEventListener("message", async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  const requestId = "requestId" in message ? message.requestId : null;

  try {
    if (message.type === "configure-model-family") {
      setBrowserModelFamily(message.modelFamily);
      return;
    }

    if (message.type === "preload-models") {
      console.info("[LLU] worker preload using model family", getBrowserModelFamily());
      await preloadModelsInBrowser((progress) => {
        postPreloadProgress(message.requestId, progress);
      });
      const reply: WorkerReply = {
        type: "preload-result",
        requestId: message.requestId,
      };
      self.postMessage(reply);
      return;
    }

    if (message.type === "analyze-family") {
      const result = await analyzeFamilyPhotosInBrowser(message.files);
      const reply: WorkerReply = {
        type: "family-analysis-result",
        requestId: message.requestId,
        result,
      };
      self.postMessage(reply);
      return;
    }

    if (message.type === "compare-family-clusters") {
      const result = await compareFamilyClustersInBrowser(
        message.sessionId,
        message.selections,
      );
      const reply: WorkerReply = {
        type: "compare-result",
        requestId: message.requestId,
        result,
      };
      self.postMessage(reply);
    }
  } catch (error) {
    if (!requestId) {
      return;
    }
    postError(
      requestId,
      error instanceof Error
        ? `${error.message}${error.stack ? `\n${error.stack}` : ""}`
        : "Browser comparison failed",
    );
  }
});
