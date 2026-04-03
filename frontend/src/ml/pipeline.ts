import * as ort from "onnxruntime-web";

import type {
  ComparisonResult,
  FamilyAnalysisResult,
  FamilyClusterCandidate,
  FamilyClusterHiddenReason,
  FamilyClusterSelection,
  ModelPreloadProgress,
  PairwiseComparison,
  PersonInfo,
} from "../types";
import { createId } from "../utils/createId";
import { computeFeatureBreakdown } from "./featureAnalysis";

const MAX_FAMILY_IMAGES = 9;
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 50_000_000;
const MAX_EDGE_PX = 1920;
const FACE_CONFIDENCE_THRESHOLD = 0.5;
const FAMILY_FACE_CONFIDENCE_THRESHOLD = 0.35;
const MIN_FAMILY_FACE_EDGE_PX = 40;
const MIN_FAMILY_FACE_AREA_RATIO = 0.008;
const FAMILY_CLUSTER_MERGE_THRESHOLD = 0.2;
const FAMILY_CLUSTER_PAIR_FLOOR = 0.05;
const FAMILY_CLUSTER_LOW_CONFIDENCE_THRESHOLD = 0.65;
const MAX_STORED_FAMILY_SESSIONS = 4;
const MOBILE_THUMBNAIL_SIZE = 160;
const DESKTOP_THUMBNAIL_SIZE = 256;

const DETECTOR_INPUT_SIZE = 640;
const RECOGNITION_INPUT_SIZE = 112;
const LANDMARK_INPUT_SIZE = 192;

const MODEL_CACHE_DB_NAME = "copyofyou-browser-ml-cache";
const MODEL_CACHE_STORE = "models";
const MODEL_CACHE_VERSION = 1;

const FACE_CACHE_DB_NAME = "lookslikeme-face-cache";
const FACE_CACHE_STORE = "faces";
const FACE_CACHE_VERSION = 1;
const MODEL_CDN_ROOT = (import.meta.env.VITE_LLU_MODEL_ROOT ?? "https://models.ente.io/lookslikeus").replace(/\/$/, "");
type ModelFamily = "buffalo_l" | "buffalo_s";
type ModelKey = "detector" | "recognition" | "landmark";
type ModelSpec = {
  key: ModelKey;
  label: string;
  url: string;
};

const MODEL_PACKS: Record<
  ModelFamily,
  {
    baseUrl: string;
    cacheNamespace: string;
    detectorFile: string;
    recognitionFile: string;
  }
> = {
  buffalo_l: {
    baseUrl: `${MODEL_CDN_ROOT}/buffalo_l`,
    cacheNamespace: "buffalo_l:v1",
    detectorFile: "det_10g.onnx",
    recognitionFile: "w600k_r50.onnx",
  },
  buffalo_s: {
    baseUrl: `${MODEL_CDN_ROOT}/buffalo_s`,
    cacheNamespace: "buffalo_s:v1",
    detectorFile: "det_500m.onnx",
    recognitionFile: "w600k_mbf.onnx",
  },
};

const ARC_FACE_DESTINATION: Array<[number, number]> = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

const MAGIC_HEADERS = [
  Uint8Array.from([0xff, 0xd8, 0xff]),
  Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
  Uint8Array.from([0x52, 0x49, 0x46, 0x46]),
];

type WorkerFile = {
  name: string;
  type: string;
  bytes: ArrayBuffer;
};

type Point2 = [number, number];
type Point3 = [number, number, number];
type BBox = [number, number, number, number];

type Detection = {
  bbox: BBox;
  score: number;
  kps: [Point2, Point2, Point2, Point2, Point2];
};

type FaceDetail = {
  embedding: Float32Array;
  landmark3d68: Point3[] | null;
  bbox: BBox;
  detScore: number;
  thumbnail: string | null;
};

type ProcessedPerson = {
  info: PersonInfo;
  meanEmbedding: Float32Array | null;
  details: FaceDetail[];
};

type FamilyFaceSample = FaceDetail & {
  id: string;
  photoIndex: number;
};

type FamilyClusterInternal = {
  id: string;
  faces: FamilyFaceSample[];
  meanEmbedding: Float32Array;
};

type ModelPreloadListener = (progress: ModelPreloadProgress) => void;

let ortConfigured = false;
let detectorSessionPromise: Promise<ort.InferenceSession> | null = null;
let recognitionSessionPromise: Promise<ort.InferenceSession> | null = null;
let landmarkSessionPromise: Promise<ort.InferenceSession> | null = null;
let modelsReadyPromise: Promise<void> | null = null;
let modelBuffersPromise: Promise<void> | null = null;
let modelCacheDbPromise: Promise<IDBDatabase | null> | null = null;
let faceCacheDbPromise: Promise<IDBDatabase | null> | null = null;
let inferenceQueue: Promise<unknown> = Promise.resolve();
const anchorCenterCache = new Map<string, Float32Array>();
const familyClusterSessions = new Map<string, FamilyClusterInternal[]>();
const familySessionOrder: string[] = [];
const modelPreloadListeners = new Set<ModelPreloadListener>();
let detectorModelBytes: Uint8Array | null = null;
let recognitionModelBytes: Uint8Array | null = null;
let landmarkModelBytes: Uint8Array | null = null;
let activeModelFamily: ModelFamily = "buffalo_s";
let latestModelPreloadProgress: ModelPreloadProgress = {
  stage: "Waiting to download models",
  loaded_bytes: 0,
  total_bytes: 0,
};

function getActiveModelPack() {
  return MODEL_PACKS[activeModelFamily];
}

function getActiveModelSpecs(): ModelSpec[] {
  const pack = getActiveModelPack();
  return [
    {
      key: "detector",
      label: "Face detector",
      url: `${pack.baseUrl}/${pack.detectorFile}`,
    },
    {
      key: "recognition",
      label: "Face embeddings",
      url: `${pack.baseUrl}/${pack.recognitionFile}`,
    },
    {
      key: "landmark",
      label: "Landmarks",
      url: `${pack.baseUrl}/1k3d68.onnx`,
    },
  ];
}

function resetModelState() {
  detectorSessionPromise = null;
  recognitionSessionPromise = null;
  landmarkSessionPromise = null;
  modelsReadyPromise = null;
  modelBuffersPromise = null;
  detectorModelBytes = null;
  recognitionModelBytes = null;
  landmarkModelBytes = null;
  latestModelPreloadProgress = {
    stage: "Waiting to download models",
    loaded_bytes: 0,
    total_bytes: 0,
  };
}

