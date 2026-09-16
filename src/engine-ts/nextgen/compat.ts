import type { EntityId, RuntimeMode, Vec3 } from './contracts.ts';
import { asEntityId, clamp, sanitizeIdentifier } from './contracts.ts';
import { NextGenRuntime } from './runtime.ts';

export interface LegacyEntityLike {
  readonly id?: string | number;
  readonly position?: Partial<Vec3>;
  readonly rotationY?: number;
  readonly active?: boolean;
}

export interface LegacyInputLike {
  readonly moveX?: number;
  readonly moveY?: number;
  readonly lookX?: number;
  readonly lookY?: number;
  readonly buttons?: readonly string[];
}

export interface ModernEntityHandle {
  readonly id: EntityId;
  readonly legacyId: string;
  readonly active: boolean;
}

const buttonToAction = (button: string): Parameters<NextGenRuntime['frame']>[1]['pressed'][number] | null => {
  const normalized = button.trim().toLowerCase();
  const map: Record<string, 'jump' | 'sprint' | 'dodge' | 'lightAttack' | 'heavyAttack' | 'block' | 'interact' | 'inventory' | 'map' | 'pause'> = {
    jump: 'jump', space: 'jump', sprint: 'sprint', shift: 'sprint', dodge: 'dodge', roll: 'dodge', attack: 'lightAttack', light: 'lightAttack', heavy: 'heavyAttack', block: 'block', interact: 'interact', inventory: 'inventory', map: 'map', pause: 'pause', escape: 'pause',
  };
  return map[normalized] ?? null;
};

export class LegacyBridge {
  readonly #runtime: NextGenRuntime;
  readonly #entities = new Map<string, ModernEntityHandle>();
  #warnings = 0;
  #frames = 0;

  constructor(runtime: NextGenRuntime) { this.#runtime = runtime; }

  registerLegacyEntity(entity: LegacyEntityLike): ModernEntityHandle {
    const legacyId = sanitizeIdentifier(String(entity.id ?? this.#entities.size + 1));
    const existing = this.#entities.get(legacyId);
    if (existing) return existing;
    const id = asEntityId(Number.parseInt(legacyId, 10) || this.#entities.size + 1);
    const handle = Object.freeze({ id, legacyId, active: entity.active !== false });
    this.#entities.set(legacyId, handle);
    return handle;
  }

  mapInput(input: LegacyInputLike): Parameters<NextGenRuntime['frame']>[1] {
    const pressed = new Set<Parameters<NextGenRuntime['frame']>[1]['pressed'][number]>();
    for (const button of input.buttons ?? []) {
      const action = buttonToAction(button);
      if (action) pressed.add(action);
      else this.#warnings += 1;
    }
    return Object.freeze({ moveX: clamp(input.moveX ?? 0, -1, 1), moveY: clamp(input.moveY ?? 0, -1, 1), lookX: clamp(input.lookX ?? 0, -1, 1), lookY: clamp(input.lookY ?? 0, -1, 1), pressed: Object.freeze([...pressed]) });
  }

  migrateTransform(entity: LegacyEntityLike): { readonly id: EntityId; readonly position: Vec3; readonly yaw: number; readonly active: boolean } {
    const handle = this.registerLegacyEntity(entity);
    return Object.freeze({ id: handle.id, position: Object.freeze({ x: entity.position?.x ?? 0, y: entity.position?.y ?? 0, z: entity.position?.z ?? 0 }), yaw: Number.isFinite(entity.rotationY) ? entity.rotationY! : 0, active: handle.active });
  }

  frame(nowMs: number, input: LegacyInputLike = {}): ReturnType<NextGenRuntime['snapshot']> {
    this.#frames += 1;
    return this.#runtime.frame(nowMs, this.mapInput(input));
  }

  mode(): RuntimeMode { return this.#runtime.mode(); }
  warnings(): number { return this.#warnings; }
  frames(): number { return this.#frames; }
  entities(): readonly ModernEntityHandle[] { return Object.freeze([...this.#entities.values()].sort((a, b) => Number(a.id) - Number(b.id))); }
}

export const createLegacyBridge = (runtime: NextGenRuntime): LegacyBridge => new LegacyBridge(runtime);
