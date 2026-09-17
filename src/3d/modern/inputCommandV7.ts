import { clampV7, type InputDecisionV7, type InputIntentV7, type InputModeV7, type TickV7, tickV7, type Vec3V7 } from './runtimeContractsV7';

export interface InputBindingV7 {
  readonly action: string;
  readonly sources: readonly InputIntentV7['source'][];
  readonly modes: readonly InputModeV7[];
  readonly priority: number;
  readonly repeatable: boolean;
}

export interface InputRouterOptionsV7 {
  readonly maxActions?: number;
  readonly maxPendingTicks?: number;
  readonly deadZone?: number;
}

export interface InputFrameV7 {
  readonly tick: TickV7;
  readonly mode: InputModeV7;
  readonly intents: readonly InputIntentV7[];
}

export interface InputMetricsV7 {
  readonly received: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly deduplicated: number;
  readonly dropped: number;
}

const vec = (x: number, y: number, z: number): Vec3V7 => Object.freeze({ x, y, z });
const clampIntentVec = (input: Vec3V7, deadZone: number): Vec3V7 => {
  const x = Math.abs(input.x) < deadZone ? 0 : clampV7(input.x, -1, 1);
  const y = Math.abs(input.y) < deadZone ? 0 : clampV7(input.y, -1, 1);
  const z = Math.abs(input.z) < deadZone ? 0 : clampV7(input.z, -1, 1);
  const length = Math.sqrt(x * x + y * y + z * z);
  if (length <= 1) return vec(x, y, z);
  return vec(x / length, y / length, z / length);
};

export class InputCommandRouterV7 {
  readonly maxActions: number;
  readonly maxPendingTicks: number;
  readonly deadZone: number;
  #bindings: InputBindingV7[] = [];
  #dedupe = new Set<string>();
  #pending = new Map<number, InputIntentV7[]>();
  #metrics: InputMetricsV7 = { received: 0, accepted: 0, rejected: 0, deduplicated: 0, dropped: 0 };

  constructor(options: InputRouterOptionsV7 = {}) {
    this.maxActions = Math.max(1, Math.trunc(options.maxActions ?? 24));
    this.maxPendingTicks = Math.max(4, Math.trunc(options.maxPendingTicks ?? 120));
    this.deadZone = clampV7(options.deadZone ?? 0.08, 0, 0.5);
  }

  bind(binding: InputBindingV7): void {
    if (!binding.action.trim()) throw new Error('Input action is required');
    this.#bindings = [...this.#bindings.filter((existing) => existing.action !== binding.action), Object.freeze({ ...binding, priority: Math.trunc(binding.priority), sources: Object.freeze([...binding.sources]), modes: Object.freeze([...binding.modes]) })]
      .sort((a, b) => b.priority - a.priority || a.action.localeCompare(b.action));
  }

  unbind(action: string): boolean {
    const before = this.#bindings.length;
    this.#bindings = this.#bindings.filter((binding) => binding.action !== action);
    return before !== this.#bindings.length;
  }

