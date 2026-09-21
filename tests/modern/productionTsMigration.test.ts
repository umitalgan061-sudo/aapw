import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const migrated = [
  'assetLoader', 'camera', 'physics', 'lighting', 'renderQuality',
  'stars', 'safeMode', 'renderBackendCapability', 'celestialLightState',
  'nightVisualEnhancement', 'auroraNightAtmosphereV5', 'auroraRayCurtainV4',
  'auroraRealism', 'mobileSpawnVegetation',
];

describe('production TypeScript migration wave 1', () => {
  it('keeps migrated JavaScript paths as compatibility barrels only', async () => {
    for (const name of migrated) {
      const js = await readFile(new URL(`../../src/3d/${name}.js`, import.meta.url), 'utf8');
      const ts = await readFile(new URL(`../../src/3d/${name}.ts`, import.meta.url), 'utf8');
      expect(js).toContain('Compatibility boundary');
      expect(js).toContain(`./${name}.ts`);
      expect(ts.startsWith('// @ts-nocheck')).toBe(true);
    }
  });
});
