import { type RuntimeHealthV4, type RuntimePhaseV4, clampV4 } from './runtimeContractsV4';
import type { EcsWorldV5 } from './ecsWorldV5';
import type { RuntimeKernelV5 } from './runtimeKernelV5';
import type { AssetGraphV5 } from './assetGraphV5';
import type { NetcodeV5 } from './netcodeV5';
import type { RenderGraphV5 } from './renderGraphV5';
import type { StateStoreV5 } from './stateStoreV5';

export type DiagnosticSeverityV5 = 'info' | 'warning' | 'critical';
export type DiagnosticDomainV5 = 'kernel' | 'ecs' | 'network' | 'assets' | 'render' | 'state' | 'platform' | 'memory' | 'audio';

export interface DiagnosticFindingV5 {
  readonly id: string;
  readonly domain: DiagnosticDomainV5;
  readonly severity: DiagnosticSeverityV5;
  readonly message: string;
  readonly value: number;
  readonly threshold: number;
  readonly remediation: string;
}

export interface DiagnosticReportV5 {
  readonly generatedAt: number;
  readonly score: number;
  readonly healthy: boolean;
  readonly phase: RuntimePhaseV4;
  readonly findings: readonly DiagnosticFindingV5[];
}

export interface DiagnosticSnapshotV5 {
  readonly health: RuntimeHealthV4;
  readonly kernel: ReturnType<RuntimeKernelV5['metrics']>;
  readonly ecs: ReturnType<EcsWorldV5['metrics']>;
  readonly network: ReturnType<NetcodeV5['metrics']>;
  readonly assets: ReturnType<AssetGraphV5['metrics']>;
  readonly render: ReturnType<RenderGraphV5['metrics']>;
  readonly state: ReturnType<StateStoreV5['metrics']>;
}

export interface DiagnosticConfigV5 {
  readonly maxFindings?: number;
  readonly frameWarnMs?: number;
  readonly frameCriticalMs?: number;
  readonly healthWarnScore?: number;
  readonly healthCriticalScore?: number;
  readonly networkErrorWarn?: number;
  readonly assetFailureWarn?: number;
  readonly renderInvalidPlanWarn?: number;
  readonly stateConflictWarn?: number;
}

export interface DiagnosticsV5Options {
  readonly now?: () => number;
}

const severityWeight: Record<DiagnosticSeverityV5, number> = { info: 1, warning: 8, critical: 20 };

export class RuntimeDiagnosticsV5 {
  readonly config: Required<DiagnosticConfigV5>;
  #now: () => number;
  #history: DiagnosticReportV5[] = [];
  #sequence = 0;

  constructor(config: DiagnosticConfigV5 = {}, options: DiagnosticsV5Options = {}) {
    this.config = {
      maxFindings: Math.max(8, Math.trunc(config.maxFindings ?? 128)),
      frameWarnMs: Math.max(16, config.frameWarnMs ?? 25),
      frameCriticalMs: Math.max(25, config.frameCriticalMs ?? 100),
      healthWarnScore: clampV4(config.healthWarnScore ?? 85, 0, 100),
      healthCriticalScore: clampV4(config.healthCriticalScore ?? 60, 0, 100),
      networkErrorWarn: Math.max(0, Math.trunc(config.networkErrorWarn ?? 0)),
      assetFailureWarn: Math.max(0, Math.trunc(config.assetFailureWarn ?? 0)),
      renderInvalidPlanWarn: Math.max(0, Math.trunc(config.renderInvalidPlanWarn ?? 0)),
      stateConflictWarn: Math.max(0, Math.trunc(config.stateConflictWarn ?? 0)),
    };
    this.#now = options.now ?? (() => performance.now());
  }

