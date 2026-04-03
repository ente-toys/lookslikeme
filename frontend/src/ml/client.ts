import type {
  ComparisonResult,
  FamilyAnalysisResult,
  FamilyClusterSelection,
  ModelPreloadProgress,
} from "../types";
import {
  analyzeFamilyInBrowserWorker,
  compareFamilyClustersInBrowserWorker,
  preloadModelsInBrowserWorker,
} from "./browserWorker";

export async function analyzeFamilyPhotosLocal(
  files: File[],
): Promise<FamilyAnalysisResult> {
  return analyzeFamilyInBrowserWorker(files);
}

export async function compareReviewedFamilyClustersLocal(
  sessionId: string,
  selections: FamilyClusterSelection[],
): Promise<ComparisonResult> {
  return compareFamilyClustersInBrowserWorker(sessionId, selections);
}

export async function preloadModelsLocal(
  onProgress?: (progress: ModelPreloadProgress) => void,
): Promise<void> {
  return preloadModelsInBrowserWorker(onProgress);
}
