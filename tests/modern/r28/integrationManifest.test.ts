import { describe, expect, it } from 'vitest';
import { createR28IntegrationManifest, validateR28IntegrationManifest } from '../../../src/3d/modern/r28/integrationManifest.ts';
import type { BrowserCapabilities } from '../../../src/3d/modern/r28/environment.ts';

describe('R28 centralized integration manifest', () => {
  const base: BrowserCapabilities = {
    secureContext: true,
    webgl: true,
    webgpu: false,
    worker: true,
    sharedArrayBuffer: false,
    hardwareConcurrency: 8,
    deviceMemoryGb: 8,
    touch: false,
    saveStorage: true,
  };

  it('selects production budgets from capability class', () => {
    const manifest = createR28IntegrationManifest(base);
    expect(manifest.runtime.tickRate).toBe(60);
    expect(manifest.runtime.maxEntities).toBeGreaterThanOrEqual(4096);
    expect(manifest.features.workers).toBe(true);
    expect(manifest.features.persistence).toBe(true);
  });

  it('honors explicit bounded overrides', () => {
    const manifest = createR28IntegrationManifest(base, {
      tickRate: 30,
      maxStepsPerFrame: 2,
      rendering: { maxSubmissions: 64 },
      security: { maxPayloadBytes: 4096 },
    });
    expect(manifest.runtime.tickRate).toBe(30);
    expect(manifest.runtime.maxStepsPerFrame).toBe(2);
    expect(manifest.rendering.maxSubmissions).toBe(64);
    expect(manifest.security.maxPayloadBytes).toBe(4096);
    expect(validateR28IntegrationManifest(manifest)).toEqual([]);
  });
});
