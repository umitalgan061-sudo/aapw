import {
  type ReleaseGateV4,
  type ReleaseReportV4,
  type RuntimeHealthV4,
  type QualityTierV4,
  type OutcomeV4,
  okV4,
  failV4,
  createRuntimeErrorV4,
  qualityRankV4,
} from './runtimeContractsV4';

export interface ReleaseContextV4 {
  readonly buildId: string;
  readonly health: RuntimeHealthV4;
  readonly quality: QualityTierV4;
  readonly typecheckPassed: boolean;
  readonly testsPassed: boolean;
  readonly deterministicGuardPassed: boolean;
  readonly forbiddenPrimitiveCount: number;
  readonly assetIntegrityFailures: number;
  readonly networkProtocolErrors: number;
}

export interface ReleaseGateConfigV4 {
  readonly minimumHealthScore?: number;
  readonly minimumQualityRank?: number;
  readonly maxForbiddenPrimitives?: number;
  readonly maxAssetFailures?: number;
  readonly maxNetworkErrors?: number;
}

export interface ReleaseGateResultV4 {
  readonly report: ReleaseReportV4;
  readonly blockingFailures: readonly ReleaseGateV4[];
}

const boolGate = (name: string, passed: boolean, detail: string): ReleaseGateV4 => Object.freeze({ name, passed, blocking: true, detail });

export class ReleaseGateV4 {
  readonly config: Required<ReleaseGateConfigV4>;

  constructor(config: ReleaseGateConfigV4 = {}) {
    this.config = {
      minimumHealthScore: Math.max(0, Math.min(100, config.minimumHealthScore ?? 85)),
      minimumQualityRank: Math.max(0, Math.min(4, Math.trunc(config.minimumQualityRank ?? 1))),
      maxForbiddenPrimitives: Math.max(0, Math.trunc(config.maxForbiddenPrimitives ?? 0)),
      maxAssetFailures: Math.max(0, Math.trunc(config.maxAssetFailures ?? 0)),
      maxNetworkErrors: Math.max(0, Math.trunc(config.maxNetworkErrors ?? 0)),
    };
  }

  evaluate(context: ReleaseContextV4): ReleaseGateResultV4 {
    const gates: ReleaseGateV4[] = [];
    gates.push(boolGate('build-id', context.buildId.trim().length > 0, context.buildId.trim() ? 'Build id present' : 'Build id is empty'));
    gates.push(boolGate('runtime-health', context.health.score >= this.config.minimumHealthScore && !context.health.stalled, `score=${context.health.score.toFixed(1)} stalled=${context.health.stalled}`));
    gates.push(boolGate('typecheck', context.typecheckPassed, context.typecheckPassed ? 'TypeScript check passed' : 'TypeScript check failed'));
    gates.push(boolGate('tests', context.testsPassed, context.testsPassed ? 'Regression tests passed' : 'Regression tests failed'));
    gates.push(boolGate('deterministic-guard', context.deterministicGuardPassed, context.deterministicGuardPassed ? 'Deterministic guards passed' : 'Deterministic guards failed'));
    gates.push(boolGate('quality-floor', qualityRankV4(context.quality) >= this.config.minimumQualityRank, `quality=${context.quality}`));
    gates.push(boolGate('forbidden-primitives', context.forbiddenPrimitiveCount <= this.config.maxForbiddenPrimitives, `count=${context.forbiddenPrimitiveCount}`));
    gates.push(boolGate('asset-integrity', context.assetIntegrityFailures <= this.config.maxAssetFailures, `failures=${context.assetIntegrityFailures}`));
    gates.push(boolGate('network-errors', context.networkProtocolErrors <= this.config.maxNetworkErrors, `errors=${context.networkProtocolErrors}`));
    const blockingFailures = gates.filter((gate) => gate.blocking && !gate.passed);
    const report: ReleaseReportV4 = Object.freeze({ buildId: context.buildId, generatedAt: Date.now(), passed: blockingFailures.length === 0, gates: Object.freeze(gates) });
    return { report, blockingFailures: Object.freeze(blockingFailures) };
  }

  assert(context: ReleaseContextV4): OutcomeV4<ReleaseReportV4> {
    const result = this.evaluate(context);
    return result.report.passed ? okV4(result.report) : failV4(createRuntimeErrorV4('RELEASE_GATE_FAILED', result.blockingFailures.map((gate) => `${gate.name}: ${gate.detail}`).join('; '), false));
  }
}

export function releaseGateSummaryV4(report: ReleaseReportV4): string {
  const status = report.passed ? 'PASS' : 'FAIL';
  return `${status} ${report.buildId} (${report.gates.filter((gate) => gate.passed).length}/${report.gates.length} gates)`;
}
