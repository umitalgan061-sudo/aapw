import type { PlayerCombatActionV6 } from './playerCombatDecisionV6.ts';

export const PLAYER_COMBAT_INPUT_EVENT = 'aapw:player-combat-input' as const;
const ACTIONS: ReadonlySet<PlayerCombatActionV6> = new Set(['light', 'heavy']);
const MAX_QUEUE = 16;
const EVENT_TTL_MS = 750;

type CombatEventTarget = {
  readonly CustomEvent?: new <T>(type: string, init: { readonly detail: T }) => Event & { readonly detail: T };
  readonly dispatchEvent?: (event: Event) => boolean;
};

export interface PlayerCombatActionEventV6 {
  readonly kind: Extract<PlayerCombatActionV6, 'light' | 'heavy'>;
  readonly source: string;
  readonly sequence: number;
  readonly timestamp: number;
}

export interface PlayerCombatActionRouterOptionsV6 {
  readonly target?: CombatEventTarget;
  readonly now?: () => number;
  readonly maxQueue?: number;
  readonly ttlMs?: number;
}

const normalizeAction = (action: string): Extract<PlayerCombatActionV6, 'light' | 'heavy'> | null => {
  if (action === 'lightAttack') return 'light';
  if (action === 'heavyAttack') return 'heavy';
  if (action === 'light' || action === 'heavy') return action;
  return null;
};

const normalizeSource = (source: unknown): string => {
  if (typeof source !== 'string') return 'unknown';
  const trimmed = source.trim();
  return trimmed ? trimmed.slice(0, 32) : 'unknown';
};

export class PlayerCombatActionRouterV6 {
  readonly #target: CombatEventTarget;
  readonly #now: () => number;
  readonly #maxQueue: number;
  readonly #ttlMs: number;
  #queue: PlayerCombatActionEventV6[] = [];
  #sequence = 0;

  constructor(options: PlayerCombatActionRouterOptionsV6 = {}) {
    this.#target = options.target ?? (globalThis as unknown as CombatEventTarget);
    this.#now = options.now ?? (() => Date.now());
    this.#maxQueue = Math.max(1, Math.floor(options.maxQueue ?? MAX_QUEUE));
    this.#ttlMs = Math.max(0, Number.isFinite(options.ttlMs) ? Number(options.ttlMs) : EVENT_TTL_MS);
  }

  enqueue(actionInput: string, source = 'unknown', timestamp = this.#now()): boolean {
    const kind = normalizeAction(actionInput);
    if (!kind || !ACTIONS.has(kind)) return false;
    const event: PlayerCombatActionEventV6 = Object.freeze({
      kind,
      source: normalizeSource(source),
      sequence: ++this.#sequence,
      timestamp: Number.isFinite(timestamp) ? timestamp : this.#now(),
    });
    this.#queue.push(event);
    if (this.#queue.length > this.#maxQueue) this.#queue.splice(0, this.#queue.length - this.#maxQueue);
    return true;
  }

  drain(options: { readonly currentTime?: number; readonly max?: number } = {}): readonly PlayerCombatActionEventV6[] {
    const currentTime = Number.isFinite(options.currentTime) ? Number(options.currentTime) : this.#now();
    const cutoff = currentTime - this.#ttlMs;
    while (this.#queue.length > 0 && this.#queue[0].timestamp < cutoff) this.#queue.shift();
    const max = Math.max(0, Math.min(this.#maxQueue, Math.floor(options.max ?? this.#maxQueue)));
    return Object.freeze(this.#queue.splice(0, max));
  }

  emit(actionInput: string, source = 'unknown', timestamp = this.#now()): boolean {
    if (!this.enqueue(actionInput, source, timestamp)) return false;
    const [event] = this.drain({ currentTime: timestamp, max: 1 });
    const CustomEventCtor = this.#target.CustomEvent;
    if (!event || typeof this.#target.dispatchEvent !== 'function' || typeof CustomEventCtor !== 'function') return false;
    this.#target.dispatchEvent(new CustomEventCtor<PlayerCombatActionEventV6>(PLAYER_COMBAT_INPUT_EVENT, { detail: event }));
    return true;
  }

  reset(): void {
    this.#queue.length = 0;
    this.#sequence = 0;
  }

  size(): number { return this.#queue.length; }
}

export function createPlayerCombatActionRouter(options: PlayerCombatActionRouterOptionsV6 = {}): Readonly<{
  enqueue: PlayerCombatActionRouterV6['enqueue'];
  drain: PlayerCombatActionRouterV6['drain'];
  emit: PlayerCombatActionRouterV6['emit'];
  reset: PlayerCombatActionRouterV6['reset'];
  size: PlayerCombatActionRouterV6['size'];
}> {
  const router = new PlayerCombatActionRouterV6(options);
  return Object.freeze({
    enqueue: router.enqueue.bind(router),
    drain: router.drain.bind(router),
    emit: router.emit.bind(router),
    reset: router.reset.bind(router),
    size: router.size.bind(router),
  });
}
