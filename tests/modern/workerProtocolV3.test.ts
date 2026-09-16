import { describe, expect, it } from 'vitest';
import {
  V3_WORKER_PROTOCOL,
  assertDirection,
  createAction,
  createHandshake,
  createLifecycle,
  createTick,
  detectWorkerCapabilities,
  isV3WorkerMessage,
} from '../../src/3d/modern/v3/workerProtocol.js';

describe('runtime-v3 worker protocol', () => {
  it('creates deterministic protocol headers and typed messages', () => {
    const handshake = createHandshake({ seq: 7, nowMs: 100, seed: 9, fixedStepMs: 16.6667, backend: 'webgpu', quality: 'high', viewport: { width: 1600, height: 900, dpr: 2 }, supportsOffscreenCanvas: true });
    const tick = createTick(120, 16.6667, 8);
    const action = createAction({ action: 'move.forward', value: 1, phase: 'pressed', source: 'keyboard', timestamp: 121, frame: 1, repeat: false }, 9);
    const lifecycle = createLifecycle('pause', 'background', 10, 130);
    expect(handshake.header.protocol).toBe(V3_WORKER_PROTOCOL);
    expect(tick.header.seq).toBe(8);
    expect(action.action.source).toBe('keyboard');
    expect(lifecycle.reason).toBe('background');
    expect(isV3WorkerMessage(tick)).toBe(true);
    expect(() => assertDirection(tick, 'worker-to-main')).toThrow('direction mismatch');
    expect(() => assertDirection(tick, 'main-to-worker')).not.toThrow();
  });

  it('reports environment capability without inventing support', () => {
    const capabilities = detectWorkerCapabilities('webgl2');
    expect(typeof capabilities.dedicatedWorker).toBe('boolean');
    expect(typeof capabilities.offscreenCanvas).toBe('boolean');
    expect(typeof capabilities.transferableCanvas).toBe('boolean');
    expect(capabilities.backend).toBe('webgl2');
  });

  it('rejects malformed messages', () => {
    expect(isV3WorkerMessage(null)).toBe(false);
    expect(isV3WorkerMessage({ type: 'tick' })).toBe(false);
    expect(isV3WorkerMessage({ type: 'tick', header: { protocol: 'wrong', version: 1, seq: 1, direction: 'main-to-worker', createdAt: 1 } })).toBe(false);
  });
});