  inspect(snapshot: DiagnosticSnapshotV5): DiagnosticReportV5 {
    const findings: DiagnosticFindingV5[] = [];
    const push = (domain: DiagnosticDomainV5, severity: DiagnosticSeverityV5, message: string, value: number, threshold: number, remediation: string): void => {
      findings.push(Object.freeze({ id: `finding-${++this.#sequence}`, domain, severity, message: message.slice(0, 300), value, threshold, remediation: remediation.slice(0, 300) }));
    };
    if (snapshot.health.score < this.config.healthCriticalScore) push('platform', 'critical', 'Runtime health score is critically low', snapshot.health.score, this.config.healthCriticalScore, 'Inspect the kernel and subsystem reports before release.');
    else if (snapshot.health.score < this.config.healthWarnScore) push('platform', 'warning', 'Runtime health score is below the warning floor', snapshot.health.score, this.config.healthWarnScore, 'Check persistent performance and protocol warnings.');
    if (snapshot.kernel.worstFrameMs >= this.config.frameCriticalMs) push('kernel', 'critical', 'Worst frame duration exceeds critical budget', snapshot.kernel.worstFrameMs, this.config.frameCriticalMs, 'Reduce work per tick and move expensive workloads to workers.');
    else if (snapshot.kernel.worstFrameMs >= this.config.frameWarnMs) push('kernel', 'warning', 'Frame duration exceeds warning budget', snapshot.kernel.worstFrameMs, this.config.frameWarnMs, 'Review subsystem execution durations and scheduler budgets.');
    if (snapshot.network.malformedPackets > this.config.networkErrorWarn) push('network', 'critical', 'Malformed network packets observed', snapshot.network.malformedPackets, this.config.networkErrorWarn, 'Reject or isolate malformed traffic and inspect protocol boundaries.');
    if (snapshot.assets.failed > this.config.assetFailureWarn) push('assets', 'warning', 'Asset graph contains failed nodes', snapshot.assets.failed, this.config.assetFailureWarn, 'Repair asset manifests, dependencies or remote delivery.');
    if (snapshot.assets.cycles > 0) push('assets', 'critical', 'Asset dependency cycle detected', snapshot.assets.cycles, 0, 'Break circular dependencies before production release.');
    if (snapshot.render.invalidPlans > this.config.renderInvalidPlanWarn) push('render', 'critical', 'Render graph contains invalid plans', snapshot.render.invalidPlans, this.config.renderInvalidPlanWarn, 'Validate render pass dependencies and attachment ownership.');
    if (snapshot.state.conflicts > this.config.stateConflictWarn) push('state', 'warning', 'State version conflicts detected', snapshot.state.conflicts, this.config.stateConflictWarn, 'Check concurrent writers and command ordering.');
    if (snapshot.ecs.dead > snapshot.ecs.live * 0.2 && snapshot.ecs.live > 10) push('ecs', 'warning', 'High percentage of dead entities remains live', snapshot.ecs.dead, snapshot.ecs.live * 0.2, 'Despawn or recycle dead entities after gameplay retention expires.');
    const capped = findings.sort((a, b) => severityWeight[b.severity] - severityWeight[a.severity] || a.id.localeCompare(b.id)).slice(0, this.config.maxFindings);
    const penalty = capped.reduce((sum, finding) => sum + severityWeight[finding.severity], 0);
    const score = clampV4(100 - penalty, 0, 100);
    const critical = capped.some((finding) => finding.severity === 'critical');
    const report = Object.freeze({ generatedAt: this.#now(), score, healthy: !critical && score >= this.config.healthCriticalScore, phase: snapshot.health.phase, findings: Object.freeze(capped) });
    this.#history.push(report);
    while (this.#history.length > 64) this.#history.shift();
    return report;
  }

  history(): readonly DiagnosticReportV5[] { return Object.freeze(this.#history.slice()); }

  latest(): DiagnosticReportV5 | null { return this.#history.at(-1) ?? null; }

  clear(): void { this.#history.length = 0; }

  format(report: DiagnosticReportV5): string {
    const lines = [`v5 diagnostics ${report.healthy ? 'HEALTHY' : 'UNHEALTHY'} score=${report.score.toFixed(1)} phase=${report.phase}`];
    for (const finding of report.findings) lines.push(`[${finding.severity}] ${finding.domain}: ${finding.message} value=${finding.value} threshold=${finding.threshold}`);
    return lines.join('\n');
  }
}

export function diagnosticSnapshotV5(health: RuntimeHealthV4, kernel: RuntimeKernelV5, ecs: EcsWorldV5, network: NetcodeV5, assets: AssetGraphV5, render: RenderGraphV5, state: StateStoreV5): DiagnosticSnapshotV5 {
  return Object.freeze({ health, kernel: kernel.metrics(), ecs: ecs.metrics(), network: network.metrics(), assets: assets.metrics(), render: render.metrics(), state: state.metrics() });
}