async function releaseInferenceSessions() {
  const sessions = await Promise.allSettled([
    detectorSessionPromise,
    recognitionSessionPromise,
    landmarkSessionPromise,
  ]);
  for (const result of sessions) {
    if (result.status === "fulfilled" && result.value) {
      try {
        await result.value.release();
      } catch {
        // already released
      }
    }
  }
  detectorSessionPromise = null;
  recognitionSessionPromise = null;
  landmarkSessionPromise = null;
  modelsReadyPromise = null;
  detectorModelBytes = null;
  recognitionModelBytes = null;
  landmarkModelBytes = null;
  anchorCenterCache.clear();
}

export function setBrowserModelFamily(modelFamily: ModelFamily) {
  if (activeModelFamily === modelFamily) {
    return;
  }
  activeModelFamily = modelFamily;
  resetModelState();
}

export function getBrowserModelFamily(): ModelFamily {
  return activeModelFamily;
}

function configureOrt() {
  if (ortConfigured) {
    return;
  }
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.simd = true;
  ortConfigured = true;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

async function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
  const pending = inferenceQueue.catch(() => undefined);
  let release!: () => void;
  inferenceQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await pending;
  try {
    return await operation();
  } finally {
    release();
  }
}

function get2dContext(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!context) {
    throw new Error("Failed to create 2D canvas context");
  }
  return context;
}

function releaseCanvas(canvas: OffscreenCanvas) {
  canvas.width = 0;
  canvas.height = 0;
}

function getThumbnailSize(): number {
  return activeModelFamily === "buffalo_s"
    ? MOBILE_THUMBNAIL_SIZE
    : DESKTOP_THUMBNAIL_SIZE;
}

function emitModelPreloadProgress(stage: string, loadedBytes: number, totalBytes: number) {
  latestModelPreloadProgress = {
    stage,
    loaded_bytes: loadedBytes,
    total_bytes: totalBytes,
  };

  for (const listener of modelPreloadListeners) {
    listener(latestModelPreloadProgress);
  }
}

function addModelPreloadListener(
  onProgress?: (progress: ModelPreloadProgress) => void,
): () => void {
  if (!onProgress) {
    return () => undefined;
  }

  modelPreloadListeners.add(onProgress);
  onProgress(latestModelPreloadProgress);
  return () => {
    modelPreloadListeners.delete(onProgress);
  };
}

function getModelBytesByKey(
  key: ModelKey,
): Uint8Array | null {
  switch (key) {
    case "detector":
      return detectorModelBytes;
    case "recognition":
      return recognitionModelBytes;
    case "landmark":
      return landmarkModelBytes;
  }
}

function getModelCacheKey(key: ModelKey): string {
  return `${getActiveModelPack().cacheNamespace}:${key}`;
}

async function openModelCacheDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") {
    return null;
  }

  modelCacheDbPromise ??= new Promise<IDBDatabase | null>((resolve) => {
    const request = indexedDB.open(MODEL_CACHE_DB_NAME, MODEL_CACHE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(MODEL_CACHE_STORE)) {
        database.createObjectStore(MODEL_CACHE_STORE);
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      resolve(null);
    };

    request.onblocked = () => {
      resolve(null);
    };
  });

  return modelCacheDbPromise;
}

async function readModelBytesFromCache(
  key: ModelKey,
): Promise<Uint8Array | null> {
  const database = await openModelCacheDb();
  if (!database) {
    return null;
  }

  return new Promise<Uint8Array | null>((resolve) => {
    let settled = false;
    const finish = (value: Uint8Array | null) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    const transaction = database.transaction(MODEL_CACHE_STORE, "readonly");
    const request = transaction.objectStore(MODEL_CACHE_STORE).get(getModelCacheKey(key));

    request.onsuccess = () => {
      const result = request.result;
      if (result instanceof ArrayBuffer) {
        finish(new Uint8Array(result));
        return;
      }
      finish(null);
    };

    request.onerror = () => {
      finish(null);
    };

    transaction.onabort = () => {
      finish(null);
    };
  });
}

async function writeModelBytesToCache(
  key: ModelKey,
  value: Uint8Array,
): Promise<void> {
  const database = await openModelCacheDb();
  if (!database) {
    return;
  }

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    const transaction = database.transaction(MODEL_CACHE_STORE, "readwrite");
    transaction.objectStore(MODEL_CACHE_STORE).put(value.slice().buffer, getModelCacheKey(key));
    transaction.oncomplete = finish;
    transaction.onerror = finish;
    transaction.onabort = finish;
  });
}

async function deleteModelBytesFromCache(key: ModelKey): Promise<void> {
  const database = await openModelCacheDb();
  if (!database) {
    return;
  }

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    const transaction = database.transaction(MODEL_CACHE_STORE, "readwrite");
    transaction.objectStore(MODEL_CACHE_STORE).delete(getModelCacheKey(key));
    transaction.oncomplete = finish;
    transaction.onerror = finish;
    transaction.onabort = finish;
  });
}

// ---- Face analysis cache ----

type CachedFace = {
  bbox: BBox;
  detScore: number;
  embedding: ArrayBuffer;
  landmark3d68: Point3[] | null;
  thumbnail: string | null;
};

async function hashFileBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const arr = new Uint8Array(digest);
  let hex = "";
  for (const b of arr) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}

function faceCacheKey(fileHash: string): string {
  return `${activeModelFamily}:${fileHash}`;
}

async function openFaceCacheDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") {
    return null;
  }

  faceCacheDbPromise ??= new Promise<IDBDatabase | null>((resolve) => {
    const request = indexedDB.open(FACE_CACHE_DB_NAME, FACE_CACHE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(FACE_CACHE_STORE)) {
        database.createObjectStore(FACE_CACHE_STORE);
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      resolve(null);
    };

    request.onblocked = () => {
      resolve(null);
    };
  });

  return faceCacheDbPromise;
}

