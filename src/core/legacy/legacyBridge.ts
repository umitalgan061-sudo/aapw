import { freeze, type KingdomState, type WorldState } from '../domain/contracts.ts';

export interface LegacyWindow extends Window {
  kingdoms?: unknown[];
  renderAll?: () => void;
  findKingdom?: (id: string) => unknown;
  currentDetailId?: string | null;
  showToast?: (message: string, kind?: string) => void;
  __AAPW_MODERN_KERNEL__?: ModernKernelBridge;
}

export interface LegacyKingdomShape {
  id: string;
  name?: string;
  owner?: string | null;
  x?: number;
  y?: number;
  army?: number;
  gold?: number;
  morale?: number;
  navy?: number;
  technology?: number;
  population?: number;
  supply?: number;
  stability?: number;
}

export interface ModernKernelBridge {
  readonly version: string;
  readonly getWorld: () => WorldState;
  readonly syncLegacyKingdoms: () => number;
  readonly selectKingdom: (id: string | null) => void;
  readonly save: () => boolean;
  readonly load: () => boolean;
}

const safeWindow = (): LegacyWindow | null => typeof window === 'undefined' ? null : window as LegacyWindow;

const asString = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback;
const asNumber = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export const readLegacyKingdom = (raw: unknown): LegacyKingdomShape | null => {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const id = asString(value.id);
  if (!id) return null;
  return freeze({
    id,
    name: asString(value.name, id),
    owner: value.owner === null ? null : asString(value.owner, ''),
    x: asNumber(value.x),
    y: asNumber(value.y),
    army: asNumber(value.army),
    gold: asNumber(value.gold),
    morale: asNumber(value.morale, 50),
    navy: asNumber(value.navy),
    technology: asNumber(value.technology),
    population: asNumber(value.population),
    supply: asNumber(value.supply, 100),
    stability: asNumber(value.stability, 100),
  });
};

export const readLegacyKingdoms = (): readonly LegacyKingdomShape[] => {
  const value = safeWindow()?.kingdoms;
  if (!Array.isArray(value)) return [];
  const result: LegacyKingdomShape[] = [];
  for (const raw of value) {
    const kingdom = readLegacyKingdom(raw);
    if (kingdom) result.push(kingdom);
  }
  return result;
};

export const toKingdomState = (legacy: LegacyKingdomShape, revision: number): KingdomState => freeze({
  id: legacy.id as KingdomState['id'],
  name: legacy.name ?? legacy.id,
  owner: legacy.owner ? legacy.owner as KingdomState['owner'] : null,
  position: freeze({ x: legacy.x ?? 0, y: legacy.y ?? 0 }),
  stats: freeze({
    army: Math.max(0, legacy.army ?? 0),
    gold: Math.max(0, legacy.gold ?? 0),
    morale: Math.min(100, Math.max(0, legacy.morale ?? 50)),
    navy: Math.max(0, legacy.navy ?? 0),
    technology: Math.min(100, Math.max(0, legacy.technology ?? 0)),
    population: Math.max(0, legacy.population ?? 0),
    supply: Math.min(100, Math.max(0, legacy.supply ?? 100)),
    stability: Math.min(100, Math.max(0, legacy.stability ?? 100)),
  }),
  neighbors: [],
  revision: revision as KingdomState['revision'],
  updatedAt: Date.now() as KingdomState['updatedAt'],
});

export const installBridge = (bridge: ModernKernelBridge): boolean => {
  const target = safeWindow();
  if (!target) return false;
  target.__AAPW_MODERN_KERNEL__ = bridge;
  return true;
};

export const notifyLegacy = (message: string, kind = 'info'): void => {
  const target = safeWindow();
  try { target?.showToast?.(message, kind); } catch { /* legacy UI is optional */ }
};

export const requestLegacyRender = (): void => {
  const target = safeWindow();
  try { target?.renderAll?.(); } catch { /* legacy renderer owns its own failures */ }
};

export const selectLegacyKingdom = (id: string | null): void => {
  const target = safeWindow();
  if (!target) return;
  try {
    target.currentDetailId = id;
    if (id) target.findKingdom?.(id);
  } catch {
    // Adapter is fail-soft by design.
  }
};
