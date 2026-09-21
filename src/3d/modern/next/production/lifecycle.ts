import type { Tick } from '../types.ts';
import type {
  FailurePolicy,
  LifecycleHook,
  LifecycleHookContext,
  RuntimeClock,
  RuntimeFault,
  RuntimeMode,
  RuntimeIdentity,
  SubsystemId,
} from './contracts.ts';

export interface LifecycleSupervisorConfig {
  readonly identity: RuntimeIdentity;
  readonly recoveryAttempts: number;
  readonly faultAfterFailures: number;
}

export interface LifecycleSnapshot {
  readonly mode: RuntimeMode;
  readonly started: boolean;
  readonly paused: boolean;
  readonly hooks: number;
  readonly healthyHooks: number;
  readonly faults: number;
  readonly recoveryAttempts: number;
}

interface HookState {
  readonly hook: LifecycleHook;
  started: boolean;
  healthy: boolean;
  failures: number;
  lastFault?: RuntimeFault;
  recoveries: number;
}

const MODES: readonly RuntimeMode[] = ['booting','running','paused','recovering','stopped','faulted'];

export class ProductionLifecycleSupervisor {
  readonly config: LifecycleSupervisorConfig;
  #hooks: HookState[] = [];
  #mode: RuntimeMode = 'booting';
  #faults: RuntimeFault[] = [];
  #abort = new AbortController();
  #clock: RuntimeClock = {
    tick: 0 as Tick,
    simTimeSeconds: 0,
    wallTimeMs: 0,
    frameIndex: 0,
    deltaSeconds: 0,
  };

  constructor(config: LifecycleSupervisorConfig) {
    this.config = {
      identity: config.identity,
      recoveryAttempts: Math.max(0, Math.floor(config.recoveryAttempts)),
      faultAfterFailures: Math.max(1, Math.floor(config.faultAfterFailures)),
    };
  }

  get mode(): RuntimeMode {
    return this.#mode;
  }

  setClock(clock: RuntimeClock): void {
    this.#clock = { ...clock };
  }

  register(hook: LifecycleHook): void {
    if (this.#hooks.some((entry) => entry.hook.id === hook.id)) throw new Error(`duplicate lifecycle hook: ${hook.id}`);
    this.#hooks.push({ hook, started: false, healthy: true, failures: 0, recoveries: 0 });
    this.#hooks.sort((a, b) => a.hook.priority - b.hook.priority || a.hook.id.localeCompare(b.hook.id));
  }

  async start(): Promise<void> {
    if (this.#mode === 'running') return;
    this.#setMode('booting');
    const context = this.#context();
    for (const state of this.#hooks) {
      if (!state.hook.start) {
        state.started = true;
        continue;
      }
      const ok = await this.#invoke(state, 'start', () => state.hook.start!(context));
      if (!ok && state.hook.failurePolicy === 'fault-runtime') {
        this.#setMode('faulted');
        return;
      }
      if (ok) state.started = true;
    }
    this.#setMode('running');
  }

  async pause(): Promise<boolean> {
    if (this.#mode !== 'running') return false;
    this.#setMode('paused');
    const context = this.#context();
    let success = true;
    for (const state of this.#hooks.toReversed()) {
      if (!state.started || !state.hook.pause) continue;
      const ok = await this.#invoke(state, 'pause', () => state.hook.pause!(context));
      success = success && ok;
    }
    return success;
  }

  async resume(): Promise<boolean> {
    if (this.#mode !== 'paused') return false;
    const context = this.#context();
    let success = true;
    for (const state of this.#hooks) {
      if (!state.started || !state.hook.resume) continue;
      const ok = await this.#invoke(state, 'resume', () => state.hook.resume!(context));
      success = success && ok;
    }
    if (success) this.#setMode('running');
    return success;
  }

  async recover(subsystem: SubsystemId): Promise<boolean> {
    this.#setMode('recovering');
    const target = this.#hooks.filter((state) => state.hook.subsystem === subsystem);
    let success = true;
    for (const state of target) {
      let recovered = false;
      for (let attempt = 1; attempt <= this.config.recoveryAttempts; attempt += 1) {
        state.recoveries += 1;
        const ok = await this.#invoke(state, 'resume', () => state.hook.resume?.(this.#context()), false);
        if (ok) {
          state.failures = 0;
          state.healthy = true;
          recovered = true;
          break;
        }
      }
      success = success && recovered;
    }
    this.#setMode(success ? 'running' : 'faulted');
    return success;
  }

  async stop(): Promise<void> {
    if (this.#mode === 'stopped') return;
    const context = this.#context();
    for (const state of this.#hooks.toReversed()) {
      if (!state.started || !state.hook.stop) continue;
      await this.#invoke(state, 'stop', () => state.hook.stop!(context), false);
      state.started = false;
    }
    this.#setMode('stopped');
  }

  async dispose(): Promise<void> {
    await this.stop();
    const context = this.#context();
    for (const state of this.#hooks.toReversed()) {
      if (!state.hook.dispose) continue;
      await this.#invoke(state, 'dispose', () => state.hook.dispose!(context), false);
    }
    this.#abort.abort();
    this.#hooks.length = 0;
    this.#setMode('stopped');
  }

  addFault(fault: RuntimeFault): void {
    this.#faults.push(fault);
    if (this.#faults.length > 256) this.#faults.shift();
  }

  faults(limit = 32): RuntimeFault[] {
    return this.#faults.slice(-Math.max(0, Math.floor(limit)));
  }

  hookStates(): readonly {
    id: string;
    subsystem: SubsystemId;
    policy: FailurePolicy;
    started: boolean;
    healthy: boolean;
    failures: number;
    recoveries: number;
    lastFault?: RuntimeFault;
  }[] {
    return this.#hooks.map((state) => ({
      id: state.hook.id,
      subsystem: state.hook.subsystem,
      policy: state.hook.failurePolicy,
      started: state.started,
      healthy: state.healthy,
      failures: state.failures,
      recoveries: state.recoveries,
      lastFault: state.lastFault,
    }));
  }

  snapshot(): LifecycleSnapshot {
    return {
      mode: this.#mode,
      started: this.#hooks.some((state) => state.started),
      paused: this.#mode === 'paused',
      hooks: this.#hooks.length,
      healthyHooks: this.#hooks.filter((state) => state.healthy).length,
      faults: this.#faults.length,
      recoveryAttempts: this.#hooks.reduce((sum, state) => sum + state.recoveries, 0),
    };
  }

  #context(): LifecycleHookContext {
    return {
      identity: this.config.identity,
      clock: this.#clock,
      signal: this.#abort.signal,
    };
  }

  async #invoke(
    state: HookState,
    operation: 'start' | 'pause' | 'resume' | 'stop' | 'dispose',
    action: () => void | Promise<void> | undefined,
    countFailure = true,
  ): Promise<boolean> {
    try {
      await action();
      return true;
    } catch (error) {
      if (countFailure) state.failures += 1;
      state.healthy = false;
      const fault: RuntimeFault = {
        subsystem: state.hook.subsystem,
        policy: state.hook.failurePolicy,
        message: error instanceof Error ? `${operation}: ${error.message}` : `${operation}: ${String(error)}`,
        tick: this.#clock.tick,
        recoverable: state.failures < this.config.faultAfterFailures || state.hook.failurePolicy !== 'fault-runtime',
        details: { hook: state.hook.id, failures: state.failures },
      };
      state.lastFault = fault;
      this.#faults.push(fault);
      if (this.#faults.length > 256) this.#faults.shift();
      if (state.failures >= this.config.faultAfterFailures && state.hook.failurePolicy === 'fault-runtime') this.#mode = 'faulted';
      if (state.hook.failurePolicy === 'restart' && operation !== 'stop' && operation !== 'dispose') {
        try {
          await state.hook.stop?.(this.#context());
          await state.hook.start?.(this.#context());
          state.started = true;
          state.healthy = true;
        } catch {
          state.healthy = false;
        }
      }
      return false;
    }
  }

  #setMode(next: RuntimeMode): void {
    if (!MODES.includes(next)) throw new Error(`unsupported lifecycle mode: ${next}`);
    this.#mode = next;
  }
}

export function createLifecycleIdentity(partial: Partial<RuntimeIdentity> = {}): RuntimeIdentity {
  return {
    application: partial.application?.trim() || 'aapw',
    build: partial.build?.trim() || 'production-r4',
    session: partial.session?.trim() || 'local',
    contractVersion: 1,
  };
}
