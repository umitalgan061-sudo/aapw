export type Brand<T, B extends string> = T & { readonly __brand: B };

export type EntityId = Brand<string, 'EntityId'>;
export type ComponentType = Brand<string, 'ComponentType'>;
export type SystemId = Brand<string, 'SystemId'>;
export type Tick = Brand<number, 'Tick'>;
export type SimTimeMs = Brand<number, 'SimTimeMs'>;

export const ENTITY_ID = (value: string): EntityId => value as EntityId;
export const COMPONENT_TYPE = (value: string): ComponentType => value as ComponentType;
export const SYSTEM_ID = (value: string): SystemId => value as SystemId;
export const TICK = (value: number): Tick => value as Tick;
export const SIM_TIME_MS = (value: number): SimTimeMs => value as SimTimeMs;

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Quaternion {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface TransformSnapshot {
  readonly position: Vec3;
  readonly rotation: Quaternion;
  readonly scale: Vec3;
}

export interface RuntimeErrorInfo {
  readonly code: string;
  readonly message: string;
  readonly recoverable: boolean;
  readonly cause?: unknown;
}

export interface FrameContext {
  readonly tick: Tick;
  readonly simulationTimeMs: SimTimeMs;
  readonly deltaSeconds: number;
  readonly interpolationAlpha: number;
  readonly frameId: number;
  readonly budgetMs: number;
  readonly deadlineMs: number;
}

export interface Disposable {
  dispose(): void;
}

export interface Result<T, E = RuntimeErrorInfo> {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: E;
}

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
};

export const normalizeUnit = (value: number, fallback = 0): number => {
  if (!Number.isFinite(value)) return fallback;
  return clamp(value, 0, 1);
};

export const stableNumber = (value: number, precision = 1e-6): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value / precision) * precision;
};

export const compareString = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export const compareNumber = (left: number, right: number): number =>
  left < right ? -1 : left > right ? 1 : 0;

export const stableSort = <T>(values: readonly T[], compare: (a: T, b: T) => number): T[] =>
  values.map((value, index) => ({ value, index }))
    .sort((a, b) => compare(a.value, b.value) || a.index - b.index)
    .map(item => item.value);

export const freezeRecord = <T extends Record<string, unknown>>(value: T): Readonly<T> =>
  Object.freeze(value);

export const safeJson = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  typeof item === 'bigint' ? `${item}n` : item,
);
