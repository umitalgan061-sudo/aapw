export const V67_MANIFEST=Object.freeze({
  id:'environment-runtime-v67',
  version:67,
  date:'2026-09-15',
  deterministic:true,
  noWorldMutation:true,
  authorities:{
    placement:'WorldAssetPlacementPipeline.js',
    material:'MaterialAssignmentCore.js',
  },
  acceptance:{
    projection:'orthographic',
    width:1536,
    height:1024,
    fovDegrees:90,
    fullWorld:true,
  },
  domains:[
    'core','hydrology','weather','surface','atmosphere','wildlife','hazards','navigation',
    'vegetation','climate','ecology','events','geology','acoustics','resonance','continuity',
    'shelter','visibility','weather-coupling','streaming','scenario-ledger','coverage-matrix',
    'release-gate','quality-guard',
  ],
});

export const V67_MANIFEST_CHECKS=Object.freeze({
  deterministic:true,
  readOnly:true,
  sharedPlacementAuthority:true,
  sharedMaterialAuthority:true,
  scenarioCoverage:true,
  exactHeadValidation:true,
});
