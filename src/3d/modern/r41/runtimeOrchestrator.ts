import {
  R41RuntimeKernel,
} from './runtimeKernel';
import {
  DeterministicModuleGraph,
} from './moduleGraph';
import { RuntimeLifecycle } from './lifecycle';
import { RenderFrameBudget } from './renderFrameBudget';
import { RuntimeErrorBoundary } from './errorBoundary';
import type { Tick } from './contracts';

export interface OrchestratorSnapshot {
  readonly tick: number;
  readonly phase: string;
  readonly lifecycle: string;
  readonly modules: readonly string[];
  readonly errors: number;
  readonly framePressure: number;
}

export class R41RuntimeOrchestrator {
  readonly kernel: R41RuntimeKernel;
  readonly modules =
    new DeterministicModuleGraph();
  readonly lifecycle =
    new RuntimeLifecycle();
  readonly frameBudget =
    new RenderFrameBudget();
  readonly errors =
    new RuntimeErrorBoundary();

  #initialized = false;

  constructor(
    kernel = new R41RuntimeKernel(),
  ) {
    this.kernel = kernel;
  }

  async initialize(): Promise<void> {
    if (this.#initialized) {
      return;
    }

    const moduleReport =
      await this.modules.initialize();

    if (moduleReport.failed.length > 0) {
      throw new Error(
        'R41_MODULE_INITIALIZATION_FAILED',
      );
    }

    await this.lifecycle.initialize();
    this.kernel.boot();
    this.#initialized = true;
  }

  async start(): Promise<void> {
    await this.initialize();
    await this.lifecycle.start();
    this.kernel.start();
  }

  frame(deltaMs: number): Tick {
    try {
      return this.kernel.frame(deltaMs);
    } catch (error) {
      this.errors.capture(
        this.kernel.clock.tick().index,
        'frame',
        error,
        true,
      );
      throw error;
    }
  }

  pause(): void {
    this.kernel.pause();
    this.lifecycle.pause();
  }

  resume(): void {
    this.kernel.resume();
    this.lifecycle.resume();
  }

  async stop(): Promise<void> {
    await this.lifecycle.stop();
    this.kernel.stop();
    this.#initialized = false;
  }

  snapshot(): OrchestratorSnapshot {
    const health =
      this.kernel.health();

    const metric =
      this.kernel.telemetry
        .metrics()
        .at(-1);

    const frame =
      this.frameBudget.evaluate({
        frameMs: metric?.value ?? 0,
        gpuMs: 0,
        cpuMs: 0,
        drawCalls: 0,
        triangles: 0,
        passes:
          this.kernel.events.size,
      });

    return Object.freeze({
      tick: health.tick,
      phase: health.phase,
      lifecycle:
        this.lifecycle.state(),
      modules: this.modules.order(),
      errors:
        this.errors.errors().length,
      framePressure:
        frame.pressure,
    });
  }

  clear(): void {
    this.errors.clear();
    this.modules.clear();
    this.lifecycle.clear();
    this.#initialized = false;
  }
}
