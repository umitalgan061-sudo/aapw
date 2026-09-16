import { ComponentKind, EntityId, EntityRecord, NetworkSnapshot, RuntimeSnapshot, Tick, asEntityId, asTick, cloneEntity } from './domain.ts';
import { EcsWorldV5 } from './ecs.ts';

export interface LegacyEntityLike {
  id?: number | string;
  position?: { x?: number; y?: number; z?: number };
  rotation?: { x?: number; y?: number; z?: number; w?: number };
  health?: number;
  maxHealth?: number;
  stamina?: number;
  maxStamina?: number;
  tags?: unknown[];
  name?: string;
  visible?: boolean;
}

export interface CompatibilityWarning { readonly path: string; readonly code: string; readonly message: string; }

export interface CompatibilityResult {
  readonly entity: EntityRecord | null;
  readonly warnings: readonly CompatibilityWarning[];
}

const numberOr = (value: unknown, fallback: number): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export const importLegacyEntity = (input: LegacyEntityLike): CompatibilityResult => {
  const warnings: CompatibilityWarning[] = [];
  const rawId = typeof input.id === 'number' ? input.id : Number(input.id);
  const id = Number.isSafeInteger(rawId) && rawId >= 0 ? asEntityId(rawId) : asEntityId(1);
  if (!(typeof input.id === 'number' || Number.isSafeInteger(rawId))) warnings.push({ path: 'id', code: 'coerce', message: 'legacy id was coerced to a safe entity id' });
  const components = new Map<ComponentKind, any>();
  components.set('transform', {
    kind: 'transform',
    position: { x: numberOr(input.position?.x, 0), y: numberOr(input.position?.y, 0), z: numberOr(input.position?.z, 0) },
    rotation: { x: numberOr(input.rotation?.x, 0), y: numberOr(input.rotation?.y, 0), z: numberOr(input.rotation?.z, 0), w: numberOr(input.rotation?.w, 1) },
    scale: { x: 1, y: 1, z: 1 },
  });
  const maximumHealth = Math.max(1, numberOr(input.maxHealth, 100));
  components.set('health', { kind: 'health', current: Math.max(0, Math.min(maximumHealth, numberOr(input.health, maximumHealth))), maximum: maximumHealth, invulnerableUntil: asTick(0) });
  const maximumStamina = Math.max(1, numberOr(input.maxStamina, 100));
  components.set('stamina', { kind: 'stamina', current: Math.max(0, Math.min(maximumStamina, numberOr(input.stamina, maximumStamina))), maximum: maximumStamina, regenPerSecond: 15, lockedUntil: asTick(0) });
  components.set('render', { kind: 'render', visible: input.visible !== false, lod: 0, layer: 0, assetId: null });
  components.set('metadata', { kind: 'metadata', tags: Array.isArray(input.tags) ? input.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 64) : [], name: typeof input.name === 'string' ? input.name.slice(0, 128) : `legacy-${id}` });
  const entity: EntityRecord = { id, createdTick: asTick(0), components, active: true };
  return { entity, warnings };
};

export const exportLegacyEntity = (entity: EntityRecord): LegacyEntityLike => {
  const transform = entity.components.get('transform');
  const health = entity.components.get('health');
  const stamina = entity.components.get('stamina');
  const render = entity.components.get('render');
  const metadata = entity.components.get('metadata');
  return {
    id: Number(entity.id),
    position: transform?.kind === 'transform' ? { ...transform.position } : undefined,
    rotation: transform?.kind === 'transform' ? { ...transform.rotation } : undefined,
    health: health?.kind === 'health' ? health.current : undefined,
    maxHealth: health?.kind === 'health' ? health.maximum : undefined,
    stamina: stamina?.kind === 'stamina' ? stamina.current : undefined,
    maxStamina: stamina?.kind === 'stamina' ? stamina.maximum : undefined,
    tags: metadata?.kind === 'metadata' ? [...metadata.tags] : undefined,
    name: metadata?.kind === 'metadata' ? metadata.name : undefined,
    visible: render?.kind === 'render' ? render.visible : undefined,
  };
};

export class LegacyWorldAdapterV5 {
  constructor(private readonly world: EcsWorldV5) {}

  import(input: LegacyEntityLike): CompatibilityResult {
    const result = importLegacyEntity(input);
    if (result.entity) {
      if (this.world.has(result.entity.id)) return { entity: this.world.get(result.entity.id) ?? null, warnings: [...result.warnings, { path: 'id', code: 'collision', message: 'entity id already exists; import skipped' }] };
      this.world.spawn({ id: result.entity.id, createdTick: result.entity.createdTick, components: [...result.entity.components.values()] });
    }
    return result;
  }

  export(id: EntityId): LegacyEntityLike | null {
    const entity = this.world.get(id);
    return entity ? exportLegacyEntity(entity) : null;
  }

  snapshot(): readonly LegacyEntityLike[] { return this.world.snapshot().map(exportLegacyEntity); }
}

export const networkToRuntimeSnapshot = (snapshot: NetworkSnapshot): RuntimeSnapshot => {
  const entities = snapshot.entities.map(cloneEntity);
  return {
    version: 5,
    tick: asTick(Number(snapshot.tick)),
    digest: { tick: asTick(Number(snapshot.tick)), entityCount: entities.length, commandCount: 0, eventCount: 0, checksum: String(entities.length) },
    entities,
    metadata: { authoritative: snapshot.authoritative, sequence: snapshot.sequence },
  };
};
