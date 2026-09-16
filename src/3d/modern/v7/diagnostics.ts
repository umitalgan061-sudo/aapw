import { digest, stableSort, type Disposable } from './primitives.js';
import type { RuntimeScheduler } from './scheduler.js';
import type { RuntimeTelemetry } from './telemetry.js';
import type { ResourceResidency } from './resourceResidency.js';
import type { NetworkSession } from './networkSession.js';
import type { RenderGovernor } from './renderGovernor.js';

export type DiagnosticSeverity = 'info' | 'warning' | 'critical';
export interface DiagnosticEntry { readonly code: string; readonly severity: DiagnosticSeverity; readonly value: number | string; readonly threshold: number | string | null; readonly message: string; }
export interface DiagnosticSnapshot { readonly generatedAt: string; readonly entries: readonly DiagnosticEntry[]; readonly healthy: boolean; readonly criticalCount: number; readonly digest: string; }
export interface DiagnosticSources { readonly scheduler: RuntimeScheduler; readonly telemetry: RuntimeTelemetry; readonly resources: ResourceResidency; readonly network: NetworkSession; readonly render: RenderGovernor; }

export class RuntimeDiagnostics implements Disposable {
  readonly sources: DiagnosticSources; #history: DiagnosticSnapshot[] = []; #disposed = false;
  constructor(sources: DiagnosticSources) { this.sources = sources; }
  inspect(): DiagnosticSnapshot {
    if (this.#disposed) return Object.freeze({ generatedAt: new Date(0).toISOString(), entries: [], healthy: false, criticalCount: 1, digest: 'disposed' });
    const entries: DiagnosticEntry[] = []; const scheduler = this.sources.scheduler.report(); const resource = this.sources.resources.stats(); const network = this.sources.network.stats(); const telemetry = this.sources.telemetry.health(); const render = this.sources.render.profile();
    if ((scheduler?.droppedTasks ?? 0) > 0) entries.push({ code: 'scheduler.dropped', severity: scheduler!.droppedTasks > 32 ? 'critical' : 'warning', value: scheduler!.droppedTasks, threshold: 0, message: 'Scheduler dropped queued work.' });
    if (resource.residentBytes > 500 * 1024 * 1024) entries.push({ code: 'memory.resident', severity: 'critical', value: resource.residentBytes, threshold: 500 * 1024 * 1024, message: 'Resident resource memory is high.' });
    if (network.queued > 800) entries.push({ code: 'network.queue', severity: 'warning', value: network.queued, threshold: 800, message: 'Network backpressure queue is high.' });
    if (telemetry.score01 < .35) entries.push({ code: 'health.low', severity: 'critical', value: telemetry.score01, threshold: .35, message: 'Runtime health score is below the safe threshold.' });
    if (render.dynamicResolution && telemetry.frameP95 > 24) entries.push({ code: 'frame.p95', severity: 'warning', value: telemetry.frameP95, threshold: 24, message: 'Frame p95 is above target.' });
    if (!entries.length) entries.push({ code: 'runtime.nominal', severity: 'info', value: telemetry.score01, threshold: 1, message: 'Runtime diagnostics are nominal.' });
    const ordered = stableSort(entries, (a, b) => ({ critical: 0, warning: 1, info: 2 }[a.severity] - ({ critical: 0, warning: 1, info: 2 }[b.severity]) || a.code.localeCompare(b.code))); const criticalCount = ordered.filter((entry) => entry.severity === 'critical').length; const snapshot = Object.freeze({ generatedAt: new Date(0).toISOString(), entries: Object.freeze(ordered), healthy: criticalCount === 0, criticalCount, digest: digest(ordered, telemetry, resource, network, render) }); this.#history.push(snapshot); if (this.#history.length > 128) this.#history.shift(); return snapshot;
  }
  history(): readonly DiagnosticSnapshot[] { return Object.freeze([...this.#history]); }
  dispose(): void { this.#disposed = true; this.#history.length = 0; }
}
