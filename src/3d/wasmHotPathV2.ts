export type HotPathOperation =
  | 'sample-height'
  | 'distance-squared'
  | 'visibility'
  | 'lod'
  | 'steer'
  | 'integrate'
  | 'boids'
  | 'spawn'
  | 'fixed-steps'
  | 'hash-sequence';

export interface HotPathModule {
  memory: WebAssembly.Memory;
  version(): number;
  scratch_ptr(): number;
  sample_height(x: number, z: number, seed: number): number;
  lod_factor(distance: number, near: number, far: number): number;
  distance_sq(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number;
  aabb_visible(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, cx: number, cy: number, cz: number, radius: number): number;
  simulation_normalize3(x: number, y: number, z: number, outPtr: number): number;
  simulation_steer_to_target(px: number, py: number, pz: number, vx: number, vy: number, vz: number, tx: number, ty: number, tz: number, maxSpeed: number, maxAcceleration: number, outPtr: number): number;
  simulation_integrate_velocity(px: number, py: number, pz: number, vx: number, vy: number, vz: number, ax: number, ay: number, az: number, dt: number, drag: number, maxSpeed: number, outPtr: number): number;
  simulation_boids(px: number, py: number, pz: number, vx: number, vy: number, vz: number, cx: number, cy: number, cz: number, avx: number, avy: number, avz: number, separationRadius: number, alignmentWeight: number, cohesionWeight: number, separationWeight: number, maxAcceleration: number, outPtr: number): number;
  simulation_culling_distance(px: number, py: number, pz: number, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): number;
  simulation_lod(distance: number, near: number, far: number, bias: number): number;
  simulation_spawn(index: number, seed: number, minX: number, maxX: number, minZ: number, maxZ: number, outPtr: number): number;
  simulation_fixed_steps(accumulator: number, step: number, maxSteps: number, outPtr: number): number;
  simulation_hash_sequence(valuesPtr: number, len: number): number;
}

export interface HotPathLoadOptions {
  readonly url?: URL | string;
  readonly bytes?: ArrayBuffer;
  readonly maxMemoryPages?: number;
}

export interface HotPathPolicy {
  readonly minVersion: number;
  readonly maxInputFloats: number;
  readonly maxSequenceWords: number;
  readonly maxDt: number;
}

const DEFAULT_POLICY: HotPathPolicy = Object.freeze({
  minVersion: 2,
  maxInputFloats: 65_536,
  maxSequenceWords: 65_536,
  maxDt: 0.25,
});

const DEFAULT_URL = new URL('/wasm/aapw_hotpath.wasm', globalThis.location?.origin ?? 'http://localhost');

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function bounded(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, finite(value, min)));
}

function assertMemory(memory: WebAssembly.Memory, maxPages: number): void {
  if (memory.buffer.byteLength / 65_536 > maxPages) {
    throw new RangeError(`WASM memory exceeds policy: ${memory.buffer.byteLength}`);
  }
}

export function createHotPathPolicy(overrides: Partial<HotPathPolicy> = {}): HotPathPolicy {
  return Object.freeze({ ...DEFAULT_POLICY, ...overrides });
}

export async function loadHotPath(options: HotPathLoadOptions = {}, policy = DEFAULT_POLICY): Promise<HotPathModule> {
  const source = options.bytes
    ? await WebAssembly.instantiate(options.bytes, {})
    : await WebAssembly.instantiateStreaming(fetch(options.url ?? DEFAULT_URL), {});
  const exports = source.instance.exports as unknown as Partial<HotPathModule>;
  const required = ['memory', 'version', 'scratch_ptr', 'sample_height', 'lod_factor', 'distance_sq'] as const;
  for (const name of required) {
    if (!(name in exports)) throw new Error(`Missing WASM export: ${name}`);
  }
  const module = exports as HotPathModule;
  if (module.version() < policy.minVersion) throw new Error(`Unsupported hot path ABI: ${module.version()}`);
  assertMemory(module.memory, options.maxMemoryPages ?? 256);
  return module;
}

export class WasmHotPathV2 {
  readonly #module: HotPathModule;
  readonly #policy: HotPathPolicy;
  readonly #scratch: Float32Array;

  constructor(module: HotPathModule, policy = DEFAULT_POLICY) {
    this.#module = module;
    this.#policy = policy;
    if (module.version() < policy.minVersion) throw new Error(`Unsupported hot path ABI: ${module.version()}`);
    this.#scratch = new Float32Array(module.memory.buffer, module.scratch_ptr(), Math.min(1024, policy.maxInputFloats));
  }

