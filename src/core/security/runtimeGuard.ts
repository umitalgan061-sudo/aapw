import { freeze, type RuntimeError } from '../domain/contracts.ts';

export interface RuntimeGuardPolicy {
  readonly maxListeners: number;
  readonly maxTimers: number;
  readonly maxFetches: number;
  readonly maxDomMutationsPerFrame: number;
  readonly maxAssetBytes: number;
  readonly allowNetwork: boolean;
  readonly allowStorage: boolean;
  readonly allowDynamicCode: boolean;
}

export interface GuardMetrics {
  readonly listeners: number;
  readonly timers: number;
  readonly fetches: number;
  readonly domMutations: number;
  readonly assetBytes: number;
  readonly violations: number;
}

export interface GuardViolation extends RuntimeError {
  readonly resource: keyof GuardMetrics;
  readonly limit: number;
  readonly observed: number;
}

const defaultPolicy: RuntimeGuardPolicy = freeze({
  maxListeners: 2048,
  maxTimers: 512,
  maxFetches: 64,
  maxDomMutationsPerFrame: 1000,
  maxAssetBytes: 1024 * 1024 * 1024,
  allowNetwork: true,
  allowStorage: true,
  allowDynamicCode: false,
});

export class RuntimeGuard {
  readonly #policy: RuntimeGuardPolicy;
  #listeners = 0;
  #timers = 0;
  #fetches = 0;
  #domMutations = 0;
  #assetBytes = 0;
  #violations = 0;

  constructor(policy: Partial<RuntimeGuardPolicy> = {}) { this.#policy = freeze({ ...defaultPolicy, ...policy }); }

  get policy(): RuntimeGuardPolicy { return this.#policy; }

  listener(delta = 1): boolean { return this.#reserve('listeners', delta, this.#policy.maxListeners); }
  timer(delta = 1): boolean { return this.#reserve('timers', delta, this.#policy.maxTimers); }
  fetch(delta = 1): boolean { return this.#reserve('fetches', delta, this.#policy.maxFetches); }
  domMutation(delta = 1): boolean { return this.#reserve('domMutations', delta, this.#policy.maxDomMutationsPerFrame); }
  asset(bytes: number): boolean { return this.#reserve('assetBytes', Math.max(0, bytes), this.#policy.maxAssetBytes); }

  canNetwork(): boolean { return this.#policy.allowNetwork; }
  canStorage(): boolean { return this.#policy.allowStorage; }
  canEval(): boolean { return this.#policy.allowDynamicCode; }

  resetFrame(): void { this.#domMutations = 0; }

  release(resource: 'listeners' | 'timers' | 'fetches', delta = 1): void {
    const amount = Math.max(0, Math.floor(delta));
    switch (resource) {
      case 'listeners': this.#listeners = Math.max(0, this.#listeners - amount); break;
      case 'timers': this.#timers = Math.max(0, this.#timers - amount); break;
      case 'fetches': this.#fetches = Math.max(0, this.#fetches - amount); break;
    }
  }

  metrics(): GuardMetrics {
    return freeze({ listeners: this.#listeners, timers: this.#timers, fetches: this.#fetches, domMutations: this.#domMutations, assetBytes: this.#assetBytes, violations: this.#violations });
  }

  audit(): readonly GuardViolation[] {
    const metrics = this.metrics();
    const checks: Array<[keyof GuardMetrics, number, number]> = [
      ['listeners', this.#policy.maxListeners, metrics.listeners],
      ['timers', this.#policy.maxTimers, metrics.timers],
      ['fetches', this.#policy.maxFetches, metrics.fetches],
      ['domMutations', this.#policy.maxDomMutationsPerFrame, metrics.domMutations],
      ['assetBytes', this.#policy.maxAssetBytes, metrics.assetBytes],
    ];
    return checks.filter(([, limit, observed]) => observed > limit).map(([resource, limit, observed]) => freeze({ code: 'RESOURCE_LIMIT', message: `${resource} exceeded its runtime limit.`, resource, limit, observed }));
  }

  #reserve(resource: 'listeners' | 'timers' | 'fetches' | 'domMutations' | 'assetBytes', delta: number, limit: number): boolean {
    const amount = Math.max(0, Math.floor(delta));
    switch (resource) {
      case 'listeners': {
        const observed = this.#listeners + amount;
        if (observed > limit) { this.#violations += 1; return false; }
        this.#listeners = observed;
        return true;
      }
      case 'timers': {
        const observed = this.#timers + amount;
        if (observed > limit) { this.#violations += 1; return false; }
        this.#timers = observed;
        return true;
      }
      case 'fetches': {
        const observed = this.#fetches + amount;
        if (observed > limit) { this.#violations += 1; return false; }
        this.#fetches = observed;
        return true;
      }
      case 'domMutations': {
        const observed = this.#domMutations + amount;
        if (observed > limit) { this.#violations += 1; return false; }
        this.#domMutations = observed;
        return true;
      }
      case 'assetBytes': {
        const observed = this.#assetBytes + amount;
        if (observed > limit) { this.#violations += 1; return false; }
        this.#assetBytes = observed;
        return true;
      }
    }
  }
}

export interface SafeCallResult<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: RuntimeError;
}

export const safeCall = <T>(operation: () => T, code = 'RUNTIME_FAILURE'): SafeCallResult<T> => {
  try { return freeze({ ok: true, value: operation() }); }
  catch (error) { return freeze({ ok: false, error: { code, message: error instanceof Error ? error.message : String(error) } }); }
};

export const safeAsync = async <T>(operation: () => Promise<T>, code = 'ASYNC_RUNTIME_FAILURE'): Promise<SafeCallResult<T>> => {
  try { return freeze({ ok: true, value: await operation() }); }
  catch (error) { return freeze({ ok: false, error: { code, message: error instanceof Error ? error.message : String(error) } }); }
};
