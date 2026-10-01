/**
 * Asset-boundary contract for world coverage v51.
 *
 * Coverage can say where an asset family is eligible, but it does not load or
 * place that asset. The shared mainline MaterialAssignmentCore and
 * WorldAssetPlacementPipeline remain the only authority for material-aware
 * world placement. This module only validates hand-off records.
 */

const VERSION = 'v51-asset-boundary';
const REQUIRED_PIPELINE = Object.freeze([
  'hydrate-load',
  'surface-analysis',
  'multi-material-recipe',
  'material-validation',
  'ground-transform',
  'placement-manifest',
  'scene-attach',
]);
const FORBIDDEN_CALLER_MARKERS = Object.freeze([
  'EditorMaterialStudio',
  'document.querySelector',
  'document.createElement',
  'THREE.Mesh',
  'BoxGeometry',
  'SphereGeometry',
  'CylinderGeometry',
]);
const FINITE_FIELDS = Object.freeze(['x','y','z','slope','moisture','snow','waterDistance','roadDistance','settlementDistance']);

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const nonNegative = (value, fallback = 0) => Math.max(0, finite(value, fallback));
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const normalizePath = (value) => String(value ?? '').replace(/\\/g,'/').trim();
const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
};
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result,key) => {
    result[key] = stable(value[key]);
    return result;
  }, {});
};
const stableStringify = (value) => JSON.stringify(stable(value));
const digest = (value) => {
  let hash = 2166136261;
  const text = stableStringify(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash,16777619);
  }
  return (hash >>> 0).toString(16).padStart(8,'0');
};

const normalizeObservation = (observation = {}) => ({
  id:String(observation.id ?? 'unknown'),
  position:{
    x:finite(observation.position?.x),
    y:finite(observation.position?.y),
    z:finite(observation.position?.z),
  },
  elevation:finite(observation.elevation,observation.position?.y ?? 0),
  slope:clamp(observation.slope,0,1),
  moisture:clamp(observation.moisture,0,1),
  snow:clamp(observation.snow,0,1),
  waterDistance:nonNegative(observation.waterDistance,Infinity),
  roadDistance:nonNegative(observation.roadDistance,Infinity),
  settlementDistance:nonNegative(observation.settlementDistance,Infinity),
  biome:String(observation.biome ?? 'unknown').toLowerCase(),
});

const validateObservation = (observation) => {
  const row=normalizeObservation(observation);
  const values=[row.position.x,row.position.y,row.position.z,row.elevation,row.slope,row.moisture,row.snow,row.waterDistance,row.roadDistance,row.settlementDistance];
  return {
    id:row.id,
    finite:values.every(Number.isFinite),
    withinBounds:row.slope>=0&&row.slope<=1&&row.moisture>=0&&row.moisture<=1&&row.snow>=0&&row.snow<=1,
    canonicalFieldsPresent:FINITE_FIELDS.every(field => field in row.position || field in row),
    noSyntheticGeometry:true,
  };
};

const validateEligibility = (observation = {}) => {
  const row=normalizeObservation(observation);
  const reason=row.waterDistance<2?'water':row.slope>.78?'cliff':row.snow>.94?'permanent-snow':row.roadDistance<8?'road':row.settlementDistance<8?'settlement':'ready';
  return {
    id:row.id,
    eligible:reason==='ready',
    reason,
    ground:{x:row.position.x,y:row.elevation,z:row.position.z},
    canonicalGroundSample:true,
    colliderMutation:false,
  };
};

const validatePipeline = (pipeline = []) => {
  const stages=Array.isArray(pipeline)?pipeline.map(stage => String(stage)):[];
  const order=REQUIRED_PIPELINE.map(stage => stages.indexOf(stage));
  const missing=REQUIRED_PIPELINE.filter(stage => !stages.includes(stage));
  const ordered=order.every((index,i)=>index>=0&&(i===0||index>order[i-1]));
  return {required:REQUIRED_PIPELINE,provided:stages,missing,ordered,complete:missing.length===0&&ordered};
};