async function readFacesFromCache(
  fileHash: string,
): Promise<CachedFace[] | null> {
  const database = await openFaceCacheDb();
  if (!database) {
    return null;
  }

  return new Promise<CachedFace[] | null>((resolve) => {
    let settled = false;
    const finish = (value: CachedFace[] | null) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    const transaction = database.transaction(FACE_CACHE_STORE, "readonly");
    const request = transaction
      .objectStore(FACE_CACHE_STORE)
      .get(faceCacheKey(fileHash));

    request.onsuccess = () => {
      const result = request.result;
      if (Array.isArray(result)) {
        finish(result as CachedFace[]);
        return;
      }
      finish(null);
    };

    request.onerror = () => {
      finish(null);
    };

    transaction.onabort = () => {
      finish(null);
    };
  });
}

async function writeFacesToCache(
  fileHash: string,
  faces: CachedFace[],
): Promise<void> {
  const database = await openFaceCacheDb();
  if (!database) {
    return;
  }

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    const transaction = database.transaction(FACE_CACHE_STORE, "readwrite");
    transaction
      .objectStore(FACE_CACHE_STORE)
      .put(faces, faceCacheKey(fileHash));
    transaction.oncomplete = finish;
    transaction.onerror = finish;
    transaction.onabort = finish;
  });
}

function setModelBytesByKey(
  key: ModelKey,
  value: Uint8Array,
) {
  switch (key) {
    case "detector":
      detectorModelBytes = value;
      break;
    case "recognition":
      recognitionModelBytes = value;
      break;
    case "landmark":
      landmarkModelBytes = value;
      break;
  }
}

async function readModelResponseBytes(
  response: Response,
  label: string,
  baseLoadedBytes: number,
  totalBytes: number,
): Promise<Uint8Array> {
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    emitModelPreloadProgress(`Downloaded ${label}`, baseLoadedBytes + buffer.byteLength, totalBytes);
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loadedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      chunks.push(value);
      loadedBytes += value.byteLength;
      emitModelPreloadProgress(
        `Downloading ${label}`,
        baseLoadedBytes + loadedBytes,
        totalBytes,
      );
    }
  }

  const buffer = new Uint8Array(loadedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  emitModelPreloadProgress(`Downloaded ${label}`, baseLoadedBytes + loadedBytes, totalBytes);
  return buffer;
}

async function ensureModelBuffers(forceRefresh = false): Promise<void> {
  if (detectorModelBytes && recognitionModelBytes && landmarkModelBytes) {
    return;
  }

  modelBuffersPromise ??= (async () => {
    const specs = getActiveModelSpecs();

    if (!forceRefresh) {
      for (const spec of specs) {
        if (getModelBytesByKey(spec.key)) {
          continue;
        }

        const cachedBytes = await readModelBytesFromCache(spec.key);
        if (cachedBytes) {
          setModelBytesByKey(spec.key, cachedBytes);
        }
      }
    }

    const missingSpecs = specs.filter((spec) => !getModelBytesByKey(spec.key));
    const responses = await Promise.all(
      missingSpecs.map(async (spec) => ({
        spec,
        response: await fetch(spec.url, {
          cache: forceRefresh ? "no-store" : "force-cache",
        }),
      })),
    );
    const responseMap = new Map(responses.map((entry) => [entry.spec.key, entry]));

    for (const { spec, response } of responses) {
      if (!response.ok) {
        throw new Error(`${spec.label} download failed with HTTP ${response.status}`);
      }
    }

    const totalBytes = specs.reduce((sum, spec) => {
      const existingBytes = getModelBytesByKey(spec.key);
      if (existingBytes) {
        return sum + existingBytes.byteLength;
      }

      const response = responseMap.get(spec.key)?.response;
      const header = response?.headers.get("content-length");
      const size = header ? Number.parseInt(header, 10) : 0;
      return sum + (Number.isFinite(size) ? size : 0);
    }, 0);

    let loadedSoFar = 0;
    const cacheWrites: Promise<void>[] = [];

    for (const spec of specs) {
      const existingBytes = getModelBytesByKey(spec.key);
      const responseEntry = responseMap.get(spec.key);

      if (existingBytes && !responseEntry) {
        loadedSoFar += existingBytes.byteLength;
        emitModelPreloadProgress(`Loaded cached ${spec.label}`, loadedSoFar, totalBytes);
        continue;
      }

      if (!responseEntry) {
        throw new Error(`${spec.label} is unavailable for preload`);
      }

      const buffer = await readModelResponseBytes(
        responseEntry.response,
        spec.label,
        loadedSoFar,
        totalBytes,
      );
      setModelBytesByKey(spec.key, buffer);
      loadedSoFar += buffer.byteLength;
      cacheWrites.push(writeModelBytesToCache(spec.key, buffer));
    }

    await Promise.all(cacheWrites);
  })().catch((error) => {
    modelBuffersPromise = null;
    throw error;
  });

  return modelBuffersPromise;
}

function isModelParsingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /protobuf parsing failed/i.test(message);
}

async function clearActiveModelCache(): Promise<void> {
  await Promise.all([
    deleteModelBytesFromCache("detector"),
    deleteModelBytesFromCache("recognition"),
    deleteModelBytesFromCache("landmark"),
  ]);
}

async function getDetectorSession(): Promise<ort.InferenceSession> {
  configureOrt();
  detectorSessionPromise ??= (async () => {
    const modelBytes = detectorModelBytes;
    if (modelBytes) {
      return ort.InferenceSession.create(modelBytes, {
        executionProviders: ["wasm"],
      });
    }
    return ort.InferenceSession.create(getActiveModelSpecs()[0].url, {
      executionProviders: ["wasm"],
    });
  })().catch((error) => {
    detectorSessionPromise = null;
    throw new Error(`detector session init failed: ${error instanceof Error ? error.message : String(error)}`);
  });
  return detectorSessionPromise;
}

async function getRecognitionSession(): Promise<ort.InferenceSession> {
  configureOrt();
  recognitionSessionPromise ??= (async () => {
    const modelBytes = recognitionModelBytes;
    if (modelBytes) {
      return ort.InferenceSession.create(modelBytes, {
        executionProviders: ["wasm"],
      });
    }
    return ort.InferenceSession.create(getActiveModelSpecs()[1].url, {
      executionProviders: ["wasm"],
    });
  })().catch((error) => {
    recognitionSessionPromise = null;
    throw new Error(`recognition session init failed: ${error instanceof Error ? error.message : String(error)}`);
  });
  return recognitionSessionPromise;
}

