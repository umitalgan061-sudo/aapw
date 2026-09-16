import type { Disposable, EngineResult, FrameCommand, Sequence, TickId } from './types.js';
import { BoundedPriorityQueue, RingBuffer } from './collections.js';
import { SEQUENCE } from './types.js';
import { clamp, stableSort } from './deterministic.js';

export type CommandDomain = 'movement' | 'combat' | 'camera' | 'interaction' | 'ui' | 'system';
export interface InputCommand extends FrameCommand { readonly domain: CommandDomain; readonly action: string; readonly value: number; readonly pressed: boolean; readonly source: 'keyboard' | 'mouse' | 'gamepad' | 'touch' | 'system'; readonly clientTimestamp: number; }
export interface CommandPolicy { readonly maxEntries: number; readonly ttlTicks: number; readonly repeatSuppressionTicks: number; readonly priorities: Readonly<Record<CommandDomain, number>>; }
export interface CommandSnapshot { readonly queued: number; readonly emitted: number; readonly rejected: number; readonly sequence: number; readonly lastTick: TickId; }

const DEFAULT_POLICY: CommandPolicy = Object.freeze({ maxEntries: 1024, ttlTicks: 30, repeatSuppressionTicks: 2, priorities: Object.freeze({ system: 100, combat: 80, movement: 60, interaction: 50, camera: 40, ui: 20 }) });

export class DeterministicCommandBuffer implements Disposable {
  private readonly policy: CommandPolicy;
  private readonly queue: BoundedPriorityQueue<InputCommand>;
  private readonly history: RingBuffer<InputCommand>;
  private readonly latestByAction = new Map<string, { tick: number; command: InputCommand }>();
  private sequence = 0;
  private emitted = 0;
  private rejected = 0;
  private lastTick = 0 as TickId;
  private _disposed = false;

  public constructor(policy: Partial<CommandPolicy> = {}) {
    this.policy = Object.freeze({ ...DEFAULT_POLICY, ...policy, maxEntries: Math.max(8, Math.trunc(policy.maxEntries ?? DEFAULT_POLICY.maxEntries)), ttlTicks: Math.max(0, Math.trunc(policy.ttlTicks ?? DEFAULT_POLICY.ttlTicks)), repeatSuppressionTicks: Math.max(0, Math.trunc(policy.repeatSuppressionTicks ?? DEFAULT_POLICY.repeatSuppressionTicks)), priorities: Object.freeze({ ...DEFAULT_POLICY.priorities, ...(policy.priorities ?? {}) }) });
    this.queue = new BoundedPriorityQueue(this.policy.maxEntries);
    this.history = new RingBuffer(this.policy.maxEntries);
  }
  public get disposed(): boolean { return this._disposed; }
  public get stats(): CommandSnapshot { return Object.freeze({ queued: this.queue.size, emitted: this.emitted, rejected: this.rejected, sequence: this.sequence, lastTick: this.lastTick }); }

  public submit(command: Omit<InputCommand, 'id' | 'kind' | 'version' | 'revision' | 'priority'>, tick: TickId): EngineResult<InputCommand> {
    if (this._disposed) return fail('BUFFER_DISPOSED', 'disposed');
    const action = String(command.action || 'unknown');
    const tickNumber = Math.max(0, Math.trunc(tick));
    const previous = this.latestByAction.get(`${command.domain}:${action}`);
    if (previous && tickNumber - previous.tick <= this.policy.repeatSuppressionTicks && command.pressed === previous.command.pressed && Math.abs(command.value - previous.command.value) < 1e-6) { this.rejected += 1; return fail('DUPLICATE_SUPPRESSED'); }
    const result: InputCommand = Object.freeze({ ...command, kind: 'engine.command', version: 1, revision: this.sequence + 1, id: SEQUENCE(++this.sequence), issuedAtTick: tick, priority: clamp(this.policy.priorities[command.domain] ?? 0, -100, 100), action, value: Number.isFinite(command.value) ? clamp(command.value, -1, 1) : 0, clientTimestamp: Number.isFinite(command.clientTimestamp) ? command.clientTimestamp : 0 });
    const pushed = this.queue.push(result, result.priority);
    if (!pushed.ok) { this.rejected += 1; return fail('BUFFER_FULL'); }
    this.latestByAction.set(`${command.domain}:${action}`, { tick: tickNumber, command: result });
    this.lastTick = tick;
    return { ok: true, value: result, meta: { status: 'ok', code: 'COMMAND_QUEUED' } };
  }

