/**
 * Fail-closed runtime adapter for the shipped wind/snow response.
 *
 * Sanitises only caller/sampler inputs before delegating to the canonical four-neighbour exposure
 * resolver. It does not replace terrain height, hydrology, collider or material/placement authority.
 * @module world/terrainWindSnowRuntimeGuard
 */

import {
  resolveTerrainWindSnowAdjustment,
  terrainWindExposureFromNeighbours,
} from './terrainWindSnowExposure.js';

const finiteOr = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

export function terrainWindExposureFromSafeNeighbours(
  heightWest,
  heightEast,
  heightNorth,
  heightSouth,
  spacingMeters,
) {
  return terrainWindExposureFromNeighbours(
    finiteOr(heightWest),
    finiteOr(heightEast),
    finiteOr(heightNorth),
    finiteOr(heightSouth),
    Math.max(1e-6, Math.abs(finiteOr(spacingMeters, 1))),
  );
}

export function resolveTerrainWindSnowAdjustmentSafely(input = {}) {
  const safe = input && typeof input === 'object' ? input : {};
  return resolveTerrainWindSnowAdjustment({
    windward: finiteOr(safe.windward),
    lee: finiteOr(safe.lee),
    permanentIce: finiteOr(safe.permanentIce),
    tundra: finiteOr(safe.tundra),
    ridgelineExposure: finiteOr(safe.ridgelineExposure),
    shelterPocket: finiteOr(safe.shelterPocket),
    snowMobility: finiteOr(safe.snowMobility),
    crustScour: finiteOr(safe.crustScour),
    packGain: finiteOr(safe.packGain),
  });
}