  receive(intent: InputIntentV7): boolean {
    this.#metrics = { ...this.#metrics, received: this.#metrics.received + 1 };
    if (intent.actions.length > this.maxActions || !Number.isInteger(Number(intent.tick)) || !Number.isInteger(intent.sequence)) {
      this.#metrics = { ...this.#metrics, rejected: this.#metrics.rejected + 1 };
      return false;
    }
    const key = `${Number(intent.tick)}:${intent.source}:${intent.sequence}`;
    if (this.#dedupe.has(key)) {
      this.#metrics = { ...this.#metrics, deduplicated: this.#metrics.deduplicated + 1 };
      return false;
    }
    this.#dedupe.add(key);
    const normalized = Object.freeze({ ...intent, move: clampIntentVec(intent.move, this.deadZone), look: clampIntentVec(intent.look, this.deadZone), actions: Object.freeze([...new Set(intent.actions.map((action) => action.trim()).filter(Boolean))]) });
    const tick = Number(intent.tick);
    const bucket = this.#pending.get(tick) ?? [];
    if (bucket.length >= 8) {
      this.#metrics = { ...this.#metrics, dropped: this.#metrics.dropped + 1 };
      return false;
    }
    bucket.push(normalized);
    this.#pending.set(tick, bucket);
    while (this.#pending.size > this.maxPendingTicks) {
      const oldest = [...this.#pending.keys()].sort((a, b) => a - b)[0];
      if (oldest === undefined) break;
      this.#pending.delete(oldest);
      this.#metrics = { ...this.#metrics, dropped: this.#metrics.dropped + 1 };
    }
    return true;
  }

  decide(frame: InputFrameV7): InputDecisionV7 {
    const intents = frame.intents.length ? frame.intents : (this.#pending.get(Number(frame.tick)) ?? []);
    const accepted: InputIntentV7[] = [];
    const consumed = new Set<string>();
    const ordered = [...intents].sort((a, b) => Number(a.sequence) - Number(b.sequence) || a.source.localeCompare(b.source));
    let chosenMove: InputIntentV7 | undefined;
    let chosenLook: InputIntentV7 | undefined;
    for (const intent of ordered) {
      const allowedBindings = intent.actions.filter((action) => this.#bindings.some((binding) => binding.action === action && binding.modes.includes(frame.mode) && binding.sources.includes(intent.source)));
      if (allowedBindings.length > 0) {
        accepted.push(intent);
        for (const action of allowedBindings) consumed.add(action);
      }
      if (!chosenMove && (Math.abs(intent.move.x) + Math.abs(intent.move.y) + Math.abs(intent.move.z) > 0.001)) chosenMove = intent;
      if (!chosenLook && (Math.abs(intent.look.x) + Math.abs(intent.look.y) + Math.abs(intent.look.z) > 0.001)) chosenLook = intent;
    }
    const winner = chosenMove ?? chosenLook ?? ordered[0] ?? { tick: tickV7(Number(frame.tick)), source: 'virtual', move: vec(0, 0, 0), look: vec(0, 0, 0), actions: [], sequence: 0 };
    this.#metrics = { ...this.#metrics, accepted: this.#metrics.accepted + accepted.length, rejected: this.#metrics.rejected + Math.max(0, ordered.length - accepted.length) };
    this.#pending.delete(Number(frame.tick));
    return Object.freeze({ accepted: accepted.length > 0 || ordered.length === 0, intent: Object.freeze({ ...winner, tick: tickV7(Number(frame.tick)), actions: Object.freeze([...consumed].sort()) }), consumedActions: Object.freeze([...consumed].sort()), reason: accepted.length ? 'binding-match' : ordered.length ? 'no-binding-match' : 'neutral-input' });
  }

  metrics(): InputMetricsV7 { return Object.freeze({ ...this.#metrics }); }
  bindings(): readonly InputBindingV7[] { return Object.freeze(this.#bindings.slice()); }
  pendingTicks(): readonly number[] { return Object.freeze([...this.#pending.keys()].sort((a, b) => a - b)); }
}

export function installDefaultBindingsV7(router: InputCommandRouterV7): void {
  const gameplay: InputModeV7[] = ['gameplay'];
  const all: InputIntentV7['source'][] = ['keyboard', 'pointer', 'touch', 'gamepad', 'xr', 'virtual', 'network'];
  router.bind({ action: 'move', sources: all, modes: gameplay, priority: 100, repeatable: true });
  router.bind({ action: 'jump', sources: all, modes: gameplay, priority: 90, repeatable: false });
  router.bind({ action: 'sprint', sources: all, modes: gameplay, priority: 80, repeatable: true });
  router.bind({ action: 'interact', sources: all, modes: gameplay, priority: 70, repeatable: false });
  router.bind({ action: 'pause', sources: ['keyboard', 'gamepad', 'touch'], modes: ['gameplay', 'menu'], priority: 200, repeatable: false });
  router.bind({ action: 'photo', sources: ['keyboard', 'gamepad', 'touch'], modes: ['gameplay'], priority: 50, repeatable: false });
}
