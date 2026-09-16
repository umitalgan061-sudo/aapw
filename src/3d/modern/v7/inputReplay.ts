import { asTick, boundedArray, clamp, digest, integer, type Disposable, type Tick, type V7Result } from './primitives.js';

export type InputDevice = 'keyboard' | 'pointer' | 'touch' | 'gamepad' | 'virtual';
export type InputAction = 'move' | 'look' | 'jump' | 'sprint' | 'interact' | 'primary' | 'secondary' | 'dodge' | 'guard' | 'lockOn' | 'inventory' | 'pause';
export interface RawInput { readonly device: InputDevice; readonly action: string; readonly x?: number; readonly y?: number; readonly value?: number; readonly pressed?: boolean; readonly serial?: number; }
export interface InputCommand { readonly tick: Tick; readonly device: InputDevice; readonly action: InputAction; readonly x: number; readonly y: number; readonly value: number; readonly pressed: boolean; readonly serial: number; }
export interface InputFrame { readonly tick: Tick; readonly commands: readonly InputCommand[]; readonly digest: string; }
export interface ReplaySegment { readonly fromTick: Tick; readonly toTick: Tick; readonly frames: readonly InputFrame[]; readonly digest: string; }
export interface InputReplayOptions { readonly historyLimit?: number; readonly commandsPerFrame?: number; readonly replayLimit?: number; }

const aliases: Readonly<Record<string, InputAction>> = Object.freeze({
  w: 'move', a: 'move', s: 'move', d: 'move', arrowup: 'move', arrowleft: 'move', arrowdown: 'move', arrowright: 'move',
  mousemove: 'look', pointermove: 'look', touchmove: 'look', gamepadlook: 'look',
  space: 'jump', shift: 'sprint', e: 'interact', enter: 'interact', click: 'primary', mouse0: 'primary', mouse1: 'secondary',
  dodge: 'dodge', guard: 'guard', block: 'guard', parry: 'guard', lockon: 'lockOn', inventory: 'inventory', i: 'inventory', escape: 'pause', pause: 'pause',
});

function normalizeAction(action: string): InputAction | null { return aliases[action.trim().toLowerCase()] ?? (Object.values(aliases).includes(action as InputAction) ? action as InputAction : null); }
function finite(value: unknown, fallback = 0): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }

export class InputReplayRuntime implements Disposable {
  readonly historyLimit: number; readonly commandsPerFrame: number; readonly replayLimit: number;
  #frames = new Map<number, InputCommand[]>(); #serial = 0; #disposed = false; #recording = true;
  constructor(options: InputReplayOptions = {}) { this.historyLimit = clamp(integer(options.historyLimit ?? 600), 16, 100_000); this.commandsPerFrame = clamp(integer(options.commandsPerFrame ?? 32), 1, 256); this.replayLimit = clamp(integer(options.replayLimit ?? 10_000), 32, 250_000); }
  ingest(raw: RawInput, tick: Tick): V7Result<InputCommand> {
    if (this.#disposed) return { ok: false, code: 'INPUT_DISPOSED', message: 'Input runtime is disposed', retryable: false };
    const action = normalizeAction(raw.action); if (!action) return { ok: false, code: 'INPUT_ACTION', message: `Unsupported action ${raw.action}`, retryable: false };
    const command: InputCommand = Object.freeze({ tick, device: raw.device, action, x: clamp(finite(raw.x), -1, 1), y: clamp(finite(raw.y), -1, 1), value: clamp(finite(raw.value), -1, 1), pressed: Boolean(raw.pressed), serial: ++this.#serial });
    if (!this.#recording) return { ok: true, value: command };
    const frame = this.#frames.get(Number(tick)) ?? []; if (frame.length >= this.commandsPerFrame) return { ok: false, code: 'INPUT_FRAME_LIMIT', message: 'Input frame command limit reached', retryable: true };
    frame.push(command); frame.sort((a, b) => a.serial - b.serial); this.#frames.set(Number(tick), frame); this.#trim(); return { ok: true, value: command };
  }
  frame(tick: Tick): InputFrame { const commands = this.#frames.get(Number(tick)) ?? []; return Object.freeze({ tick, commands: Object.freeze([...commands]), digest: digest(tick, commands) }); }
  range(fromTick: Tick, toTick: Tick): ReplaySegment {
    const start = Number(fromTick); const end = Math.max(start, Number(toTick)); const frames: InputFrame[] = [];
    for (let tick = start; tick <= end && frames.length < this.replayLimit; tick += 1) frames.push(this.frame(asTick(tick)));
    return Object.freeze({ fromTick, toTick: asTick(end), frames: Object.freeze(frames), digest: digest(frames) });
  }
  replay(segment: ReplaySegment, consumer: (command: InputCommand) => void): number {
    if (this.#disposed) return 0; let count = 0; for (const frame of boundedArray(segment.frames, this.replayLimit)) for (const command of frame.commands) { if (count >= this.replayLimit) return count; try { consumer(command); count += 1; } catch { /* consumer isolation */ } } return count;
  }
  setRecording(active: boolean): void { this.#recording = Boolean(active); }
  isRecording(): boolean { return this.#recording; }
  clear(): void { this.#frames.clear(); this.#serial = 0; }
  frameCount(): number { return this.#frames.size; }
  digest(fromTick = 0, toTick = Math.max(0, ...this.#frames.keys())): string { return this.range(asTick(fromTick), asTick(toTick)).digest; }
  dispose(): void { this.#disposed = true; this.clear(); }
  #trim(): void { if (this.#frames.size <= this.historyLimit) return; const ordered = [...this.#frames.keys()].sort((a, b) => a - b); for (const tick of ordered.slice(0, ordered.length - this.historyLimit)) this.#frames.delete(tick); }
}

export function normalizeInputSnapshot(raw: readonly RawInput[], tick: Tick): readonly InputCommand[] {
  return Object.freeze(raw.map((value, index) => Object.freeze({ tick, device: value.device, action: normalizeAction(value.action) ?? 'pause', x: clamp(finite(value.x), -1, 1), y: clamp(finite(value.y), -1, 1), value: clamp(finite(value.value), -1, 1), pressed: Boolean(value.pressed), serial: finite(value.serial, index) })).filter((command) => command.action !== 'pause' || raw.some((value) => value.action.toLowerCase() === 'pause')));
}
