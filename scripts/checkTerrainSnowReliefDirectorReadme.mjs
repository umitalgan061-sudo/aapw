#!/usr/bin/env node
import assert from 'node:assert/strict';
import { TERRAIN_SNOW_RELIEF_DIRECTOR_POLICY as P, resolveTerrainSnowRelief } from '../src/3d/world/terrainSnowReliefDirector.js';
assert.equal(P.renderOnly, true);
const result = resolveTerrainSnowRelief({ snowAmount: 0.8, permanentIce: 1, tundra: 1, worldX: 0, worldZ: -400 });
assert.equal(result.renderOnly, true);
assert.equal(result.policyId, P.id);
console.log('TERRAIN_SNOW_RELIEF_ENTRYPOINT_OK');
