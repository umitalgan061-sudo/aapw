import type { EntityId, PredictionState, RuntimeCommand, Tick, Vec3 } from './types';
import { PredictionBuffer, TransformReconciler, normalizeInput } from './network';
import { commandId } from './types';
import { clamp, hashJson } from './deterministic';

export interface PredictionSample {
  readonly tick: Tick;
  readonly position: Vec3;
  readonly velocity: Vec3;
}
export interface PredictionLimits {
  readonly maxCommands: number;
  readonly maxCorrection: number;
  readonly maxInputAgeTicks: number;
}
export interface PredictionFrame {
  readonly command: RuntimeCommand;
  readonly state: PredictionState<PredictionSample>;
  readonly digest: string;
}

export class InputPredictionController {
  readonly limits: PredictionLimits;
  readonly actor: EntityId;
  #buffer = new PredictionBuffer<PredictionSample>(128);
  #reconciler: TransformReconciler;
  #sequence = 0;
  #lastTick = 0 as Tick;
  #position: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });
  #velocity: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });

  constructor(actor: EntityId, limits: Partial<PredictionLimits> = {}) {
    this.actor = actor;
    this.limits = Object.freeze({ maxCommands: 128, maxCorrection: 4, maxInputAgeTicks: 12, ...limits });
    this.#reconciler = new TransformReconciler(this.limits.maxCorrection);
  }

  predict(tick: Tick, move: Vec3, speed = 5): PredictionFrame | null {
    if (Number(tick) + this.limits.maxInputAgeTicks < Number(this.#lastTick)) return null;
    const input = normalizeInput(move, { x: 0, y: 0, z: 0 }, false, false);
    const command: RuntimeCommand = Object.freeze({
      id: commandId('prediction:' + String(++this.#sequence)),
      tick,
      actor: this.actor,
      type: 'player.move',
      payload: Object.freeze({ move: input.move, speed: clamp(speed, 0, 20) }),
      sequence: this.#sequence,
      predictionKey: String(this.actor) + ':' + String(this.#sequence),
    });
    this.#velocity = Object.freeze({ x: input.move.x * speed, y: 0, z: input.move.z * speed });
    this.#position = Object.freeze({
      x: this.#position.x + this.#velocity.x / 60,
      y: this.#position.y + this.#velocity.y / 60,
      z: this.#position.z + this.#velocity.z / 60,
    });
    const predicted: PredictionSample = Object.freeze({ tick, position: this.#position, velocity: this.#velocity });
    this.#buffer.push(command, predicted);
    this.#lastTick = tick;
    const authoritative = predicted;
    const state = this.#buffer.reconcile(authoritative, tick, distance);
    return Object.freeze({ command, state, digest: hashJson({ command, state }) });
  }

  reconcile(tick: Tick, authoritative: PredictionSample): PredictionState<PredictionSample> {
    const state = this.#buffer.reconcile(authoritative, tick, distance);
    if (state.error > this.limits.maxCorrection) {
      this.#position = authoritative.position;
      this.#velocity = authoritative.velocity;
    } else {
      this.#position = blendVec3(this.#position, authoritative.position, 0.5);
      this.#velocity = blendVec3(this.#velocity, authoritative.velocity, 0.5);
    }
    return state;
  }

  acknowledge(sequence: number): void { this.#buffer.acknowledge(Math.max(0, Math.trunc(sequence))); }
  pending(): number { return this.#buffer.size(); }
  position(): Vec3 { return this.#position; }
  velocity(): Vec3 { return this.#velocity; }
  clear(): void { this.#buffer.clear(); this.#sequence = 0; this.#lastTick = 0 as Tick; this.#position = Object.freeze({ x: 0, y: 0, z: 0 }); this.#velocity = Object.freeze({ x: 0, y: 0, z: 0 }); }
}

function distance(a: PredictionSample, b: PredictionSample): number {
  return Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y, a.position.z - b.position.z);
}
function blendVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  const n = clamp(t, 0, 1);
  return Object.freeze({ x: a.x + (b.x - a.x) * n, y: a.y + (b.y - a.y) * n, z: a.z + (b.z - a.z) * n });
}
