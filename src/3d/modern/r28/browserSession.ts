import { BrowserRuntimeHost, type BrowserHostOptions } from './browserHost.ts';
import { RuntimeLifecycleController } from './lifecycle.ts';
import { RuntimeRecoveryController } from './errorRecovery.ts';
import { RuntimeResourceRegistry } from './resourceRegistry.ts';
import { RuntimeTelemetry } from './telemetry.ts';
import { RuntimeSession, type SessionTransport } from './session.ts';

export interface BrowserSessionOptions extends BrowserHostOptions {
  readonly diagnostics?: boolean;
  readonly session?: boolean;
}

export interface BrowserSessionState {
  readonly lifecycle: ReturnType<RuntimeLifecycleController['state']>;
  readonly running: boolean;
  readonly connected: boolean;
  readonly tick: number;
  readonly qualityLevel: number;
  readonly resources: ReturnType<RuntimeResourceRegistry['stats']>;
}

export class BrowserGameSession {
  readonly host: BrowserRuntimeHost;
  readonly lifecycle = new RuntimeLifecycleController();
  readonly recovery = new RuntimeRecoveryController();
  readonly resources = new RuntimeResourceRegistry();
  readonly telemetry = new RuntimeTelemetry();
  readonly session: RuntimeSession | null;

  constructor(options: BrowserSessionOptions = {}) {
    this.host = new BrowserRuntimeHost(options);
    this.session = options.session === false ? null : new RuntimeSession(options);
    this.lifecycle.registerMany([
      { id: 'host', mount: () => this.host.mount(), start: () => this.host.start(), stop: () => this.host.stop(), dispose: () => this.host.dispose() },
      { id: 'resources', dispose: () => this.resources.dispose() },
      { id: 'session', start: () => undefined, stop: () => this.session?.disconnect(), dispose: () => this.session?.disconnect() },
    ]);
  }

  async mount(): Promise<void> {
    await this.lifecycle.mount();
    this.telemetry.incident({
      tick: this.host.runtime.currentTick(),
      code: 'R28_SESSION_MOUNTED',
      severity: 'info',
      detail: 'Browser game session mounted',
    });
  }

  start(): void {
    this.lifecycle.start();
  }

  pause(): void {
    this.host.stop();
    this.lifecycle.pause();
  }

  resume(): void {
    this.lifecycle.resume();
    this.host.start();
  }

  async stop(): Promise<void> {
    await this.lifecycle.stop();
    this.session?.disconnect('session-stop');
  }

  async dispose(): Promise<void> {
    await this.lifecycle.dispose();
    this.telemetry.clear();
  }

  state(): BrowserSessionState {
    return {
      lifecycle: this.lifecycle.state,
      running: this.host.state().running,
      connected: this.session?.state().connected ?? false,
      tick: this.host.runtime.currentTick(),
      qualityLevel: this.host.runtime.quality.level,
      resources: this.resources.stats(),
    };
  }

  async connect(transport: SessionTransport, sessionId?: string): Promise<void> {
    if (!this.session) throw new Error('Network session is disabled');
    await this.session.connect(transport, sessionId);
  }
}
