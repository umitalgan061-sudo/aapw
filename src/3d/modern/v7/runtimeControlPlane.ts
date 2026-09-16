import { digest, stableSort, type Disposable, type V7Result } from './primitives.js';
import type { ReleaseGate } from './releaseGate.js';
import type { RecoveryCoordinator } from './recovery.js';
import type { RuntimeDiagnostics } from './diagnostics.js';
import type { RenderGovernor, RenderSignals } from './renderGovernor.js';
import type { RuntimeTelemetry } from './telemetry.js';
import type { RuntimeScheduler } from './scheduler.js';

export type ControlCommand =
  | { readonly type: 'pause' }
  | { readonly type: 'resume' }
  | { readonly type: 'force-quality'; readonly tier: Parameters<RenderGovernor['setTier']>[0] }
  | { readonly type: 'recover'; readonly domains?: readonly string[] }
  | { readonly type: 'clear-telemetry' }
  | { readonly type: 'release-gate'; readonly name: string; readonly status: 'pass' | 'warn' | 'fail' | 'unknown'; readonly blocking?: boolean }
  | { readonly type: 'inspect' };
export interface ControlAuditEntry { readonly serial: number; readonly command: string; readonly accepted: boolean; readonly reason: string; readonly digest: string; }
export interface ControlPlaneStatus { readonly paused: boolean; readonly quality: ReturnType<RenderGovernor['profile']>; readonly health: ReturnType<RuntimeDiagnostics['inspect']>; readonly release: ReturnType<ReleaseGate['evaluate']>; readonly audit: number; readonly digest: string; }
export interface RuntimeControlPlaneSources { readonly render: RenderGovernor; readonly recovery: RecoveryCoordinator; readonly diagnostics: RuntimeDiagnostics; readonly release: ReleaseGate; readonly telemetry: RuntimeTelemetry; readonly scheduler: RuntimeScheduler; }

export class RuntimeControlPlane implements Disposable {
  readonly sources: RuntimeControlPlaneSources;
  readonly maxAudit: number;
  #paused = false;
  #audit: ControlAuditEntry[] = [];
  #serial = 0;
  #disposed = false;

  constructor(sources: RuntimeControlPlaneSources, maxAudit = 512) {
    this.sources = sources;
    this.maxAudit = Math.max(32, Math.min(4096, Math.trunc(maxAudit)));
  }

  execute(command: ControlCommand, tick = 0): V7Result<unknown> {
    if (this.#disposed) return { ok: false, code: 'CONTROL_DISPOSED', message: 'Control plane is disposed', retryable: false };
    let accepted = false;
    let reason = 'unknown-command';
    let value: unknown = undefined;
    try {
      switch (command.type) {
        case 'pause':
          this.#paused = true;
          accepted = true;
          reason = 'paused';
          break;
        case 'resume':
          this.#paused = false;
          accepted = true;
          reason = 'resumed';
          break;
        case 'force-quality':
          this.sources.render.setTier(command.tier);
          accepted = true;
          reason = `quality:${command.tier}`;
          break;
        case 'recover':
          value = this.sources.recovery.recover(command.domains as any, tick);
          accepted = Boolean((value as { success?: boolean }).success);
          reason = accepted ? 'recovery-complete' : 'recovery-failed';
          break;
        case 'clear-telemetry':
          this.sources.telemetry.reset();
          accepted = true;
          reason = 'telemetry-cleared';
          break;
        case 'release-gate':
          value = this.sources.release.record({ name: command.name, status: command.status, blocking: command.blocking });
          accepted = value !== null;
          reason = accepted ? 'release-gate-recorded' : 'release-gate-rejected';
          break;
        case 'inspect':
          value = this.sources.diagnostics.inspect();
          accepted = true;
          reason = 'inspection-complete';
          break;
      }
    } catch (error) {
      accepted = false;
      reason = error instanceof Error ? error.message : String(error);
    }
    this.#record(command.type, accepted, reason);
    return accepted ? { ok: true, value } : { ok: false, code: 'CONTROL_REJECTED', message: reason, retryable: false };
  }

  paused(): boolean {
    return this.#paused;
  }

  filterFrame<T>(frame: T): T | null {
    return this.#paused ? null : frame;
  }

  qualityAt(signals: RenderSignals): ReturnType<RenderGovernor['evaluate']> {
    return this.sources.render.evaluate(signals);
  }

  status(): ControlPlaneStatus {
    const health = this.sources.diagnostics.inspect();
    const release = this.sources.release.evaluate('runtime', 'v7');
    return Object.freeze({
      paused: this.#paused,
      quality: this.sources.render.profile(),
      health,
      release,
      audit: this.#audit.length,
      digest: digest(this.#paused, health.digest, release.digest, this.#audit.length),
    });
  }

  audit(): readonly ControlAuditEntry[] {
    return Object.freeze([...this.#audit]);
  }

  clearAudit(): void {
    this.#audit.length = 0;
  }

  dispose(): void {
    this.#disposed = true;
    this.#audit.length = 0;
  }

  #record(command: string, accepted: boolean, reason: string): void {
    const entry: ControlAuditEntry = Object.freeze({
      serial: ++this.#serial,
      command,
      accepted,
      reason,
      digest: digest(this.#serial, command, accepted, reason),
    });
    this.#audit.push(entry);
    if (this.#audit.length > this.maxAudit) this.#audit.shift();
  }
}

export function sortControlAudit(entries: readonly ControlAuditEntry[]): readonly ControlAuditEntry[] {
  return Object.freeze(stableSort(entries, (a, b) => a.serial - b.serial || a.command.localeCompare(b.command)));
}
