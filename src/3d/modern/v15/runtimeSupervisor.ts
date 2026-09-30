import { NextGenRuntimeV14 } from "../nextGenRuntimeV14.ts";
import { checksumV15, frameV15, sequenceV15, type DeviceCapabilitiesV15, type FrameObservationV15, type InputIntentV15, type QualityDecisionV15, type RuntimeHealthV15, type RuntimeModeV15 } from "./types.ts";
import { AdaptiveQualityDirectorV15 } from "./adaptiveQuality.ts";
import { probeCapabilitiesV15 } from "./capabilityProbe.ts";
import { FixedFrameSchedulerV15 } from "./frameScheduler.ts";
import { SemanticInputPipelineV15, type InputButtonV15 } from "./inputPipeline.ts";
import { AssetPipelineV15 } from "./assetPipeline.ts";
import { PredictiveWorldPartitionV15 } from "./worldPartition.ts";
import { SecureNetworkEnvelopeV15 } from "./networkEnvelope.ts";
import { MemorySaveStorageV15, SaveManagerV15 } from "./saveStore.ts";
import { RenderTelemetryBufferV15 } from "./renderTelemetry.ts";

export interface RuntimeSupervisorOptionsV15 {
  readonly canvas?: HTMLCanvasElement;
  readonly initialQuality?: "minimal" | "balanced" | "high" | "ultra";
  readonly telemetryCapacity?: number;
  readonly seed?: number;
  readonly autoInitialize?: boolean;
}

export interface RuntimeSupervisorSnapshotV15 {
  readonly frame: number;
  readonly tick: number;
  readonly mode: RuntimeModeV15;
  readonly capabilities: DeviceCapabilitiesV15;
  readonly quality: QualityDecisionV15;
  readonly health: RuntimeHealthV15;
  readonly scheduler: Readonly<ReturnType<FixedFrameSchedulerV15["snapshot"]>>;
  readonly assets: Readonly<ReturnType<AssetPipelineV15["stats"]>>;
  readonly world: Readonly<ReturnType<PredictiveWorldPartitionV15["stats"]>>;
  readonly network: Readonly<ReturnType<SecureNetworkEnvelopeV15["stats"]>>;
  readonly telemetry: Readonly<ReturnType<RenderTelemetryBufferV15["averages"]>>;
  readonly saveRevision: number;
  readonly checksum: number;
}

const baselineCapabilities: DeviceCapabilitiesV15 = Object.freeze({
  backend: "webgl2", webgpuAvailable: false, webgl2Available: false, mobile: false, touch: false,
  reducedMotion: false, batterySaver: false, hardwareConcurrency: 4, deviceMemoryGb: null,
  devicePixelRatio: 1, maxTextureDimension: null, timestamp: 0,
});
const baselineObservation: FrameObservationV15 = Object.freeze({
  frame: frameV15(0), frameMs: 16.67, cpuMs: 8, gpuMs: null, drawCalls: 0, triangles: 0,
  visibleObjects: 0, textureBytes: 0, memoryPressure: 0, thermalPressure: 0, timestampMs: 0,
});
const baselineInput: InputIntentV15 = Object.freeze({
  sequence: sequenceV15(0), timestampMs: 0, move: { x: 0, y: 0 }, look: { x: 0, y: 0 },
  buttons: 0, actions: Object.freeze([]), source: "system",
});

export class RuntimeSupervisorV15 {
  readonly scheduler: FixedFrameSchedulerV15;
  readonly quality: AdaptiveQualityDirectorV15;
  readonly input: SemanticInputPipelineV15;
  readonly assets: AssetPipelineV15;
  readonly world: PredictiveWorldPartitionV15;
  readonly network: SecureNetworkEnvelopeV15<unknown>;
  readonly saves: SaveManagerV15<unknown>;
  readonly telemetry: RenderTelemetryBufferV15;
  readonly controlPlane: NextGenRuntimeV14;

  #capabilities = baselineCapabilities;
  #observation = baselineObservation;
  #input = baselineInput;
  #telemetryCapacity: number;
  #seed: number;
  #initialized = false;
  #initialization: Promise<void> | undefined;
  #disposed = false;

