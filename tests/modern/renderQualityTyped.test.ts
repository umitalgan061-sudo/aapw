import { describe, expect, it } from 'vitest';
import { QUALITY_LEVELS } from '../../src/3d/config.ts';
import {
  configureRendererRealism,
  resolveRenderQuality,
  type RenderQuality,
} from '../../src/3d/renderQuality.ts';

describe('typed render-quality policy', () => {
  it('keeps mobile on the low budget even when local storage asks for ultra', () => {
    const quality = resolveRenderQuality({
      coarsePointer: true,
      manualLevel: QUALITY_LEVELS.ULTRA,
    });
    expect(quality.level).toBe(QUALITY_LEVELS.LOW);
    expect(quality.shadowsEnabled).toBe(false);
    expect(quality.preset.shadowMapSize).toBe(512);
  });

  it('accepts a valid desktop override and ignores invalid input', () => {
    const high = resolveRenderQuality({ coarsePointer: false, manualLevel: QUALITY_LEVELS.ULTRA });
    const fallback = resolveRenderQuality({ coarsePointer: false, manualLevel: 'future-quality' });
    expect(high.level).toBe(QUALITY_LEVELS.ULTRA);
    expect(high.preset.shadowMapSize).toBe(4096);
    expect(fallback.level).toBe(QUALITY_LEVELS.HIGH);
  });

  it('always enables filmic tone mapping while keeping mobile shadows disabled', () => {
    const calls: string[] = [];
    const renderer = {
      toneMapping: 0,
      toneMappingExposure: 0,
      shadowMap: { enabled: false, type: 0 },
    } as unknown as Parameters<typeof configureRendererRealism>[0];
    const quality: RenderQuality = {
      level: QUALITY_LEVELS.LOW,
      preset: resolveRenderQuality({ coarsePointer: true }).preset,
      shadowsEnabled: false,
    };
    configureRendererRealism(renderer, quality);
    calls.push(String(renderer.toneMapping));
    expect(Number(renderer.toneMappingExposure)).toBe(1.15);
    expect(renderer.shadowMap.enabled).toBe(false);
    expect(calls.length).toBe(1);
  });
});
