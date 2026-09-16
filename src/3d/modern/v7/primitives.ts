export type Brand<T, B extends string> = T & { readonly __brand: B };
export type EntityId = Brand<string, 'EntityId'>;
export type TaskId = Brand<string, 'TaskId'>;
export type ResourceId = Brand<string, 'ResourceId'>;
export type Tick = Brand<number, 'Tick'>;

export interface Vec3 { readonly x: number; readonly y: number; readonly z: number; }
export interface Range { readonly min: number; readonly max: number; }
export interface BudgetSlice { readonly cpuMs: number; readonly gpuMs: number; readonly networkBytes: number; readonly memoryBytes: number; }
export interface Disposable { dispose(): void; }

export type V7Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly retryable: boolean };

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => Object.freeze({ x, y, z });
export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
export const clamp01 = (value: number): number => clamp(Number.isFinite(value) ? value : 0, 0, 1);
export const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
export const integer = (value: number, fallback = 0): number => Math.trunc(finite(value, fallback));
export const distanceSq = (a: Vec3, b: Vec3): number => {
  const x = a.x - b.x; const y = a.y - b.y; const z = a.z - b.z;
  return x * x + y * y + z * z;
};
export const lengthSq = (a: Vec3): number => a.x * a.x + a.y * a.y + a.z * a.z;
export const normalize = (a: Vec3): Vec3 => {
  const length = Math.sqrt(lengthSq(a));
  return length > 1e-9 ? vec3(a.x / length, a.y / length, a.z / length) : vec3(0, 0, 0);
};
export const add = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z);
export const scale = (a: Vec3, factor: number): Vec3 => vec3(a.x * factor, a.y * factor, a.z * factor);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export function stableSort<T>(items: readonly T[], compare: (a: T, b: T) => number): readonly T[] {
  return Object.freeze(items.map((item, index) => ({ item, index })).sort((a, b) => compare(a.item, b.item) || a.index - b.index).map(({ item }) => item));
}

export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function hashValues(values: readonly unknown[]): number {
  let hash = 0x9e3779b9;
  for (const value of values) {
    const encoded = typeof value === 'string' ? value : JSON.stringify(value) ?? 'null';
    hash = Math.imul(hash ^ hashString(encoded), 0x85ebca6b) >>> 0;
    hash ^= hash >>> 13;
  }
  return hash >>> 0;
}

export const toHex = (value: number): string => (value >>> 0).toString(16).padStart(8, '0');
export const digest = (...values: readonly unknown[]): string => toHex(hashValues(values));
export const asEntityId = (value: string): EntityId => value as EntityId;
export const asTaskId = (value: string): TaskId => value as TaskId;
export const asResourceId = (value: string): ResourceId => value as ResourceId;
export const asTick = (value: number): Tick => Math.max(0, integer(value)) as Tick;

export function freezeDeep<T>(value: T, depth = 4): T {
  if (depth <= 0 || value === null || typeof value !== 'object') return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child, depth - 1);
  return value;
}

export function boundedArray<T>(items: readonly T[], limit: number): readonly T[] {
  return Object.freeze(items.slice(0, Math.max(0, integer(limit))));
}

export function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
