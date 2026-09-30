import type {
  RuntimeFrameR31,
  RuntimePluginR31,
  RuntimePriority,
} from './applicationTypesR31.ts';
import { ApplicationKernelR31 } from './applicationKernelR31.ts';
import { BrowserRuntimeBridgeR31 } from './browserRuntimeBridgeR31.ts';
import { RenderRuntimeBridgeR31 } from './renderRuntimeBridgeR31.ts';
import type { RenderPortR31 } from './applicationTypesR31.ts';

export interface IntegrationRuntimeConfigR31 {
  readonly nowMs?: () => number;
  readonly render?: RenderPortR31;
  readonly inputSource?: string;
}

export interface IntegrationRuntimeDiagnosticsR31 {
  readonly started: boolean;
  readonly input: ReturnType<BrowserRuntimeBridgeR31['diagnostics']>;
  readonly render: ReturnType<RenderRuntimeBridgeR31['diagnostics']> | null;
  readonly kernel: ReturnType<ApplicationKernelR31['diagnosticsSnapshot']>;
}

function defaultNow(): number {
  return performance.now();
}

export class IntegrationRuntimeR31 {
  readonly kernel: ApplicationKernelR31;
  readonly input: BrowserRuntimeBridgeR31;
  readonly render: RenderRuntimeBridgeR31 | null;
  #started = false;

  constructor(config: IntegrationRuntimeConfigR31 = {}) {
    this.render = config.render ? new RenderRuntimeBridgeR31(config.render) : null;
    this.kernel = new ApplicationKernelR31({
      nowMs: config.nowMs ?? defaultNow,
      onError: (error, context) => console.error('[R31]', context, error),
    });
    this.input = new BrowserRuntimeBridgeR31({
      enqueue: (command) => this.kernel.commands.enqueue(command),
      source: config.inputSource ?? 'browser',
      nowMs: config.nowMs ?? defaultNow,
      getFrame: () => this.kernel.diagnosticsSnapshot().frame,
      getTick: () => this.kernel.diagnosticsSnapshot().clockTick,
    });
    if (this.render) {
      this.kernel.registerPlugin({
        id: 'r31.render',
        phase: 'render',
        priority: 'critical',
        update: (frame) => this.render?.render(frame),
      });
    }
  }

  register(plugin: RuntimePluginR31): () => void {
    return this.kernel.registerPlugin(plugin);
  }

  async start(): Promise<void> {
    if (this.#started) return;
    await this.kernel.start();
    this.input.start();
    this.#started = true;
  }

  async frame(nowMs = defaultNow()): Promise<void> {
    await this.kernel.frame(nowMs);
  }

  pause(): void {
    this.kernel.pause('integration.pause');
  }

  resume(): void {
    this.kernel.resume();
  }

  async stop(): Promise<void> {
    if (!this.#started) return;
    this.input.stop();
    await this.kernel.stop('integration.stop');
    this.render?.dispose();
    this.#started = false;
  }

  diagnostics(): IntegrationRuntimeDiagnosticsR31 {
    return Object.freeze({
      started: this.#started,
      input: this.input.diagnostics(),
      render: this.render?.diagnostics() ?? null,
      kernel: this.kernel.diagnosticsSnapshot(),
    });
  }
}

export function createFramePluginR31(
  id: string,
  priority: RuntimePriority,
  phase: RuntimePluginR31['phase'],
  update: (frame: RuntimeFrameR31) => void,
): RuntimePluginR31 {
  return Object.freeze({ id, priority, phase, update });
}
