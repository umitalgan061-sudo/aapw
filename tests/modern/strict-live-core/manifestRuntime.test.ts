import { describe, expect, it } from 'vitest';
import {
  createManifest,
  isMimeAllowed,
  manifestAsset,
  manifestFamilies,
  manifestToRequests,
  planManifestLoadOrder,
  validateManifest,
} from '../../../src/3d/strict/assetManifestRuntime.ts';

describe('assetManifestRuntime', () => {
  it('creates a valid local manifest asset', () => {
    const result = manifestAsset({
      id: 'player',
      url: './assets/player.glb',
      kind: 'model',
      priority: 10,
      bytes: 1024,
      tags: ['family:character', 'hero'],
      critical: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tags).toContain('family:character');
  });

  it('rejects invalid digest metadata', () => {
    const result = manifestAsset({
      url: './x.bin',
      kind: 'binary',
      integrity: { sha256: 'abc' },
    });
    expect(result.ok).toBe(false);
  });

  it('validates duplicate ids and warning metadata', () => {
    const first = manifestAsset({
      id: 'a',
      url: './a.json',
      kind: 'json',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = {
      ...first.value,
      critical: true,
      optional: true,
    };
    const manifest = createManifest(1, [first.value, second]);
    const validation = validateManifest(manifest);
    expect(validation.ok).toBe(false);
    expect(validation.errors.some(error => error.startsWith('duplicate:'))).toBe(true);
    expect(validation.warnings).toContain('critical-optional:a');
  });

  it('orders dependencies before dependants', () => {
    const base = manifestAsset({
      id: 'base',
      url: './base.glb',
      kind: 'model',
    });
    const child = manifestAsset({
      id: 'child',
      url: './child.glb',
      kind: 'model',
      dependencies: ['base'],
    });
    expect(base.ok && child.ok).toBe(true);
    if (!base.ok || !child.ok) return;
    const order = planManifestLoadOrder(createManifest(1, [child.value, base.value]));
    expect(order.ordered).toEqual(['base', 'child']);
    expect(order.missingDependencies).toHaveLength(0);
  });

  it('reports missing dependencies', () => {
    const child = manifestAsset({
      id: 'child',
      url: './child.glb',
      kind: 'model',
      dependencies: ['missing'],
    });
    expect(child.ok).toBe(true);
    if (!child.ok) return;
    const order = planManifestLoadOrder(createManifest(1, [child.value]));
    expect(order.missingDependencies[0]?.dependency).toBe('missing');
  });

  it('groups assets by semantic family', () => {
    const a = manifestAsset({
      id: 'a',
      url: './a.glb',
      kind: 'model',
      bytes: 10,
      tags: ['family:character'],
    });
    const b = manifestAsset({
      id: 'b',
      url: './b.glb',
      kind: 'model',
      bytes: 20,
      tags: ['family:character'],
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    const families = manifestFamilies(createManifest(1, [a.value, b.value]));
    expect(families[0]).toMatchObject({
      family: 'character',
      count: 2,
      bytes: 30,
    });
  });

  it('emits requests for runtime admission', () => {
    const asset = manifestAsset({
      id: 'x',
      url: './x.json',
      kind: 'json',
      critical: true,
    });
    expect(asset.ok).toBe(true);
    if (!asset.ok) return;
    const request = manifestToRequests(createManifest(1, [asset.value]))[0];
    expect(request?.id).toBe('x');
    expect(request?.maxRetries).toBe(4);
  });

  it('uses an explicit MIME allowlist', () => {
    expect(isMimeAllowed('model/gltf-binary')).toBe(true);
    expect(isMimeAllowed('application/x-dangerous')).toBe(false);
  });
});