async function getLandmarkSession(): Promise<ort.InferenceSession> {
  configureOrt();
  landmarkSessionPromise ??= (async () => {
    const modelBytes = landmarkModelBytes;
    if (modelBytes) {
      return ort.InferenceSession.create(modelBytes, {
        executionProviders: ["wasm"],
      });
    }
    return ort.InferenceSession.create(getActiveModelSpecs()[2].url, {
      executionProviders: ["wasm"],
    });
  })().catch((error) => {
    landmarkSessionPromise = null;
    throw new Error(`landmark session init failed: ${error instanceof Error ? error.message : String(error)}`);
  });
  return landmarkSessionPromise;
}

export async function preloadModelsInBrowser(
  onProgress?: (progress: ModelPreloadProgress) => void,
): Promise<void> {
  const removeListener = addModelPreloadListener(onProgress);

  try {
    modelsReadyPromise ??= (async () => {
      try {
        emitModelPreloadProgress("Starting model download", 0, 0);
        await ensureModelBuffers();
        const totalBytes =
          (detectorModelBytes?.byteLength ?? 0) +
          (recognitionModelBytes?.byteLength ?? 0) +
          (landmarkModelBytes?.byteLength ?? 0);
        emitModelPreloadProgress("Initializing models", totalBytes, totalBytes);
        await getDetectorSession();
        await getRecognitionSession();
        await getLandmarkSession();
        emitModelPreloadProgress("Models ready", totalBytes, totalBytes);
      } catch (error) {
        modelsReadyPromise = null;

        if (isModelParsingError(error)) {
          emitModelPreloadProgress("Refreshing model files", 0, 0);
          await clearActiveModelCache();
          resetModelState();
          await ensureModelBuffers(true);
          const totalBytes =
            (detectorModelBytes?.byteLength ?? 0) +
            (recognitionModelBytes?.byteLength ?? 0) +
            (landmarkModelBytes?.byteLength ?? 0);
          emitModelPreloadProgress("Retrying model initialization", totalBytes, totalBytes);
          await getDetectorSession();
          await getRecognitionSession();
          await getLandmarkSession();
          emitModelPreloadProgress("Models ready", totalBytes, totalBytes);
          return;
        }

        throw error;
      }
    })();

    return await modelsReadyPromise;
  } finally {
    removeListener();
  }
}

function hasSupportedMagic(bytes: Uint8Array): boolean {
  return MAGIC_HEADERS.some((magic) => magic.every((value, index) => bytes[index] === value));
}

function inferMimeType(bytes: Uint8Array, fallback: string): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    return "image/png";
  }
  if (bytes[0] === 0x52 && bytes[1] === 0x49) {
    return "image/webp";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "image/jpeg";
  }
  return fallback || "image/jpeg";
}

function validateImageBytes(file: WorkerFile): Uint8Array {
  const bytes = new Uint8Array(file.bytes);
  if (bytes.byteLength > MAX_IMAGE_SIZE_BYTES) {
    throw new Error(
      `Image too large: ${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB (max ${(MAX_IMAGE_SIZE_BYTES / 1024 / 1024).toFixed(0)}MB)`,
    );
  }
  if (!hasSupportedMagic(bytes)) {
    throw new Error(`Invalid image format for ${file.name || "upload"}`);
  }
  return bytes;
}

async function decodeAndResizeImage(file: WorkerFile): Promise<OffscreenCanvas> {
  const bytes = validateImageBytes(file);
  const blob = new Blob([file.bytes], { type: inferMimeType(bytes, file.type) });

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, {
      colorSpaceConversion: "none",
      imageOrientation: "none",
      premultiplyAlpha: "none",
    });
  } catch {
    throw new Error(`Failed to decode image ${file.name || "upload"}`);
  }

  if (bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) {
    bitmap.close();
    throw new Error(`Image too large in pixels for ${file.name || "upload"}`);
  }

  const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.floor(bitmap.width * scale));
  const height = Math.max(1, Math.floor(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = get2dContext(canvas);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas;
}

function canvasToTensor(
  canvas: OffscreenCanvas,
  mean: number,
  std: number,
): ort.Tensor {
  const context = get2dContext(canvas);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixelCount = canvas.width * canvas.height;
  const tensorData = new Float32Array(pixelCount * 3);
  const redOffset = 0;
  const greenOffset = pixelCount;
  const blueOffset = pixelCount * 2;

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const imageOffset = pixel * 4;
    tensorData[redOffset + pixel] = (data[imageOffset] - mean) / std;
    tensorData[greenOffset + pixel] = (data[imageOffset + 1] - mean) / std;
    tensorData[blueOffset + pixel] = (data[imageOffset + 2] - mean) / std;
  }

  return new ort.Tensor("float32", tensorData, [1, 3, canvas.height, canvas.width]);
}

function l2Normalize(values: Float32Array): Float32Array {
  let sumSquares = 0;
  for (const value of values) {
    sumSquares += value * value;
  }
  const norm = Math.sqrt(sumSquares) || 1;
  const normalized = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    normalized[index] = values[index] / norm;
  }
  return normalized;
}

function meanEmbedding(embeddings: Float32Array[]): Float32Array | null {
  if (embeddings.length === 0) {
    return null;
  }
  const output = new Float32Array(embeddings[0].length);
  for (const embedding of embeddings) {
    for (let index = 0; index < embedding.length; index += 1) {
      output[index] += embedding[index];
    }
  }
  for (let index = 0; index < output.length; index += 1) {
    output[index] /= embeddings.length;
  }
  return l2Normalize(output);
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
  }
  return dot;
}

function createDetectionInput(source: OffscreenCanvas): { canvas: OffscreenCanvas; detScale: number } {
  const inputWidth = DETECTOR_INPUT_SIZE;
  const inputHeight = DETECTOR_INPUT_SIZE;
  const imageRatio = source.height / source.width;
  const modelRatio = inputHeight / inputWidth;
  let newWidth: number;
  let newHeight: number;
  if (imageRatio > modelRatio) {
    newHeight = inputHeight;
    newWidth = Math.floor(newHeight / imageRatio);
  } else {
    newWidth = inputWidth;
    newHeight = Math.floor(newWidth * imageRatio);
  }
  const detScale = newHeight / source.height;

  const canvas = new OffscreenCanvas(inputWidth, inputHeight);
  const context = get2dContext(canvas);
  context.fillStyle = "black";
  context.fillRect(0, 0, inputWidth, inputHeight);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, newWidth, newHeight);
  return { canvas, detScale };
}

