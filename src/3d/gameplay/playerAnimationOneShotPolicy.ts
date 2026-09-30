/** Production TypeScript owner for src/3d/gameplay/playerAnimationOneShotPolicy.js. Legacy .js remains compatibility-only. */
export const PLAYER_ANIMATION_ONESHOT_POLICY_VERSION = '2026-09-15-v1' as const;

export const PLAYER_ANIMATION_ONESHOT_LIMITS = Object.freeze({
  maxWindowSeconds: 2.5,
  minWindowSeconds: 0.03,
  minRetriggerGapSeconds: 0.08,
  maxRequestsPerWindow: 4,
  maxHistoryEntries: 32,
} as const);

export const PLAYER_ANIMATION_ONESHOT_STATES = Object.freeze([
  'ready',
  'starting',
  'holding',
  'ending',
  'cooldown',
] as const);

export type PlayerAnimationOneShotPhase = typeof PLAYER_ANIMATION_ONESHOT_STATES[number];
export interface PlayerAnimationOneShotRequestInput {
  readonly action?: unknown;
  readonly windowSeconds?: unknown;
  readonly priority?: unknown;
  readonly variant?: unknown;
}
export interface PlayerAnimationOneShotRequest {
  readonly action: string;
  readonly windowSeconds: number;
  readonly priority: number;
  readonly variant: string;
  readonly fingerprint: string;
}
export interface PlayerAnimationOneShotState {
  readonly phase: PlayerAnimationOneShotPhase;
  readonly action: string;
  readonly variant: string;
  readonly remainingSeconds: number;
  readonly elapsedSeconds: number;
  readonly lastRequestAtSeconds: number;
  readonly requestsInWindow: number;
  readonly requestFingerprint: string;
  readonly transitionCount: number;
  readonly rejectionCount: number;
}
export type PlayerAnimationOneShotRejectReason = 'empty-action' | 'cooldown' | 'duplicate' | 'window-quota' | 'lower-priority-active';
export interface PlayerAnimationOneShotDecision {
  readonly accepted: boolean;
  readonly reason: 'ready' | 'priority-replace' | PlayerAnimationOneShotRejectReason;
  readonly request: PlayerAnimationOneShotRequest;
}
export interface PlayerAnimationOneShotStepResult {
  readonly state: PlayerAnimationOneShotState;
  readonly decision: PlayerAnimationOneShotDecision | null;
  readonly started: boolean;
  readonly ended: boolean;
  readonly validation: Readonly<{ ok: boolean; failures: readonly string[] }>;
}
export interface PlayerAnimationOneShotSignal {
  readonly type: 'action-start' | 'action-end' | 'action-rejected';
  readonly sequence: number;
  readonly action: string;
  readonly variant?: string;
  readonly fingerprint?: string;
  readonly reason?: PlayerAnimationOneShotRejectReason;
  readonly atSeconds: number;
}
export interface PlayerAnimationOneShotSnapshot {
  readonly version: typeof PLAYER_ANIMATION_ONESHOT_POLICY_VERSION;
  readonly nowSeconds: number;
  readonly state: PlayerAnimationOneShotState;
  readonly sequence: number;
  readonly history: readonly PlayerAnimationOneShotSignal[];
}
export interface PlayerAnimationOneShotController {
  readonly update: (deltaSeconds: unknown, request?: PlayerAnimationOneShotRequestInput | null) => Readonly<PlayerAnimationOneShotStepResult & { snapshot: PlayerAnimationOneShotSnapshot }>;
  readonly snapshot: () => PlayerAnimationOneShotSnapshot;
  readonly reset: () => void;
  readonly readHistory: () => readonly PlayerAnimationOneShotSignal[];
}

const finite = (value: unknown, fallback = 0): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};
const clamp = (value: unknown, min: number, max: number): number => Math.max(min, Math.min(max, finite(value, min)));
const round = (value: unknown, digits = 4): number => {
  const factor = 10 ** digits;
  const output = Math.round(finite(value) * factor) / factor;
  return Object.is(output, -0) ? 0 : output;
};
const normalizeAction = (value: unknown): string => typeof value === 'string' && value.length > 0 ? value : 'none';
const normalizeWindow = (value: unknown): number => clamp(finite(value, 0.5), PLAYER_ANIMATION_ONESHOT_LIMITS.minWindowSeconds, PLAYER_ANIMATION_ONESHOT_LIMITS.maxWindowSeconds);

