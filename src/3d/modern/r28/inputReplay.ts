import type { InputFrame } from '../r27/contracts.ts';

export interface ReplayHeader {
  readonly magic: 'AAPW-R28-INPUT';
  readonly version: 1;
  readonly tickRate: number;
  readonly createdAtTick: number;
}

export interface ReplayFrame {
  readonly input: InputFrame;
  readonly checksum: string;
}

export interface ReplayClip {
  readonly header: ReplayHeader;
  readonly frames: readonly ReplayFrame[];
  readonly checksum: string;
}

function checksumText(value: string): string {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function canonicalInput(input: InputFrame): string {
  const analog = Object.entries(input.analog)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => key + '=' + value.toFixed(6))
    .join('|');
  return [
    input.tick,
    input.move.x.toFixed(6),
    input.move.y.toFixed(6),
    input.look.x.toFixed(6),
    input.look.y.toFixed(6),
    [...input.buttons].sort().join(','),
    analog,
  ].join(';');
}

export class InputReplayRecorder {
  readonly tickRate: number;
  readonly createdAtTick: number;
  #frames: ReplayFrame[] = [];
  #recording = false;

  constructor(tickRate = 60, createdAtTick = 0) {
    this.tickRate = Math.max(1, Math.floor(tickRate));
    this.createdAtTick = Math.max(0, Math.floor(createdAtTick));
  }

  start(): void {
    this.#frames = [];
    this.#recording = true;
  }

  stop(): ReplayClip {
    this.#recording = false;
    const header: ReplayHeader = {
      magic: 'AAPW-R28-INPUT',
      version: 1,
      tickRate: this.tickRate,
      createdAtTick: this.createdAtTick,
    };
    const payload = JSON.stringify({
      header,
      frames: this.#frames,
    });
    return {
      header,
      frames: [...this.#frames],
      checksum: checksumText(payload),
    };
  }

  push(input: InputFrame): boolean {
    if (!this.#recording) return false;
    const normalized: InputFrame = {
      ...input,
      tick: Math.max(0, Math.floor(input.tick)),
      move: {
        x: clamp(input.move.x),
        y: clamp(input.move.y),
      },
      look: {
        x: clamp(input.look.x),
        y: clamp(input.look.y),
      },
      buttons: [...new Set(input.buttons)].sort(),
      analog: Object.fromEntries(
        Object.entries(input.analog)
          .filter(([, value]) => Number.isFinite(value))
          .map(([key, value]) => [key, clamp(value)]),
      ),
    };
    this.#frames.push({
      input: normalized,
      checksum: checksumText(canonicalInput(normalized)),
    });
    return true;
  }

  frameCount(): number {
    return this.#frames.length;
  }

  isRecording(): boolean {
    return this.#recording;
  }
}

export class InputReplayPlayer {
  readonly clip: ReplayClip;
  #cursor = 0;

  constructor(clip: ReplayClip) {
    this.clip = clip;
    this.#verify();
  }

  reset(): void {
    this.#cursor = 0;
  }

  next(): InputFrame | null {
    const frame = this.clip.frames[this.#cursor++];
    return frame?.input ?? null;
  }

  seek(tick: number): void {
    const target = Math.max(0, Math.floor(tick));
    const index = this.clip.frames.findIndex((frame) => frame.input.tick >= target);
    this.#cursor = index < 0 ? this.clip.frames.length : index;
  }

  remaining(): number {
    return Math.max(0, this.clip.frames.length - this.#cursor);
  }

  #verify(): void {
    if (this.clip.header.magic !== 'AAPW-R28-INPUT' || this.clip.header.version !== 1) {
      throw new Error('Unsupported R28 replay format');
    }
    const framePayload = this.clip.frames.map((frame) => frame.checksum).join('|');
    const expected = checksumText(JSON.stringify({ header: this.clip.header, frames: this.clip.frames }));
    if (expected !== this.clip.checksum) {
      throw new Error('R28 input replay checksum mismatch: ' + framePayload.slice(0, 16));
    }
    for (const frame of this.clip.frames) {
      if (checksumText(canonicalInput(frame.input)) !== frame.checksum) throw new Error('R28 input frame checksum mismatch');
    }
  }
}

function clamp(value: number): number {
  return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
}