function getAnchorCenters(height: number, width: number, stride: number, numAnchors: number): Float32Array {
  const cacheKey = `${height}:${width}:${stride}:${numAnchors}`;
  const cached = anchorCenterCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const centers = new Float32Array(height * width * numAnchors * 2);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let anchor = 0; anchor < numAnchors; anchor += 1) {
        centers[offset] = x * stride;
        centers[offset + 1] = y * stride;
        offset += 2;
      }
    }
  }
  anchorCenterCache.set(cacheKey, centers);
  return centers;
}

function nms(detections: Detection[], threshold: number): Detection[] {
  const sorted = [...detections].sort((left, right) => right.score - left.score);
  const kept: Detection[] = [];

  while (sorted.length > 0) {
    const current = sorted.shift()!;
    kept.push(current);
    const [x1, y1, x2, y2] = current.bbox;
    const currentArea = (x2 - x1 + 1) * (y2 - y1 + 1);

    for (let index = sorted.length - 1; index >= 0; index -= 1) {
      const candidate = sorted[index];
      const [cx1, cy1, cx2, cy2] = candidate.bbox;
      const xx1 = Math.max(x1, cx1);
      const yy1 = Math.max(y1, cy1);
      const xx2 = Math.min(x2, cx2);
      const yy2 = Math.min(y2, cy2);
      const width = Math.max(0, xx2 - xx1 + 1);
      const height = Math.max(0, yy2 - yy1 + 1);
      const intersection = width * height;
      const candidateArea = (cx2 - cx1 + 1) * (cy2 - cy1 + 1);
      const overlap = intersection / (currentArea + candidateArea - intersection);
      if (overlap > threshold) {
        sorted.splice(index, 1);
      }
    }
  }

  return kept;
}

async function detectFaces(
  source: OffscreenCanvas,
  minConfidence = FACE_CONFIDENCE_THRESHOLD,
): Promise<Detection[]> {
  const session = await getDetectorSession();
  const { canvas, detScale } = createDetectionInput(source);
  const inputTensor = canvasToTensor(canvas, 127.5, 128.0);
  const outputs = await runExclusive(() => session.run({ [session.inputNames[0]]: inputTensor }));

  const fmc = 3;
  const featStrideFpn = [8, 16, 32];
  const numAnchors = 2;
  const detections: Detection[] = [];

  for (let strideIndex = 0; strideIndex < featStrideFpn.length; strideIndex += 1) {
    const stride = featStrideFpn[strideIndex];
    const scoresTensor = outputs[session.outputNames[strideIndex]];
    const bboxTensor = outputs[session.outputNames[strideIndex + fmc]];
    const kpsTensor = outputs[session.outputNames[strideIndex + fmc * 2]];

    const scores = scoresTensor.data as Float32Array;
    const bboxPreds = bboxTensor.data as Float32Array;
    const kpsPreds = kpsTensor.data as Float32Array;

    const height = Math.floor(DETECTOR_INPUT_SIZE / stride);
    const width = Math.floor(DETECTOR_INPUT_SIZE / stride);
    const anchorCenters = getAnchorCenters(height, width, stride, numAnchors);
    const candidateCount = height * width * numAnchors;

    for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex += 1) {
      const score = scores[candidateIndex];
      if (score < minConfidence) {
        continue;
      }

      const anchorOffset = candidateIndex * 2;
      const bboxOffset = candidateIndex * 4;
      const kpsOffset = candidateIndex * 10;
      const anchorX = anchorCenters[anchorOffset];
      const anchorY = anchorCenters[anchorOffset + 1];

      const x1 = (anchorX - bboxPreds[bboxOffset] * stride) / detScale;
      const y1 = (anchorY - bboxPreds[bboxOffset + 1] * stride) / detScale;
      const x2 = (anchorX + bboxPreds[bboxOffset + 2] * stride) / detScale;
      const y2 = (anchorY + bboxPreds[bboxOffset + 3] * stride) / detScale;

      const kps: [Point2, Point2, Point2, Point2, Point2] = [
        [(anchorX + kpsPreds[kpsOffset] * stride) / detScale, (anchorY + kpsPreds[kpsOffset + 1] * stride) / detScale],
        [(anchorX + kpsPreds[kpsOffset + 2] * stride) / detScale, (anchorY + kpsPreds[kpsOffset + 3] * stride) / detScale],
        [(anchorX + kpsPreds[kpsOffset + 4] * stride) / detScale, (anchorY + kpsPreds[kpsOffset + 5] * stride) / detScale],
        [(anchorX + kpsPreds[kpsOffset + 6] * stride) / detScale, (anchorY + kpsPreds[kpsOffset + 7] * stride) / detScale],
        [(anchorX + kpsPreds[kpsOffset + 8] * stride) / detScale, (anchorY + kpsPreds[kpsOffset + 9] * stride) / detScale],
      ];

      detections.push({
        bbox: [x1, y1, x2, y2],
        score,
        kps,
      });
    }
  }

  return nms(detections, 0.4);
}

function solveLinearSystem4x4(matrix: number[][], vector: number[]): number[] {
  const a = matrix.map((row) => [...row]);
  const b = [...vector];

  for (let pivotIndex = 0; pivotIndex < 4; pivotIndex += 1) {
    let maxRow = pivotIndex;
    for (let row = pivotIndex + 1; row < 4; row += 1) {
      if (Math.abs(a[row][pivotIndex]) > Math.abs(a[maxRow][pivotIndex])) {
        maxRow = row;
      }
    }
    if (maxRow !== pivotIndex) {
      [a[pivotIndex], a[maxRow]] = [a[maxRow], a[pivotIndex]];
      [b[pivotIndex], b[maxRow]] = [b[maxRow], b[pivotIndex]];
    }

    const pivot = a[pivotIndex][pivotIndex];
    if (Math.abs(pivot) < 1e-8) {
      throw new Error("Failed to solve similarity transform");
    }

    for (let column = pivotIndex; column < 4; column += 1) {
      a[pivotIndex][column] /= pivot;
    }
    b[pivotIndex] /= pivot;

    for (let row = 0; row < 4; row += 1) {
      if (row === pivotIndex) {
        continue;
      }
      const factor = a[row][pivotIndex];
      if (factor === 0) {
        continue;
      }
      for (let column = pivotIndex; column < 4; column += 1) {
        a[row][column] -= factor * a[pivotIndex][column];
      }
      b[row] -= factor * b[pivotIndex];
    }
  }

  return b;
}