const validateMaterials = (assignment = {}) => {
  const surfaces=Array.isArray(assignment.surfaces)?assignment.surfaces:[];
  const uniqueSurfaceIds=[...new Set(surfaces.map(surface => String(surface.id ?? surface.name ?? 'unknown')))]
    .filter(value=>value!=='unknown');
  const placeholderMarkers=surfaces.filter(surface => /placeholder|dummy|primitive|default-cube|default-sphere/i.test(String(surface.name ?? surface.id ?? '')));
  const missingPbr=surfaces.filter(surface => surface.pbr !== true && surface.textureSet !== true && surface.layeredFallback !== true);
  return {
    surfaceCount:surfaces.length,
    uniqueSurfaceCount:uniqueSurfaceIds.length,
    multiSurfaceRisk:surfaces.length<=1,
    placeholderCount:placeholderMarkers.length,
    pbrGapCount:missingPbr.length,
    valid:placeholderMarkers.length===0&&missingPbr.length===0&&(surfaces.length===0||surfaces.length>1),
  };
};

const validateHandoff = (record = {}) => {
  const sourcePath=normalizePath(record.assetPath);
  const policy=String(record.policy ?? 'shared-pipeline').toLowerCase();
  const pipeline=validatePipeline(record.pipeline);
  const observation=validateObservation(record.observation);
  const eligibility=validateEligibility(record.observation);
  const materials=validateMaterials(record.materialAssignment);
  const forbidden=FORBIDDEN_CALLER_MARKERS.filter(marker=>String(record.codeMarkerText ?? '').includes(marker));
  return {
    version:VERSION,
    assetPath:sourcePath,
    policy,
    sharedAuthority:record.sharedAuthority === 'MaterialAssignmentCore+WorldAssetPlacementPipeline',
    pipeline,
    observation,
    eligibility,
    materials,
    forbiddenMarkers:forbidden,
    geometryCreated:record.geometryCreated === true,
    assetHydratedHere:record.assetHydratedHere === true,
    editorImportedHere:record.editorImportedHere === true,
    sceneAttachedHere:record.sceneAttachedHere === true,
    valid:policy==='shared-pipeline'&&pipeline.complete&&observation.finite&&observation.withinBounds&&
      eligibility.canonicalGroundSample&&materials.placeholderCount===0&&forbidden.length===0&&
      record.geometryCreated!==true&&record.editorImportedHere!==true&&record.assetHydratedHere!==true,
  };
};

export function createWorldCoverageAssetBoundaryV51(record = {}) {
  const result={
    version:VERSION,
    handoff:validateHandoff(record),
    guarantees:{
      coveragePlansOnly:true,
      sharedPlacementAuthority:'MaterialAssignmentCore+WorldAssetPlacementPipeline',
      editorRuntimeImport:false,
      geometryCreation:false,
      sourceAssetOverwrite:false,
    },
  };
  result.digest=digest(result);
  return deepFreeze(result);
}

export function createWorldCoverageAssetBoundaryBatchV51(records = []) {
  const rows=Array.isArray(records)?records.map(createWorldCoverageAssetBoundaryV51):[];
  const valid=rows.filter(row=>row.handoff.valid).length;
  return deepFreeze({version:VERSION,count:rows.length,valid,invalid:rows.length-valid,allValid:valid===rows.length,rows,digest:digest(rows)});
}

export function createWorldCoverageAssetBoundaryDecisionV51(record = {}) {
  const boundary=createWorldCoverageAssetBoundaryV51(record);
  const handoff=boundary.handoff;
  return deepFreeze({
    version:VERSION,
    accept:handoff.valid,
    reason:handoff.valid?'accepted':'blocked',
    assetPath:handoff.assetPath,
    placementAuthority:boundary.guarantees.sharedPlacementAuthority,
    geometryCreationBlocked:handoff.geometryCreated,
    editorImportBlocked:handoff.editorImportedHere,
    localHydrationBlocked:handoff.assetHydratedHere,
    pipelineComplete:handoff.pipeline.complete,
    materialValidation:handoff.materials,
  });
}

export const WORLD_COVERAGE_ASSET_BOUNDARY_V51=Object.freeze({
  version:VERSION,
  requiredPipeline:REQUIRED_PIPELINE,
  forbiddenCallerMarkers:FORBIDDEN_CALLER_MARKERS,
  authority:'MaterialAssignmentCore+WorldAssetPlacementPipeline',
});
