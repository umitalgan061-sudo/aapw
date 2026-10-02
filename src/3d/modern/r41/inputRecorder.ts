import type { InputIntent } from './inputIntent';

export interface InputRecording {
  readonly sessionId: string;
  readonly startedTick: number;
  readonly intents: readonly InputIntent[];
}

export class InputRecorder {
  readonly maxIntents: number;
  #sessionId = '';
  #startedTick = 0;
  #intents: InputIntent[] = [];

  constructor(maxIntents = 12000) {
    this.maxIntents = Math.max(
      256,
      Math.trunc(maxIntents),
    );
  }

  start(
    sessionId: string,
    tick: number,
  ): void {
    if (!sessionId.trim()) {
      throw new Error(
        'INPUT_RECORDING_SESSION_REQUIRED',
      );
    }

    this.#sessionId = sessionId;
    this.#startedTick = tick;
    this.#intents = [];
  }

  record(
    intent: InputIntent,
  ): boolean {
    if (!this.#sessionId) {
      return false;
    }

    if (
      intent.tick
      < this.#startedTick
    ) {
      return false;
    }

    this.#intents.push(
      Object.freeze({
        ...intent,
      }),
    );

    while (
      this.#intents.length
      > this.maxIntents
    ) {
      this.#intents.shift();
    }

    return true;
  }

  recording():
    InputRecording | null {
    if (!this.#sessionId) {
      return null;
    }

    return Object.freeze({
      sessionId: this.#sessionId,
      startedTick: this.#startedTick,
      intents: Object.freeze([
        ...this.#intents,
      ]),
    });
  }

  clear(): void {
    this.#sessionId = '';
    this.#startedTick = 0;
    this.#intents = [];
  }

  size(): number {
    return this.#intents.length;
  }
}
