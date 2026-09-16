import type { CapabilitySnapshot, EngineResult, EntityId, FrameCommand, RuntimeHealth, SystemDefinition } from './types.js';
import { RuntimeKernel, type RuntimeKernelOptions } from './runtime.js';
import { TypedEventBus } from './eventBus.js';
import { probeCapabilities, buildPlatformProfile } from './capabilities.js';
import { deepFreeze, validateCommand } from './validation.js';
import { createModernEngineFacade, type ModernEngineFacade } from './index.js';

export interface LegacyRuntimeContract {
  readonly events?: { on?: (name: string, handler: (...args: unknown[]) => unknown) => unknown; off?: (...args: unknown[]) => unknown };
  readonly emit?: (name: string, payload?: unknown) => unknown;
  readonly getState?: () => unknown;
  readonly setState?: (state: unknown) => unknown;
  readonly tick?: (deltaSeconds: number) => unknown;
  readonly dispose?: () => unknown;
}

export interface MigrationBoundaryOptions extends RuntimeKernelOptions {
  readonly legacy?: LegacyRuntimeContract;
  readonly bridgeLegacyEvents?: readonly string[];
  readonly exposeGlobal?: boolean;
  readonly globalName?: string;
}

export interface MigrationHealth {
  readonly mode: 'shadow' | 'active' | 'legacy';
  readonly typescriptReady: boolean;
  readonly legacyConnected: boolean;
  readonly bridgedEvents: number;
  readonly lastError?: string;
}

export class MigrationBoundary {
  private readonly legacy?: LegacyRuntimeContract;
  private readonly legacyUnsubscribers: Array<() => void> = [];
  private readonly runtime: RuntimeKernel;
  private readonly events: TypedEventBus;
  private readonly mode: 'shadow' | 'active';
  private readonly bridged = new Set<string>();
  private lastError: string | undefined;
  private disposed = false;

  public constructor(options: MigrationBoundaryOptions = {}) {
    this.legacy = options.legacy;
    this.runtime = new RuntimeKernel(options);
    this.events = new TypedEventBus({ maxQueuedEvents: options.eventQueue ?? 4096 });
    this.mode = options.legacy ? 'shadow' : 'active';
    this.runtime.initialize();
    for (const eventName of options.bridgeLegacyEvents ?? []) this.bridgeLegacyEvent(eventName);
    if (options.exposeGlobal && typeof globalThis !== 'undefined') this.exposeGlobal(options.globalName ?? '__AAPW_ENGINE_TS__');
  }

  public get health(): MigrationHealth {
    return Object.freeze({ mode: this.mode, typescriptReady: !this.disposed && !this.runtime.disposed, legacyConnected: Boolean(this.legacy), bridgedEvents: this.bridged.size, ...(this.lastError ? { lastError: this.lastError } : {}) });
  }
  public get engine(): RuntimeKernel { return this.runtime; }
  public get bus(): TypedEventBus { return this.events; }

  public addSystem(system: SystemDefinition): boolean { return this.runtime.registerSystem(system); }

  public submitLegacyCommand(value: unknown): EngineResult<void> {
    const report = validateCommand(value);
    if (!report.ok || !isFrameCommand(value)) return { ok: false, meta: { status: 'invalid', code: 'LEGACY_COMMAND_INVALID', message: report.issues.map(issue => issue.path).join(',') } };
    const result = this.runtime.submitCommand(value);
    if (!result.ok) this.lastError = result.meta.code;
    return result;
  }

  public publishLegacyEvent(name: string, payload: unknown): boolean {
    if (this.disposed || !name) return false;
    try {
      const accepted = this.events.publish(name, deepFreeze(payload));
      if (accepted && this.legacy?.emit) this.legacy.emit(name, payload);
      return accepted;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'legacy event bridge error';
      return false;
    }
  }

  public frame(deltaSeconds: number): ReturnType<RuntimeKernel['advance']> {
    if (this.disposed) return this.runtime.advance({ deltaSeconds: 0 });
    return this.runtime.advance({ deltaSeconds });
  }

