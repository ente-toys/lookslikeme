import type { FeatureBreakdown, FeatureScore } from "../types";

type Point2 = [number, number];
type Point3 = [number, number, number];

const REGIONS = ["eyes", "nose", "mouth", "jawline"] as const;

function dist(a: Point2, b: Point2): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.hypot(dx, dy);
}

function meanPoint(points: Point2[], indices: number[]): Point2 {
  let sumX = 0;
  let sumY = 0;
  for (const index of indices) {
    sumX += points[index][0];
    sumY += points[index][1];
  }
  return [sumX / indices.length, sumY / indices.length];
}

function angle(a: Point2, b: Point2, c: Point2): number {
  const ba: Point2 = [a[0] - b[0], a[1] - b[1]];
  const bc: Point2 = [c[0] - b[0], c[1] - b[1]];
  const dot = ba[0] * bc[0] + ba[1] * bc[1];
  const baNorm = Math.hypot(ba[0], ba[1]);
  const bcNorm = Math.hypot(bc[0], bc[1]);
  const cosAngle = dot / (baNorm * bcNorm + 1e-8);
  return (Math.acos(Math.max(-1, Math.min(1, cosAngle))) * 180) / Math.PI;
}

function eyeRatios(points: Point2[], faceW: number, faceH: number): number[] {
  const rightEyeCenter = meanPoint(points, [36, 37, 38, 39, 40, 41]);
  const leftEyeCenter = meanPoint(points, [42, 43, 44, 45, 46, 47]);

  const interEye = dist(rightEyeCenter, leftEyeCenter);
  const rightEyeWidth = dist(points[36], points[39]);
  const leftEyeWidth = dist(points[42], points[45]);

  const rightEyeHeight = (dist(points[37], points[41]) + dist(points[38], points[40])) / 2;
  const leftEyeHeight = (dist(points[43], points[47]) + dist(points[44], points[46])) / 2;
  const rightOpenness = rightEyeHeight / (rightEyeWidth + 1e-8);
  const leftOpenness = leftEyeHeight / (leftEyeWidth + 1e-8);

  const rightBrowCenter = meanPoint(points, [17, 18, 19, 20, 21]);
  const leftBrowCenter = meanPoint(points, [22, 23, 24, 25, 26]);
  const rightBrowEye = dist(rightBrowCenter, rightEyeCenter);
  const leftBrowEye = dist(leftBrowCenter, leftEyeCenter);

  return [
    interEye / (faceW + 1e-8),
    ((rightEyeWidth + leftEyeWidth) / 2) / (faceW + 1e-8),
    (rightOpenness + leftOpenness) / 2,
    ((rightBrowEye + leftBrowEye) / 2) / (faceH + 1e-8),
  ];
}

function noseRatios(points: Point2[], faceW: number, faceH: number): number[] {
  const noseLength = dist(points[27], points[30]);
  const noseWidth = dist(points[31], points[35]);
  const bridgeWidth = dist(points[27], points[28]);

  return [
    noseLength / (faceH + 1e-8),
    noseWidth / (faceW + 1e-8),
    bridgeWidth / (noseWidth + 1e-8),
  ];
}

function mouthRatios(points: Point2[], faceW: number, faceH: number): number[] {
  const mouthWidth = dist(points[48], points[54]);
  const upperLip = dist(meanPoint(points, [50, 51, 52]), meanPoint(points, [61, 62, 63]));
  const lowerLip = dist(meanPoint(points, [56, 57, 58]), meanPoint(points, [65, 66, 67]));
  const mouthChin = dist(points[57], points[8]);

  return [
    mouthWidth / (faceW + 1e-8),
    (upperLip + lowerLip) / (faceH + 1e-8),
    upperLip / (lowerLip + 1e-8),
    mouthChin / (faceH + 1e-8),
  ];
}

