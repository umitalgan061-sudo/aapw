import type { InputAction } from './types';
import { checksum } from './deterministic';

export interface InputReplay {
  readonly version: 1;
  readonly actions: readonly InputAction[];
  readonly digest: string;
}

/** Records user intent, not DOM events, so replays survive device/layout changes. */
export class InputRecorder {
  #recording = false;
  #actions: InputAction[] = [];

  start(): void { this.#recording = true; this.#actions = []; }
  stop(): InputReplay { this.#recording = false; return this.snapshot(); }
  push(action: InputAction): void { if (this.#recording) this.#actions.push({ ...action }); }
  snapshot(): InputReplay {
    const actions = [...this.#actions].sort((a, b) => Number(a.timestamp) - Number(b.timestamp) || a.action.localeCompare(b.action));
    return { version: 1, actions, digest: checksum(actions) };
  }
  clear(): void { this.#actions = []; }
  get recording(): boolean { return this.#recording; }
}

export interface ReplayCursor {
  readonly next: () => InputAction | null;
  readonly done: () => boolean;
  readonly reset: () => void;
}

export function createReplayCursor(replay: InputReplay): ReplayCursor {
  let index = 0;
  const actions = [...replay.actions].sort((a, b) => Number(a.timestamp) - Number(b.timestamp) || a.action.localeCompare(b.action));
  return {
    next() { return index < actions.length ? { ...actions[index++]! } : null; },
    done() { return index >= actions.length; },
    reset() { index = 0; },
  };
}

export function replayDigest(actions: readonly InputAction[]): string {
  return checksum(actions.map((action) => ({
    action: action.action,
    value: Number(action.value.toFixed(5)),
    source: action.source,
    timestamp: Number(action.timestamp),
  })));
}
