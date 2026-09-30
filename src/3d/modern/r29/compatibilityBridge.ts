import { createAapwRuntimeApi, type RuntimePublicApi } from '../r28/runtimeApi.ts';
import { R29Runtime, type R29RuntimeOptions } from './runtime.ts';
import type { R29RuntimeSnapshot } from './contracts.ts';

export interface R29CompatibilityBridgeOptions {
  readonly r29?: R29RuntimeOptions;
  readonly legacyRuntime?: RuntimePublicApi;
  readonly shadowMode?: boolean;
  readonly shadowTolerance?: number;
}

export interface R29CompatibilityReport {
  readonly shadowMode: boolean;
  readonly r29Tick: number;
  readonly legacyTick: number;
  readonly frameMs: number;
  readonly deltaTick: number;
  readonly withinTolerance: boolean;
  readonly warnings: readonly string[];
}

export class R29CompatibilityBridge {
  readonly runtime: R29Runtime;
  readonly legacy: RuntimePublicApi;
  readonly shadowMode: boolean;
  readonly shadowTolerance: number;

  #lastReport: R29CompatibilityReport = Object.freeze({
    shadowMode: false,
    r29Tick: 0,
    legacyTick: 0,
    frameMs: 0,
    deltaTick: 0,
    withinTolerance: true,
    warnings: [],
  });

  constructor(options: R29CompatibilityBridgeOptions = {}) {
    this.runtime = new R29Runtime(options.r29);
    this.legacy = options.legacyRuntime ?? createAapwRuntimeApi();
    this.shadowMode = options.shadowMode ?? true;
    this.shadowTolerance = Math.max(0, options.shadowTolerance ?? 2);
  }

  async start(): Promise<void> {
    await this.runtime.start();
    this.legacy.mount();
    this.legacy.start();
  }

  async frame(deltaSeconds: number): Promise<R29CompatibilityReport> {
    const started = performance.now();
    await this.runtime.frame(deltaSeconds);
    const legacyHealth = this.legacy.step(Math.max(0, Math.min(0.25, deltaSeconds)));
    const r29Tick = this.runtime.snapshot().tick;
    const legacyTick = legacyHealth.tick;
    const deltaTick = Math.abs(r29Tick - legacyTick);
    const warnings: string[] = [];
    if (!this.shadowMode) warnings.push('shadow-disabled');
    if (legacyHealth.status === 'critical') warnings.push('legacy-critical');
    if (deltaTick > this.shadowTolerance) warnings.push('tick-drift');
    this.#lastReport = Object.freeze({
      shadowMode: this.shadowMode,
      r29Tick,
      legacyTick,
      frameMs: performance.now() - started,
      deltaTick,
      withinTolerance: deltaTick <= this.shadowTolerance,
      warnings: Object.freeze(warnings),
    });
    return this.#lastReport;
  }

  snapshot(): R29RuntimeSnapshot {
    return this.runtime.snapshot();
  }

  report(): R29CompatibilityReport {
    return this.#lastReport;
  }

  async stop(): Promise<void> {
    await this.runtime.stop();
    this.legacy.stop();
  }

  dispose(): void {
    this.runtime.dispose();
    this.legacy.dispose();
  }
}

export function createR29CompatibilityBridge(options: R29CompatibilityBridgeOptions = {}): R29CompatibilityBridge {
  return new R29CompatibilityBridge(options);
}
