import type { Backend, QualityTier } from '../../types/platform.js';
import type { V3Action, V3RenderPacket, V3RuntimeSnapshot, V3Viewport } from './runtimeContracts.js';

export const V3_WORKER_PROTOCOL = 'aapw.worker.v3' as const;
export const V3_WORKER_PROTOCOL_VERSION = 1 as const;

export type V3WorkerDirection = 'main-to-worker' | 'worker-to-main';
export type V3WorkerMessageType = 'handshake' | 'ready' | 'tick' | 'action' | 'pause' | 'resume' | 'stop' | 'snapshot' | 'render-packet' | 'device-state' | 'error' | 'dispose';
export interface V3WorkerHeader { readonly protocol: typeof V3_WORKER_PROTOCOL; readonly version: typeof V3_WORKER_PROTOCOL_VERSION; readonly seq: number; readonly direction: V3WorkerDirection; readonly createdAt: number; }
export interface V3WorkerHandshake { readonly type: 'handshake'; readonly header: V3WorkerHeader; readonly seed: number; readonly fixedStepMs: number; readonly backend: Backend; readonly quality: QualityTier; readonly viewport: V3Viewport; readonly supportsOffscreenCanvas: boolean; readonly offscreenCanvas?: OffscreenCanvas; }
export interface V3WorkerReady { readonly type: 'ready'; readonly header: V3WorkerHeader; readonly workerId: string; readonly backend: Backend; readonly supportsOffscreenCanvas: boolean; }
export interface V3WorkerTick { readonly type: 'tick'; readonly header: V3WorkerHeader; readonly nowMs: number; readonly deltaHintMs: number; }
export interface V3WorkerAction { readonly type: 'action'; readonly header: V3WorkerHeader; readonly action: V3Action; }
export interface V3WorkerLifecycle { readonly type: 'pause' | 'resume' | 'stop' | 'dispose'; readonly header: V3WorkerHeader; readonly reason: string; }
export interface V3WorkerSnapshot { readonly type: 'snapshot'; readonly header: V3WorkerHeader; readonly snapshot: V3RuntimeSnapshot; }
export interface V3WorkerRenderPacket { readonly type: 'render-packet'; readonly header: V3WorkerHeader; readonly packet: V3RenderPacket; }
export interface V3WorkerDeviceState { readonly type: 'device-state'; readonly header: V3WorkerHeader; readonly backend: Backend; readonly lost: boolean; readonly reason?: string; }
export interface V3WorkerError { readonly type: 'error'; readonly header: V3WorkerHeader; readonly code: string; readonly message: string; readonly recoverable: boolean; }
export type V3WorkerMessage = V3WorkerHandshake | V3WorkerReady | V3WorkerTick | V3WorkerAction | V3WorkerLifecycle | V3WorkerSnapshot | V3WorkerRenderPacket | V3WorkerDeviceState | V3WorkerError;
export interface V3WorkerCapabilities { readonly dedicatedWorker: boolean; readonly offscreenCanvas: boolean; readonly transferableCanvas: boolean; readonly crossOriginIsolated: boolean; readonly backend: Backend; }

export const finite = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
export const seq = (value: unknown): number => Math.max(0, Math.trunc(finite(value)));
export function makeWorkerHeader(direction: V3WorkerDirection, sequence: number, nowMs = Date.now()): V3WorkerHeader { return Object.freeze({ protocol: V3_WORKER_PROTOCOL, version: V3_WORKER_PROTOCOL_VERSION, seq: seq(sequence), direction, createdAt: Math.max(0, finite(nowMs)) }); }
export function createHandshake(options: Omit<V3WorkerHandshake, 'type' | 'header' | 'offscreenCanvas'> & { readonly seq: number; readonly nowMs?: number; readonly offscreenCanvas?: OffscreenCanvas }): V3WorkerHandshake { return Object.freeze({ type: 'handshake', header: makeWorkerHeader('main-to-worker', options.seq, options.nowMs), seed: Math.trunc(options.seed), fixedStepMs: finite(options.fixedStepMs, 1000 / 60), backend: options.backend, quality: options.quality, viewport: Object.freeze({ ...options.viewport }), supportsOffscreenCanvas: Boolean(options.supportsOffscreenCanvas), ...(options.offscreenCanvas ? { offscreenCanvas: options.offscreenCanvas } : {}) }); }
export function createTick(nowMs: number, deltaHintMs: number, sequence: number): V3WorkerTick { return Object.freeze({ type: 'tick', header: makeWorkerHeader('main-to-worker', sequence, nowMs), nowMs: Math.max(0, finite(nowMs)), deltaHintMs: Math.max(0, finite(deltaHintMs)) }); }
export function createAction(action: V3Action, sequence: number): V3WorkerAction { return Object.freeze({ type: 'action', header: makeWorkerHeader('main-to-worker', sequence, action.timestamp), action }); }
export function createLifecycle(type: V3WorkerLifecycle['type'], reason: string, sequence: number, nowMs = Date.now()): V3WorkerLifecycle { return Object.freeze({ type, header: makeWorkerHeader('main-to-worker', sequence, nowMs), reason: reason.slice(0, 128) }); }
export function isV3WorkerMessage(value: unknown): value is V3WorkerMessage { if (!value || typeof value !== 'object') return false; const candidate = value as Partial<V3WorkerMessage>; return candidate.header?.protocol === V3_WORKER_PROTOCOL && candidate.header.version === V3_WORKER_PROTOCOL_VERSION && typeof candidate.type === 'string'; }
export function assertDirection(message: V3WorkerMessage, direction: V3WorkerDirection): void { if (message.header.direction !== direction) throw new TypeError(`Worker message direction mismatch: expected=${direction} actual=${message.header.direction}`); }
export function normalizeWorkerError(error: unknown): Pick<V3WorkerError, 'code' | 'message' | 'recoverable'> { const message = error instanceof Error ? error.message : String(error); return Object.freeze({ code: typeof DOMException !== 'undefined' && error instanceof DOMException ? error.name : 'V3_WORKER_ERROR', message: message.slice(0, 512), recoverable: true }); }
export function canTransferOffscreenCanvas(value: unknown): value is HTMLCanvasElement { return typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement && typeof value.transferControlToOffscreen === 'function'; }
export function detectWorkerCapabilities(backend: Backend): V3WorkerCapabilities { const dedicatedWorker = typeof Worker !== 'undefined'; const offscreenCanvas = typeof OffscreenCanvas !== 'undefined'; const transferableCanvas = typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function'; const crossOriginIsolated = typeof globalThis.crossOriginIsolated === 'boolean' && globalThis.crossOriginIsolated; return Object.freeze({ dedicatedWorker, offscreenCanvas, transferableCanvas, crossOriginIsolated, backend }); }
