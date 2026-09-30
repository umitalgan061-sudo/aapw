import type { NetworkPortR31, RuntimeFrameR31, RuntimePluginR31 } from './applicationTypesR31.ts';
import { DEFAULT_RUNTIME_CONFIG_R31, normalizeRuntimeConfigR31, validateRuntimeConfigR31 } from './runtimeConfigR31.ts';
import { ApplicationKernelR31 } from './applicationKernelR31.ts';
import { FailureContainmentR31 } from './failureContainmentR31.ts';
import { PerformanceBudgetR31 } from './performanceBudgetR31.ts';
import { TelemetryBufferR31 } from './telemetryR31.ts';
import { NetworkSessionR31 } from './networkSessionR31.ts';

export interface RuntimeHostOptionsR31 {
  readonly nowMs?: () => number;
  readonly networkPort?: NetworkPortR31;
}

export interface RuntimeHostDiagnosticsR31 {
  readonly started: boolean;
  readonly kernel: ReturnType<ApplicationKernelR31['diagnosticsSnapshot']>;
  readonly telemetry: ReturnType<TelemetryBufferR31['diagnostics']>;
  readonly failures: ReturnType<FailureContainmentR31['state']>;
  readonly network: ReturnType<NetworkSessionR31['diagnostics']> | null;
  readonly configErrors: readonly string[];
}

export class RuntimeHostR31 {
  readonly config;
  readonly kernel: ApplicationKernelR31;
  readonly failures = new FailureContainmentR31();
  readonly telemetry = new TelemetryBufferR31();
  readonly budget: PerformanceBudgetR31;
  readonly network: NetworkSessionR31 | null;
  readonly #nowMs: () => number;
  #started = false;

  constructor(input: Partial<typeof DEFAULT_RUNTIME_CONFIG_R31> = {}, options: RuntimeHostOptionsR31 = {}) {
    this.config = normalizeRuntimeConfigR31(input);
    this.#nowMs = options.nowMs ?? (() => performance.now());
    this.budget = new PerformanceBudgetR31(this.config.budget);
    this.kernel = new ApplicationKernelR31({
      nowMs: this.#nowMs,
      onError: (error, context) => {
        this.telemetry.record({
          timestampMs: this.#nowMs(),
          name: 'runtime.error',
          value: 1,
          unit: 'count',
          tags: Object.freeze({ context }),
        });
        console.error('[R31 RuntimeHost]', context, error);
      },
    }, {
      budget: this.config.budget,
      fixedStepSeconds: this.config.fixedStepSeconds,
      maxCatchUpSteps: this.config.maxCatchUpSteps,
    });
    this.network = options.networkPort ? new NetworkSessionR31(options.networkPort) : null;
  }

  register(plugin: RuntimePluginR31, maxFailures = 3, cooldownFrames = 30): () => void {
    const unregisterFailure = this.failures.register(plugin.id, {
      mode: 'disable',
      maxFailures,
      cooldownFrames,
    });
    const wrapped: RuntimePluginR31 = Object.freeze({
      ...plugin,
      update: plugin.update
        ? (frame: RuntimeFrameR31) => {
          const result = this.failures.execute(plugin.id, frame.frame, () => plugin.update!(frame));
          if (!result.ok) {
            this.telemetry.record({
              timestampMs: this.#nowMs(),
              name: 'runtime.plugin.failure',
              value: 1,
              unit: 'count',
              tags: Object.freeze({ plugin: plugin.id }),
            });
          }
        }
        : undefined,
    });
    const unregister = this.kernel.registerPlugin(wrapped);
    return () => {
      unregister();
      unregisterFailure();
    };
  }

  async start(): Promise<void> {
    const errors = validateRuntimeConfigR31(this.config);
    if (errors.length) throw new Error(`Invalid R31 config: ${errors.join(',')}`);
    if (this.#started) return;
    await this.kernel.start();
    this.#started = true;
  }

  frame(nowMs = this.#nowMs()): Promise<void> {
    return this.kernel.frame(nowMs);
  }

  sendNetworkPacket(packet: Parameters<NetworkSessionR31['send']>[0], nowMs = this.#nowMs()): boolean {
    return this.network?.send(packet, nowMs) ?? false;
  }

  receiveNetworkBytes(bytes: Uint8Array): boolean {
    return this.network?.receive(bytes) ?? false;
  }

  async stop(): Promise<void> {
    if (!this.#started) return;
    await this.kernel.stop('runtime-host.stop');
    this.network?.close();
    this.#started = false;
  }

  diagnostics(): RuntimeHostDiagnosticsR31 {
    return Object.freeze({
      started: this.#started,
      kernel: this.kernel.diagnosticsSnapshot(),
      telemetry: this.telemetry.diagnostics(),
      failures: this.failures.state(),
      network: this.network?.diagnostics() ?? null,
      configErrors: Object.freeze(validateRuntimeConfigR31(this.config)),
    });
  }
}
