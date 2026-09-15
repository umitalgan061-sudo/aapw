import { V67_POLICY, buildRuntimeFrameV67, validateRuntimeFrameV67, runtimeSummaryV67, hashV67 } from './environmentRuntimeV67.js';
import { buildHydrologyFieldV67, hydrologyTelemetryV67 } from './environmentRuntimeHydrologyV67.js';
import { buildWeatherFieldV67, forecastWeatherV67, weatherTelemetryV67 } from './environmentRuntimeWeatherV67.js';
import { buildSurfaceFieldV67, surfaceTelemetryV67 } from './environmentRuntimeSurfaceV67.js';
import { buildAtmosphereFieldV67, atmosphereTelemetryV67 } from './environmentRuntimeAtmosphereV67.js';
import { buildWildlifeFieldV67, wildlifeTelemetryV67 } from './environmentRuntimeWildlifeV67.js';
import { buildHazardFieldV67, hazardTelemetryV67 } from './environmentRuntimeHazardsV67.js';
import { buildNavigationFieldV67, navigationTelemetryV67 } from './environmentRuntimeNavigationV67.js';
import { buildVegetationFieldV67, vegetationTelemetryV67 } from './environmentRuntimeVegetationV67.js';
import { buildClimateFieldV67, climateTelemetryV67 } from './environmentRuntimeClimateV67.js';
import { buildAcousticFieldV67, acousticsTelemetryV67 } from './environmentRuntimeAcousticsV67.js';
import { buildResonanceFieldV67, resonanceTelemetryV67 } from './environmentRuntimeResonanceV67.js';
import { buildContinuityFieldV67, continuityHealingV67, continuityTelemetryV67 } from './environmentRuntimeContinuityV67.js';
import { buildShelterFieldV67, shelterTelemetryV67 } from './environmentRuntimeShelterV67.js';
import { buildVisibilityFieldV67, visibilityTelemetryV67 } from './environmentRuntimeVisibilityV67.js';
import { buildCouplingFieldV67, couplingTelemetryV67 } from './environmentRuntimeWeatherCouplingV67.js';
import { synthesizeEnvironmentEventsV67 } from './environmentRuntimeEventsV67.js';
import { buildGeologyFieldV67, geologyTelemetryV67 } from './environmentRuntimeGeologyV67.js';
import { buildGroundFieldV67, groundTelemetryV67 } from './environmentRuntimeGroundResponseV67.js';
import { buildExposureFieldV67, exposureTelemetryV67 } from './environmentRuntimeExposureV67.js';
import { buildTransitionFieldV67, transitionTelemetryV67 } from './environmentRuntimeBiomeTransitionsV67.js';
import { buildResourceFieldV67, resourceTelemetryV67 } from './environmentRuntimeResourcesV67.js';
import { buildInteractionFieldV67, interactionTelemetryV67 } from './environmentRuntimeInteractionV67.js';
import { buildObservabilityLedgerV67, observabilityTelemetryV67 } from './environmentRuntimeObservabilityV67.js';

export const V67_INTEGRATION_POLICY = Object.freeze({
  id:'environment-runtime-integration-v67',
  version:67,
  deterministic:true,
  noWorldMutation:true,
  placementAuthority:'WorldAssetPlacementPipeline.js',
  materialAuthority:'MaterialAssignmentCore.js',
});

