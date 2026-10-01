/** Deterministic combat presentation asset catalog. No fake combat assets are claimed as shipped. */

export type CombatCueSemantic = 'attack-start' | 'impact' | 'blocked-impact' | 'critical-impact' | 'stagger' | 'death' | 'dodge';
export type CombatPresentationChannel = 'vfx' | 'sfx' | 'haptic' | 'camera';

export interface CombatPresentationAsset {
  readonly id: string;
  readonly semantic: CombatCueSemantic;
  readonly kind: CombatPresentationChannel;
  readonly path: string | null;
  readonly available: boolean;
  readonly fallbackId: string | null;
  readonly source: 'shipped' | 'pending' | 'fallback';
  readonly notes: string;
}

const UI_CLICK_FALLBACK = Object.freeze({ id: 'ui_click_kenney', path: 'assets/audio/ui-click.wav', source: 'shipped' as const });

export const COMBAT_PRESENTATION_ASSETS: readonly CombatPresentationAsset[] = Object.freeze([
  Object.freeze({ id: 'combat_attack_start_vfx', semantic: 'attack-start', kind: 'vfx', path: null, available: false, fallbackId: null, source: 'pending', notes: 'Combat-specific particle asset is not currently shipped.' }),
  Object.freeze({ id: 'combat_impact_vfx', semantic: 'impact', kind: 'vfx', path: null, available: false, fallbackId: null, source: 'pending', notes: 'Use consumer-owned impact particle/material.' }),
  Object.freeze({ id: 'combat_block_vfx', semantic: 'blocked-impact', kind: 'vfx', path: null, available: false, fallbackId: null, source: 'pending', notes: 'Use consumer-owned guard spark effect.' }),
  Object.freeze({ id: 'combat_critical_vfx', semantic: 'critical-impact', kind: 'vfx', path: null, available: false, fallbackId: null, source: 'pending', notes: 'Use consumer-owned critical burst effect.' }),
  Object.freeze({ id: 'combat_stagger_vfx', semantic: 'stagger', kind: 'vfx', path: null, available: false, fallbackId: null, source: 'pending', notes: 'Use consumer-owned poise break effect.' }),
  Object.freeze({ id: 'combat_death_vfx', semantic: 'death', kind: 'vfx', path: null, available: false, fallbackId: null, source: 'pending', notes: 'Use consumer-owned death effect.' }),
  Object.freeze({ id: 'combat_dodge_vfx', semantic: 'dodge', kind: 'vfx', path: null, available: false, fallbackId: null, source: 'pending', notes: 'Use consumer-owned dodge trail/afterimage.' }),
  Object.freeze({ id: 'combat_attack_sfx', semantic: 'attack-start', kind: 'sfx', path: UI_CLICK_FALLBACK.path, available: true, fallbackId: UI_CLICK_FALLBACK.id, source: 'fallback', notes: 'Existing CC0 UI click is a disclosed non-combat fallback only.' }),
  Object.freeze({ id: 'combat_impact_sfx', semantic: 'impact', kind: 'sfx', path: UI_CLICK_FALLBACK.path, available: true, fallbackId: UI_CLICK_FALLBACK.id, source: 'fallback', notes: 'Existing CC0 UI click is a disclosed non-combat fallback only.' }),
  Object.freeze({ id: 'combat_block_sfx', semantic: 'blocked-impact', kind: 'sfx', path: UI_CLICK_FALLBACK.path, available: true, fallbackId: UI_CLICK_FALLBACK.id, source: 'fallback', notes: 'Existing CC0 UI click is a disclosed non-combat fallback only.' }),
  Object.freeze({ id: 'combat_critical_sfx', semantic: 'critical-impact', kind: 'sfx', path: UI_CLICK_FALLBACK.path, available: true, fallbackId: UI_CLICK_FALLBACK.id, source: 'fallback', notes: 'Existing CC0 UI click is a disclosed non-combat fallback only.' }),
  Object.freeze({ id: 'combat_stagger_sfx', semantic: 'stagger', kind: 'sfx', path: UI_CLICK_FALLBACK.path, available: true, fallbackId: UI_CLICK_FALLBACK.id, source: 'fallback', notes: 'Existing CC0 UI click is a disclosed non-combat fallback only.' }),
  Object.freeze({ id: 'combat_death_sfx', semantic: 'death', kind: 'sfx', path: UI_CLICK_FALLBACK.path, available: true, fallbackId: UI_CLICK_FALLBACK.id, source: 'fallback', notes: 'Existing CC0 UI click is a disclosed non-combat fallback only.' }),
  Object.freeze({ id: 'combat_dodge_sfx', semantic: 'dodge', kind: 'sfx', path: UI_CLICK_FALLBACK.path, available: true, fallbackId: UI_CLICK_FALLBACK.id, source: 'fallback', notes: 'Existing CC0 UI click is a disclosed non-combat fallback only.' }),
]);

export interface CombatPresentationAssetAudit { readonly total: number; readonly shipped: number; readonly pending: number; readonly fallbacks: number; readonly missingCombatAudio: number; readonly missingCombatVfx: number; }

export function auditCombatPresentationAssets(catalog: readonly CombatPresentationAsset[] = COMBAT_PRESENTATION_ASSETS): CombatPresentationAssetAudit {
  const shipped = catalog.filter((asset) => asset.source === 'shipped').length;
  const pending = catalog.filter((asset) => asset.source === 'pending').length;
  const fallbacks = catalog.filter((asset) => asset.source === 'fallback').length;
  return Object.freeze({
    total: catalog.length, shipped, pending, fallbacks,
    missingCombatAudio: catalog.filter((asset) => asset.kind === 'sfx' && asset.source !== 'shipped').length,
    missingCombatVfx: catalog.filter((asset) => asset.kind === 'vfx' && !asset.available).length,
  });
}

export function resolveCombatPresentationAsset(semantic: CombatCueSemantic, channel: CombatPresentationChannel, catalog: readonly CombatPresentationAsset[] = COMBAT_PRESENTATION_ASSETS): CombatPresentationAsset | null {
  return catalog.find((asset) => asset.semantic === semantic && asset.kind === channel && asset.available)
    ?? catalog.find((asset) => asset.semantic === semantic && asset.kind === channel)
    ?? null;
}

export function buildCombatAssetProof(catalog: readonly CombatPresentationAsset[] = COMBAT_PRESENTATION_ASSETS): Readonly<{ audit: CombatPresentationAssetAudit; disclosedFallbacks: readonly string[] }> {
  const audit = auditCombatPresentationAssets(catalog);
  const disclosedFallbacks = Object.freeze(catalog.filter((asset) => asset.source === 'fallback').map((asset) => asset.id + ':' + String(asset.path) + ':' + asset.notes));
  return Object.freeze({ audit, disclosedFallbacks });
}

export function isCombatAssetPathSafe(path: string | null): boolean {
  if (path === null) return true;
  return path.startsWith('assets/') && !path.includes('..') && !path.includes('\\');
}