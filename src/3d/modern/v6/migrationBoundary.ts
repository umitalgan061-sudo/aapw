/**
 * V6 migration boundary.
 * Audits the repository's typed runtime ownership and provides a staged,
 * machine-readable cutover plan for legacy JavaScript boundaries.
 */

export type MigrationStatus = 'legacy' | 'typed' | 'adapter' | 'verified' | 'blocked';
export type MigrationRisk = 'low' | 'medium' | 'high' | 'critical';

export interface MigrationEntry {
  readonly surface: string;
  readonly owner: string;
  readonly status: MigrationStatus;
  readonly risk: MigrationRisk;
  readonly dependencies: readonly string[];
  readonly replacement?: string;
  readonly gate?: string;
}

export interface MigrationReport {
  readonly generatedAtTick: number;
  readonly total: number;
  readonly complete: number;
  readonly remaining: number;
  readonly risk: MigrationRisk;
  readonly entries: readonly MigrationEntry[];
}

export interface MigrationPolicy {
  readonly forbiddenOwners: readonly string[];
  readonly requiredTypedDomains: readonly string[];
  readonly maxLegacyCritical: number;
}

const DEFAULT_POLICY: MigrationPolicy = {
  forbiddenOwners: ['runtime-kernel', 'simulation-state', 'network-authority'],
  requiredTypedDomains: ['simulation', 'render', 'assets', 'network', 'persistence', 'input', 'security'],
  maxLegacyCritical: 0,
};

function rank(status: MigrationStatus): number {
  switch (status) {
    case 'verified': return 4;
    case 'typed': return 3;
    case 'adapter': return 2;
    case 'legacy': return 1;
    default: return 0;
  }
}

function riskRank(risk: MigrationRisk): number {
  switch (risk) { case 'critical': return 4; case 'high': return 3; case 'medium': return 2; default: return 1; }
}

export const V6_MIGRATION_CATALOG: readonly MigrationEntry[] = [
  { surface: '3d/modern/v6/deterministicKernel', owner: 'simulation', status: 'typed', risk: 'low', dependencies: [], gate: 'determinism' },
  { surface: '3d/modern/v6/worldState', owner: 'simulation', status: 'typed', risk: 'medium', dependencies: ['deterministicKernel'], gate: 'snapshot-replay' },
  { surface: '3d/modern/v6/networkSession', owner: 'network', status: 'typed', risk: 'high', dependencies: ['deterministicKernel'], gate: 'sequence-window' },
  { surface: '3d/modern/v6/assetGraph', owner: 'assets', status: 'typed', risk: 'medium', dependencies: ['workerProtocol'], gate: 'asset-budget' },
  { surface: '3d/modern/v6/scenePlanner', owner: 'render', status: 'typed', risk: 'medium', dependencies: ['assetGraph'], gate: 'lod-hysteresis' },
  { surface: '3d/modern/v6/commandPipeline', owner: 'input', status: 'typed', risk: 'medium', dependencies: ['deterministicKernel'], gate: 'command-order' },
  { surface: '3d/modern/v6/uiState', owner: 'presentation', status: 'typed', risk: 'low', dependencies: ['commandPipeline'], gate: 'a11y-projection' },
  { surface: '3d/modern/v6/performanceGovernor', owner: 'performance', status: 'typed', risk: 'low', dependencies: ['scenePlanner'], gate: 'budget-control' },
  { surface: '3d/modern/v6/pwaRuntime', owner: 'platform', status: 'typed', risk: 'medium', dependencies: ['assetGraph'], gate: 'offline-contract' },
  { surface: '3d/modern/v6/securityTelemetry', owner: 'security', status: 'typed', risk: 'high', dependencies: ['workerProtocol'], gate: 'payload-limits' },
  { surface: '3d/legacy/game3d.js', owner: 'legacy-runtime', status: 'adapter', risk: 'critical', dependencies: ['modernFacade'], replacement: '3d/modern/v6/platform', gate: 'browser-parity' },
  { surface: '3d/sceneManager.js', owner: 'legacy-runtime', status: 'adapter', risk: 'high', dependencies: ['scenePlanner'], replacement: '3d/modern/v6/scenePlanner', gate: 'render-parity' },
  { surface: '3d/gameplay/player.js', owner: 'legacy-runtime', status: 'adapter', risk: 'high', dependencies: ['worldState', 'commandPipeline'], replacement: '3d/modern/v6/worldState', gate: 'movement-parity' },
  { surface: '3d/gameplay/combat.js', owner: 'legacy-runtime', status: 'adapter', risk: 'high', dependencies: ['networkSession', 'worldState'], replacement: '3d/modern/v6/networkSession', gate: 'combat-parity' },
  { surface: 'service-worker.js', owner: 'legacy-pwa', status: 'adapter', risk: 'medium', dependencies: ['pwaRuntime'], replacement: '3d/modern/v6/pwaRuntime', gate: 'offline-parity' },
];

