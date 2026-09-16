import type { Disposable, Vec3 } from './types.js';
import { createModernEngineFacade, type ModernEngineFacade } from './index.js';
import { RenderFrameBuilder, normalizeCameraPacket, type CameraPacket, type DrawPacket, type RenderFramePacket } from './renderPacket.js';
import { scaleForPressure } from './quality.js';
import type { StreamCamera, StreamChunk, StreamPlan } from './streaming.js';

export interface ModernRuntimeFrameInput {
  readonly deltaSeconds: number;
  readonly camera: CameraPacket;
  readonly streamCamera?: StreamCamera;
  readonly streamChunks?: readonly StreamChunk[];
  readonly drawPackets?: readonly DrawPacket[];
  readonly cpuRatio?: number;
  readonly gpuRatio?: number;
  readonly frameRatio?: number;
  readonly memoryRatio?: number;
  readonly thermalRatio?: number;
  readonly droppedFrames?: number;
  readonly tick?: number;
}

export interface ModernRuntimeFrame {
  readonly frame: number;
  readonly tick: number;
  readonly runtimeChecksum: string;
  readonly renderPacket: RenderFramePacket;
  readonly streamPlan: StreamPlan;
  readonly qualityRevision: number;
  readonly qualityTier: ModernEngineFacade['quality']['currentTier'];
  readonly renderScale: number;
  readonly assetBytes: number;
  readonly assetUtilization: number;
}

export interface ModernRuntimeHealth {
  readonly ready: boolean;
  readonly backend: string;
  readonly quality: string;
  readonly runtimePhase: string;
  readonly resourceUtilization: number;
  readonly assetUtilization: number;
  readonly lastFrame?: ModernRuntimeFrame;
}

export interface ModernGameRuntimeOptions {
  readonly facade?: ModernEngineFacade;
  readonly renderPacket?: { readonly maxDraws?: number; readonly maxShadows?: number; readonly maxAnimated?: number; readonly maxTransparent?: number; readonly maxDistance?: number };
}

export class ModernGameRuntime implements Disposable {
  public readonly facade: ModernEngineFacade;
  private readonly renderBuilder: RenderFrameBuilder;
  private frameValue = 0;
  private tickValue = 0;
  private started = false;
  private disposedValue = false;
  private lastFrameValue: ModernRuntimeFrame | undefined;

  public constructor(options: ModernGameRuntimeOptions = {}) {
    this.facade = options.facade ?? createModernEngineFacade();
    this.renderBuilder = new RenderFrameBuilder({ ...options.renderPacket, renderScale: this.facade.quality.profile().renderScale });
  }

  public get disposed(): boolean { return this.disposedValue; }
  public get frame(): number { return this.frameValue; }
  public get tick(): number { return this.tickValue; }
  public get health(): ModernRuntimeHealth {
    return Object.freeze({ ready: this.started && !this.disposedValue, backend: String(this.facade.backend), quality: this.facade.quality.currentTier, runtimePhase: this.facade.runtime.health.phase, resourceUtilization: maxUtilization(this.facade.resources.quotas()), assetUtilization: this.facade.assets.stats.utilization, ...(this.lastFrameValue ? { lastFrame: this.lastFrameValue } : {}) });
  }

  public start(): boolean {
    if (this.disposedValue) return false;
    if (this.started) return true;
    const result = this.facade.runtime.initialize();
    this.started = result.ok;
    return this.started;
  }

