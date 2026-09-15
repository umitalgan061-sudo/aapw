export const V67_MANIFEST=Object.freeze({
  id:'environment-runtime-v67',
  version:67,
  date:'2026-09-15',
  deterministic:true,
  noWorldMutation:true,
  authorities:{placement:'WorldAssetPlacementPipeline.js',material:'MaterialAssignmentCore.js'},
  acceptance:{projection:'orthographic',width:1536,height:1024,fovDegrees:90,fullWorld:true},
  domains:[
    'core','hydrology','weather','surface','atmosphere','wildlife','hazards','navigation','vegetation','climate','ecology','events','geology','acoustics','resonance','continuity','shelter','visibility','weather-coupling','streaming','scenario-ledger','coverage-matrix','release-gate','quality-guard','ground','exposure','biome-transitions','resources','interaction','observability','performance','audit',
  ],
  runtimeContracts:{
    inputsArePlainData:true,
    outputsAreSerializable:true,
    sceneMutationForbidden:true,
    sharedAuthoritiesPreserved:true,
    deterministicDigestRequired:true,
  },
  platformModes:['desktop','tablet','mobile'],
  worldSignals:['elevation','slope','moisture','temperature','humidity','wind','visibility','rain','snow','canopy','waterDistance','humanPressure'],
  releaseEnvelope:{minimumAddedLines:2850,maximumAddedLines:3000,minimumQuality:.58,minimumEvidence:.92},
});

export const V67_MANIFEST_CHECKS=Object.freeze({
  deterministic:true,
  readOnly:true,
  sharedPlacementAuthority:true,
  sharedMaterialAuthority:true,
  scenarioCoverage:true,
  exactHeadValidation:true,
  runtimeContractsExplicit:true,
  platformModesCovered:true,
  releaseEnvelopeExplicit:true,
});

export const manifestDomainSetV67=()=>new Set(V67_MANIFEST.domains);
export const manifestHasDomainV67=(domain)=>manifestDomainSetV67().has(domain);
export const manifestAcceptanceProfileV67=()=>({...V67_MANIFEST.acceptance,version:V67_MANIFEST.version});
