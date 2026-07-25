/**
 * ctrGeo.ts — Radius-based origin randomization utilities for the CTR module
 *
 * Used by:
 *   - CTR Campaign wizard (GPS spoofing for browser sessions)
 *   - Drive Simulation (origin address randomization)
 *
 * No external API calls — pure math. Reverse geocoding happens server-side
 * when a session is dispatched.
 */

export const RADIUS_OPTIONS = [
  { label: "3 miles",  value: 3 },
  { label: "5 miles",  value: 5 },
  { label: "7 miles",  value: 7 },
  { label: "10 miles", value: 10 },
  { label: "15 miles", value: 15 },
  { label: "20 miles", value: 20 },
] as const;

export type RadiusMiles = 3 | 5 | 7 | 10 | 15 | 20;

/** Degrees per mile (approximate, good enough for US metro areas) */
const MILES_TO_DEG_LAT = 1 / 69.0;
const milesToDegLng = (lat: number) => 1 / (69.0 * Math.cos((lat * Math.PI) / 180));

/**
 * Generate a random lat/lng within `radiusMiles` of `centerLat/centerLng`.
 * Uses uniform distribution across the circle (not just the edge).
 */
export function randomPointInRadius(
  centerLat: number,
  centerLng: number,
  radiusMiles: number
): { lat: number; lng: number } {
  // Uniform distribution: r = radius * sqrt(random) to avoid center clustering
  const r = radiusMiles * Math.sqrt(Math.random());
  const theta = Math.random() * 2 * Math.PI;

  const deltaLat = r * MILES_TO_DEG_LAT * Math.cos(theta);
  const deltaLng = r * milesToDegLng(centerLat) * Math.sin(theta);

  return {
    lat: Math.round((centerLat + deltaLat) * 1_000_000) / 1_000_000,
    lng: Math.round((centerLng + deltaLng) * 1_000_000) / 1_000_000,
  };
}

/**
 * Given a list of ZIP bias targets with weights, pick a ZIP to bias toward.
 * Returns null if no ZIPs are configured (pure radius mode).
 *
 * ZIP weights don't need to sum to 100 — we normalize them.
 * Any remaining weight after ZIPs is "free roam" within the full radius.
 */
export function pickBiasedZip(
  zipTargets: Array<{ zipCode: string; weightPct: number; centerLat?: number | null; centerLng?: number | null; isActive: boolean }>
): { zipCode: string; centerLat: number; centerLng: number } | null {
  const active = zipTargets.filter(z => z.isActive && z.centerLat && z.centerLng);
  if (active.length === 0) return null;

  const totalWeight = active.reduce((sum, z) => sum + z.weightPct, 0);
  if (totalWeight <= 0) return null;

  // Normalize and pick
  const rand = Math.random() * totalWeight;
  let cumulative = 0;
  for (const z of active) {
    cumulative += z.weightPct;
    if (rand <= cumulative) {
      return {
        zipCode: z.zipCode,
        centerLat: z.centerLat!,
        centerLng: z.centerLng!,
      };
    }
  }
  return null;
}

/**
 * Generate a randomized origin point, respecting ZIP bias if configured.
 * - If ZIP bias is active and a ZIP is selected, randomize within a ~1.5-mile
 *   radius of that ZIP's centroid (keeps it within the ZIP boundary).
 * - Otherwise, randomize freely within the campaign's full radius.
 */
export function generateOriginPoint(
  centerLat: number,
  centerLng: number,
  radiusMiles: number,
  zipTargets: Array<{ zipCode: string; weightPct: number; centerLat?: number | null; centerLng?: number | null; isActive: boolean }> = []
): { lat: number; lng: number; sourceZip?: string } {
  const biasedZip = pickBiasedZip(zipTargets);

  if (biasedZip) {
    // Randomize within ~1.5 miles of the ZIP centroid
    const point = randomPointInRadius(biasedZip.centerLat, biasedZip.centerLng, 1.5);
    return { ...point, sourceZip: biasedZip.zipCode };
  }

  // Pure radius mode
  const point = randomPointInRadius(centerLat, centerLng, radiusMiles);
  return point;
}

/**
 * Check if a lat/lng is "too close" to any recently used origin.
 * "Too close" = within 0.1 miles (~528 feet).
 */
export function isTooClose(
  lat: number,
  lng: number,
  usedOrigins: Array<{ lat: number; lng: number }>
): boolean {
  const MIN_DIST_MILES = 0.1;
  return usedOrigins.some(o => {
    const dLat = (lat - o.lat) / MILES_TO_DEG_LAT;
    const dLng = (lng - o.lng) / milesToDegLng(lat);
    const dist = Math.sqrt(dLat * dLat + dLng * dLng);
    return dist < MIN_DIST_MILES;
  });
}

/**
 * Generate a unique origin point, retrying up to 10 times to avoid
 * recently used locations.
 */
export function generateUniqueOrigin(
  centerLat: number,
  centerLng: number,
  radiusMiles: number,
  usedOrigins: Array<{ lat: number; lng: number }>,
  zipTargets: Array<{ zipCode: string; weightPct: number; centerLat?: number | null; centerLng?: number | null; isActive: boolean }> = []
): { lat: number; lng: number; sourceZip?: string } {
  for (let attempt = 0; attempt < 10; attempt++) {
    const point = generateOriginPoint(centerLat, centerLng, radiusMiles, zipTargets);
    if (!isTooClose(point.lat, point.lng, usedOrigins)) {
      return point;
    }
  }
  // After 10 attempts, just return the last one (edge case: very dense used_origins)
  return generateOriginPoint(centerLat, centerLng, radiusMiles, zipTargets);
}
