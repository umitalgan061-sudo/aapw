import type { RuntimeCommandKind, RuntimeCommandR31, RuntimeFrameR31 } from './applicationTypesR31.ts';
import { asR31Id } from './applicationTypesR31.ts';
import type { ApplicationKernelDiagnosticsR31 } from './applicationKernelR31.ts';
import { ApplicationKernelR31 } from './applicationKernelR31.ts';

export interface RuntimeFacadeR31Options {
  readonly nowMs?: () => number;
  readonly source?: string;
}

export interface RuntimeFacadeDiagnosticsR31 {
  readonly kernel: ApplicationKernelDiagnosticsR31;
  readonly commandCounter: number;
  readonly source: string;
}

export class RuntimeFacadeR31 {
  readonly #kernel: ApplicationKernelR31;
  readonly #source: string;
  #counter = 0;

  constructor(options: RuntimeFacadeR31Options = {}) {
    this.#source = options.source ?? 'r31.facade';
    this.#kernel = new ApplicationKernelR31({
      nowMs: options.nowMs ?? (() => performance.now()),
      onError: (error, context) => console.error('[RuntimeFacadeR31]', context, error),
    });
  }

  get kernel(): ApplicationKernelR31 { return this.#kernel; }

  start(): Promise<void> { return this.#kernel.start(); }
  pause(reason = 'facade.pause'): void { this.#kernel.pause(reason); }
  resume(): void { this.#kernel.resume(); }
  stop(reason = 'facade.stop'): Promise<void> { return this.#kernel.stop(reason); }

  enqueue<T>(
    kind: RuntimeCommandKind,
    name: string,
    payload: T,
    priority: RuntimeCommandR31<T>['priority'] = 'normal',
  ): boolean {
    const now = performance.now();
    const command: RuntimeCommandR31<T> = Object.freeze({
      id: asR31Id(`r31.facade.${++this.#counter}`),
      kind,
      name,
      priority,
      payload,
      context: Object.freeze({
        frame: this.#kernel.diagnosticsSnapshot().frame,
        simulationTick: this.#kernel.diagnosticsSnapshot().clockTick,
        source: this.#source,
        acceptedAt: now,
      }),
    });
    return this.#kernel.commands.enqueue(command);
  }

  frame(nowMs?: number): Promise<void> { return this.#kernel.frame(nowMs); }

  use(id: string, phase: RuntimeFrameR31['phase'], update: (frame: RuntimeFrameR31) => void): () => void {
    return this.#kernel.registerPlugin({
      id,
      phase,
      priority: 'normal',
      update,
    });
  }

  diagnostics(): RuntimeFacadeDiagnosticsR31 {
    return Object.freeze({
      kernel: this.#kernel.diagnosticsSnapshot(),
      commandCounter: this.#counter,
      source: this.#source,
    });
  }
}
