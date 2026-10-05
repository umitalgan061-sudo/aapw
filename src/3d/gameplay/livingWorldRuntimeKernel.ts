/**
 * Living World Runtime Kernel — deterministic AI work arbitration.
 * Owns scheduling and telemetry only; entity behavior remains with existing gameplay systems.
 */
import {
  createLivingWorldStimulusWorkBudget,
  type StimulusActorInput,
} from './livingWorldStimulusWorkBudget.ts';
import {
  evaluateFaunaActivityBudget,
  faunaActivityBudgetDigest,
  type FaunaActivityCandidateInput,
  type FaunaActivityBudgetResult,
} from './livingWorldFaunaActivityBudget.ts';

export interface LivingWorldKernelTickInput {
  readonly tick?: number;
  readonly actors?: readonly StimulusActorInput[];
  readonly faunaCandidates?: readonly FaunaActivityCandidateInput[];
  readonly budget?: number;
  readonly context?: Readonly<Record<string, unknown>>;
}

export interface LivingWorldKernelSnapshot {
  readonly tick: number;
  readonly deterministic: true;
  readonly stimulus: ReturnType<ReturnType<typeof createLivingWorldStimulusWorkBudget>['select']>;
  readonly fauna: FaunaActivityBudgetResult;
  readonly selectedActorCount: number;
  readonly deferredFaunaCount: number;
  readonly digest: string;
}

function stableHash(value: unknown): number {
  let hash = 2166136261;
  for (const character of JSON.stringify(value ?? null)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function createLivingWorldRuntimeKernel(options: {
  readonly stimulusBudget?: number;
  readonly bucketCount?: number;
} = {}) {
  const stimulus = createLivingWorldStimulusWorkBudget({
    budget: options.stimulusBudget,
    bucketCount: options.bucketCount,
  });
  let tick = 0;
  let disposed = false;

  const runTick = (input: LivingWorldKernelTickInput = {}): LivingWorldKernelSnapshot => {
    if (disposed) {
      const fauna = evaluateFaunaActivityBudget([], { tick, seed: 'disposed', budget: 4 });
      const empty = stimulus.select([], 0);
      return Object.freeze({
        tick,
        deterministic: true,
        stimulus: empty,
        fauna,
        selectedActorCount: 0,
        deferredFaunaCount: 0,
        digest: 'disposed',
      });
    }

    const requestedTick = Number.isInteger(input.tick) ? Number(input.tick) : tick + 1;
    tick = Math.max(tick + 1, requestedTick);

    const stimulusResult = stimulus.select(input.actors ?? [], input.budget);
    const context: Readonly<Record<string, unknown>> = {
      ...(input.context ?? {}),
      tick,
      seed: String(input.context?.seed ?? 'living-world'),
      budget: Number(input.context?.budget ?? input.budget ?? 24),
    };
    const fauna = evaluateFaunaActivityBudget(input.faunaCandidates ?? [], context);
    const digest = stableHash({
      tick,
      stimulus: stimulusResult,
      fauna: faunaActivityBudgetDigest(fauna),
    }).toString(16).padStart(8, '0');

    return Object.freeze({
      tick,
      deterministic: true,
      stimulus: stimulusResult,
      fauna,
      selectedActorCount: stimulusResult.selected.length,
      deferredFaunaCount: fauna.deferred.length,
      digest,
    });
  };

  const reset = (): void => {
    tick = 0;
    stimulus.reset();
  };

  const dispose = (): void => {
    disposed = true;
    stimulus.dispose();
  };

  return Object.freeze({
    tick: runTick,
    reset,
    dispose,
    get snapshotTick(): number { return tick; },
  });
}

export interface LivingWorldRuntimeKernelReplayReport {
  readonly deterministic: true;
  readonly ticks: number;
  readonly lastDigest: string;
}

export function replayLivingWorldRuntimeKernel(
  factory: () => ReturnType<typeof createLivingWorldRuntimeKernel>,
  inputs: readonly LivingWorldKernelTickInput[],
): LivingWorldRuntimeKernelReplayReport {
  const left = factory();
  const right = factory();
  let lastDigest = '';

  for (const input of inputs) {
    const a = left.tick(input);
    const b = right.tick(input);
    if (a.digest !== b.digest) throw new Error('Living World Runtime Kernel lost determinism.');
    lastDigest = a.digest;
  }

  left.dispose();
  right.dispose();
  return Object.freeze({ deterministic: true, ticks: inputs.length, lastDigest });
}
