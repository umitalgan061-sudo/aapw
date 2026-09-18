import type { RuntimeConfigV7 } from './types.ts';
import { DEFAULT_RUNTIME_CONFIG_V7 } from './types.ts';
import { checksumV7 } from './deterministic.ts';
import { DEFAULT_CODEC_LIMITS_V7, RuntimeCodecV7 } from './codec.ts';

export interface ReleaseGateCheckV7 {
  readonly id: string;
  readonly ok: boolean;
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
}

export interface ReleaseGateReportV7 {
  readonly ok: boolean;
  readonly version: 7;
  readonly checks: readonly ReleaseGateCheckV7[];
  readonly errors: number;
  readonly warnings: number;
  readonly checksum: string;
}

const check = (id: string, ok: boolean, message: string, severity: ReleaseGateCheckV7['severity'] = ok ? 'info' : 'error'): ReleaseGateCheckV7 =>
  Object.freeze({ id, ok, severity, message });

export function runProductionReleaseGateV7(config: RuntimeConfigV7 = DEFAULT_RUNTIME_CONFIG_V7): ReleaseGateReportV7 {
  const checks: ReleaseGateCheckV7[] = [];
  checks.push(check('config.fixed-hz', Number.isFinite(config.fixedHz) && config.fixedHz >= 30 && config.fixedHz <= 240, 'fixed simulation frequency is within supported range'));
  checks.push(check('config.catch-up', Number.isInteger(config.maxCatchUpSteps) && config.maxCatchUpSteps >= 1 && config.maxCatchUpSteps <= 8, 'catch-up guard is bounded'));
  checks.push(check('config.scheduler', Number.isFinite(config.schedulerMs) && config.schedulerMs > 0 && config.schedulerMs <= 8, 'scheduler budget is bounded'));
  checks.push(check('config.world-cell', Number.isFinite(config.worldCellMeters) && config.worldCellMeters >= 4 && config.worldCellMeters <= 256, 'world spatial cell size is reasonable'));
  checks.push(check('network.packet', config.network.maxPacketBytes <= 1400 && config.network.maxPacketBytes >= 256, 'network packet size protects typical MTU'));
  checks.push(check('network.rate', config.network.maxCommandsPerSecond <= 1000 && config.network.maxSnapshotsPerSecond <= 120, 'network command/snapshot rates are bounded'));
  checks.push(check('assets.budget', config.asset.maxBytes > config.asset.reserveBytes && config.asset.maxEntries > 0, 'asset budget reserves admission headroom'));
  checks.push(check('codec.limit', DEFAULT_CODEC_LIMITS_V7.maxBytes >= 256 * 1024, 'codec payload limit is large enough for normal snapshots', 'info'));

  const codec = new RuntimeCodecV7();
  try {
    const probe = {
      tick: 0 as never, revision: 0 as never, baseline: null,
      entities: [], deltas: [], checksum: '00000000' as never,
    };
    const encoded = codec.encodeSnapshot({ ...probe, checksum: checksumV7({ tick: probe.tick, revision: probe.revision, baseline: probe.baseline, entities: probe.entities, deltas: probe.deltas }) });
    codec.decodeSnapshot(encoded);
    checks.push(check('codec.roundtrip', true, 'snapshot encode/decode roundtrip succeeded'));
  } catch (error) {
    checks.push(check('codec.roundtrip', false, error instanceof Error ? error.message : String(error)));
  }

  const errors = checks.filter((item) => item.severity === 'error' && !item.ok).length;
  const warnings = checks.filter((item) => item.severity === 'warning' && !item.ok).length;
  return Object.freeze({ ok: errors === 0, version: 7, checks: Object.freeze(checks), errors, warnings, checksum: checksumV7(checks) });
}

export function assertProductionReleaseGateV7(config: RuntimeConfigV7 = DEFAULT_RUNTIME_CONFIG_V7): ReleaseGateReportV7 {
  const report = runProductionReleaseGateV7(config);
  if (!report.ok) {
    const failures = report.checks.filter((item) => !item.ok).map((item) => `${item.id}: ${item.message}`).join('; ');
    throw new Error(`production-v7 release gate failed: ${failures}`);
  }
  return report;
}
