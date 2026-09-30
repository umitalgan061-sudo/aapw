import type { RuntimeSnapshot } from '../r27/contracts.ts';
import type { BrowserHostState } from './browserHost.ts';
import type { ResourceStats } from './resourceRegistry.ts';
import type { Incident, RuntimeTelemetry } from './telemetry.ts';

export interface DiagnosticsBridgeInput {
  readonly host: BrowserHostState;
  readonly snapshot: RuntimeSnapshot;
  readonly resources: ResourceStats;
  readonly telemetry: RuntimeTelemetry;
}

export interface RuntimeHealthReport {
  readonly status: 'healthy' | 'degraded' | 'critical';
  readonly score: number;
  readonly tick: number;
  readonly qualityLevel: number;
  readonly frameMs: number;
  readonly entityCount: number;
  readonly resourceBytes: number;
  readonly criticalIncidents: readonly Incident[];
  readonly warnings: readonly Incident[];
  readonly recommendations: readonly string[];
}

export class RuntimeDiagnosticsBridge {
  evaluate(input: DiagnosticsBridgeInput): RuntimeHealthReport {
    const criticalIncidents = input.telemetry.incidents().filter((incident) => incident.severity === 'critical');
    const warnings = input.telemetry.incidents().filter((incident) => incident.severity === 'warning');
    let score = 100;
    if (input.host.lastFrameMs > 33) score -= 30;
    else if (input.host.lastFrameMs > 22) score -= 15;
    else if (input.host.lastFrameMs > 17) score -= 5;
    if (input.snapshot.entities.length > 4000) score -= 10;
    if (input.resources.bytes > 512 * 1024 * 1024) score -= 15;
    score -= criticalIncidents.length * 20;
    score -= Math.min(20, warnings.length * 3);

    const recommendations: string[] = [];
    if (input.host.lastFrameMs > 22) recommendations.push('Reduce render quality or visible entity budget.');
    if (input.resources.bytes > 512 * 1024 * 1024) recommendations.push('Release unused GPU/asset resources.');
    if (warnings.length > 0) recommendations.push('Inspect recent runtime incidents.');
    if (!input.host.environment.capabilities.worker) recommendations.push('Enable worker-backed world generation when supported.');
    if (recommendations.length === 0) recommendations.push('Runtime is operating inside configured budgets.');

    const normalizedScore = Math.max(0, Math.min(100, score));
    const status: RuntimeHealthReport['status'] =
      criticalIncidents.length > 0 || normalizedScore < 50 ? 'critical' :
      normalizedScore < 75 ? 'degraded' : 'healthy';

    return Object.freeze({
      status,
      score: normalizedScore,
      tick: input.host.tick,
      qualityLevel: input.snapshot.qualityLevel,
      frameMs: input.host.lastFrameMs,
      entityCount: input.snapshot.entities.length,
      resourceBytes: input.resources.bytes,
      criticalIncidents: criticalIncidents.map((incident) => ({ ...incident })),
      warnings: warnings.map((incident) => ({ ...incident })),
      recommendations,
    });
  }

  toLogLine(report: RuntimeHealthReport): string {
    return [
      'R28',
      report.status,
      'score=' + report.score,
      'tick=' + report.tick,
      'frameMs=' + report.frameMs.toFixed(2),
      'entities=' + report.entityCount,
      'resources=' + report.resourceBytes,
    ].join(' ');
  }
}
