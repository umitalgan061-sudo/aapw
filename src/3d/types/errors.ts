export type RuntimeErrorCode =
  | 'INVALID_CONFIG'
  | 'INVALID_STATE'
  | 'INVALID_ASSET'
  | 'ASSET_TIMEOUT'
  | 'ASSET_DECODE'
  | 'STORAGE_UNAVAILABLE'
  | 'SAVE_CORRUPT'
  | 'SAVE_VERSION'
  | 'SAVE_CHECKSUM'
  | 'DEVICE_UNAVAILABLE'
  | 'DEVICE_LOST'
  | 'RENDER_INIT'
  | 'RENDER_PIPELINE'
  | 'WORKER_TIMEOUT'
  | 'WORKER_FAILED'
  | 'TASK_CYCLE'
  | 'TASK_CANCELLED'
  | 'INPUT_INVALID'
  | 'WORLD_STREAM'
  | 'RECOVERY_EXHAUSTED';

export interface RuntimeErrorShape {
  readonly code: RuntimeErrorCode;
  readonly message: string;
  readonly recoverable: boolean;
  readonly retryable: boolean;
  readonly subsystem: 'config' | 'state' | 'asset' | 'storage' | 'render' | 'worker' | 'input' | 'world' | 'recovery';
  readonly cause?: unknown;
  readonly context: Readonly<Record<string, string | number | boolean>>;
}

const retryableCodes = new Set<RuntimeErrorCode>(['ASSET_TIMEOUT','STORAGE_UNAVAILABLE','DEVICE_LOST','WORKER_TIMEOUT','WORKER_FAILED','WORLD_STREAM']);
const recoverableCodes = new Set<RuntimeErrorCode>(['INVALID_ASSET','ASSET_TIMEOUT','ASSET_DECODE','STORAGE_UNAVAILABLE','DEVICE_UNAVAILABLE','DEVICE_LOST','RENDER_INIT','RENDER_PIPELINE','WORKER_TIMEOUT','WORKER_FAILED','TASK_CANCELLED','WORLD_STREAM']);

export function createRuntimeError(code: RuntimeErrorCode, message: string, subsystem: RuntimeErrorShape['subsystem'], context: RuntimeErrorShape['context'] = {}, cause?: unknown): RuntimeErrorShape {
  return Object.freeze({ code, message, subsystem, recoverable: recoverableCodes.has(code), retryable: retryableCodes.has(code), context: Object.freeze({ ...context }), ...(cause === undefined ? {} : { cause }) });
}

export function isRetryable(error: RuntimeErrorShape): boolean { return error.retryable; }
export function isRecoverable(error: RuntimeErrorShape): boolean { return error.recoverable; }

export function assertNoRuntimeError(value: RuntimeErrorShape | undefined): void {
  if (value) throw new Error(`[${value.code}] ${value.message}`);
}
