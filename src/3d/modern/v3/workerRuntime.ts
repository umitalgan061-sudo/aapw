import { createV3RuntimeKernel } from './runtimeKernel.js';
import {
  assertDirection,
  createLifecycle,
  detectWorkerCapabilities,
  isV3WorkerMessage,
  makeWorkerHeader,
  normalizeWorkerError,
  type V3WorkerHandshake,
  type V3WorkerMessage,
  type V3WorkerHeader,
} from './workerProtocol.js';
import type { V3RuntimeConfig, V3RuntimeDependencies, V3Viewport } from './runtimeContracts.js';

interface DedicatedWorkerScopeLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
}

interface WorkerBootState {
  sequence: number;
  ready: boolean;
  disposed: boolean;
  backend: 'webgpu' | 'webgl2';
}

const scope = globalThis as unknown as DedicatedWorkerScopeLike;
const state: WorkerBootState = { sequence: 0, ready: false, disposed: false, backend: 'webgl2' };
let kernel: ReturnType<typeof createV3RuntimeKernel> | undefined;

const now = (): number => typeof performance !== 'undefined' ? performance.now() : Date.now();
const nextHeader = (): V3WorkerHeader => makeWorkerHeader('worker-to-main', ++state.sequence, now());
const reply = (payload: Record<string, unknown>): void => scope.postMessage({ ...payload, header: nextHeader() });

function bootstrap(message: V3WorkerHandshake): void {
  const viewport: V3Viewport = Object.freeze({ ...message.viewport });
  const config: V3RuntimeConfig = Object.freeze({
    worldId: 'worker-world' as V3RuntimeConfig['worldId'], seed: Math.trunc(message.seed), host: 'dedicated-worker', mode: 'interactive', backend: message.backend,
    quality: message.quality, fixedStepMs: Math.max(1, message.fixedStepMs), maxDeltaMs: 250, maxCatchUpSteps: 6,
    budget: { totalMs: 16.6667, simulationMs: 5, inputMs: 1, streamingMs: 2, presentationMs: 7, saveMs: 1 },
    enableLegacyAdapter: false, enablePersistence: true, enableWorkers: false,
  });
  const frameSource: V3RuntimeDependencies['frameSource'] = {
    now, viewport: () => viewport,
    camera: () => Object.freeze({ position: { x: 0, y: 80, z: 120 }, target: { x: 0, y: 0, z: 0 }, fov: 60, near: 0.1, far: 30_000, dpr: viewport.dpr }),
  };
  kernel = createV3RuntimeKernel({ config, dependencies: { now, frameSource } });
  state.backend = message.backend;
  state.ready = true;
  reply({ type: 'ready', workerId: `v3-${message.seed.toString(16)}`, backend: message.backend, supportsOffscreenCanvas: detectWorkerCapabilities(message.backend).offscreenCanvas });
}

async function handle(message: V3WorkerMessage): Promise<void> {
  if (!isV3WorkerMessage(message)) return;
  assertDirection(message, 'main-to-worker');
  switch (message.type) {
    case 'handshake':
      bootstrap(message);
      if (kernel) await kernel.start();
      break;
    case 'tick':
      if (state.ready && kernel) {
        const snapshot = kernel.tick(message.nowMs);
        reply({ type: 'snapshot', snapshot });
        reply({ type: 'render-packet', packet: kernel.renderPacket() });
      }
      break;
    case 'action':
      if (state.ready) kernel?.dispatch(message.action);
      break;
    case 'pause': kernel?.pause(message.reason); break;
    case 'resume': kernel?.resume(message.reason); break;
    case 'stop': if (kernel) await kernel.stop(message.reason); state.ready = false; break;
    case 'dispose': if (kernel) await kernel.dispose(); state.ready = false; state.disposed = true; break;
    case 'ready':
    case 'snapshot':
    case 'render-packet':
    case 'device-state':
    case 'error':
      throw new Error(`Unexpected worker-to-main message on worker host: ${message.type}`);
  }
}

scope.addEventListener('message', event => {
  if (state.disposed) return;
  void handle(event.data as V3WorkerMessage).catch(error => {
    const failure = normalizeWorkerError(error);
    reply({ type: 'error', ...failure });
  });
});

reply({ type: 'device-state', backend: state.backend, lost: false });

export const V3_WORKER_ENTRY_READY = true;
