import {
  stableDigest,
  type InputFrame,
  type InputIntent,
  type QualityDecision,
  type Result,
  type R43RuntimeOptions,
  type RuntimeHealth,
  type RuntimeFrameResult,
  type RuntimeCommand,
  type RawInputSnapshot,
} from './contracts.ts';
import { R43Runtime } from './runtime.ts';

export interface LegacyStateAdapter {
  set?(key: string, value: unknown): void;
  get?(key: string): unknown;
}

export interface LegacyRendererAdapter {
  setPixelRatio?(ratio: number): void;
  setQuality?(tier: QualityDecision['tier']): void;
  setBackend?(backend: string): void;
}

export interface GameBridgeOptions extends R43RuntimeOptions {
  readonly state?: LegacyStateAdapter;
  readonly renderer?: LegacyRendererAdapter;
  readonly eventPrefix?: string;
}

export interface GameBridgeFrameInput {
  readonly deltaSeconds: number;
  readonly frameMs: number;
  readonly cpuMs: number;
  readonly gpuMs?: number;
  readonly input?: RawInputSnapshot;
  readonly frameNumber?: number;
}

export interface GameBridgeSnapshot {
  readonly runtime: RuntimeFrameResult;
  readonly input?: InputIntent;
  readonly digest: string;
}

export interface R43GameBridge {
  readonly runtime: R43Runtime;
  initialize(): Result<RuntimeFrameResult>;
  frame(input: GameBridgeFrameInput): Result<GameBridgeSnapshot>;
  command(command: RuntimeCommand): Result<true>;
  pause(reason?: string): Result<true>;
  resume(): Result<true>;
  health(): RuntimeHealth;
  dispose(): void;
}

export function createR43GameBridge(options: GameBridgeOptions = {}): R43GameBridge {
  const runtime = new R43Runtime(options);
  const state = options.state ?? {};
  const renderer = options.renderer ?? {};
  const prefix = options.eventPrefix ?? 'aapw:r43';

  const publish = (name: string, detail: unknown): void => {
    if (typeof globalThis.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') return;
    globalThis.dispatchEvent(new globalThis.CustomEvent(prefix + ':' + name, { detail }));
  };

  const sync = (result: RuntimeFrameResult): void => {
    state.set?.('r43Frame', result.frame);
    state.set?.('r43Tick', result.tick);
    state.set?.('r43Digest', result.digest);
    state.set?.('r43Health', result.health);
    state.set?.('r43Quality', result.quality);
    state.set?.('r43Snapshot', result.snapshot);
    renderer.setPixelRatio?.(result.quality.renderScale);
    renderer.setQuality?.(result.quality.tier);
    publish('frame', result);
  };

  const initialize = (): Result<RuntimeFrameResult> => {
    const result = runtime.initialize();
    if (result.ok && result.value) sync(result.value);
    return result;
  };

  const frame = (input: GameBridgeFrameInput): Result<GameBridgeSnapshot> => {
    const frameNumber = input.frameNumber ?? runtime.clock.frame() + 1;
    const intent = input.input ? runtime.submitInput(frameNumber, input.input) : undefined;
    const result = runtime.frame(input.deltaSeconds, input.frameMs, input.cpuMs, input.gpuMs ?? 0);
    if (!result.ok || !result.value) return result as Result<GameBridgeSnapshot>;
    sync(result.value);
    const snapshot: GameBridgeSnapshot = Object.freeze({
      runtime: result.value,
      ...(intent ? { input: intent } : {}),
      digest: stableDigest({
        frame: result.value.frame,
        tick: result.value.tick,
        runtimeDigest: result.value.digest,
        input: intent,
      }),
    });
    publish('snapshot', snapshot);
    return { ok: true, value: snapshot };
  };

  return {
    runtime,
    initialize,
    frame,
    command: (command) => runtime.enqueue(command),
    pause: (reason = 'bridge') => runtime.pause(reason),
    resume: () => runtime.resume(),
    health: () => runtime.healthSnapshot(),
    dispose: () => {
      runtime.shutdown();
      publish('disposed', { digest: stableDigest(runtime.snapshotResult()) });
    },
  };
}

export function inputFrameIntent(frame: InputFrame): InputIntent {
  return frame.intent;
}