function estimateSimilarityTransform(source: Point2[], destination: Point2[]): [number, number, number, number, number, number] {
  const normal = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  const target = [0, 0, 0, 0];

  for (let index = 0; index < source.length; index += 1) {
    const [x, y] = source[index];
    const [u, v] = destination[index];
    const row1 = [x, -y, 1, 0];
    const row2 = [y, x, 0, 1];

    for (let row = 0; row < 4; row += 1) {
      target[row] += row1[row] * u + row2[row] * v;
      for (let column = 0; column < 4; column += 1) {
        normal[row][column] += row1[row] * row1[column] + row2[row] * row2[column];
      }
    }
  }

  const [a, b, tx, ty] = solveLinearSystem4x4(normal, target);
  return [a, b, -b, a, tx, ty];
}

function createWarpCanvas(
  source: OffscreenCanvas,
  matrix: [number, number, number, number, number, number],
  width: number,
  height: number,
): OffscreenCanvas {
  const canvas = new OffscreenCanvas(width, height);
  const context = get2dContext(canvas);
  context.fillStyle = "black";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.setTransform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
  context.drawImage(source, 0, 0);
  context.setTransform(1, 0, 0, 1, 0, 0);
  return canvas;
}

function invertAffine(matrix: [number, number, number, number, number, number]): [number, number, number, number, number, number] {
  const [a, b, c, d, e, f] = matrix;
  const determinant = a * d - b * c;
  if (Math.abs(determinant) < 1e-8) {
    throw new Error("Failed to invert affine transform");
  }
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant,
  ];
}

function transformPoints3d(points: Point3[], matrix: [number, number, number, number, number, number]): Point3[] {
  const [a, b, c, d, e, f] = matrix;
  const scale = Math.sqrt(a * a + c * c);
  return points.map((point) => [
    a * point[0] + c * point[1] + e,
    b * point[0] + d * point[1] + f,
    point[2] * scale,
  ]);
}

async function extractEmbedding(source: OffscreenCanvas, detection: Detection): Promise<Float32Array> {
  const session = await getRecognitionSession();
  const matrix = estimateSimilarityTransform(detection.kps, ARC_FACE_DESTINATION);
  const aligned = createWarpCanvas(source, matrix, RECOGNITION_INPUT_SIZE, RECOGNITION_INPUT_SIZE);
  const tensor = canvasToTensor(aligned, 127.5, 127.5);
  const outputs = await runExclusive(() => session.run({ [session.inputNames[0]]: tensor }));
  const output = outputs[session.outputNames[0]].data as Float32Array;
  return l2Normalize(new Float32Array(output));
}

async function extractLandmark3d68(source: OffscreenCanvas, detection: Detection): Promise<Point3[]> {
  const session = await getLandmarkSession();
  const [x1, y1, x2, y2] = detection.bbox;
  const width = x2 - x1;
  const height = y2 - y1;
  const centerX = (x1 + x2) / 2;
  const centerY = (y1 + y2) / 2;
  const scale = LANDMARK_INPUT_SIZE / (Math.max(width, height) * 1.5);
  const matrix: [number, number, number, number, number, number] = [
    scale,
    0,
    0,
    scale,
    LANDMARK_INPUT_SIZE / 2 - centerX * scale,
    LANDMARK_INPUT_SIZE / 2 - centerY * scale,
  ];

  const aligned = createWarpCanvas(source, matrix, LANDMARK_INPUT_SIZE, LANDMARK_INPUT_SIZE);
  const tensor = canvasToTensor(aligned, 0, 1);
  const outputs = await runExclusive(() => session.run({ [session.inputNames[0]]: tensor }));
  const raw = outputs[session.outputNames[0]].data as Float32Array;

  const reshaped: Point3[] = [];
  for (let index = 0; index < raw.length; index += 3) {
    reshaped.push([raw[index], raw[index + 1], raw[index + 2]]);
  }
  const landmarks = reshaped.slice(-68).map((point) => [
    (point[0] + 1) * (LANDMARK_INPUT_SIZE / 2),
    (point[1] + 1) * (LANDMARK_INPUT_SIZE / 2),
    point[2] * (LANDMARK_INPUT_SIZE / 2),
  ] as Point3);

  return transformPoints3d(landmarks, invertAffine(matrix));
}

async function makeFaceThumbnailDataUrl(
  source: OffscreenCanvas,
  bbox: BBox,
): Promise<string> {
  const size = getThumbnailSize();
  const [x1, y1, x2, y2] = bbox;
  const width = Math.max(1, x2 - x1);
  const height = Math.max(1, y2 - y1);
  const centerX = x1 + width / 2;
  const centerY = y1 + height / 2;
  const side = Math.max(
    1,
    Math.min(Math.max(width, height) * 1.4, source.width, source.height),
  );
  const cropX = Math.min(Math.max(0, centerX - side / 2), Math.max(0, source.width - side));
  const cropY = Math.min(Math.max(0, centerY - side / 2), Math.max(0, source.height - side));

  const quality = activeModelFamily === "buffalo_s" ? 0.7 : 0.85;
  const canvas = new OffscreenCanvas(size, size);
  const context = get2dContext(canvas);
  context.fillStyle = "black";
  context.fillRect(0, 0, size, size);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, cropX, cropY, side, side, 0, 0, size, size);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
  releaseCanvas(canvas);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

function distinctPhotoCount(faces: FamilyFaceSample[]): number {
  return new Set(faces.map((face) => face.photoIndex)).size;
}

function evidenceScore(faces: FamilyFaceSample[]): number {
  return faces.length * 2 + distinctPhotoCount(faces);
}

function meanDetectorScore(faces: FamilyFaceSample[]): number {
  return faces.reduce((sum, face) => sum + face.detScore, 0) / faces.length;
}

function isFamilyFaceCandidate(source: OffscreenCanvas, detection: Detection): boolean {
  const width = detection.bbox[2] - detection.bbox[0];
  const height = detection.bbox[3] - detection.bbox[1];
  const area = Math.max(0, width) * Math.max(0, height);
  return (
    Math.min(width, height) >= MIN_FAMILY_FACE_EDGE_PX &&
    area / (source.width * source.height) >= MIN_FAMILY_FACE_AREA_RATIO
  );
}

