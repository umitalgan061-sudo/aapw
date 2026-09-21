/** Strict TypeScript owner for bounded frame-loop safe mode. */
export interface SafeModeEntity {
  readonly object3D: import('three').Object3D;
  readonly dispose: () => void;
  disabledDueToError?: boolean;
}
export interface SafeModeEntityOptions {
  readonly entities: readonly SafeModeEntity[];
  readonly scene: import('three').Scene;
  readonly label: string;
  readonly update: (entity: SafeModeEntity) => void;
}
export interface SafeModeSystemOptions {
  readonly disabled: boolean;
  readonly label: string;
  readonly update: () => void;
  readonly disposeOnError?: () => void;
}
const SAFE_MODE_NOTE = '(GOVERNANCE.md §8.13 safe mode), rest of the game continues.';
export function updateEntitiesSafely({ entities, scene, label, update }: SafeModeEntityOptions): readonly SafeModeEntity[] {
  let anyFailed = false;
  for (const entity of entities) {
    try {
      update(entity);
    } catch (error: unknown) {
      console.error(`[game3d] ${label} "${entity.object3D.name || '?'}" update() threw — disabling this one only ${SAFE_MODE_NOTE}`, error);
      scene.remove(entity.object3D);
      try {
        entity.dispose();
      } catch (disposeError: unknown) {
        console.error(`[game3d] ${label} "${entity.object3D.name || '?'}" dispose() ALSO threw during safe-mode cleanup — entity still disabled ${SAFE_MODE_NOTE}`, disposeError);
      }
      entity.disabledDueToError = true;
      anyFailed = true;
    }
  }
  return anyFailed ? entities.filter((entity) => !entity.disabledDueToError) : entities;
}
export function updateSystemSafely({ disabled, label, update, disposeOnError }: SafeModeSystemOptions): boolean {
  if (disabled) return true;
  try {
    update();
    return false;
  } catch (error: unknown) {
    console.error(`[game3d] ${label} update() threw — disabling it for the rest of this session ${SAFE_MODE_NOTE}`, error);
    if (disposeOnError) {
      try {
        disposeOnError();
      } catch (disposeError: unknown) {
        console.error(`[game3d] ${label} disposeOnError() ALSO threw during safe-mode cleanup — system still disabled ${SAFE_MODE_NOTE}`, disposeError);
      }
    }
    return true;
  }
}
