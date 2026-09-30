import type { CameraState, FrameId, RuntimeSnapshot, QualityTier } from "../types.ts";
import { tickModernRuntime, type RuntimeFrameInput, type RuntimeServices } from "../runtime.ts";
import {
  frameV15,
  type FrameObservationV15,
  type InputIntentV15,
  type QualityDecisionV15,
} from "./types.ts";
import { RuntimeSupervisorV15, type RuntimeSupervisorOptionsV15, createRuntimeSupervisorV15 } from "./runtimeSupervisor.ts";

export interface V15BridgeFrameInput {
  readonly frame?: number;
  readonly frameMs: number;
  readonly cpuMs?: number;
  readonly gpuMs?: number;
  readonly drawCalls?: number;
  readonly triangles?: number;
  readonly visibleObjects?: number;
  readonly textureBytes?: number;
  readonly memoryPressure?: number;
  readonly thermalPressure?: number;
  readonly camera: CameraState;
  readonly input?: InputIntentV15;
}

export interface V15BridgeSnapshot {
  readonly legacyRuntime: RuntimeSnapshot;
  readonly supervisor: Awaited<ReturnType<RuntimeSupervisorV15["tick"]>>;
  readonly qualityChanged: boolean;
  readonly quality: QualityDecisionV15;
}

export interface V15PlatformBridgeOptions extends RuntimeSupervisorOptionsV15 {
  readonly runtime: RuntimeServices;
  readonly qualityMapper?: (tier: QualityTier) => "minimal" | "balanced" | "high" | "ultra";
}

const identityQuality = (tier: QualityTier): "minimal" | "balanced" | "high" | "ultra" =>
  tier === "minimal" || tier === "balanced" || tier === "high" || tier === "ultra" ? tier : "balanced";

function toObservation(input: V15BridgeFrameInput, frame: number, timestampMs: number): FrameObservationV15 {
  return Object.freeze({
    frame: frameV15(frame),
    frameMs: Math.max(0, Math.min(250, input.frameMs)),
    cpuMs: Math.max(0, input.cpuMs ?? input.frameMs),
    gpuMs: input.gpuMs === undefined ? null : Math.max(0, input.gpuMs),
    drawCalls: Math.max(0, Math.floor(input.drawCalls ?? 0)),
    triangles: Math.max(0, Math.floor(input.triangles ?? 0)),
    visibleObjects: Math.max(0, Math.floor(input.visibleObjects ?? 0)),
    textureBytes: Math.max(0, Math.floor(input.textureBytes ?? 0)),
    memoryPressure: Math.max(0, Math.min(1, input.memoryPressure ?? 0)),
    thermalPressure: Math.max(0, Math.min(1, input.thermalPressure ?? 0)),
    timestampMs,
  });
}

function toRuntimeInput(input: V15BridgeFrameInput, frame: number): RuntimeFrameInput {
  return {
    frame: frame as FrameId,
    frameMs: Math.max(0, Math.min(250, input.frameMs)),
    cpuMs: Math.max(0, input.cpuMs ?? input.frameMs),
    gpuMs: input.gpuMs,
    drawCalls: Math.max(0, Math.floor(input.drawCalls ?? 0)),
    triangles: Math.max(0, Math.floor(input.triangles ?? 0)),
    visibleObjects: Math.max(0, Math.floor(input.visibleObjects ?? 0)),
    textureBytes: Math.max(0, Math.floor(input.textureBytes ?? 0)),
    memoryPressure: input.memoryPressure,
    thermalPressure: input.thermalPressure,
    camera: input.camera,
  };
}

export class ModernRuntimePlatformBridgeV15 {
  readonly runtime: RuntimeServices;
  readonly supervisor: RuntimeSupervisorV15;
  readonly #qualityMapper: (tier: QualityTier) => "minimal" | "balanced" | "high" | "ultra";
  #lastFrame = 0;
  #lastQuality: "minimal" | "balanced" | "high" | "ultra" = "balanced";
  #lastSnapshot: V15BridgeSnapshot | undefined;

  constructor(options: V15PlatformBridgeOptions) {
    this.runtime = options.runtime;
    this.supervisor = createRuntimeSupervisorV15({
      canvas: options.canvas,
      initialQuality: identityQuality(options.initialQuality ?? "balanced"),
      telemetryCapacity: options.telemetryCapacity,
      seed: options.seed,
      autoInitialize: false,
    });
    this.#qualityMapper = options.qualityMapper ?? identityQuality;
  }

  async initialize(canvas?: HTMLCanvasElement): Promise<void> {
    await this.supervisor.initialize({ canvas });
    this.#lastQuality = this.#qualityMapper(this.supervisor.quality.tier);
  }

  async frame(input: V15BridgeFrameInput): Promise<V15BridgeSnapshot> {
    const frame = Math.max(this.#lastFrame + 1, Math.floor(input.frame ?? this.#lastFrame + 1));
    const timestampMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    const observation = toObservation(input, frame, timestampMs);
    const previousQuality = this.#lastQuality;
    const legacyRuntime = tickModernRuntime(this.runtime, toRuntimeInput(input, frame));
    const supervisor = await this.supervisor.tick(observation, input.input);
    this.#lastFrame = frame;
    this.#lastQuality = this.#qualityMapper(supervisor.quality.tier);
    const snapshot = Object.freeze({
      legacyRuntime,
      supervisor,
      qualityChanged: previousQuality !== this.#lastQuality,
      quality: supervisor.quality,
    });
    this.#lastSnapshot = snapshot;
    return snapshot;
  }

  latest(): V15BridgeSnapshot | undefined { return this.#lastSnapshot; }
  setStreamInterest(interest: Parameters<RuntimeSupervisorV15["setStreamInterest"]>[0]): void { this.supervisor.setStreamInterest(interest); }
  defineChunk(spec: Parameters<RuntimeSupervisorV15["defineChunk"]>[0]): boolean { return this.supervisor.defineChunk(spec); }
  observeKeyboard(code: string, down: boolean, timestampMs: number): void { this.supervisor.observeKeyboard(code, down, timestampMs); }
  observePointer(button: number, down: boolean, timestampMs: number): void { this.supervisor.observePointer(button, down, timestampMs); }
  observeTouchMove(x: number, y: number): void { this.supervisor.observeTouchMove(x, y); }
  async dispose(): Promise<void> { await this.supervisor.dispose(); }
}

export function createV15PlatformBridge(options: V15PlatformBridgeOptions): ModernRuntimePlatformBridgeV15 {
  return new ModernRuntimePlatformBridgeV15(options);
}