  get version(): number { return this.#module.version(); }
  get memoryBytes(): number { return this.#module.memory.buffer.byteLength; }

  sampleHeight(x: number, z: number, seed: number): number {
    return finite(this.#module.sample_height(finite(x), finite(z), seed >>> 0));
  }

  lod(distance: number, near: number, far: number, bias = 0): number {
    return bounded(this.#module.simulation_lod(finite(distance), finite(near), finite(far), finite(bias)), 0, 1);
  }

  distanceSquared(a: readonly [number, number, number], b: readonly [number, number, number]): number {
    return Math.max(0, finite(this.#module.distance_sq(...a, ...b)));
  }

  cullingDistanceSquared(position: readonly [number, number, number], min: readonly [number, number, number], max: readonly [number, number, number]): number {
    return Math.max(0, finite(this.#module.simulation_culling_distance(...position, ...min, ...max)));
  }

  normalize3(x: number, y: number, z: number): readonly [number, number, number] {
    const ok = this.#module.simulation_normalize3(finite(x), finite(y), finite(z), this.#module.scratch_ptr());
    if (!ok) throw new Error('WASM normalize3 failed');
    return [this.#scratch[0] ?? 0, this.#scratch[1] ?? 0, this.#scratch[2] ?? 0];
  }

  steerToTarget(position: readonly [number, number, number], velocity: readonly [number, number, number], target: readonly [number, number, number], maxSpeed: number, maxAcceleration: number): readonly [number, number, number] {
    const ok = this.#module.simulation_steer_to_target(...position, ...velocity, ...target, Math.max(0, finite(maxSpeed)), Math.max(0, finite(maxAcceleration)), this.#module.scratch_ptr());
    if (!ok) throw new Error('WASM steering failed');
    return [this.#scratch[0] ?? 0, this.#scratch[1] ?? 0, this.#scratch[2] ?? 0];
  }

  integrate(position: readonly [number, number, number], velocity: readonly [number, number, number], acceleration: readonly [number, number, number], dt: number, drag: number, maxSpeed: number): readonly [number, number, number, number, number, number] {
    const ok = this.#module.simulation_integrate_velocity(...position, ...velocity, ...acceleration, bounded(dt, 0, this.#policy.maxDt), Math.max(0, finite(drag)), Math.max(0, finite(maxSpeed)), this.#module.scratch_ptr());
    if (!ok) throw new Error('WASM integration failed');
    return [this.#scratch[0] ?? 0, this.#scratch[1] ?? 0, this.#scratch[2] ?? 0, this.#scratch[3] ?? 0, this.#scratch[4] ?? 0, this.#scratch[5] ?? 0];
  }

  boids(position: readonly [number, number, number], velocity: readonly [number, number, number], center: readonly [number, number, number], averageVelocity: readonly [number, number, number], separationRadius: number, alignmentWeight: number, cohesionWeight: number, separationWeight: number, maxAcceleration: number): readonly [number, number, number] {
    const ok = this.#module.simulation_boids(...position, ...velocity, ...center, ...averageVelocity, Math.max(0, finite(separationRadius)), finite(alignmentWeight), finite(cohesionWeight), finite(separationWeight), Math.max(0, finite(maxAcceleration)), this.#module.scratch_ptr());
    if (!ok) throw new Error('WASM boids failed');
    return [this.#scratch[0] ?? 0, this.#scratch[1] ?? 0, this.#scratch[2] ?? 0];
  }

  spawn(index: number, seed: number, minX: number, maxX: number, minZ: number, maxZ: number): readonly [number, number] {
    const ok = this.#module.simulation_spawn(index >>> 0, seed >>> 0, finite(minX), finite(maxX), finite(minZ), finite(maxZ), this.#module.scratch_ptr());
    if (!ok) throw new Error('WASM spawn failed');
    return [this.#scratch[0] ?? 0, this.#scratch[1] ?? 0];
  }

  fixedSteps(accumulator: number, step: number, maxSteps: number): readonly [number, number] {
    const ok = this.#module.simulation_fixed_steps(Math.max(0, finite(accumulator)), Math.max(0, finite(step)), Math.max(0, Math.floor(maxSteps)), this.#module.scratch_ptr());
    if (!ok) throw new Error('WASM fixed-step calculation failed');
    return [this.#scratch[0] ?? 0, this.#scratch[1] ?? 0];
  }

  hashWords(words: Uint32Array): number {
    if (words.length > this.#policy.maxSequenceWords) throw new RangeError('Sequence exceeds hot-path policy');
    const pointer = this.#module.scratch_ptr();
    const bytes = new Uint32Array(this.#module.memory.buffer, pointer, words.length);
    bytes.set(words);
    return this.#module.simulation_hash_sequence(pointer, words.length) >>> 0;
  }

  deterministicSampleGrid(width: number, height: number, originX: number, originZ: number, spacing: number, seed: number): Float32Array {
    const w = Math.max(0, Math.min(256, Math.floor(width)));
    const h = Math.max(0, Math.min(256, Math.floor(height)));
    const count = Math.min(w * h, this.#policy.maxInputFloats);
    const input = new Float32Array(count * 2);
    for (let i = 0; i < count; i += 1) {
      const x = i % w;
      const z = Math.floor(i / w);
      input[i * 2] = finite(originX) + x * finite(spacing);
      input[i * 2 + 1] = finite(originZ) + z * finite(spacing);
    }
    const ptr = this.#module.scratch_ptr();
    const wasmInput = new Float32Array(this.#module.memory.buffer, ptr, Math.min(count * 2, this.#scratch.length));
    wasmInput.set(input.subarray(0, wasmInput.length));
    return Float32Array.from({ length: count }, (_, i) => this.sampleHeight(input[i * 2]!, input[i * 2 + 1]!, seed));
  }

  operationSupported(operation: HotPathOperation): boolean {
    const exportName = operation === 'sample-height' ? 'sample_height'
      : operation === 'distance-squared' ? 'distance_sq'
      : operation === 'visibility' ? 'aabb_visible'
      : operation === 'lod' ? 'simulation_lod'
      : operation === 'steer' ? 'simulation_steer_to_target'
      : operation === 'integrate' ? 'simulation_integrate_velocity'
      : operation === 'boids' ? 'simulation_boids'
      : operation === 'spawn' ? 'simulation_spawn'
      : operation === 'fixed-steps' ? 'simulation_fixed_steps'
      : 'simulation_hash_sequence';
    return typeof (this.#module as unknown as Record<string, unknown>)[exportName] === 'function';
  }
}

export function shouldUseHotPath(capabilities: { readonly wasm: boolean; readonly crossOriginIsolated?: boolean }, minVersion = 2): boolean {
  return capabilities.wasm && minVersion <= 2 && (capabilities.crossOriginIsolated !== false);
}