  public step(input: ModernRuntimeFrameInput): ModernRuntimeFrame {
    if (this.disposedValue) return this.emptyFrame(input.camera);
    this.start();
    this.frameValue += 1;
    if (input.tick !== undefined) this.tickValue = Math.max(this.tickValue + 1, Math.trunc(input.tick));
    else this.tickValue += 1;
    const qualityDecision = this.facade.quality.update({ cpuRatio: input.cpuRatio, gpuRatio: input.gpuRatio, frameRatio: input.frameRatio, memoryRatio: input.memoryRatio, thermalRatio: input.thermalRatio, droppedFrames: input.droppedFrames }, this.frameValue);
    this.facade.resources.resetFrameUsage();
    this.facade.assets.setTick(this.tickValue);
    const runtimeResult = this.facade.runtime.advance({ deltaSeconds: input.deltaSeconds });
    const renderScale = scaleForPressure(qualityDecision.next, qualityDecision.pressure);
    this.renderBuilder.clear();
    this.renderBuilder.setFrame(this.frameValue, this.tickValue);
    for (const draw of input.drawPackets ?? []) this.renderBuilder.add(draw);
    const camera = normalizeCameraPacket(input.camera);
    const renderPacket = this.renderBuilder.build({ ...camera, pixelRatio: Math.max(0.5, camera.pixelRatio * renderScale) });
    const streamPlan = input.streamChunks && input.streamCamera ? this.facade.streaming.plan(input.streamChunks, input.streamCamera, this.tickValue) : emptyStreamPlan(this.tickValue);
    this.facade.telemetry.record('modern.runtime.frame', Number(input.deltaSeconds), 's', { backend: String(this.facade.backend), quality: qualityDecision.next });
    this.facade.telemetry.record('modern.runtime.renderScale', renderScale, 'ratio', { quality: qualityDecision.next });
    this.facade.telemetry.record('modern.runtime.visibleDraws', renderPacket.stats.visible, 'count', { pass: 'render-packet' });
    this.facade.telemetry.record('modern.runtime.streamLoads', streamPlan.loads.length, 'count', { kind: 'streaming' });
    const frame: ModernRuntimeFrame = Object.freeze({ frame: this.frameValue, tick: this.tickValue, runtimeChecksum: runtimeResult.frame.checksum, renderPacket, streamPlan, qualityRevision: qualityDecision.revision, qualityTier: qualityDecision.next, renderScale, assetBytes: this.facade.assets.stats.bytesResident, assetUtilization: this.facade.assets.stats.utilization });
    this.lastFrameValue = frame;
    return frame;
  }

  public tickSimulation(deltaSeconds: number): ModernRuntimeFrame | undefined {
    const position: Vec3 = { x: 0, y: 0, z: 0 };
    if (!this.lastFrameValue) return undefined;
    return this.step({ deltaSeconds, camera: { position, forward: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 }, near: 0.1, far: 1000, fovDegrees: 60, aspect: 1, viewportWidth: 1, viewportHeight: 1, pixelRatio: 1 } });
  }

  public dispose(): void {
    if (this.disposedValue) return;
    this.disposedValue = true;
    this.lastFrameValue = undefined;
    this.facade.dispose();
  }

  private emptyFrame(camera: CameraPacket): ModernRuntimeFrame {
    const normalized = normalizeCameraPacket(camera);
    const renderPacket = this.renderBuilder.build(normalized);
    return Object.freeze({ frame: this.frameValue, tick: this.tickValue, runtimeChecksum: '00000000', renderPacket, streamPlan: emptyStreamPlan(this.tickValue), qualityRevision: this.facade.quality.revisionNumber, qualityTier: this.facade.quality.currentTier, renderScale: 0.5, assetBytes: 0, assetUtilization: 0 });
  }
}

const emptyStreamPlan = (revision: number): StreamPlan => Object.freeze({ decisions: Object.freeze([]), loads: Object.freeze([]), unloads: Object.freeze([]), retries: Object.freeze([]), retained: Object.freeze([]), memoryBytes: 0, entityCount: 0, revision });
const maxUtilization = (quotas: readonly { readonly utilization: number }[]): number => quotas.reduce((max, item) => Math.max(max, item.utilization), 0);

export const createModernGameRuntime = (options: ModernGameRuntimeOptions = {}): ModernGameRuntime => new ModernGameRuntime(options);
