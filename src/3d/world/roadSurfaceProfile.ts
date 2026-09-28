/** Production TypeScript owner for src/3d/world/roadSurfaceProfile.js; legacy JS path remains compatibility-only. *//**
 * Dense, deterministic road-surface profiling utilities.
 *
 * Road routing works on a coarser search grid for performance, while the rendered road ultimately
 * follows the continuous terrain sampler. A narrow ridge or drainage cut can therefore live between
 * two legal grid nodes. This module closes that scale gap by sampling every candidate segment at a
 * bounded world-space interval before the route is accepted.
 *
 * It is deliberately geography-neutral: it never changes height, water, road topology, settlements,
 * or colliders. It only measures the same sampler the runtime already owns.
 */

export const ROAD_PROFILE_POLICY = Object.freeze({
  id: 'road-surface-profile-2026-08-27-v3-phase-robust-subedge-grade',
  maxSampleSpacingMeters: 4,
  presentationSampleSpacingMeters: 6,
  epsilonMeters: 1e-6,
  deterministic: true,
  geographyAuthorityUnchanged: true,
  heightAuthority: 'world/terrain.ts',
});

const EPSILON = ROAD_PROFILE_POLICY.epsilonMeters;

export interface RoadPoint {
  readonly x: number;
  readonly z: number;
  readonly y: number;
}

export interface RoadInputPoint {
  readonly x: number;
  readonly z: number;
  readonly y?: number;
}

export type TerrainSampler = (x: number, z: number) => number;

export interface TerrainSegmentProfile {
  readonly horizontalMeters: number;
  readonly subsegmentCount: number;
  readonly sampleCount: number;
  readonly maxSpacingMeters: number;
  readonly startHeightMeters: number;
  readonly endHeightMeters: number;
  readonly directGradeDegrees: number;
  readonly maxGradeDegrees: number;
  readonly maxRiseMeters: number;
  readonly totalAscentMeters: number;
  readonly totalDescentMeters: number;
  readonly minHeightMeters: number;
  readonly maxHeightMeters: number;
  readonly meanHeightMeters: number;
  readonly meanGradeDegrees: number;
  readonly rmsStepDeltaMeters: number;
  readonly elevationRangeMeters: number;
  readonly samples: readonly TerrainProfileSample[];
}

export interface TerrainProfileSample {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly t: number;
}

export interface RoadProfile {
  readonly points: readonly RoadPoint[];
  readonly sourcePointCount: number;
  readonly densifiedPointCount: number;
  readonly segmentCount: number;
  readonly sampledSubsegments?: number;
  readonly lengthMeters: number;
  readonly maxGradeDegrees: number;
  readonly meanGradeDegrees: number;
  readonly totalAscentMeters: number;
  readonly totalDescentMeters: number;
  readonly maxRiseMeters: number;
  readonly elevationRangeMeters: number;
  readonly roughnessRmsMeters: number;
}



