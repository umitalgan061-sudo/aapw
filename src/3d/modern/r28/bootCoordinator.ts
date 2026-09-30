import type { RuntimeEvent } from '../r27/contracts.ts';
import { BrowserRuntimeHost } from './browserHost.ts';
import { RuntimeLifecycleController } from './lifecycle.ts';
import { RuntimeRecoveryController } from './errorRecovery.ts';
import { RuntimeTelemetry } from './telemetry.ts';
import { RuntimeVirtualConsole } from './virtualConsole.ts';

export interface BootCoordinatorConfig {
  readonly autoStart: boolean;
  readonly mountDiagnostics: boolean;
}

export interface BootResult {
  readonly success: boolean;
  readonly state: 'mounted' | 'running' | 'failed';
  readonly events: readonly RuntimeEvent[];
  readonly error?: string;
}

export class RuntimeBootCoordinator {
  readonly host: BrowserRuntimeHost;
  readonly lifecycle = new RuntimeLifecycleController();
  readonly recovery = new RuntimeRecoveryController();
  readonly telemetry = new RuntimeTelemetry();
  readonly console = new RuntimeVirtualConsole();
  readonly config: BootCoordinatorConfig;

  constructor(
    host: BrowserRuntimeHost,
    config: Partial<BootCoordinatorConfig> = {},
  ) {
    this.host = host;
    this.config = Object.freeze({
      autoStart: config.autoStart ?? true,
      mountDiagnostics: config.mountDiagnostics ?? false,
    });
    this.lifecycle.register({
      id: 'browser-host',
      mount: () => this.host.mount(),
      start: () => this.host.start(),
      pause: () => this.host.stop(),
      stop: () => this.host.stop(),
      dispose: () => this.host.dispose(),
    });
  }

  async boot(): Promise<BootResult> {
    const startedAt = this.host.runtime.currentTick();
    try {
      await this.lifecycle.mount();
      this.console.info('Runtime mounted', startedAt);
      this.telemetry.record({ tick: startedAt, name: 'boot.mount', value: 1, unit: 'count' });
      if (this.config.autoStart && this.lifecycle.state === 'mounted') this.lifecycle.start();
      this.console.info('Runtime ready', this.host.runtime.currentTick());
      return {
        success: true,
        state: this.lifecycle.state === 'running' ? 'running' : 'mounted',
        events: this.lifecycle.events(),
      };
    } catch (error) {
      this.recovery.registerFailure();
      this.telemetry.incident({
        tick: this.host.runtime.currentTick(),
        code: 'R28_BOOT_FAILURE',
        severity: 'critical',
        detail: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        state: 'failed',
        events: this.lifecycle.events(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async shutdown(): Promise<void> {
    await this.lifecycle.dispose();
    this.console.info('Runtime disposed', this.host.runtime.currentTick());
  }
}