function averageClusterSimilarity(
  left: FamilyClusterInternal,
  right: FamilyClusterInternal,
): number {
  let total = 0;
  let count = 0;
  for (const leftFace of left.faces) {
    for (const rightFace of right.faces) {
      total += cosineSimilarity(leftFace.embedding, rightFace.embedding);
      count += 1;
    }
  }
  return count > 0 ? total / count : -1;
}

function violatesClusterGuardrail(
  left: FamilyClusterInternal,
  right: FamilyClusterInternal,
): boolean {
  const leftPhotoIndexes = new Set(left.faces.map((face) => face.photoIndex));
  for (const rightFace of right.faces) {
    // A person cannot appear as two separate faces in the same family photo.
    if (leftPhotoIndexes.has(rightFace.photoIndex)) {
      return true;
    }
  }

  if (left.faces.length < 2 && right.faces.length < 2) {
    return false;
  }

  for (const leftFace of left.faces) {
    for (const rightFace of right.faces) {
      if (cosineSimilarity(leftFace.embedding, rightFace.embedding) < FAMILY_CLUSTER_PAIR_FLOOR) {
        return true;
      }
    }
  }

  return false;
}

function clusterFamilyFaces(faces: FamilyFaceSample[]): FamilyClusterInternal[] {
  let nextClusterId = 1;
  const clusters: FamilyClusterInternal[] = faces.map((face) => ({
    id: `cluster_${nextClusterId++}`,
    faces: [face],
    meanEmbedding: face.embedding,
  }));

  while (clusters.length > 1) {
    let bestLeft = -1;
    let bestRight = -1;
    let bestScore = -Infinity;

    for (let leftIndex = 0; leftIndex < clusters.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < clusters.length; rightIndex += 1) {
        const left = clusters[leftIndex];
        const right = clusters[rightIndex];
        if (violatesClusterGuardrail(left, right)) {
          continue;
        }

        const score = averageClusterSimilarity(left, right);
        if (score >= FAMILY_CLUSTER_MERGE_THRESHOLD && score > bestScore) {
          bestScore = score;
          bestLeft = leftIndex;
          bestRight = rightIndex;
        }
      }
    }

    if (bestLeft === -1 || bestRight === -1) {
      break;
    }

    const mergedFaces = [...clusters[bestLeft].faces, ...clusters[bestRight].faces];
    const mergedEmbedding = meanEmbedding(mergedFaces.map((face) => face.embedding));
    clusters.splice(bestRight, 1);
    clusters.splice(bestLeft, 1, {
      id: `cluster_${nextClusterId++}`,
      faces: mergedFaces,
      meanEmbedding: mergedEmbedding ?? mergedFaces[0].embedding,
    });
  }

  return clusters.sort((left, right) => {
    const evidenceDelta = evidenceScore(right.faces) - evidenceScore(left.faces);
    if (evidenceDelta !== 0) {
      return evidenceDelta;
    }

    const photoDelta = distinctPhotoCount(right.faces) - distinctPhotoCount(left.faces);
    if (photoDelta !== 0) {
      return photoDelta;
    }

    return right.faces.length - left.faces.length;
  });
}

function pickRepresentativeThumbnails(faces: FamilyFaceSample[]): string[] {
  const sorted = [...faces].sort((left, right) => right.detScore - left.detScore);
  const seenPhotos = new Set<number>();
  const thumbnails: string[] = [];

  for (const face of sorted) {
    if (seenPhotos.has(face.photoIndex)) {
      continue;
    }
    if (!face.thumbnail) {
      continue;
    }
    seenPhotos.add(face.photoIndex);
    thumbnails.push(face.thumbnail);
    if (thumbnails.length === 3) {
      return thumbnails;
    }
  }

  for (const face of sorted) {
    if (!face.thumbnail) {
      continue;
    }
    if (thumbnails.includes(face.thumbnail)) {
      continue;
    }
    thumbnails.push(face.thumbnail);
    if (thumbnails.length === 3) {
      break;
    }
  }

  return thumbnails;
}

function hiddenReasonForCluster(cluster: FamilyClusterInternal): FamilyClusterHiddenReason | null {
  if (cluster.faces.length === 1) {
    return "single_face";
  }
  if (meanDetectorScore(cluster.faces) < FAMILY_CLUSTER_LOW_CONFIDENCE_THRESHOLD) {
    return "low_confidence";
  }
  return null;
}

function storeFamilyClusterSession(
  sessionId: string,
  clusters: FamilyClusterInternal[],
) {
  familyClusterSessions.set(sessionId, clusters);
  familySessionOrder.push(sessionId);

  while (familySessionOrder.length > MAX_STORED_FAMILY_SESSIONS) {
    const oldestSessionId = familySessionOrder.shift();
    if (oldestSessionId) {
      familyClusterSessions.delete(oldestSessionId);
    }
  }
}

function buildFamilyClusterCandidate(
  cluster: FamilyClusterInternal,
  includedByDefault: boolean,
  hiddenReason: FamilyClusterHiddenReason | null,
): FamilyClusterCandidate {
  const thumbnails = pickRepresentativeThumbnails(cluster.faces);
  return {
    id: cluster.id,
    suggested_name: "",
    thumbnail_b64: thumbnails[0] ?? null,
    all_thumbnails_b64: thumbnails,
    face_count: cluster.faces.length,
    photo_count: distinctPhotoCount(cluster.faces),
    mean_detector_score: round4(meanDetectorScore(cluster.faces)),
    included_by_default: includedByDefault,
    hidden_reason: hiddenReason,
  };
}

function buildProcessedPersonFromCluster(
  cluster: FamilyClusterInternal,
  name: string,
): ProcessedPerson {
  const thumbnails = pickRepresentativeThumbnails(cluster.faces);
  return {
    info: {
      name,
      thumbnail_b64: thumbnails[0] ?? null,
      all_thumbnails_b64: thumbnails,
      images_count: distinctPhotoCount(cluster.faces),
      faces_detected: cluster.faces.length,
    },
    meanEmbedding: cluster.meanEmbedding,
    details: cluster.faces,
  };
}

