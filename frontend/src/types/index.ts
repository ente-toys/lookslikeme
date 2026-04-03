export interface FeatureScore {
  region: string;
  similarity: number;
  geometric_sim: number;
  visual_sim: number | null;
}

export interface FeatureBreakdown {
  features: FeatureScore[];
  best_matching_feature: string;
  least_matching_feature: string;
}

export interface PairwiseComparison {
  person_a: string;
  person_b: string;
  face_similarity: number | null;
  feature_breakdown: FeatureBreakdown | null;
  person_a_face_thumbnail_b64: string | null;
  person_b_face_thumbnail_b64: string | null;
}

export interface PersonInfo {
  name: string;
  thumbnail_b64: string | null;
  all_thumbnails_b64: string[];
  images_count: number;
  faces_detected: number;
}

export interface ComparisonResult {
  persons: PersonInfo[];
  pairwise: PairwiseComparison[];
  metadata: {
    face_weight: number;
    appearance_weight: number;
    processing_time_seconds: number;
  };
}

export type FamilyClusterHiddenReason =
  | "single_face"
  | "low_confidence";

export interface FamilyClusterCandidate {
  id: string;
  suggested_name: string;
  thumbnail_b64: string | null;
  all_thumbnails_b64: string[];
  face_count: number;
  photo_count: number;
  mean_detector_score: number;
  included_by_default: boolean;
  hidden_reason: FamilyClusterHiddenReason | null;
}

export interface FamilyClusterSelection {
  cluster_id: string;
  name: string;
  included: boolean;
}

export interface FamilyAnalysisResult {
  session_id: string;
  clusters: FamilyClusterCandidate[];
  metadata: {
    uploaded_images_count: number;
    faces_detected: number;
    clusters_detected: number;
    processing_time_seconds: number;
  };
}

export interface ModelPreloadProgress {
  stage: string;
  loaded_bytes: number;
  total_bytes: number;
}