export function buildMigrationReport(entries: readonly MigrationEntry[] = V6_MIGRATION_CATALOG, tick = 0, policy: Partial<MigrationPolicy> = {}): MigrationReport {
  const merged = { ...DEFAULT_POLICY, ...policy };
  const complete = entries.filter((entry) => rank(entry.status) >= 3).length;
  const remaining = entries.length - complete;
  const highestRisk = entries.reduce<MigrationRisk>((current, entry) => riskRank(entry.risk) > riskRank(current) ? entry.risk : current, 'low');
  const legacyCritical = entries.filter((entry) => entry.status === 'legacy' && entry.risk === 'critical').length;
  const missingDomains = merged.requiredTypedDomains.filter((domain) => !entries.some((entry) => entry.owner === domain && rank(entry.status) >= 3));
  let risk = highestRisk;
  if (legacyCritical > merged.maxLegacyCritical || missingDomains.length > 0) risk = 'critical';
  return { generatedAtTick: Math.max(0, Math.floor(tick)), total: entries.length, complete, remaining, risk, entries: entries.map((entry) => ({ ...entry, dependencies: [...entry.dependencies] })) };
}

export function validateMigrationReport(report: MigrationReport, policy: Partial<MigrationPolicy> = {}): readonly string[] {
  const merged = { ...DEFAULT_POLICY, ...policy };
  const failures: string[] = [];
  if (report.total !== report.entries.length) failures.push('total mismatch');
  if (report.complete + report.remaining !== report.total) failures.push('completion arithmetic mismatch');
  for (const entry of report.entries) {
    if (merged.forbiddenOwners.includes(entry.owner) && entry.status === 'legacy') failures.push(`forbidden legacy owner: ${entry.surface}`);
    if (entry.status === 'verified' && !entry.gate) failures.push(`verified entry lacks gate: ${entry.surface}`);
    if (entry.status === 'adapter' && !entry.replacement) failures.push(`adapter entry lacks replacement: ${entry.surface}`);
  }
  const missingDomains = merged.requiredTypedDomains.filter((domain) => !report.entries.some((entry) => entry.owner === domain && rank(entry.status) >= 3));
  for (const domain of missingDomains) failures.push(`missing typed domain: ${domain}`);
  return failures.sort();
}

export function topMigrationRisks(entries: readonly MigrationEntry[] = V6_MIGRATION_CATALOG, limit = 8): readonly MigrationEntry[] {
  return [...entries].sort((a, b) => riskRank(b.risk) - riskRank(a.risk) || rank(a.status) - rank(b.status) || a.surface.localeCompare(b.surface)).slice(0, Math.max(1, limit));
}

export function dependencyOrder(entries: readonly MigrationEntry[] = V6_MIGRATION_CATALOG): readonly string[] {
  const bySurface = new Map(entries.map((entry) => [entry.surface, entry]));
  const ordered: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (surface: string): void => {
    if (visited.has(surface)) return;
    if (visiting.has(surface)) throw new Error(`migration dependency cycle: ${surface}`);
    visiting.add(surface);
    const entry = bySurface.get(surface);
    if (entry) for (const dependency of entry.dependencies) {
      const candidate = entries.find((item) => item.surface.endsWith(dependency) || item.surface.includes(dependency));
      if (candidate) visit(candidate.surface);
    }
    visiting.delete(surface);
    visited.add(surface);
    ordered.push(surface);
  };
  for (const entry of entries) visit(entry.surface);
  return ordered;
}

export function migrationDigest(report: MigrationReport): string {
  const source = report.entries.map((entry) => [entry.surface, entry.status, entry.risk, [...entry.dependencies].sort(), entry.replacement ?? '', entry.gate ?? '']).join('|');
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) { hash ^= source.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
