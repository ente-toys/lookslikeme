import type {
  ComparisonResult,
  FamilyAnalysisResult,
  FamilyClusterSelection,
  ModelPreloadProgress,
} from "../types";
import {
  analyzeFamilyPhotosLocal,
  compareReviewedFamilyClustersLocal,
  preloadModelsLocal,
} from "../ml/client";

export async function analyzeFamilyUpload(
  files: File[],
): Promise<FamilyAnalysisResult> {
  return analyzeFamilyPhotosLocal(files);
}

export async function compareFamilySelection(
  sessionId: string,
  selections: FamilyClusterSelection[],
): Promise<ComparisonResult> {
  return compareReviewedFamilyClustersLocal(sessionId, selections);
}

export async function preloadModels(
  onProgress?: (progress: ModelPreloadProgress) => void,
): Promise<void> {
  return preloadModelsLocal(onProgress);
}