function findClosestFacePair(
  left: FaceDetail[],
  right: FaceDetail[],
): { leftFace: FaceDetail | null; rightFace: FaceDetail | null } {
  let bestLeft: FaceDetail | null = null;
  let bestRight: FaceDetail | null = null;
  let bestScore = -Infinity;

  for (const leftFace of left) {
    for (const rightFace of right) {
      const score = cosineSimilarity(leftFace.embedding, rightFace.embedding);
      if (score > bestScore) {
        bestScore = score;
        bestLeft = leftFace;
        bestRight = rightFace;
      }
    }
  }

  return {
    leftFace: bestLeft,
    rightFace: bestRight,
  };
}

function buildComparisonResult(
  processedPersons: ProcessedPerson[],
  startTime: number,
): ComparisonResult {
  const pairwise: PairwiseComparison[] = [];

  for (let first = 0; first < processedPersons.length; first += 1) {
    for (let second = first + 1; second < processedPersons.length; second += 1) {
      const left = processedPersons[first];
      const right = processedPersons[second];
      const closestPair = findClosestFacePair(left.details, right.details);
      let faceSimilarity: number | null = null;
      if (left.meanEmbedding && right.meanEmbedding) {
        faceSimilarity = round4(cosineSimilarity(left.meanEmbedding, right.meanEmbedding));
      }

      pairwise.push({
        person_a: left.info.name,
        person_b: right.info.name,
        face_similarity: faceSimilarity,
        feature_breakdown: computeFeatureBreakdown(left.details, right.details),
        person_a_face_thumbnail_b64:
          closestPair.leftFace?.thumbnail ?? left.info.thumbnail_b64,
        person_b_face_thumbnail_b64:
          closestPair.rightFace?.thumbnail ?? right.info.thumbnail_b64,
      });
    }
  }

  return {
    persons: processedPersons.map((person) => person.info),
    pairwise,
    metadata: {
      face_weight: 1.0,
      appearance_weight: 0.0,
      processing_time_seconds: round2((performance.now() - startTime) / 1000),
    },
  };
}

export async function analyzeFamilyPhotosInBrowser(
  files: WorkerFile[],
): Promise<FamilyAnalysisResult> {
  if (files.length === 0) {
    throw new Error("Add at least 1 photo");
  }
  if (files.length > MAX_FAMILY_IMAGES) {
    throw new Error(`You can add up to ${MAX_FAMILY_IMAGES} photos`);
  }

  const start = performance.now();
  const faces: FamilyFaceSample[] = [];
  let needsInference = false;

  // Hash all files upfront and check cache
  const fileHashes: string[] = [];
  const cachedResults: (CachedFace[] | null)[] = [];
  for (const file of files) {
    const hash = await hashFileBytes(file.bytes);
    fileHashes.push(hash);
    cachedResults.push(await readFacesFromCache(hash));
  }

  needsInference = cachedResults.some((cached) => cached === null);
  if (needsInference) {
    await preloadModelsInBrowser();
  }

  for (let photoIndex = 0; photoIndex < files.length; photoIndex += 1) {
    const cached = cachedResults[photoIndex];

    if (cached) {
      for (let faceIndex = 0; faceIndex < cached.length; faceIndex += 1) {
        const cf = cached[faceIndex];
        faces.push({
          id: `face_${photoIndex}_${faceIndex}`,
          photoIndex,
          embedding: new Float32Array(cf.embedding),
          landmark3d68: cf.landmark3d68,
          bbox: cf.bbox,
          detScore: cf.detScore,
          thumbnail: cf.thumbnail,
        });
      }
      continue;
    }

    const image = await decodeAndResizeImage(files[photoIndex]);
    const detections = await detectFaces(image, FAMILY_FACE_CONFIDENCE_THRESHOLD);
    const photoFaces: CachedFace[] = [];
    let faceIndex = 0;

    for (const detection of detections) {
      if (!isFamilyFaceCandidate(image, detection)) {
        continue;
      }

      const embedding = await extractEmbedding(image, detection);
      const landmark3d68 = await extractLandmark3d68(image, detection);
      const thumbnail = await makeFaceThumbnailDataUrl(image, detection.bbox);
      faces.push({
        id: `face_${photoIndex}_${faceIndex}`,
        photoIndex,
        thumbnail,
        embedding,
        landmark3d68,
        bbox: detection.bbox,
        detScore: detection.score,
      });
      photoFaces.push({
        bbox: detection.bbox,
        detScore: detection.score,
        embedding: embedding.buffer.slice(0) as ArrayBuffer,
        landmark3d68,
        thumbnail,
      });
      faceIndex += 1;
    }

    releaseCanvas(image);
    writeFacesToCache(fileHashes[photoIndex], photoFaces);
  }

  if (needsInference) {
    await releaseInferenceSessions();
  }

  if (faces.length === 0) {
    throw new Error("No usable faces found in the uploaded photos");
  }

  const clusters = clusterFamilyFaces(faces);
  const sessionId = createId();
  storeFamilyClusterSession(sessionId, clusters);

  const clusterCandidates = clusters.map((cluster) => {
    const hiddenReason = hiddenReasonForCluster(cluster);
    const includedByDefault =
      !(cluster.faces.length === 1 && clusters.length >= 3);
    return buildFamilyClusterCandidate(cluster, includedByDefault, hiddenReason);
  });

  return {
    session_id: sessionId,
    clusters: clusterCandidates,
    metadata: {
      uploaded_images_count: files.length,
      faces_detected: faces.length,
      clusters_detected: clusters.length,
      processing_time_seconds: round2((performance.now() - start) / 1000),
    },
  };
}

export async function compareFamilyClustersInBrowser(
  sessionId: string,
  selections: FamilyClusterSelection[],
): Promise<ComparisonResult> {
  const clusters = familyClusterSessions.get(sessionId);
  if (!clusters) {
    throw new Error("Review expired. Please analyze the photos again.");
  }

  const selectedClusters: ProcessedPerson[] = [];
  for (const selection of selections) {
    if (!selection.included) {
      continue;
    }

    const cluster = clusters.find((candidate) => candidate.id === selection.cluster_id);
    if (!cluster) {
      throw new Error("A selected face group is no longer available.");
    }

    const name = selection.name.trim() || `cluster-${selectedClusters.length + 1}`;
    selectedClusters.push(buildProcessedPersonFromCluster(cluster, name));
  }

  if (selectedClusters.length < 2) {
    throw new Error("Select at least 2 face groups before comparing.");
  }

  const start = performance.now();
  return buildComparisonResult(selectedClusters, start);
}
