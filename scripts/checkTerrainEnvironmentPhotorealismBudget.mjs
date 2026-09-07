import assert from 'node:assert/strict';
import { TERRAIN_ENVIRONMENT_PHOTOREALISM_BUDGET, textureMemoryPressure, vegetationDensityPressure, terrainDetailLayerBudget, shadowDistancePolicy, photorealismAdmission } from '../src/3d/world/terrainEnvironmentPhotorealismBudget.js';
for(const device of ['mobile','desktop']){assert.ok(TERRAIN_ENVIRONMENT_PHOTOREALISM_BUDGET[device].textureMB>0);assert.ok(TERRAIN_ENVIRONMENT_PHOTOREALISM_BUDGET[device].vegetationInstances>0);assert.equal(textureMemoryPressure(0,device).overBudget,false);assert.equal(vegetationDensityPressure(0,device).overBudget,false);assert.ok(terrainDetailLayerBudget({distanceMeters:0,deviceClass:device}).layers>=1);}
assert.ok(shadowDistancePolicy('tree','mobile').distance<shadowDistancePolicy('cliff','mobile').distance);
assert.equal(photorealismAdmission({deviceClass:'desktop',textureMB:100,vegetationInstances:1000}).accepted,true);
assert.equal(photorealismAdmission({deviceClass:'desktop',textureMB:701,vegetationInstances:1}).accepted,false);
assert.equal(photorealismAdmission({deviceClass:'mobile',textureMB:1,vegetationInstances:1101}).accepted,false);
console.log(JSON.stringify({ok:true,desktop:TERRAIN_ENVIRONMENT_PHOTOREALISM_BUDGET.desktop,mobile:TERRAIN_ENVIRONMENT_PHOTOREALISM_BUDGET.mobile}));