  public shadowCompare(deltaSeconds: number, legacyState: unknown): { readonly match: boolean; readonly engineChecksum: string; readonly legacyFingerprint: string } {
    const result = this.frame(deltaSeconds);
    const engineFingerprint = result.frame.checksum;
    const legacyFingerprint = fingerprint(legacyState);
    return Object.freeze({ match: engineFingerprint === legacyFingerprint, engineChecksum: engineFingerprint, legacyFingerprint });
  }

  public exportLegacyState(): EngineResult<unknown> {
    if (!this.legacy?.getState) return { ok: false, meta: { status: 'rejected', code: 'LEGACY_STATE_UNAVAILABLE' } };
    try { return { ok: true, value: deepFreeze(structuredClone(this.legacy.getState())), meta: { status: 'ok', code: 'LEGACY_STATE_CAPTURED' } }; }
    catch (error) { return { ok: false, meta: { status: 'invalid', code: 'LEGACY_STATE_ERROR', message: error instanceof Error ? error.message : 'unknown' } }; }
  }

  public importToLegacy(state: unknown): EngineResult<void> {
    if (!this.legacy?.setState) return { ok: false, meta: { status: 'rejected', code: 'LEGACY_STATE_WRITE_UNAVAILABLE' } };
    try { this.legacy.setState(structuredClone(state)); return { ok: true, meta: { status: 'ok', code: 'LEGACY_STATE_WRITTEN' } }; }
    catch (error) { return { ok: false, meta: { status: 'rejected', code: 'LEGACY_STATE_WRITE_ERROR', message: error instanceof Error ? error.message : 'unknown' } }; }
  }

  public promote(): boolean {
    if (this.disposed || !this.legacy) return false;
    try { this.legacy.dispose?.(); this.disposed = false; return true; }
    catch (error) { this.lastError = error instanceof Error ? error.message : 'promotion error'; return false; }
  }

  public bridgeLegacyEvent(name: string): boolean {
    if (!this.legacy || !name || this.bridged.has(name)) return false;
    const listener = (...args: unknown[]): void => { this.publishLegacyEvent(name, args.length <= 1 ? args[0] : args); };
    const events = this.legacy.events;
    try {
      if (events?.on) {
        const unsubscribe = events.on(name, listener);
        if (typeof unsubscribe === 'function') this.legacyUnsubscribers.push(unsubscribe as () => void);
        this.bridged.add(name);
        return true;
      }
    } catch (error) { this.lastError = error instanceof Error ? error.message : 'event bridge error'; }
    return false;
  }

  public capabilities(): CapabilitySnapshot { return probeCapabilities(); }
  public platform(): ReturnType<typeof buildPlatformProfile> { return buildPlatformProfile(this.capabilities()); }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsubscribe of this.legacyUnsubscribers.splice(0)) { try { unsubscribe(); } catch { /* teardown isolation */ } }
    this.runtime.dispose();
    this.events.dispose();
  }

  private exposeGlobal(name: string): void {
    const root = globalThis as unknown as Record<string, unknown>;
    if (root[name]) return;
    const facade: ModernEngineFacade = createModernEngineFacade();
    root[name] = Object.freeze({ facade, migration: this });
  }
}

const isFrameCommand = (value: unknown): value is FrameCommand => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<FrameCommand>;
  return record.type === 'frame' && typeof record.kind === 'string' && typeof record.entity === 'string';
};

const fingerprint = (value: unknown): string => {
  try {
    const canonical = JSON.stringify(value, (_key, candidate: unknown) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(candidate as Record<string, unknown>).sort()) sorted[key] = (candidate as Record<string, unknown>)[key];
      return sorted;
    });
    let hash = 2166136261 >>> 0;
    for (let index = 0; index < canonical.length; index += 1) { hash ^= canonical.charCodeAt(index); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(16).padStart(8, '0');
  } catch { return '00000000'; }
};

export const createMigrationBoundary = (options: MigrationBoundaryOptions = {}): MigrationBoundary => new MigrationBoundary(options);

export const legacyAdapterContract = Object.freeze({
  version: 1,
  strategy: 'shadow-first',
  eventDirection: 'legacy-to-typescript',
  stateDirection: 'bidirectional-explicit',
  mutationOwner: 'caller',
  failClosed: true,
});
