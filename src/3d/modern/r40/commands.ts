import type { CommandId, EntityId, RuntimeCommand, Tick } from './types';
import { commandId } from './types';
import { hashJson, stableSort } from './deterministic';

export interface CommandRule {
  readonly type: string;
  readonly validate: (payload: Readonly<Record<string, unknown>>) => boolean;
  readonly cost: number;
  readonly lane: 'critical' | 'interactive' | 'simulation' | 'background' | 'idle';
}
export interface CommandResult { readonly accepted: boolean; readonly command: RuntimeCommand | null; readonly reason: string; readonly digest: string; }
export interface CommandBatch { readonly tick: Tick; readonly commands: readonly RuntimeCommand[]; readonly digest: string; }

export class CommandRouter {
  #rules = new Map<string, CommandRule>();
  #sequence = 0;
  #lastTick = 0;
  #history: RuntimeCommand[] = [];

  register(rule: CommandRule): boolean {
    if (!/^[A-Za-z0-9_.:-]{1,96}$/.test(rule.type) || this.#rules.has(rule.type)) return false;
    if (rule.cost < 1 || rule.cost > 1000) return false;
    this.#rules.set(rule.type, Object.freeze({ ...rule }));
    return true;
  }

  route(type: string, payload: Readonly<Record<string, unknown>>, tick: Tick, actor: EntityId | null = null): CommandResult {
    const rule = this.#rules.get(type);
    if (!rule) return Object.freeze({ accepted: false, command: null, reason: 'unknown command type', digest: hashJson({ type, payload }) });
    let accepted = false;
    try { accepted = Boolean(rule.validate(payload)); } catch { accepted = false; }
    if (!accepted) return Object.freeze({ accepted: false, command: null, reason: 'command payload rejected', digest: hashJson({ type, payload }) });
    const command: RuntimeCommand = Object.freeze({
      id: commandId('cmd-' + String(++this.#sequence)),
      tick,
      actor,
      type,
      payload: Object.freeze({ ...payload }),
      sequence: this.#sequence,
      predictionKey: actor ? String(actor) + ':' + String(this.#sequence) : null,
    });
    this.#history.push(command);
    if (this.#history.length > 4096) this.#history.shift();
    this.#lastTick = Math.max(this.#lastTick, Number(tick));
    return Object.freeze({ accepted: true, command, reason: 'accepted', digest: hashJson(command) });
  }

  batch(tick: Tick, commands: readonly RuntimeCommand[]): CommandBatch {
    const ordered = stableSort(commands.filter((command) => Number(command.tick) <= Number(tick)), (a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
    return Object.freeze({ tick, commands: Object.freeze(ordered), digest: hashJson(ordered) });
  }

  history(fromTick: Tick = 0 as Tick): readonly RuntimeCommand[] { return Object.freeze(this.#history.filter((command) => Number(command.tick) >= Number(fromTick))); }
  registered(): readonly string[] { return Object.freeze([...this.#rules.keys()].sort()); }
  remove(type: string): boolean { return this.#rules.delete(type); }
  clear(): void { this.#rules.clear(); this.#history.length = 0; this.#sequence = 0; this.#lastTick = 0; }
  lastTick(): Tick { return this.#lastTick as Tick; }
}

export function commandReplayKey(command: RuntimeCommand): string {
  return String(command.tick) + ':' + String(command.sequence) + ':' + String(command.id);
}

export function isMovementCommand(command: RuntimeCommand): boolean {
  return command.type === 'player.move' || command.type === 'player.look' || command.type === 'player.jump';
}
