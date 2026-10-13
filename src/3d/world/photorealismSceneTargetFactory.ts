/**
 * Buzul Muhafızı — live-scene target factory.
 *
 * This is a narrow adapter around already-owned scene systems. It does not
 * import Three.js, editor DOM code, or create a second material/placement
 * authority. Callers provide the mutation callbacks owned by createScene().
 */
import type {
  RuntimeOperation,
  RuntimeTarget,
} from './photorealismRuntimeController.ts';

export interface PhotorealismSceneTargetCallbacks {
  readonly renderer?: (operation: RuntimeOperation, value: number|boolean|Readonly<Record<string, unknown>>) => void;
  readonly fog?: (operation: RuntimeOperation, value: number|boolean|Readonly<Record<string, unknown>>) => void;
  readonly sun?: (operation: RuntimeOperation, value: number|boolean|Readonly<Record<string, unknown>>) => void;
  readonly moon?: (operation: RuntimeOperation, value: number|boolean|Readonly<Record<string, unknown>>) => void;
  readonly material?: (operation: RuntimeOperation, value: number|boolean|Readonly<Record<string, unknown>>) => void;
  readonly water?: (operation: RuntimeOperation, value: number|boolean|Readonly<Record<string, unknown>>) => void;
  readonly vegetation?: (operation: RuntimeOperation, value: number|boolean|Readonly<Record<string, unknown>>) => void;
  readonly placement?: (operation: RuntimeOperation, value: number|boolean|Readonly<Record<string, unknown>>) => void;
}

const kinds = Object.freeze([
  'renderer','fog','sun','moon','material','water','vegetation','placement',
] as const);

type TargetKind = typeof kinds[number];

function callbackTarget(
  kind: TargetKind,
  callback: PhotorealismSceneTargetCallbacks[TargetKind] | undefined,
): RuntimeTarget | null {
  if (typeof callback !== 'function') return null;
  return Object.freeze({
    id: `createScene:${kind}`,
    kind,
    apply: callback,
  });
}

/**
 * Build one canonical target list from the callbacks already owned by the
 * live scene. Missing optional owners are omitted; the controller remains
 * deterministic and can still apply the available operations.
 */
export function createPhotorealismSceneTargets(
  callbacks: PhotorealismSceneTargetCallbacks,
): readonly RuntimeTarget[] {
  const targets = kinds
    .map((kind) => callbackTarget(kind, callbacks[kind]))
    .filter((target): target is RuntimeTarget => target !== null);
  return Object.freeze(targets);
}

export function isPhotorealismSceneTarget(value: unknown): value is RuntimeTarget {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RuntimeTarget>;
  return typeof candidate.id === 'string'
    && typeof candidate.kind === 'string'
    && (kinds as readonly string[]).includes(candidate.kind)
    && typeof candidate.apply === 'function';
}

export function sceneTargetKinds(targets: readonly RuntimeTarget[]): readonly string[] {
  return Object.freeze(targets.map((target) => target.kind));
}
