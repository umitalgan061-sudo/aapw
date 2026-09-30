import { BrowserRuntimeHost, type BrowserHostOptions } from './browserHost.ts';
import { RuntimeDiagnosticsBridge, type RuntimeHealthReport } from './diagnosticsBridge.ts';
import { RuntimeTelemetry } from './telemetry.ts';
import { RuntimeVirtualConsole } from './virtualConsole.ts';
import { createR28IntegrationManifest, type R28IntegrationManifest } from './integrationManifest.ts';
import { profileRuntimeEnvironment, readBrowserCapabilities } from './environment.ts';

export interface RuntimePublicApi {
  readonly host: BrowserRuntimeHost;
  readonly manifest: R28IntegrationManifest;
  readonly telemetry: RuntimeTelemetry;
  readonly console: RuntimeVirtualConsole;
  mount(): void;
  start(): void;
  stop(): void;
  dispose(): void;
  step(deltaSeconds: number): RuntimeHealthReport;
}

export class AapwRuntimeApi implements RuntimePublicApi {
  readonly host: BrowserRuntimeHost;
  readonly manifest: R28IntegrationManifest;
  readonly telemetry = new RuntimeTelemetry();
  readonly console = new RuntimeVirtualConsole();
  readonly diagnostics = new RuntimeDiagnosticsBridge();

  constructor(options: BrowserHostOptions = {}) {
    const capabilities = readBrowserCapabilities();
    const environment = profileRuntimeEnvironment(capabilities);
    this.manifest = createR28IntegrationManifest(capabilities, {
      tickRate: options.tickRate,
      maxStepsPerFrame: options.maxStepsPerFrame,
      features: { runtimeApi: true, qualityLevel: environment.qualityHint > 0 },
    });
    this.host = new BrowserRuntimeHost({
      ...options,
      tickRate: this.manifest.runtime.tickRate,
      maxStepsPerFrame: this.manifest.runtime.maxStepsPerFrame,
      qualityLevel: options.qualityLevel ?? environment.qualityHint,
    });
  }

  mount(): void {
    this.host.mount();
    this.console.info('R28 public runtime mounted', this.host.runtime.currentTick());
  }

  start(): void {
    this.host.start();
    this.console.info('R28 public runtime started', this.host.runtime.currentTick());
  }

  stop(): void {
    this.host.stop();
    this.console.info('R28 public runtime stopped', this.host.runtime.currentTick());
  }

  dispose(): void {
    this.host.dispose();
    this.telemetry.clear();
    this.console.info('R28 public runtime disposed');
  }

  step(deltaSeconds: number): RuntimeHealthReport {
    const state = this.host.step(deltaSeconds);
    const snapshot = this.host.runtime.createSnapshot();
    this.telemetry.record({
      tick: snapshot.tick,
      name: 'runtime.frame',
      value: state.lastFrameMs,
      unit: 'ms',
    });
    return this.diagnostics.evaluate({
      host: state,
      snapshot,
      resources: { count: 0, bytes: 0, byKind: {} },
      telemetry: this.telemetry,
    });
  }
}

export function createAapwRuntimeApi(options: BrowserHostOptions = {}): RuntimePublicApi {
  return new AapwRuntimeApi(options);
}