function jawlineRatios(points: Point2[], faceW: number, faceH: number): number[] {
  const jawAngle = angle(points[4], points[8], points[12]);
  const jawMid: Point2 = [(points[4][0] + points[12][0]) / 2, (points[4][1] + points[12][1]) / 2];
  const chinProminence = dist(points[8], jawMid);

  return [
    faceW / (faceH + 1e-8),
    jawAngle / 180,
    chinProminence / (faceH + 1e-8),
  ];
}

function extractGeometricRatios(landmark3d68: Point3[]): Record<(typeof REGIONS)[number], number[]> {
  const points = landmark3d68.map((point) => [point[0], point[1]] as Point2);
  const faceW = dist(points[0], points[16]);
  const faceH = dist(points[27], points[8]);

  return {
    eyes: eyeRatios(points, faceW, faceH),
    nose: noseRatios(points, faceW, faceH),
    mouth: mouthRatios(points, faceW, faceH),
    jawline: jawlineRatios(points, faceW, faceH),
  };
}

function geometricSimilarity(ratiosA: number[], ratiosB: number[]): number {
  let relativeDiffSum = 0;
  for (let index = 0; index < ratiosA.length; index += 1) {
    const diff = Math.abs(ratiosA[index] - ratiosB[index]);
    const meanMagnitude = (Math.abs(ratiosA[index]) + Math.abs(ratiosB[index])) / 2 + 1e-8;
    relativeDiffSum += diff / meanMagnitude;
  }
  const relativeDiff = relativeDiffSum / ratiosA.length;
  return Math.max(0, Math.min(1, Math.exp(-10 * relativeDiff)));
}

function meanVectors(vectors: number[][]): number[] {
  const width = vectors[0]?.length ?? 0;
  const output = new Array<number>(width).fill(0);
  for (const vector of vectors) {
    for (let index = 0; index < width; index += 1) {
      output[index] += vector[index];
    }
  }
  return output.map((value) => value / vectors.length);
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function computeFeatureBreakdown(
  detailsA: Array<{ landmark3d68: Point3[] | null }>,
  detailsB: Array<{ landmark3d68: Point3[] | null }>,
): FeatureBreakdown | null {
  const landmarksA = detailsA.flatMap((detail) => (detail.landmark3d68 ? [detail.landmark3d68] : []));
  const landmarksB = detailsB.flatMap((detail) => (detail.landmark3d68 ? [detail.landmark3d68] : []));

  if (landmarksA.length === 0 || landmarksB.length === 0) {
    return null;
  }

  const ratiosA = landmarksA.map((landmark) => extractGeometricRatios(landmark));
  const ratiosB = landmarksB.map((landmark) => extractGeometricRatios(landmark));

  const meanRatiosA = {
    eyes: meanVectors(ratiosA.map((ratio) => ratio.eyes)),
    nose: meanVectors(ratiosA.map((ratio) => ratio.nose)),
    mouth: meanVectors(ratiosA.map((ratio) => ratio.mouth)),
    jawline: meanVectors(ratiosA.map((ratio) => ratio.jawline)),
  };
  const meanRatiosB = {
    eyes: meanVectors(ratiosB.map((ratio) => ratio.eyes)),
    nose: meanVectors(ratiosB.map((ratio) => ratio.nose)),
    mouth: meanVectors(ratiosB.map((ratio) => ratio.mouth)),
    jawline: meanVectors(ratiosB.map((ratio) => ratio.jawline)),
  };

  const features: FeatureScore[] = REGIONS.map((region) => {
    const similarity = geometricSimilarity(meanRatiosA[region], meanRatiosB[region]);
    return {
      region,
      similarity: round4(similarity),
      geometric_sim: round4(similarity),
      visual_sim: null,
    };
  });

  const bestMatching = features.reduce((best, feature) => (feature.similarity > best.similarity ? feature : best));
  const leastMatching = features.reduce((worst, feature) => (feature.similarity < worst.similarity ? feature : worst));

  return {
    features,
    best_matching_feature: bestMatching.region,
    least_matching_feature: leastMatching.region,
  };
}
