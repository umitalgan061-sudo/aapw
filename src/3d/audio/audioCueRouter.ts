/** Strict TypeScript semantic audio cue router. */

import { buildAudioCueRequest } from './audioEventCueMap.ts';
import { getAudioDesign, audioDesignMaxInstances, audioDesignIsCritical } from './audioDesignCatalog.ts';

export type AudioCueRoute = 'ui' | 'world' | 'player' | 'combat' | 'weather' | 'ambience' | 'music';

export interface AudioCueRequest {
  readonly id: string;
  readonly group?: string;
  readonly class?: string;
  readonly priority: number;
  readonly gain?: number;
  readonly spatial?: boolean;
}

export interface AudioCuePayload extends Readonly<Record<string, unknown>> {
  readonly position?: Readonly<{ x: number; y: number; z: number }>;
  readonly maxDistance?: number;
}

export interface AudioCueRouterState {
  readonly activeInstances?: number;
}

export interface AudioCueDesign extends Readonly<Record<string, unknown>> {
  readonly spatial?: boolean;
}

export interface AudioCueRouteDecision {
  readonly version: 1;
  readonly admitted: boolean;
  readonly route: AudioCueRoute;
  readonly critical: boolean;
  readonly priority: number;
  readonly cue: AudioCueRequest;
  readonly design: AudioCueDesign | null;
  readonly reason: 'admitted' | 'instance-budget';
  readonly instanceBudget: Readonly<{ active: number; max: number }>;
}

export interface SpatialRegistration {
  readonly version: 1;
  readonly spatial: boolean;
  readonly request: Readonly<Record<string, unknown>>;
}

const ROUTES = Object.freeze({
  UI: 'ui',
  WORLD: 'world',
  PLAYER: 'player',
  COMBAT: 'combat',
  WEATHER: 'weather',
  AMBIENCE: 'ambience',
  MUSIC: 'music',
} satisfies Record<string, AudioCueRoute>);

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function routeFor(cue: AudioCueRequest): AudioCueRoute {
  if (cue.group === 'ui') return ROUTES.UI;
  if (cue.group === 'combat') return ROUTES.COMBAT;
  if (cue.group === 'player') return ROUTES.PLAYER;
  if (cue.group === 'weather') return ROUTES.WEATHER;
  if (cue.group === 'music') return ROUTES.MUSIC;
  if (cue.group === 'ambience' || cue.group === 'water') return ROUTES.AMBIENCE;
  return ROUTES.WORLD;
}

function freeze<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function normalizeCue(value: unknown): AudioCueRequest | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : '';
  if (!id) return null;
  return freeze({
    id,
    group: typeof record.group === 'string' ? record.group : undefined,
    class: typeof record.class === 'string' ? record.class : undefined,
    priority: clamp(finiteOr(record.priority, 50), 0, 100),
    gain: record.gain === undefined ? undefined : clamp(finiteOr(record.gain, 1), 0, 1),
    spatial: record.spatial === true,
  });
}

function normalizeDesign(value: unknown): AudioCueDesign | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  return freeze({
    ...record,
    spatial: record.spatial === true,
  });
}

export function routeAudioCue(
  keyOrEvent: unknown,
  payload: AudioCuePayload = {},
  state: AudioCueRouterState = {},
): AudioCueRouteDecision | null {
  const cue = normalizeCue(buildAudioCueRequest(keyOrEvent, payload));
  if (!cue) return null;

  const lookupKey = String(keyOrEvent);
  const directDesign = getAudioDesign(cue.id);
  const fallbackDesign = directDesign ? directDesign : getAudioDesign(lookupKey);
  const design = normalizeDesign(fallbackDesign);
  const designKey = directDesign ? cue.id : design ? lookupKey : null;
  const designMax = designKey ? audioDesignMaxInstances(designKey) : 2;
  const activeInstances = Math.max(0, Math.round(finiteOr(state.activeInstances, 0)));
  const critical = designKey ? audioDesignIsCritical(designKey) : cue.priority >= 95;
  const route = routeFor(cue);
  const admitted = critical || activeInstances < designMax;

  return freeze({
    version: 1,
    admitted,
    route,
    critical,
    priority: cue.priority,
    cue,
    design,
    reason: admitted ? 'admitted' : 'instance-budget',
    instanceBudget: freeze({ active: activeInstances, max: designMax }),
  });
}

export function buildSpatialRegistration(
  keyOrEvent: unknown,
  payload: AudioCuePayload = {},
): SpatialRegistration | null {
  const route = routeAudioCue(keyOrEvent, payload);
  if (!route || !route.admitted) return null;

  const design = route.design;
  if (!design?.spatial) {
    return freeze({ version: 1, spatial: false, request: route.cue });
  }

  const position = payload.position ?? { x: 0, y: 0, z: 0 };
  return freeze({
    version: 1,
    spatial: true,
    request: freeze({
      id: route.cue.id,
      class: route.cue.class,
      priority: route.cue.priority,
      gain: route.cue.gain,
      positional: true,
      position: freeze(position),
      maxDistance: clamp(finiteOr(payload.maxDistance, 120), 4, 500),
      voiceCost: route.cue.class === 'dragon' ? 2 : 1,
    }),
  });
}

export function routingConstants(): Readonly<{ routes: typeof ROUTES }> {
  return freeze({ routes: ROUTES });
}
