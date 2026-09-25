/**
 * Runtime-facing parity consumer for the shared WorldAssetPlacementPipeline contract.
 *
 * The placement pipeline remains the only authority for asset loading, material assignment,
 * grounding, manifest creation and scene attachment. This module is deliberately observation-only:
 * it consumes an already-prepared placement result and fail-closes before a caller attaches it.
 */
import {
  evaluatePreparedWorldPlacementParity,
} from './terrainPlacementParityRuntime.ts';

export type PreparedWorldPlacementParityDecision = Readonly<{
  ok: boolean;
  failures: readonly string[];
  sampleCount: number;
  maxHeightDeltaMeters: number;
  maxFootprintRangeMeters: number;
  prepared: unknown;
}>;

export function evaluatePreparedPlacementForAttach(prepared: unknown): PreparedWorldPlacementParityDecision {
  const result = evaluatePreparedWorldPlacementParity(prepared as never);
  return Object.freeze({
    ok: result.ok,
    failures: Object.freeze([...result.failures]),
    sampleCount: result.sampleCount,
    maxHeightDeltaMeters: result.maxHeightDeltaMeters,
    maxFootprintRangeMeters: result.maxFootprintRangeMeters,
    prepared,
  });
}

export function assertPreparedPlacementForAttach(prepared: unknown): PreparedWorldPlacementParityDecision {
  const decision = evaluatePreparedPlacementForAttach(prepared);
  if (!decision.ok) {
    throw new Error(`Prepared world placement rejected: ${decision.failures.join(',')}`);
  }
  return decision;
}
