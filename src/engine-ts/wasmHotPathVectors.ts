export type HotPathVectorGroup = 'height' | 'lod' | 'distance' | 'spatial' | 'bilinear' | 'quantize';

export interface HeightVector { readonly group: 'height'; readonly x: number; readonly z: number; readonly seed: number; }
export interface LodVector { readonly group: 'lod'; readonly distance: number; readonly near: number; readonly far: number; }
export interface DistanceVector { readonly group: 'distance'; readonly a: readonly [number, number, number]; readonly b: readonly [number, number, number]; }
export interface SpatialVector { readonly group: 'spatial'; readonly cellX: number; readonly cellZ: number; }
export interface BilinearVector { readonly group: 'bilinear'; readonly h: readonly [number, number, number, number]; readonly tx: number; readonly tz: number; }
export interface QuantizeVector { readonly group: 'quantize'; readonly value: number; readonly step: number; }
export type HotPathVector = HeightVector | LodVector | DistanceVector | SpatialVector | BilinearVector | QuantizeVector;

export const HOT_PATH_VECTOR_COUNT = 4096 as const;
export const HOT_PATH_VECTOR_GROUPS = ['height', 'lod', 'distance', 'spatial', 'bilinear', 'quantize'] as const satisfies readonly HotPathVectorGroup[];
const LOD_DISTANCES = [0, 1, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, Number.POSITIVE_INFINITY] as const;
const QUANTIZE_STEPS = [0.25, 0.5, 1, 2, 5, 10, 25, 100] as const;

const signed = (value: number, modulus: number, center: number): number => (value % modulus) - center;
const cycleFor = (id: number): number => Math.floor(id / HOT_PATH_VECTOR_GROUPS.length);
const assertVectorId = (id: number): void => { if (!Number.isInteger(id) || id < 0 || id >= HOT_PATH_VECTOR_COUNT) throw new RangeError(`invalid hot-path vector id: ${id}`); };

export const deriveHotPathVector = (id: number): HotPathVector => {
  assertVectorId(id);
  const group = HOT_PATH_VECTOR_GROUPS[id % HOT_PATH_VECTOR_GROUPS.length];
  const cycle = cycleFor(id);
  switch (group) {
    case 'height': return Object.freeze({ group, x: signed(cycle * 7919, 42001, 21000), z: signed(cycle * 104729, 36001, 18000), seed: (0x9e3779b9 * (cycle + 1)) >>> 0 });
    case 'lod': return Object.freeze({ group, distance: LOD_DISTANCES[cycle % LOD_DISTANCES.length]!, near: cycle % 7, far: 100 + (cycle % 9) * 250 });
    case 'distance': return Object.freeze({ group, a: [signed(cycle * 31, 401, 200), signed(cycle * 17, 303, 151), signed(cycle * 13, 201, 100)] as const, b: [signed(cycle * 23, 401, 200), signed(cycle * 29, 303, 151), signed(cycle * 7, 201, 100)] as const });
    case 'spatial': return Object.freeze({ group, cellX: signed(cycle * 97, 4001, 2000), cellZ: signed(cycle * 193, 4001, 2000) });
    case 'bilinear': return Object.freeze({ group, h: [signed(cycle * 3, 101, 50), signed(cycle * 5, 151, 75), signed(cycle * 7, 201, 100), signed(cycle * 11, 251, 125)] as const, tx: (cycle % 11) / 10, tz: ((cycle * 3) % 11) / 10 });
    case 'quantize': return Object.freeze({ group, value: signed(cycle * 37, 10001, 5000), step: QUANTIZE_STEPS[cycle % QUANTIZE_STEPS.length]! });
    default: return assertNever(group);
  }
};

export const vectorIsBoundaryCase = (id: number): boolean => { assertVectorId(id); return id < 768 || id % 17 === 0 || id % 31 === 0; };
export const vectorExpectedGroupCounts = (): Readonly<Record<HotPathVectorGroup, number>> => {
  const counts = { height: 0, lod: 0, distance: 0, spatial: 0, bilinear: 0, quantize: 0 };
  for (let id = 0; id < HOT_PATH_VECTOR_COUNT; id += 1) counts[deriveHotPathVector(id).group] += 1;
  return Object.freeze(counts);
};
export const vectorBoundaryCount = (): number => { let count = 0; for (let id = 0; id < HOT_PATH_VECTOR_COUNT; id += 1) if (vectorIsBoundaryCase(id)) count += 1; return count; };
export const vectorFingerprint = (id: number): string => {
  const vector = deriveHotPathVector(id);
  const text = JSON.stringify(vector);
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
};
const assertNever = (value: never): never => { throw new Error(`unhandled hot-path vector group: ${String(value)}`); };
