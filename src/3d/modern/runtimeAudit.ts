import type { PlatformError, Result } from './types';
import type { BrowserCapabilities } from './browserPlatform';
import type { PerformanceSummary } from './performanceLab';
import type { RuntimeSessionDiagnostics } from './runtimeSession';
import type { RuntimeFeatureSwitches } from './qualityProfile';

export type AuditSeverity = 'info' | 'warning' | 'error' | 'blocker';

export interface AuditFinding {
  readonly id: string;
  readonly severity: AuditSeverity;
  readonly area: string;
  readonly message: string;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly remediation: string;
}

export interface AuditReport {
  readonly generatedAt: number;
  readonly healthy: boolean;
  readonly findings: readonly AuditFinding[];
  readonly counts: Readonly<Record<AuditSeverity, number>>;
  readonly digest: string;
}

export interface RuntimeAuditInput {
  readonly capabilities: BrowserCapabilities;
  readonly diagnostics?: RuntimeSessionDiagnostics;
  readonly performance?: PerformanceSummary;
  readonly features: RuntimeFeatureSwitches;
  readonly secureStorageAvailable: boolean;
  readonly staticAssetBasePath?: string;
}

const severityWeight: Readonly<Record<AuditSeverity, number>> = Object.freeze({ info: 0, warning: 1, error: 2, blocker: 3 });

function finding(id: string, severity: AuditSeverity, area: string, message: string, remediation: string, evidence: Readonly<Record<string, unknown>> = {}): AuditFinding {
  return Object.freeze({ id, severity, area, message, remediation, evidence: Object.freeze({ ...evidence }) });
}

export function auditRuntime(input: RuntimeAuditInput): AuditReport {
  const findings: AuditFinding[] = [];
  const capabilities = input.capabilities;
  if (!capabilities.features.webgpu && !capabilities.features.webgl2) {
    findings.push(finding('renderer-unavailable', 'blocker', 'rendering', 'No supported accelerated renderer was detected', 'Keep the headless fallback for diagnostics or provide WebGL2/WebGPU compatibility.', { rendererOrder: capabilities.rendererOrder }));
  } else if (!capabilities.features.webgpu && input.features.enableWebGPU) {
    findings.push(finding('webgpu-fallback', 'info', 'rendering', 'WebGPU is unavailable; renderer should remain on the compatibility path', 'Do not disable the WebGL2 fallback when shipping broad browser support.', { rendererOrder: capabilities.rendererOrder }));
  }
  if (!capabilities.secureContext) {
    findings.push(finding('insecure-context', 'warning', 'platform', 'Secure browser context is unavailable', 'Serve the game over HTTPS so WebGPU, service workers and stronger isolation policies remain available.', { secureContext: capabilities.secureContext }));
  }
  if (input.features.enableWorkerStreaming && !capabilities.features.webWorker) {
    findings.push(finding('worker-missing', 'error', 'streaming', 'Worker streaming is enabled but Worker is unavailable', 'Disable the feature or keep the synchronous streaming fallback enabled.', { enabled: input.features.enableWorkerStreaming }));
  }
  if (input.features.enableAutosave && !capabilities.features.indexedDb && !input.secureStorageAvailable) {
    findings.push(finding('persistence-unavailable', 'error', 'persistence', 'Autosave is enabled without an available persistence backend', 'Use IndexedDB or a verified local fallback before entering gameplay.', {}));
  }
  if (input.features.enableNetworkReplication && !capabilities.secureContext) {
    findings.push(finding('network-context', 'warning', 'network', 'Network replication is enabled outside a secure context', 'Require HTTPS before activating browser networking transports.', {}));
  }
  if (capabilities.saveData) {
    findings.push(finding('save-data', 'info', 'network', 'The browser requests reduced data usage', 'Prefer low-bandwidth asset variants and defer optional streaming work.', { connection: capabilities.connectionType }));
  }
  if (input.diagnostics) {
    if (!input.diagnostics.status.running) findings.push(finding('session-stopped', 'info', 'runtime', 'Runtime session is not currently running', 'Expected for menus/editor states; do not surface as an error during normal bootstrap.', {}));
    if (input.diagnostics.status.dirty && input.diagnostics.save.status.saving === false) findings.push(finding('unsaved-state', 'warning', 'persistence', 'Session has unsaved changes', 'Trigger a bounded autosave or explicit save before page lifecycle suspension.', { frame: input.diagnostics.status.frame }));
    if (input.diagnostics.performance.health === 'critical') findings.push(finding('critical-performance', 'error', 'performance', 'Runtime performance is currently critical', 'Lower quality tier, reduce streaming work and inspect long tasks before shipping this configuration.', { p95: input.diagnostics.performance.frameP95Ms }));
  }
  if (input.performance) {
    if (input.performance.longTaskRate > 0.1) findings.push(finding('long-task-rate', 'warning', 'performance', 'Long tasks exceed the interactive-frame budget', 'Split synchronous work and move asset/serialization work off the critical frame.', { longTaskRate: input.performance.longTaskRate }));
    if (input.performance.memoryRatio > 0.95) findings.push(finding('memory-pressure', 'error', 'memory', 'Browser memory usage is close to the configured safety ceiling', 'Reduce texture/vegetation residency and release unused resources before loading additional cells.', { memoryRatio: input.performance.memoryRatio }));
  }
  if (!input.staticAssetBasePath) findings.push(finding('asset-base-implicit', 'warning', 'assets', 'Static asset base path is implicit', 'Set an explicit asset root for production builds so CDN/subpath deployments cannot silently break relative URLs.', {}));
  const counts: Record<AuditSeverity, number> = { info: 0, warning: 0, error: 0, blocker: 0 };
  for (const item of findings) counts[item.severity] += 1;
  const healthy = counts.blocker === 0 && counts.error === 0;
  const digest = JSON.stringify(findings.map((item) => ({ id: item.id, severity: item.severity, message: item.message })));
  return Object.freeze({ generatedAt: Date.now(), healthy, findings: Object.freeze(findings), counts: Object.freeze(counts), digest });
}

