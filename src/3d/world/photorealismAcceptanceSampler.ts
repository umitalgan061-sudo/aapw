/**
 * Buzul Muhafızı — deterministic acceptance sampling for shipped scenes.
 *
 * The sampler does not render or mutate a scene. It converts canonical
 * observations into a stable full-world/far/near capture plan so the same
 * seed, coordinates and camera contract can be compared before/after a
 * production change without introducing a second terrain authority.
 */
import type { CanonicalEnvironmentObservation } from './photorealismEnvironmentPass.ts';
import { buildPhotorealismFrame } from './photorealismDirector.ts';

export type AcceptanceView = 'full-world' | 'far' | 'terrain-near' | 'northwest-near';

export interface AcceptanceSample {
  readonly id: string;
  readonly view: AcceptanceView;
  readonly coordinate: readonly [number, number];
  readonly orthographic: boolean;
  readonly viewport: readonly [number, number];
  readonly headingDegrees: number;
  readonly elevationDegrees: number;
  readonly seed: number;
  readonly expectedCategories: readonly string[];
}

export interface AcceptanceSampleSet {
  readonly deterministicKey: string;
  readonly samples: readonly AcceptanceSample[];
  readonly cameraContract: Readonly<{
    projection: 'orthographic';
    viewport: readonly [number, number];
    sameSeedBeforeAfter: boolean;
  }>;
}

export interface AcceptanceSamplingOptions {
  readonly seed: number;
  readonly worldCenter?: readonly [number, number];
  readonly worldExtent?: readonly [number, number];
  readonly viewport?: readonly [number, number];
}

const finite = (value: unknown, fallback: number): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

function point(
  center: readonly [number, number],
  extent: readonly [number, number],
  x: number,
  y: number,
): readonly [number, number] {
  return Object.freeze([
    center[0] + extent[0] * x,
    center[1] + extent[1] * y,
  ] as const);
}

function sample(
  id: string,
  view: AcceptanceView,
  coordinate: readonly [number, number],
  viewport: readonly [number, number],
  seed: number,
  headingDegrees: number,
  elevationDegrees: number,
  expectedCategories: readonly string[],
): AcceptanceSample {
  return Object.freeze({
    id,
    view,
    coordinate,
    orthographic: true,
    viewport,
    headingDegrees,
    elevationDegrees,
    seed,
    expectedCategories: Object.freeze([...expectedCategories]),
  });
}

export function createPhotorealismAcceptanceSampleSet(
  observation: CanonicalEnvironmentObservation,
  options: AcceptanceSamplingOptions,
): AcceptanceSampleSet {
  const seed = Math.trunc(finite(options.seed, 0));
  const center: readonly [number, number] = Object.freeze([
    finite(options.worldCenter?.[0], observation.sample.worldX),
    finite(options.worldCenter?.[1], observation.sample.worldZ),
  ] as const);
  const extent: readonly [number, number] = Object.freeze([
    Math.max(1, Math.abs(finite(options.worldExtent?.[0], 1000))),
    Math.max(1, Math.abs(finite(options.worldExtent?.[1], 1000))),
  ] as const);
  const viewport: readonly [number, number] = Object.freeze([
    Math.max(1, Math.trunc(finite(options.viewport?.[0], 1536))),
    Math.max(1, Math.trunc(finite(options.viewport?.[1], 1024))),
  ] as const);
  const frame = buildPhotorealismFrame(seed, observation.sample);
  const categories = Object.freeze([
    'coast',
    'mountain',
    'water',
    'vegetation',
    'settlement',
    frame.biome,
    frame.dominantSurface,
  ].filter((value, index, values) => values.indexOf(value) === index));
  const samples = [
    sample('full-world', 'full-world', point(center, extent, 0, 0), viewport, seed, 0, 90, categories),
    sample('far-center', 'far', point(center, extent, 0.18, 0.12), viewport, seed, 18, 62, categories),
    sample('terrain-near-center', 'terrain-near', point(center, extent, 0.03, -0.04), viewport, seed, 12, 34, categories),
    sample('northwest-near', 'northwest-near', point(center, extent, -0.62, 0.58), viewport, seed, 320, 30, categories),
  ];
  return Object.freeze({
    deterministicKey: `buzul|acceptance-sampler-v1|${seed}|${viewport[0]}x${viewport[1]}|${Math.round(observation.sample.worldX * 4) / 4}|${Math.round(observation.sample.worldZ * 4) / 4}`,
    samples: Object.freeze(samples),
    cameraContract: Object.freeze({
      projection: 'orthographic',
      viewport,
      sameSeedBeforeAfter: true,
    }),
  });
}

export function acceptanceSampleIds(set: AcceptanceSampleSet): readonly string[] {
  return Object.freeze(set.samples.map((sampleEntry) => sampleEntry.id));
}