  public drain(tick: TickId, max = 128): readonly InputCommand[] {
    if (this._disposed) return [];
    this.lastTick = tick;
    const values = this.queue.drain(Math.max(0, Math.trunc(max)));
    const fresh = values.filter(command => Number(tick) - Number(command.issuedAtTick) <= this.policy.ttlTicks);
    const ordered = stableSort(fresh, (a, b) => b.priority - a.priority || Number(a.issuedAtTick) - Number(b.issuedAtTick) || Number(a.id) - Number(b.id));
    for (const command of ordered) { this.history.push(command); this.emitted += 1; }
    return Object.freeze(ordered);
  }

  public replay(fromTick: TickId, toTick: TickId): readonly InputCommand[] {
    return this.history.toArray().filter(command => Number(command.issuedAtTick) >= Number(fromTick) && Number(command.issuedAtTick) <= Number(toTick));
  }

  public reset(): void { this.queue.clear(); this.history.clear(); this.latestByAction.clear(); this.sequence = 0; this.emitted = 0; this.rejected = 0; this.lastTick = 0 as TickId; }
  public dispose(): void { if (this._disposed) return; this.reset(); this.queue.dispose(); this.history.dispose(); this._disposed = true; }
}

export interface ArbiterCandidate { readonly command: InputCommand; readonly allowed: boolean; readonly reason: string; }
export interface ArbitrationContext { readonly stamina: number; readonly poise: number; readonly grounded: boolean; readonly lockedOn: boolean; readonly menuOpen: boolean; readonly combatLocked: boolean; readonly tick: TickId; }

export class CommandArbiter {
  public evaluate(commands: readonly InputCommand[], context: ArbitrationContext): readonly ArbiterCandidate[] {
    const candidates = stableSort(commands, (a, b) => b.priority - a.priority || Number(a.id) - Number(b.id));
    return Object.freeze(candidates.map(command => {
      const result = this.check(command, context);
      return Object.freeze({ command, allowed: result.allowed, reason: result.reason });
    }));
  }
  public choose(commands: readonly InputCommand[], context: ArbitrationContext): InputCommand | undefined {
    return this.evaluate(commands, context).find(candidate => candidate.allowed)?.command;
  }
  private check(command: InputCommand, context: ArbitrationContext): { allowed: boolean; reason: string } {
    if (context.menuOpen && command.domain !== 'ui') return { allowed: false, reason: 'ui-focus' };
    if (context.combatLocked && (command.domain === 'movement' || command.domain === 'interaction')) return { allowed: false, reason: 'combat-lock' };
    if (command.action.includes('dodge') && context.stamina < 12) return { allowed: false, reason: 'stamina' };
    if (command.action.includes('heavy') && context.stamina < 24) return { allowed: false, reason: 'stamina' };
    if (command.action.includes('parry') && context.poise <= 0) return { allowed: false, reason: 'poise' };
    if (command.action.includes('jump') && !context.grounded) return { allowed: false, reason: 'airborne' };
    return { allowed: true, reason: context.lockedOn ? 'lock-on-context' : 'accepted' };
  }
}

const fail = <T>(code: string, message?: string): EngineResult<T> => ({ ok: false, meta: { status: 'rejected', code, ...(message ? { message } : {}) } });
