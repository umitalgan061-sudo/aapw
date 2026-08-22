#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WORLD_SCALE } from '../src/3d/config.js';
import { WORLD_REFERENCE_ALIGNMENT } from '../src/3d/world/worldReferenceAlignment.js';
import {
	TERRAIN_BIOME_SHADING_POLICY,
	normalizedMapYAtWorldZ,
	northClimateWeightsAtWorldZ,
	resolveTerrainBiomeColor,
} from '../src/3d/world/terrainBiomeShading.js';
import { updateDayNightLighting } from '../src/3d/lighting.js';

function worldZAtNormalizedMapY(normalizedY) {
	const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
	const mapY = normalizedY * WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;
	return (mapY - centerMapY) * WORLD_SCALE.METERS_PER_MAP_UNIT;
}

const farNorthZ = worldZAtNormalizedMapY(0.05);
const iceEdgeZ = worldZAtNormalizedMapY(TERRAIN_BIOME_SHADING_POLICY.northIceFullNormalizedY);
const temperateZ = worldZAtNormalizedMapY(0.55);
assert(Math.abs(normalizedMapYAtWorldZ(farNorthZ) - 0.05) < 1e-9, 'worldZ/mapY conversion must round-trip');

const farNorthClimate = northClimateWeightsAtWorldZ(farNorthZ);
const iceEdgeClimate = northClimateWeightsAtWorldZ(iceEdgeZ);
const temperateClimate = northClimateWeightsAtWorldZ(temperateZ);
assert(farNorthClimate.permanentIce > 0.99, 'far north must be permanent cryosphere');
assert(iceEdgeClimate.permanentIce > 0.99, 'full-ice boundary must still be effectively frozen');
assert(temperateClimate.permanentIce < 0.001, 'temperate south must not inherit permanent ice');
assert(temperateClimate.tundra < 0.001, 'temperate south must not inherit tundra');

const northColor = new THREE.Color();
const temperateColor = new THREE.Color();
resolveTerrainBiomeColor(northColor, {
	heightAboveSeaMeters: 18,
	slopeDegrees: 4,
	rockWeight: 0,
	snowWeight: 0,
	worldX: 0,
	worldZ: farNorthZ,
});
resolveTerrainBiomeColor(temperateColor, {
	heightAboveSeaMeters: 18,
	slopeDegrees: 4,
	rockWeight: 0,
	snowWeight: 0,
	worldX: 0,
	worldZ: temperateZ,
});
const northLuma = northColor.r * 0.2126 + northColor.g * 0.7152 + northColor.b * 0.0722;
const temperateLuma = temperateColor.r * 0.2126 + temperateColor.g * 0.7152 + temperateColor.b * 0.0722;
assert(northLuma > temperateLuma * 1.7, 'low-altitude far north must visibly resolve as snow/ice instead of green');
assert(northColor.b > northColor.r * 0.75, 'frozen north should retain a restrained ice-blue component');

function makeLights() {
	return {
		sun: new THREE.DirectionalLight(0xffffff, 1),
		moon: new THREE.DirectionalLight(0xc8dcff, 0),
		hemisphere: new THREE.HemisphereLight(0xffffff, 0x000000, 1),
		sunVisual: new THREE.Group(),
		moonVisual: new THREE.Group(),
	};
}

const lights = makeLights();
const dayLength = 100;

// 06:00 / ratio .25 => east (+X) horizon.
const sunrise = updateDayNightLighting(lights, 25, dayLength, 0);
assert(Math.abs(sunrise.timeRatio - 0.25) < 1e-9);
assert(lights.sun.position.x > 890, 'sunrise must begin in the east (+X)');
assert(Math.abs(lights.sun.position.y) < 1e-6, 'sunrise must sit on the horizon');

// 12:00 / ratio .5 => high overhead.
updateDayNightLighting(lights, 50, dayLength, 0);
assert(lights.sun.position.y > 890, 'noon sun must be overhead');
assert(Math.abs(lights.sun.position.x) < 1e-6, 'noon sun should be centered east/west');

// 18:00 / ratio .75 => west (-X) horizon.
updateDayNightLighting(lights, 75, dayLength, 0);
assert(lights.sun.position.x < -890, 'sunset must end in the west (-X)');
assert(Math.abs(lights.sun.position.y) < 1e-6, 'sunset must sit on the horizon');

// Midnight => moon above the horizon and actually illuminating the world.
const midnight = updateDayNightLighting(lights, 0, dayLength, 0);
assert(midnight.nightFactor > 0.95, 'midnight must be full night');
assert(lights.moon.position.y > 890, 'moon must oppose the below-horizon midnight sun');
assert(lights.moon.intensity > 0.5, 'moon must provide a meaningful directional night key');
assert.equal(lights.moonVisual.visible, true);

console.log('[checkNorthClimateCelestialCycle] PASS: map north is forced into a real cryosphere and the sun/moon follow the east-noon-west/opposite-night cycle.');
