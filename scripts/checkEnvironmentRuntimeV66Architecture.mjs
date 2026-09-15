import assert from 'node:assert/strict';
import { ENVIRONMENT_RUNTIME_V66_MANIFEST } from '../src/3d/world/environmentRuntimeV66Manifest.js';
import { V66_INTEGRATION_POLICY } from '../src/3d/world/environmentRuntimeIntegrationV66.js';
import { V66_RELEASE_POLICY } from '../src/3d/world/environmentRuntimeReleaseV66.js';
import { V66_AUDIT_POLICY } from '../src/3d/world/environmentRuntimeV66Audit.js';
import { V66_CONTINUITY_POLICY } from '../src/3d/world/environmentRuntimeContinuityV66.js';
import { V66_WEATHER_COUPLING_POLICY } from '../src/3d/world/environmentRuntimeWeatherCouplingV66.js';

assert.equal(ENVIRONMENT_RUNTIME_V66_MANIFEST.version,66);
assert.equal(ENVIRONMENT_RUNTIME_V66_MANIFEST.deterministic,true);
assert.equal(ENVIRONMENT_RUNTIME_V66_MANIFEST.noWorldMutation,true);
assert.equal(ENVIRONMENT_RUNTIME_V66_MANIFEST.sharedAuthorities.placement,'WorldAssetPlacementPipeline.js');
assert.equal(ENVIRONMENT_RUNTIME_V66_MANIFEST.sharedAuthorities.material,'MaterialAssignmentCore.js');
assert.equal(V66_INTEGRATION_POLICY.noWorldMutation,true);
assert.equal(V66_RELEASE_POLICY.noWorldMutation,true);
assert.equal(V66_AUDIT_POLICY.deterministic,true);
assert.equal(V66_CONTINUITY_POLICY.mutation,false);
assert.equal(V66_WEATHER_COUPLING_POLICY.mutation,false);

const featureNames=ENVIRONMENT_RUNTIME_V66_MANIFEST.features;
for(const required of ['erosion-response','hydrology-dynamics','wildlife-routing','solar-exposure','terrain-navigation','seasonal-ecology','biome-ecotone','vegetation-layering','habitat-resources'])assert.ok(featureNames.includes(required),required);
assert.equal(new Set(featureNames).size,featureNames.length);
assert.ok(featureNames.length>=19);

const acceptance=ENVIRONMENT_RUNTIME_V66_MANIFEST.acceptance;
assert.equal(acceptance.width,1536);
assert.equal(acceptance.height,1024);
assert.equal(acceptance.projection,'orthographic');
assert.equal(acceptance.fovDegrees,90);
assert.equal(acceptance.fullWorld,true);
console.log(JSON.stringify({ok:true,suite:'v66-architecture',features:featureNames.length,acceptance}));
