/** Production TypeScript owner for src/3d/gameplay/playerCombatActionRouter.js. Legacy .js remains compatibility-only. */
export const PLAYER_COMBAT_INPUT_EVENT = 'aapw:player-combat-input' as const;
export const PLAYER_COMBAT_INPUT_ACTIONS = Object.freeze(['light', 'heavy'] as const);
export type PlayerCombatInputAction = typeof PLAYER_COMBAT_INPUT_ACTIONS[number];
export interface PlayerCombatInputEvent {
  readonly kind: PlayerCombatInputAction;
  readonly source: string;
  readonly sequence: number;
  readonly timestamp: number;
}
export interface PlayerCombatActionRouterOptions {
  readonly target?: PlayerCombatEventTarget;
  readonly now?: () => number;
  readonly maxQueue?: unknown;
  readonly ttlMs?: unknown;
}
export interface PlayerCombatEventTarget extends EventTarget {
  readonly CustomEvent?: typeof CustomEvent;
}
export interface PlayerCombatActionRouter {
  readonly enqueue: (action: unknown, source?: unknown, timestamp?: unknown) => boolean;
  readonly drain: (options?: { readonly currentTime?: unknown; readonly max?: unknown }) => readonly PlayerCombatInputEvent[];
  readonly emit: (action: unknown, source?: unknown, timestamp?: unknown) => boolean;
  readonly reset: () => void;
}

const ACTION_SET = new Set<PlayerCombatInputAction>(PLAYER_COMBAT_INPUT_ACTIONS);
const normalizeAction = (action: unknown): PlayerCombatInputAction | null => {
  const value = action === 'lightAttack' ? 'light' : action === 'heavyAttack' ? 'heavy' : action;
  return typeof value === 'string' && ACTION_SET.has(value as PlayerCombatInputAction) ? value as PlayerCombatInputAction : null;
};
const normalizeSource = (source: unknown): string => typeof source === 'string' && source.trim() ? source.trim().slice(0, 32) : 'unknown';
const finite = (value: unknown, fallback: number): number => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function createPlayerCombatActionRouter({
  target = globalThis as unknown as PlayerCombatEventTarget,
  now = () => Date.now(),
  maxQueue = 16,
  ttlMs = 750,
}: PlayerCombatActionRouterOptions = {}): PlayerCombatActionRouter {
  const queue: PlayerCombatInputEvent[] = [];
  let sequence = 0;
  const queueLimit = Math.max(1, Math.min(128, Math.floor(finite(maxQueue, 16))));
  const ttl = Math.max(0, finite(ttlMs, 750));

  const enqueue = (action: unknown, source = 'unknown', timestamp = now()): boolean => {
    const kind = normalizeAction(action);
    if (!kind) return false;
    const safeTimestamp = finite(timestamp, now());
    const event = Object.freeze({ kind, source: normalizeSource(source), sequence: ++sequence, timestamp: safeTimestamp });
    queue.push(event);
    if (queue.length > queueLimit) queue.splice(0, queue.length - queueLimit);
    return true;
  };

  const drain = ({ currentTime = now(), max = queueLimit }: { readonly currentTime?: unknown; readonly max?: unknown } = {}): readonly PlayerCombatInputEvent[] => {
    const cutoff = finite(currentTime, now()) - ttl;
    while (queue.length && queue[0].timestamp < cutoff) queue.shift();
    const count = Math.max(0, Math.min(queueLimit, Math.floor(finite(max, queueLimit))));
    return Object.freeze(queue.splice(0, count));
  };

  const emit = (action: unknown, source = 'unknown', timestamp = now()): boolean => {
    if (!enqueue(action, source, timestamp)) return false;
    const [event] = drain({ currentTime: timestamp, max: 1 });
    const Constructor = target.CustomEvent ?? CustomEvent;
    if (!event || typeof target.dispatchEvent !== 'function' || typeof Constructor !== 'function') return false;
    target.dispatchEvent(new Constructor(PLAYER_COMBAT_INPUT_EVENT, { detail: event }));
    return true;
  };

  const reset = (): void => { queue.length = 0; sequence = 0; };
  return Object.freeze({ enqueue, drain, emit, reset });
}