function stableHash(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function canonicalRequest(request: PlayerAnimationOneShotRequestInput = {}): string {
  return JSON.stringify({
    action: normalizeAction(request.action),
    windowSeconds: normalizeWindow(request.windowSeconds),
    priority: clamp(Math.floor(finite(request.priority, 0)), 0, 9),
    variant: typeof request.variant === 'string' ? request.variant : 'default',
  });
}

export function normalizePlayerAnimationOneShotRequest(request: PlayerAnimationOneShotRequestInput = {}): PlayerAnimationOneShotRequest {
  return Object.freeze({
    action: normalizeAction(request.action),
    windowSeconds: normalizeWindow(request.windowSeconds),
    priority: clamp(Math.floor(finite(request.priority, 0)), 0, 9),
    variant: typeof request.variant === 'string' ? request.variant : 'default',
    fingerprint: stableHash(canonicalRequest(request)),
  });
}

export function createPlayerAnimationOneShotState(): PlayerAnimationOneShotState {
  return Object.freeze({
    phase: 'ready',
    action: 'none',
    variant: 'default',
    remainingSeconds: 0,
    elapsedSeconds: 0,
    lastRequestAtSeconds: -Infinity,
    requestsInWindow: 0,
    requestFingerprint: '',
    transitionCount: 0,
    rejectionCount: 0,
  });
}

export function validatePlayerAnimationOneShotState(state: unknown): Readonly<{ ok: boolean; failures: readonly string[] }> {
  const value = state && typeof state === 'object' ? state as Partial<PlayerAnimationOneShotState> : {};
  const failures: string[] = [];
  if (!PLAYER_ANIMATION_ONESHOT_STATES.includes(value.phase as PlayerAnimationOneShotPhase)) failures.push('phase');
  if (!Number.isFinite(value.remainingSeconds) || (value.remainingSeconds ?? 0) < 0) failures.push('remainingSeconds');
  if (!Number.isFinite(value.elapsedSeconds) || (value.elapsedSeconds ?? 0) < 0) failures.push('elapsedSeconds');
  if (!Number.isInteger(value.requestsInWindow) || (value.requestsInWindow ?? 0) < 0) failures.push('requestsInWindow');
  if (!Number.isInteger(value.rejectionCount) || (value.rejectionCount ?? 0) < 0) failures.push('rejectionCount');
  if (!Number.isInteger(value.transitionCount) || (value.transitionCount ?? 0) < 0) failures.push('transitionCount');
  return Object.freeze({ ok: failures.length === 0, failures: Object.freeze(failures) });
}

export function resolvePlayerAnimationOneShotDecision(
  state: PlayerAnimationOneShotState | null | undefined,
  request: PlayerAnimationOneShotRequestInput,
  nowSeconds = 0,
): PlayerAnimationOneShotDecision {
  const current = state ?? createPlayerAnimationOneShotState();
  const normalized = normalizePlayerAnimationOneShotRequest(request);
  const now = Math.max(0, finite(nowSeconds));
  const active = current.phase !== 'ready' && current.phase !== 'cooldown';
  const gap = now - finite(current.lastRequestAtSeconds, -Infinity);
  const sameAction = current.action === normalized.action && current.variant === normalized.variant;
  const cooldownBlocked = current.phase === 'cooldown' && gap < PLAYER_ANIMATION_ONESHOT_LIMITS.minRetriggerGapSeconds;
  const duplicateBlocked = active && sameAction && gap < PLAYER_ANIMATION_ONESHOT_LIMITS.minRetriggerGapSeconds;
  const quotaBlocked = current.requestsInWindow >= PLAYER_ANIMATION_ONESHOT_LIMITS.maxRequestsPerWindow && gap < normalized.windowSeconds;
  if (normalized.action === 'none') return Object.freeze({ accepted: false, reason: 'empty-action', request: normalized });
  if (cooldownBlocked) return Object.freeze({ accepted: false, reason: 'cooldown', request: normalized });
  if (duplicateBlocked) return Object.freeze({ accepted: false, reason: 'duplicate', request: normalized });
  if (quotaBlocked && normalized.priority < 8) return Object.freeze({ accepted: false, reason: 'window-quota', request: normalized });
  if (active && normalized.priority < 4 && !sameAction) return Object.freeze({ accepted: false, reason: 'lower-priority-active', request: normalized });
  return Object.freeze({ accepted: true, reason: active ? 'priority-replace' : 'ready', request: normalized });
}

function gapFromLastWindow(state: PlayerAnimationOneShotState, nowSeconds: unknown): boolean {
  const gap = Math.max(0, finite(nowSeconds) - finite(state.lastRequestAtSeconds, -Infinity));
  return !Number.isFinite(gap) || gap >= PLAYER_ANIMATION_ONESHOT_LIMITS.maxWindowSeconds;
}

export function startPlayerAnimationOneShot(
  state: PlayerAnimationOneShotState | null | undefined,
  request: PlayerAnimationOneShotRequestInput,
  nowSeconds = 0,
): Readonly<{ state: PlayerAnimationOneShotState; decision: PlayerAnimationOneShotDecision; changed: boolean }> {
  const current = state ?? createPlayerAnimationOneShotState();
  const decision = resolvePlayerAnimationOneShotDecision(current, request, nowSeconds);
  if (!decision.accepted) {
    return Object.freeze({
      state: Object.freeze({ ...current, rejectionCount: current.rejectionCount + 1 }),
      decision,
      changed: false,
    });
  }
  const next = Object.freeze({
    ...current,
    phase: 'starting' as const,
    action: decision.request.action,
    variant: decision.request.variant,
    remainingSeconds: decision.request.windowSeconds,
    elapsedSeconds: 0,
    lastRequestAtSeconds: Math.max(0, finite(nowSeconds)),
    requestsInWindow: gapFromLastWindow(current, nowSeconds) ? 1 : current.requestsInWindow + 1,
    requestFingerprint: decision.request.fingerprint,
    transitionCount: current.transitionCount + 1,
  });
  return Object.freeze({ state: next, decision, changed: true });
}

export function advancePlayerAnimationOneShot(
  state: PlayerAnimationOneShotState | null | undefined,
  deltaSeconds = 0,
): Readonly<{ state: PlayerAnimationOneShotState; ended: boolean; progressed: boolean }> {
  const current = state ?? createPlayerAnimationOneShotState();
  const delta = clamp(finite(deltaSeconds), 0, PLAYER_ANIMATION_ONESHOT_LIMITS.maxWindowSeconds);
  if (current.phase === 'ready') return Object.freeze({ state: current, ended: false, progressed: false });
  const remaining = Math.max(0, current.remainingSeconds - delta);
  let phase: PlayerAnimationOneShotPhase = current.phase;
  let ended = false;
  if (remaining <= 0) {
    phase = current.phase === 'cooldown' ? 'ready' : 'cooldown';
    ended = current.phase !== 'cooldown';
  } else if (current.phase === 'starting') {
    phase = 'holding';
  }
  const next = Object.freeze({
    ...current,
    phase,
    remainingSeconds: phase === 'cooldown' ? PLAYER_ANIMATION_ONESHOT_LIMITS.minRetriggerGapSeconds : round(remaining),
    elapsedSeconds: round(current.elapsedSeconds + delta),
  });
  return Object.freeze({ state: next, ended, progressed: delta > 0 });
}

export function forceEndPlayerAnimationOneShot(state: PlayerAnimationOneShotState | null | undefined): Readonly<{ state: PlayerAnimationOneShotState; changed: boolean }> {
  const current = state ?? createPlayerAnimationOneShotState();
  if (current.phase === 'ready') return Object.freeze({ state: current, changed: false });
  return Object.freeze({
    state: Object.freeze({ ...current, phase: 'cooldown' as const, remainingSeconds: PLAYER_ANIMATION_ONESHOT_LIMITS.minRetriggerGapSeconds }),
    changed: true,
  });
}

export function tickPlayerAnimationOneShotController(
  controllerState: PlayerAnimationOneShotState | null | undefined,
  request: PlayerAnimationOneShotRequestInput | null = null,
  deltaSeconds = 0,
  nowSeconds = 0,
): PlayerAnimationOneShotStepResult {
  let state = controllerState ?? createPlayerAnimationOneShotState();
  let decision: PlayerAnimationOneShotDecision | null = null;
  let started = false;
  if (request) {
    const result = startPlayerAnimationOneShot(state, request, nowSeconds);
    state = result.state;
    decision = result.decision;
    started = result.changed;
  }
  const advanced = advancePlayerAnimationOneShot(state, deltaSeconds);
  state = advanced.state;
  const validation = validatePlayerAnimationOneShotState(state);
  if (!validation.ok) throw new Error(`Invalid one-shot state: ${validation.failures.join(',')}`);
  return Object.freeze({ state, decision, started, ended: advanced.ended, validation });
}

export function createPlayerAnimationOneShotController({
  onSignal = null,
  historyLimit = PLAYER_ANIMATION_ONESHOT_LIMITS.maxHistoryEntries,
}: {
  readonly onSignal?: ((signal: PlayerAnimationOneShotSignal) => void) | null;
  readonly historyLimit?: unknown;
} = {}): PlayerAnimationOneShotController {
  let state = createPlayerAnimationOneShotState();
  let nowSeconds = 0;
  const history: PlayerAnimationOneShotSignal[] = [];
  const limit = clamp(Math.floor(finite(historyLimit, PLAYER_ANIMATION_ONESHOT_LIMITS.maxHistoryEntries)), 1, 128);
  let sequence = 0;

  const publish = (signal: PlayerAnimationOneShotSignal): void => {
    history.push(Object.freeze({ ...signal }));
    while (history.length > limit) history.shift();
    onSignal?.(signal);
  };

  const snapshot = (): PlayerAnimationOneShotSnapshot => Object.freeze({
    version: PLAYER_ANIMATION_ONESHOT_POLICY_VERSION,
    nowSeconds,
    state,
    sequence,
    history: Object.freeze(history.slice()),
  });

  const update = (deltaSeconds: unknown, request: PlayerAnimationOneShotRequestInput | null = null) => {
    const delta = Math.max(0, finite(deltaSeconds));
    nowSeconds = round(nowSeconds + delta);
    const previous = state;
    const result = tickPlayerAnimationOneShotController(state, request, delta, nowSeconds);
    state = result.state;
    if (result.started) publish({ type: 'action-start', sequence: ++sequence, action: state.action, variant: state.variant, fingerprint: state.requestFingerprint, atSeconds: nowSeconds });
    if (result.ended) publish({ type: 'action-end', sequence: ++sequence, action: previous.action, variant: previous.variant, atSeconds: nowSeconds });
    if (result.decision && !result.decision.accepted) publish({ type: 'action-rejected', sequence: ++sequence, action: result.decision.request.action, reason: result.decision.reason as PlayerAnimationOneShotRejectReason, atSeconds: nowSeconds });
    return Object.freeze({ ...result, snapshot: snapshot() });
  };

  const reset = (): void => {
    state = createPlayerAnimationOneShotState();
    nowSeconds = 0;
    sequence = 0;
    history.length = 0;
  };

  return Object.freeze({ update, snapshot, reset, readHistory: () => Object.freeze(history.slice()) });
}

export function resolvePlayerAnimationOneShotWeight(remainingSeconds: unknown, windowSeconds: unknown): number {
  const total = normalizeWindow(windowSeconds);
  const remaining = clamp(finite(remainingSeconds), 0, total);
  const progress = total <= 0 ? 1 : 1 - remaining / total;
  const fadeIn = clamp(progress / 0.12, 0, 1);
  const fadeOut = clamp(remaining / Math.max(total * 0.2, 0.04), 0, 1);
  return round(Math.min(fadeIn, fadeOut));
}

export function resolvePlayerAnimationOneShotPhase(state: { readonly phase?: unknown } | null | undefined): PlayerAnimationOneShotPhase {
  return PLAYER_ANIMATION_ONESHOT_STATES.includes(state?.phase as PlayerAnimationOneShotPhase) ? state!.phase as PlayerAnimationOneShotPhase : 'ready';
}

export function resolvePlayerAnimationOneShotFingerprint(request: PlayerAnimationOneShotRequestInput): string {
  return normalizePlayerAnimationOneShotRequest(request).fingerprint;
}

export function isPlayerAnimationOneShotActive(state: { readonly phase?: unknown } | null | undefined): boolean {
  const phase = resolvePlayerAnimationOneShotPhase(state);
  return phase === 'starting' || phase === 'holding' || phase === 'ending';
}

export function auditPlayerAnimationOneShotPolicy() {
  const initial = createPlayerAnimationOneShotState();
  const validation = validatePlayerAnimationOneShotState(initial);
  const request = normalizePlayerAnimationOneShotRequest({ action: 'heavy-attack', windowSeconds: 0.7, priority: 8 });
  return Object.freeze({
    version: PLAYER_ANIMATION_ONESHOT_POLICY_VERSION,
    ok: validation.ok && request.action === 'heavy-attack' && request.fingerprint.length === 8,
    validation,
    request,
    capabilities: Object.freeze(['bounded-one-shot-window', 'priority-retrigger-gate', 'deterministic-request-fingerprint', 'action-start-end-signals', 'bounded-history']),
  });
}

export const PLAYER_ANIMATION_ONESHOT_POLICY = Object.freeze({
  version: PLAYER_ANIMATION_ONESHOT_POLICY_VERSION,
  limits: PLAYER_ANIMATION_ONESHOT_LIMITS,
  states: PLAYER_ANIMATION_ONESHOT_STATES,
});