export interface ReleaseGateOptions {
  readonly minimumHealth: AuditSeverity;
  readonly allowWarnings?: boolean;
  readonly requiredFeatures?: readonly string[];
}

export function releaseGate(report: AuditReport, options: ReleaseGateOptions = { minimumHealth: 'error', allowWarnings: true }): Result<AuditReport> {
  const threshold = severityWeight[options.minimumHealth];
  const severe = report.findings.filter((item) => severityWeight[item.severity] >= threshold);
  if (severe.length) {
    return { ok: false, error: { code: 'RUNTIME_RELEASE_GATE_FAILED', message: `Release gate found ${severe.length} finding(s) at or above ${options.minimumHealth}`, retryable: false, cause: severe } as PlatformError };
  }
  if (!options.allowWarnings && report.counts.warning > 0) {
    return { ok: false, error: { code: 'RUNTIME_WARNINGS_DISALLOWED', message: 'Warnings are disallowed by this release profile', retryable: false } };
  }
  if (options.requiredFeatures?.length) {
    const available = new Set(Object.keys(report.findings));
    void available;
  }
  return { ok: true, value: report };
}

export function compareAuditReports(before: AuditReport, after: AuditReport): Readonly<Record<string, number>> {
  return Object.freeze({
    blockerDelta: after.counts.blocker - before.counts.blocker,
    errorDelta: after.counts.error - before.counts.error,
    warningDelta: after.counts.warning - before.counts.warning,
    infoDelta: after.counts.info - before.counts.info,
  });
}

export interface AssertionRule<T> {
  readonly id: string;
  readonly description: string;
  readonly evaluate: (input: T) => boolean;
  readonly severity?: AuditSeverity;
}

export class InvariantSuite<T> {
  #rules: AssertionRule<T>[] = [];

  add(rule: AssertionRule<T>): this {
    if (!rule.id.trim()) throw new Error('Invariant id must not be empty');
    if (this.#rules.some((entry) => entry.id === rule.id)) throw new Error(`Invariant ${rule.id} already exists`);
    this.#rules.push(Object.freeze({ ...rule, severity: rule.severity ?? 'error' }));
    return this;
  }

  run(input: T): readonly AuditFinding[] {
    const findings: AuditFinding[] = [];
    for (const rule of this.#rules) {
      let passed = false;
      try { passed = rule.evaluate(input); } catch (cause) {
        findings.push(finding(rule.id, 'blocker', 'invariant', `Invariant threw while evaluating: ${rule.description}`, 'Fix the invariant implementation before shipping.', { cause: String(cause) }));
        continue;
      }
      if (!passed) findings.push(finding(rule.id, rule.severity ?? 'error', 'invariant', `Invariant failed: ${rule.description}`, 'Investigate the runtime state violating this invariant.'));
    }
    return Object.freeze(findings);
  }

  size(): number { return this.#rules.length; }
}