function finiteNumber(value: unknown, label: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function finitePoint(point: unknown, label: string): { x: number; z: number } {
  if (!point || typeof point !== 'object') throw new TypeError(`${label} must be a point`);
  const candidate = point as { readonly x?: unknown; readonly z?: unknown };
  return {
    x: finiteNumber(candidate.x, `${label}.x`),
    z: finiteNumber(candidate.z, `${label}.z`),
  };
}

export function gradeDegrees(riseMeters: number, horizontalMeters: number): number {
  const rise = Math.abs(finiteNumber(riseMeters, 'riseMeters'));
  const horizontal = finiteNumber(horizontalMeters, 'horizontalMeters');
  if (horizontal < 0) throw new RangeError('horizontalMeters must be >= 0');
  if (horizontal <= EPSILON) return rise <= EPSILON ? 0 : 90;
  return (Math.atan2(rise, horizontal) * 180) / Math.PI;
}

export function segmentSampleCount(horizontalMeters: number, maxSpacingMeters = ROAD_PROFILE_POLICY.maxSampleSpacingMeters): number {
  const horizontal = finiteNumber(horizontalMeters, 'horizontalMeters');
  const spacing = finiteNumber(maxSpacingMeters, 'maxSpacingMeters');
  if (horizontal < 0) throw new RangeError('horizontalMeters must be >= 0');
  if (!(spacing > 0)) throw new RangeError('maxSpacingMeters must be > 0');
  return Math.max(1, Math.ceil(horizontal / spacing));
}

/**
 * Densely samples one XZ segment on the exact terrain sampler.
 * The two endpoints are always included; `subsegmentCount` controls how many intervals exist.
 */
export function profileTerrainSegment({
  start,
  end,
  sampleHeightMeters,
  maxSpacingMeters = ROAD_PROFILE_POLICY.maxSampleSpacingMeters,
}: {
  readonly start: RoadInputPoint;
  readonly end: RoadInputPoint;
  readonly sampleHeightMeters: TerrainSampler;
  readonly maxSpacingMeters?: number;
}): TerrainSegmentProfile {
  if (typeof sampleHeightMeters !== 'function') throw new TypeError('sampleHeightMeters must be a function');
  const a = finitePoint(start, 'start');
  const b = finitePoint(end, 'end');
  const horizontalMeters = Math.hypot(b.x - a.x, b.z - a.z);
  const subsegmentCount = segmentSampleCount(horizontalMeters, maxSpacingMeters);
  const samples: TerrainProfileSample[] = new Array(subsegmentCount + 1);

  let previousHeight = 0;
  let maxGradeDegrees = 0;
  let maxRiseMeters = 0;
  let totalAscentMeters = 0;
  let totalDescentMeters = 0;
  let minHeightMeters = Infinity;
  let maxHeightMeters = -Infinity;
  let sumHeightMeters = 0;
  let sumSquaredDeltaMeters = 0;
  let gradeAccumulator = 0;

  for (let index = 0; index <= subsegmentCount; index += 1) {
    const t = subsegmentCount === 0 ? 0 : index / subsegmentCount;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    const y = finiteNumber(sampleHeightMeters(x, z), 'sampleHeightMeters result');
    samples[index] = { x, z, y, t };
    minHeightMeters = Math.min(minHeightMeters, y);
    maxHeightMeters = Math.max(maxHeightMeters, y);
    sumHeightMeters += y;

    if (index > 0) {
      const previous = samples[index - 1]!;
      const localHorizontal = Math.hypot(x - previous.x, z - previous.z);
      const signedDelta = y - previousHeight;
      const localGrade = gradeDegrees(signedDelta, localHorizontal);
      maxGradeDegrees = Math.max(maxGradeDegrees, localGrade);
      maxRiseMeters = Math.max(maxRiseMeters, Math.abs(signedDelta));
      if (signedDelta > 0) totalAscentMeters += signedDelta;
      else totalDescentMeters += -signedDelta;
      sumSquaredDeltaMeters += signedDelta * signedDelta;
      gradeAccumulator += localGrade;
    }
    previousHeight = y;
  }

  const startHeightMeters = samples[0]!.y;
  const endHeightMeters = samples.at(-1)!.y;
  const directGradeDegrees = gradeDegrees(endHeightMeters - startHeightMeters, horizontalMeters);
  const meanHeightMeters = sumHeightMeters / samples.length;
  const meanGradeDegrees = subsegmentCount > 0 ? gradeAccumulator / subsegmentCount : 0;
  const rmsStepDeltaMeters = subsegmentCount > 0
    ? Math.sqrt(sumSquaredDeltaMeters / subsegmentCount)
    : 0;

  return Object.freeze({
    horizontalMeters,
    subsegmentCount,
    sampleCount: samples.length,
    maxSpacingMeters: horizontalMeters / subsegmentCount,
    startHeightMeters,
    endHeightMeters,
    directGradeDegrees,
    maxGradeDegrees,
    maxRiseMeters,
    totalAscentMeters,
    totalDescentMeters,
    minHeightMeters,
    maxHeightMeters,
    meanHeightMeters,
    meanGradeDegrees,
    rmsStepDeltaMeters,
    elevationRangeMeters: maxHeightMeters - minHeightMeters,
    samples,
  });
}

function normalizedInputPoint(point: RoadInputPoint, sampleHeightMeters: TerrainSampler, label: string): RoadPoint {
  const p = finitePoint(point, label);
  const y = typeof point.y === 'number' && Number.isFinite(point.y) ? point.y : sampleHeightMeters(p.x, p.z);
  return { x: p.x, z: p.z, y: finiteNumber(y, `${label}.y`) };
}

function complementaryProfileSpacing(maxSpacingMeters: number): number {
  const primary = finiteNumber(maxSpacingMeters, 'maxSpacingMeters');
  const presentation = ROAD_PROFILE_POLICY.presentationSampleSpacingMeters;
  const search = ROAD_PROFILE_POLICY.maxSampleSpacingMeters;
  return Math.abs(primary - presentation) <= EPSILON ? search : presentation;
}

/**
 * Profiles a whole polyline and returns a densified copy suitable for final route validation.
 *
 * Max grade is audited at both the 6 m presentation spacing and the independent 4 m search spacing.
 * The denser search lattice makes A* candidate-edge acceptance stricter than final presentation,
 * while the complementary 6 m audit keeps a different sampling phase in the returned-route proof.
 */
export function profileRoadPolyline({
  points,
  sampleHeightMeters,
  maxSpacingMeters = ROAD_PROFILE_POLICY.presentationSampleSpacingMeters,
}: {
  readonly points: readonly RoadInputPoint[];
  readonly sampleHeightMeters: TerrainSampler;
  readonly maxSpacingMeters?: number;
}): RoadProfile {
  if (!Array.isArray(points) || points.length === 0) throw new TypeError('points must be a non-empty array');
  if (typeof sampleHeightMeters !== 'function') throw new TypeError('sampleHeightMeters must be a function');

  const source: RoadPoint[] = points.map((point, index) => normalizedInputPoint(point, sampleHeightMeters, `points[${index}]`));
  if (source.length === 1) {
    return Object.freeze({
      points: [source[0]],
      sourcePointCount: 1,
      densifiedPointCount: 1,
      segmentCount: 0,
      lengthMeters: 0,
      maxGradeDegrees: 0,
      meanGradeDegrees: 0,
      totalAscentMeters: 0,
      totalDescentMeters: 0,
      maxRiseMeters: 0,
      elevationRangeMeters: 0,
      roughnessRmsMeters: 0,
    });
  }

  const densified: RoadPoint[] = [];
  let lengthMeters = 0;
  let maxGradeDegrees = 0;
  let totalAscentMeters = 0;
  let totalDescentMeters = 0;
  let maxRiseMeters = 0;
  let minHeightMeters = Infinity;
  let maxHeightMeters = -Infinity;
  let gradeWeightedDistance = 0;
  let squaredStepDeltaSum = 0;
  let sampledSubsegments = 0;
  const auditSpacingMeters = complementaryProfileSpacing(maxSpacingMeters);

  for (let segmentIndex = 1; segmentIndex < source.length; segmentIndex += 1) {
    const start = source[segmentIndex - 1]!;
    const end = source[segmentIndex]!;
    const profile = profileTerrainSegment({ start, end, sampleHeightMeters, maxSpacingMeters });
    const phaseAudit = Math.abs(auditSpacingMeters - maxSpacingMeters) <= EPSILON
      ? profile
      : profileTerrainSegment({ start, end, sampleHeightMeters, maxSpacingMeters: auditSpacingMeters });
    lengthMeters += profile.horizontalMeters;
    maxGradeDegrees = Math.max(maxGradeDegrees, profile.maxGradeDegrees, phaseAudit.maxGradeDegrees);
    totalAscentMeters += profile.totalAscentMeters;
    totalDescentMeters += profile.totalDescentMeters;
    maxRiseMeters = Math.max(maxRiseMeters, profile.maxRiseMeters, phaseAudit.maxRiseMeters);
    minHeightMeters = Math.min(minHeightMeters, profile.minHeightMeters, phaseAudit.minHeightMeters);
    maxHeightMeters = Math.max(maxHeightMeters, profile.maxHeightMeters, phaseAudit.maxHeightMeters);

    for (let sampleIndex = 0; sampleIndex < profile.samples.length; sampleIndex += 1) {
      if (segmentIndex > 1 && sampleIndex === 0) continue;
      const sample = profile.samples[sampleIndex]!;
      densified.push({ x: sample.x, z: sample.z, y: sample.y });
      if (densified.length > 1) {
        const previous = densified[densified.length - 2]!;
        const horizontal = Math.hypot(sample.x - previous.x, sample.z - previous.z);
        const localGrade = gradeDegrees(sample.y - previous.y, horizontal);
        gradeWeightedDistance += localGrade * horizontal;
        squaredStepDeltaSum += (sample.y - previous.y) ** 2;
        sampledSubsegments += 1;
      }
    }
  }

  return Object.freeze({
    points: densified,
    sourcePointCount: source.length,
    densifiedPointCount: densified.length,
    segmentCount: source.length - 1,
    sampledSubsegments,
    lengthMeters,
    maxGradeDegrees,
    meanGradeDegrees: lengthMeters > EPSILON ? gradeWeightedDistance / lengthMeters : 0,
    totalAscentMeters,
    totalDescentMeters,
    maxRiseMeters,
    elevationRangeMeters: maxHeightMeters - minHeightMeters,
    roughnessRmsMeters: sampledSubsegments > 0 ? Math.sqrt(squaredStepDeltaSum / sampledSubsegments) : 0,
  });
}

export function pathIsGradeSafe(profile: RoadProfile | null | undefined, maxGradeDegrees: number): boolean {
  if (!profile || !Number.isFinite(profile.maxGradeDegrees)) return false;
  const cap = finiteNumber(maxGradeDegrees, 'maxGradeDegrees');
  if (cap < 0 || cap > 90) throw new RangeError('maxGradeDegrees must be between 0 and 90');
  return profile.maxGradeDegrees <= cap + 1e-9;
}

/**
 * Measures how much a densified path bends. Large heading changes are useful diagnostic evidence
 * for switchbacks, while a zero value describes a straight path.
 */
export function summarizePolylineCurvature(points: readonly RoadPoint[]): { readonly turnCount:number; readonly totalTurnDegrees:number; readonly maxTurnDegrees:number; readonly meanTurnDegrees:number } {
  if (!Array.isArray(points) || points.length < 3) {
    return Object.freeze({ turnCount: 0, totalTurnDegrees: 0, maxTurnDegrees: 0, meanTurnDegrees: 0 });
  }
  let turnCount = 0;
  let totalTurnDegrees = 0;
  let maxTurnDegrees = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const a = points[index - 1]!
    const b = points[index]!
    const c = points[index + 1]!
    const ax = b.x - a.x;
    const az = b.z - a.z;
    const bx = c.x - b.x;
    const bz = c.z - b.z;
    const aLength = Math.hypot(ax, az);
    const bLength = Math.hypot(bx, bz);
    if (aLength <= EPSILON || bLength <= EPSILON) continue;
    const dot = Math.max(-1, Math.min(1, (ax * bx + az * bz) / (aLength * bLength)));
    const turn = (Math.acos(dot) * 180) / Math.PI;
    if (turn <= 1e-7) continue;
    turnCount += 1;
    totalTurnDegrees += turn;
    maxTurnDegrees = Math.max(maxTurnDegrees, turn);
  }
  return Object.freeze({
    turnCount,
    totalTurnDegrees,
    maxTurnDegrees,
    meanTurnDegrees: turnCount > 0 ? totalTurnDegrees / turnCount : 0,
  });
}

export function checksumProfile(profile: Pick<RoadProfile, 'points'|'maxGradeDegrees'|'lengthMeters'>): string {
  if (!profile || !Array.isArray(profile.points)) throw new TypeError('profile.points is required');
  let hash = 2166136261 >>> 0;
  const mix = (value) => {
    const scaled = Math.round(value * 1000);
    hash ^= scaled & 0xff; hash = Math.imul(hash, 16777619) >>> 0;
    hash ^= (scaled >>> 8) & 0xff; hash = Math.imul(hash, 16777619) >>> 0;
    hash ^= (scaled >>> 16) & 0xff; hash = Math.imul(hash, 16777619) >>> 0;
    hash ^= (scaled >>> 24) & 0xff; hash = Math.imul(hash, 16777619) >>> 0;
  };
  for (const point of profile.points) {
    mix(point.x); mix(point.y); mix(point.z);
  }
  mix(profile.maxGradeDegrees);
  mix(profile.lengthMeters);
  return hash.toString(16).padStart(8, '0');
}
