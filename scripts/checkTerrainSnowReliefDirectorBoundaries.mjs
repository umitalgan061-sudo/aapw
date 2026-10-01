#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveTerrainSnowRelief } from '../src/3d/world/terrainSnowReliefDirector.js';
const samples = [0, 0.02, 0.05, 0.12, 0.24, 0.5, 0.8, 0.98, 1.2, -1];
for (const snowAmount of samples) {
  const result = resolveTerrainSnowRelief({ snowAmount, permanentIce: 1, tundra: 1, slopeDegrees: 18, worldX: snowAmount * 100, worldZ: -500, leeDeposit: 0.7, concavityHold: 0.5 });
  for (const key of ['visible','packed','accumulated','firn','crust','powder','glacial','rock','scree']) {
    assert(Number.isFinite(result.weights[key]));
    assert(result.weights[key] >= 0 && result.weights[key] <= 1);
  }
}
for (const slopeDegrees of [0, 4, 12, 24, 42, 58, 72, 90]) {
  const result = resolveTerrainSnowRelief({ snowAmount: 0.82, permanentIce: 1, tundra: 1, slopeDegrees, worldX: 10, worldZ: -800, ridgeExposure: 0.7, windwardScour: 0.8, leeDeposit: 0.3, concavityHold: 0.2, rockWeight: 0.3, screeWeight: 0.2 });
  assert(Number.isFinite(result.terrain.cliffSuppression));
  assert(result.terrain.cliffSuppression >= 0 && result.terrain.cliffSuppression <= 1);
}
console.log('TERRAIN_SNOW_RELIEF_BOUNDARIES_OK');
