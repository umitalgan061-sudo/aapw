import { describe, expect, it } from 'vitest';
import {
  R35_VERSION,
  clamp01,
  createRuntimeSnapshot,
  normalizeFeatureSet,
  validateConfig,
} from '../../src/3d/nextgen/r35/contracts';
import { defaultR35Config } from '../../src/3d/nextgen/r35/runtimeApplication';

describe('R35 contract integrity', () => {
  it('keeps runtime version and feature defaults explicit', () => {
    expect(R35_VERSION).toBe(35);
    const features = normalizeFeatureSet({});
    expect(Object.keys(features).length).toBe(11);
    expect(features.rollback).toBe(true);
  });

  it('normalizes invalid numeric values at boundaries', () => {
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(-1)).toBe(0);
  });

  it('accepts the shipped default runtime configuration', () => {
    const config = defaultR35Config();
    validateConfig(config);
    expect(config.maxCatchUpSteps).toBeGreaterThan(0);
    expect(config.frameBudgets.length).toBe(9);
  });

  it('creates a complete runtime snapshot', () => {
    const snapshot = createRuntimeSnapshot();
    expect(snapshot.version).toBe(R35_VERSION);
    expect(snapshot.world.seed).toBe(1);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });
});
