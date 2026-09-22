import { describe, expect, it } from 'vitest';
import {
  createPhotorealismSceneTargets,
  isPhotorealismSceneTarget,
  sceneTargetKinds,
} from '../../src/3d/world/photorealismSceneTargetFactory.ts';

const callback = () => undefined;

describe('photorealism scene target factory', () => {
  it('creates stable createScene ids in canonical owner order', () => {
    const targets = createPhotorealismSceneTargets({
      renderer: callback,
      fog: callback,
      sun: callback,
      moon: callback,
      material: callback,
      water: callback,
      vegetation: callback,
      placement: callback,
    });
    expect(targets.map((target) => target.id)).toEqual([
      'createScene:renderer',
      'createScene:fog',
      'createScene:sun',
      'createScene:moon',
      'createScene:material',
      'createScene:water',
      'createScene:vegetation',
      'createScene:placement',
    ]);
    expect(sceneTargetKinds(targets)).toEqual([
      'renderer','fog','sun','moon','material','water','vegetation','placement',
    ]);
    expect(targets.every(isPhotorealismSceneTarget)).toBe(true);
  });

  it('omits absent owners without manufacturing placeholder targets', () => {
    const targets = createPhotorealismSceneTargets({ renderer: callback, water: callback });
    expect(targets.map((target) => target.kind)).toEqual(['renderer', 'water']);
    expect(targets.some((target) => target.kind === 'material')).toBe(false);
  });

  it('keeps callback value flow intact', () => {
    const seen: unknown[] = [];
    const targets = createPhotorealismSceneTargets({
      renderer: (_operation, value) => seen.push(value),
    });
    targets[0]?.apply('set-exposure', 0.82);
    expect(seen).toEqual([0.82]);
  });
});