export const buildEnvironmentRuntimeV67 = ({ samples=[], clock=12, dayOfYear=180, seed='v67', weather={} }={}) => {
  const runtime=buildRuntimeFrameV67({samples,clock,dayOfYear,seed});
  const hydrology=buildHydrologyFieldV67(samples);
  const weatherField=buildWeatherFieldV67(samples.map(s=>({...s,...weather})),seed);
  const forecast=forecastWeatherV67({samples:samples.map(s=>({...s,...weather})),seed,horizon:6});
  const surface=buildSurfaceFieldV67(samples);
  const atmosphere=buildAtmosphereFieldV67(samples);
  const wildlife=buildWildlifeFieldV67(samples);
  const hazards=buildHazardFieldV67(samples.map(s=>({...s,hazard:s.hazard??0})));
  const navigation=buildNavigationFieldV67(samples.map((s,i)=>({...s,hazard:hazards[i]?.risk,traction:surface[i]?.traction})));
  const vegetation=buildVegetationFieldV67(samples,dayOfYear);
  const climate=buildClimateFieldV67(samples,dayOfYear);
  const acoustics=buildAcousticFieldV67(samples);
  const resonance=buildResonanceFieldV67(samples);
  const continuity=continuityHealingV67(buildContinuityFieldV67(samples));
  const shelter=buildShelterFieldV67(samples);
  const visibility=buildVisibilityFieldV67(samples);
  const coupling=buildCouplingFieldV67(samples,weather);
  const events=synthesizeEnvironmentEventsV67(samples,{dayOfYear,seed});
  const geology=buildGeologyFieldV67(samples);
  const ground=buildGroundFieldV67(samples);
  const exposure=buildExposureFieldV67(samples,clock);
  const transitions=buildTransitionFieldV67(samples);
  const resources=buildResourceFieldV67(samples);
  const interactions=buildInteractionFieldV67(samples);
  const result={policy:V67_INTEGRATION_POLICY.id,contract:V67_INTEGRATION_POLICY,runtime,hydrology,weatherField,forecast,surface,atmosphere,wildlife,hazards,navigation,vegetation,climate,acoustics,resonance,continuity,shelter,visibility,coupling,events,geology,ground,exposure,transitions,resources,interactions};
  const telemetry={
    core:validateRuntimeFrameV67(runtime),hydrology:hydrologyTelemetryV67(hydrology),weather:weatherTelemetryV67(weatherField),surface:surfaceTelemetryV67(surface),atmosphere:atmosphereTelemetryV67(atmosphere),wildlife:wildlifeTelemetryV67(wildlife),hazards:hazardTelemetryV67(hazards),navigation:navigationTelemetryV67(navigation),vegetation:vegetationTelemetryV67(vegetation),climate:climateTelemetryV67(climate),acoustics:acousticsTelemetryV67(acoustics),resonance:resonanceTelemetryV67(resonance),continuity:continuityTelemetryV67(continuity),shelter:shelterTelemetryV67(shelter),visibility:visibilityTelemetryV67(visibility),coupling:couplingTelemetryV67(coupling),geology:geologyTelemetryV67(geology),ground:groundTelemetryV67(ground),exposure:exposureTelemetryV67(exposure),transitions:transitionTelemetryV67(transitions),resources:resourceTelemetryV67(resources),interactions:interactionTelemetryV67(interactions),
  };
  const enriched={...result,telemetry};
  const observability=buildObservabilityLedgerV67(enriched,{});
  return {...enriched,observability,telemetry:{...telemetry,observability:observabilityTelemetryV67({policy:'observability-v67',score:0,decision:'degraded',observability})},digest:hashV67(JSON.stringify({...enriched,observability}))};
};

export const validateEnvironmentRuntimeV67 = (runtime={}) => {
  const required=['runtime','hydrology','weatherField','forecast','surface','atmosphere','wildlife','hazards','navigation','vegetation','climate','acoustics','resonance','continuity','shelter','visibility','coupling','events','geology','ground','exposure','transitions','resources','interactions'];
  const errors=[];
  if(runtime.policy!==V67_INTEGRATION_POLICY.id)errors.push('policy');
  if(runtime.contract?.noWorldMutation!==true)errors.push('mutation');
  if(runtime.contract?.placementAuthority!=='WorldAssetPlacementPipeline.js')errors.push('placement');
  if(runtime.contract?.materialAuthority!=='MaterialAssignmentCore.js')errors.push('material');
  for(const key of required)if(!(key in runtime))errors.push(key);
  if(!runtime.digest)errors.push('digest');
  return{ok:errors.length===0,errors};
};

export const runtimeQualityScoreV67 = (runtime={}) => {
  const tele=runtime.telemetry??{};
  const checks=Object.values(tele).filter(x=>x&&typeof x==='object');
  const valid=checks.filter(x=>x.valid===true||x.ok===true).length;
  const total=Math.max(1,checks.length);
  const base=valid/total;
  const risk=Math.max(0,1-(tele.hazards?.summary?.mean??0));
  const continuity=tele.continuity?.summary?.meanHealed??0;
  const visibility=tele.atmosphere?.summary?.meanVisibility??0;
  const ground=tele.ground?.summary?.wet!==undefined?1:0;
  const exposure=tele.exposure?.summary?.meanMargin??0;
  const interactions=tele.interactions?.summary?.meanSafety??0;
  const resources=tele.resources?.summary?.meanAbundance??0;
  return Math.max(0,Math.min(1,base*.28+risk*.12+continuity*.14+visibility*.11+ground*.04+exposure*.1+interactions*.11+resources*.1));
};

export const runtimeSummaryEnvelopeV67 = (runtime={}) => ({version:67,digest:runtime.digest,sampleCount:runtime.runtime?.sampleCount??0,phase:runtime.runtime?.phase,quality:runtimeQualityScoreV67(runtime),core:runtimeSummaryV67(runtime.runtime)});
export const acceptanceGateV67 = (runtime={}) => {const summary=runtimeSummaryEnvelopeV67(runtime);return {ok:validateEnvironmentRuntimeV67(runtime).ok&&summary.quality>=.58&&summary.sampleCount>0,summary};};
export const compareEnvironmentRuntimeV67 = (before={},after={}) => ({sameDigest:before.digest===after.digest,before:runtimeSummaryEnvelopeV67(before),after:runtimeSummaryEnvelopeV67(after),qualityDelta:runtimeQualityScoreV67(after)-runtimeQualityScoreV67(before)});
export const immutableContractSnapshotV67 = (runtime={}) => Object.freeze({policy:V67_POLICY.id,integration:V67_INTEGRATION_POLICY.id,deterministic:true,noWorldMutation:true,placementAuthority:V67_POLICY.placementAuthority,materialAuthority:V67_POLICY.materialAuthority,digest:runtime.digest});