  constructor(options: RuntimeSupervisorOptionsV15 = {}) {
    this.scheduler = new FixedFrameSchedulerV15();
    this.quality = new AdaptiveQualityDirectorV15({ initial: options.initialQuality ?? "balanced" });
    this.input = new SemanticInputPipelineV15();
    this.assets = new AssetPipelineV15();
    this.world = new PredictiveWorldPartitionV15();
    this.network = new SecureNetworkEnvelopeV15();
    this.saves = new SaveManagerV15<unknown>(new MemorySaveStorageV15());
    this.telemetry = new RenderTelemetryBufferV15(options.telemetryCapacity ?? 720);
    this.controlPlane = new NextGenRuntimeV14({ initialQuality: options.initialQuality });
    this.#telemetryCapacity = Math.max(32, Math.min(10_000, Math.floor(options.telemetryCapacity ?? 720)));
    this.#seed = Number.isInteger(options.seed) ? Number(options.seed) : 0xA4F15;
    if (options.autoInitialize) {
      this.#initialization = this.#initializeInternal({ canvas: options.canvas });
      void this.#initialization.catch(() => undefined);
    }
  }

  async initialize(options: Pick<RuntimeSupervisorOptionsV15, "canvas"> = {}): Promise<void> {
    if (this.#disposed) throw new Error("runtime supervisor disposed");
    if (this.#initialized) return;
    if (this.#initialization) {
      await this.#initialization;
      return;
    }
    const promise = this.#initializeInternal(options);
    this.#initialization = promise;
    try { await promise; } finally { if (this.#initialization === promise) this.#initialization = undefined; }
  }

  async #initializeInternal(options: Pick<RuntimeSupervisorOptionsV15, "canvas">): Promise<void> {
    this.#capabilities = await probeCapabilitiesV15({ canvas: options.canvas });
    this.#initialized = true;
  }

  get initialized(): boolean { return this.#initialized; }
  get capabilities(): DeviceCapabilitiesV15 { return this.#capabilities; }
  get seed(): number { return this.#seed; }

  async tick(observation: Omit<FrameObservationV15, "frame"> & { readonly frame?: number }, input?: InputIntentV15): Promise<RuntimeSupervisorSnapshotV15> {
    await this.initialize();
    if (this.#disposed) throw new Error("runtime supervisor disposed");
    const frame = frameV15(Math.max(0, Math.floor(observation.frame ?? this.scheduler.frame + 1)));
    const current: FrameObservationV15 = Object.freeze({ ...observation, frame });
    this.#observation = current;
    this.#input = input ?? this.#input;
    this.telemetry.push({
      frame: Number(frame),
      backend: this.#capabilities.backend,
      gpuMs: current.gpuMs,
      cpuMs: current.cpuMs,
      frameMs: current.frameMs,
      drawCalls: current.drawCalls,
      triangles: current.triangles,
      visibleObjects: current.visibleObjects,
      textureBytes: current.textureBytes,
      renderScale: this.quality.decision().renderScale,
      quality: this.quality.tier,
    });
    this.#qualitySample(current);
    this.scheduler.step(current.frameMs / 1000, () => undefined);
    this.assets.update(this.scheduler.tick);
    try {
      await this.controlPlane.tick({
        frameMs: current.frameMs, cpuMs: current.cpuMs, gpuMs: current.gpuMs ?? undefined,
        memoryPressure: current.memoryPressure, thermalPressure: current.thermalPressure,
        drawCalls: current.drawCalls, visibleObjects: current.visibleObjects,
      }, {
        sequence: Number(this.#input.sequence), timestampMs: this.#input.timestampMs,
        move: this.#input.move, look: this.#input.look, buttons: this.#input.buttons,
        actions: this.#input.actions, source: this.#input.source,
      });
    } catch {
      // Optional v14 control-plane failures remain visible through v15 health.
    }
    return this.snapshot();
  }

  #qualitySample(observation: FrameObservationV15): void {
    this.quality.observe(observation);
  }

  observeKeyboard(code: string, isDown: boolean, timestampMs: number): void { this.input.ingestKeyboard(code, isDown, timestampMs); }
  observePointer(button: number, isDown: boolean, timestampMs: number): void { this.input.ingestPointer(button, isDown, timestampMs); }
  observeTouchMove(x: number, y: number): void { this.input.ingestTouchMove(x, y); }

  observeGamepad(moveX: number, moveY: number, lookX: number, lookY: number, buttons: Readonly<Partial<Record<InputButtonV15, boolean>>>, timestampMs: number): void {
    this.input.ingestGamepad(moveX, moveY, lookX, lookY, buttons, timestampMs);
  }

  consumeInput(timestampMs: number): InputIntentV15 { this.#input = this.input.consume(timestampMs); return this.#input; }

  setMode(mode: RuntimeModeV15): void { this.scheduler.setMode(mode); }
  setStreamInterest(interest: Parameters<PredictiveWorldPartitionV15["setInterest"]>[0]): void { this.world.setInterest(interest); }
  defineChunk(spec: Parameters<PredictiveWorldPartitionV15["define"]>[0]): boolean { return this.world.define(spec); }

  connectNetwork(): void { this.network.connect(); }
  readyNetwork(): void { this.network.ready(); }
  disconnectNetwork(): void { this.network.disconnect(); }

  health(): RuntimeHealthV15 {
    const pressure = this.quality.pressure().combined;
    const reasons: string[] = [];
    if (!this.#capabilities.webgl2Available && this.#capabilities.backend === "webgl2") reasons.push("webgl2-unavailable");
    if (this.#capabilities.webgpuAvailable && this.#capabilities.backend === "webgl2") reasons.push("webgpu-fallback");
    if (this.#capabilities.batterySaver) reasons.push("battery-saver");
    if (pressure >= 0.9) reasons.push("runtime-pressure-critical");
    else if (pressure >= 0.78) reasons.push("runtime-pressure-high");
    if (this.scheduler.pressureScore() >= 0.85) reasons.push("scheduler-overload");
    if (this.telemetry.percentileFrameMs(0.95) > 33.33) reasons.push("frame-p95-high");
    const score = Math.max(0, Math.min(100, Math.round(100 - pressure * 70 - reasons.length * 6)));
    return Object.freeze({
      state: score < 45 ? "critical" : score < 72 ? "degraded" : "healthy",
      score, reasons: Object.freeze(reasons),
      observation: this.#observation, quality: this.quality.decision(), capabilities: this.#capabilities,
    });
  }

  snapshot(): RuntimeSupervisorSnapshotV15 {
    const health = this.health();
    const scheduler = this.scheduler.snapshot();
    const assets = this.assets.stats();
    const world = this.world.stats();
    const network = this.network.stats();
    const telemetry = this.telemetry.averages(Math.min(60, Math.max(1, this.telemetry.size())));
    const payload = {
      frame: scheduler.frame, tick: scheduler.tick, mode: scheduler.mode,
      capabilities: this.#capabilities, quality: this.quality.decision(), health,
      scheduler, assets, world, network, telemetry, saveRevision: Number(this.saves.revision()), seed: this.#seed,
    };
    return Object.freeze({
      frame: scheduler.frame, tick: scheduler.tick, mode: scheduler.mode,
      capabilities: this.#capabilities, quality: this.quality.decision(), health,
      scheduler, assets, world, network, telemetry, saveRevision: Number(this.saves.revision()),
      checksum: checksumV15(payload),
    });
  }

  recentTelemetry(): readonly (ReturnType<RenderTelemetryBufferV15["latest"]>)[] {
    return Object.freeze(this.telemetry.window(this.#telemetryCapacity).map(sample => sample));
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.scheduler.setMode("suspended");
    this.network.disconnect();
  }
}

export function createRuntimeSupervisorV15(options: RuntimeSupervisorOptionsV15 = {}): RuntimeSupervisorV15 {
  return new RuntimeSupervisorV15(options);
}
