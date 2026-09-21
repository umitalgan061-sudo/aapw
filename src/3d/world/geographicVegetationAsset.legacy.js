/**
 * Optional real-asset upgrade for the existing deterministic vegetation instances.
 * Scatter/height/hydrology/road ownership remains in world/vegetation.js.
 * This module only maps existing tree matrices to verified repository-authored GLB silhouettes.
 * Missing/LFS-pointer/corrupt sources fail closed to procedural trees.
 */

import * as THREE from 'three';
import { AssetLoader } from '../assetLoader.js';
import { REFERENCE_BIOME_ZONES, sampleReferenceInfluence } from './worldReferenceMap.js';
import { terrainMapUvAt } from './terrain.js';
import { northReferenceCryosphereAtWorldXZ } from './northReferenceCryosphere.js';

export const GEOGRAPHIC_VEGETATION_ASSET_POLICY = Object.freeze({
  id: 'vegetation-biome-real-assets-2026-09-07-v1',
  canonicalMapAuthority: 'owner-world-map-2026-08-08',
  scatterAuthority: 'world/vegetation.js',
  heightAuthority: 'world/terrain.js',
  assetAuthority: 'repository-authored-vegetation-glb',
  deterministic: true,
  desktopOnly: true,
  preserveSourcePbr: true,
  failClosedToProcedural: true,
  minimumSourceBytes: 512,
  targetSingleTreeHeightMeters: 7.6,
  maximumHorizontalToHeightRatio: 1.8,
  maximumRenderableMeshes: 8,
  maximumSourceExtentMeters: 35,
  replacementRatioMin: 0.18,
  replacementRatioMax: 0.42,
});

export const GEOGRAPHIC_VEGETATION_ASSETS = Object.freeze({
  birch: Object.freeze({ id: 'vegetation-birch-real', src: 'assets/models/vegetation/birch_trees_R7qMWzb7nk.glb', regions: Object.freeze(['cold-grassland','marsh','lush-grassland','temperate-coast','temperate']), scale: Object.freeze([0.82,1.18]), weight: 0.38 }),
  canopy: Object.freeze({ id: 'vegetation-canopy-real', src: 'assets/models/vegetation/big_tree_by_3donimus_dnwh762pn_6_na.glb', regions: Object.freeze(['lush-grassland','jungle','temperate','temperate-coast']), scale: Object.freeze([0.72,1.12]), weight: 0.30 }),
  autumn: Object.freeze({ id: 'vegetation-autumn-real', src: 'assets/models/vegetation/fall_tree_4GYen9Xm3Kj.glb', regions: Object.freeze(['temperate','lush-grassland','cold-grassland']), scale: Object.freeze([0.76,1.10]), weight: 0.17 }),
  dead: Object.freeze({ id: 'vegetation-dead-real', src: 'assets/models/vegetation/dead_tree_n8FhMgMldD.glb', regions: Object.freeze(['desert','steppe','arid','rocky-hills','mountain']), scale: Object.freeze([0.78,1.14]), weight: 0.15 }),
});

export const GEOGRAPHIC_VEGETATION_REGION_POLICY = Object.freeze({
  'cold-grassland': Object.freeze({ families: Object.freeze(['birch','autumn']), densityMultiplier: 0.72, maxSlopeDegrees: 38 }),
  marsh: Object.freeze({ families: Object.freeze(['birch']), densityMultiplier: 0.58, maxSlopeDegrees: 24 }),
  mountain: Object.freeze({ families: Object.freeze(['birch','dead']), densityMultiplier: 0.46, maxSlopeDegrees: 32 }),
  'rocky-hills': Object.freeze({ families: Object.freeze(['dead','birch']), densityMultiplier: 0.40, maxSlopeDegrees: 34 }),
  'lush-grassland': Object.freeze({ families: Object.freeze(['canopy','birch','autumn']), densityMultiplier: 1.00, maxSlopeDegrees: 42 }),
  desert: Object.freeze({ families: Object.freeze(['dead']), densityMultiplier: 0.24, maxSlopeDegrees: 25 }),
  steppe: Object.freeze({ families: Object.freeze(['dead','birch']), densityMultiplier: 0.28, maxSlopeDegrees: 34 }),
  'temperate-coast': Object.freeze({ families: Object.freeze(['birch','canopy']), densityMultiplier: 0.82, maxSlopeDegrees: 34 }),
  arid: Object.freeze({ families: Object.freeze(['dead']), densityMultiplier: 0.22, maxSlopeDegrees: 30 }),
  jungle: Object.freeze({ families: Object.freeze(['canopy']), densityMultiplier: 1.08, maxSlopeDegrees: 40 }),
  temperate: Object.freeze({ families: Object.freeze(['birch','canopy','autumn']), densityMultiplier: 0.92, maxSlopeDegrees: 42 }),
});

const PROCEDURAL_TREE_NAMES = Object.freeze(['vegetation-pine-trunks','vegetation-pine-foliage','vegetation-round-trunks','vegetation-round-foliage']);
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();
const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _normalization = new THREE.Matrix4();
const _final = new THREE.Matrix4();

function clamp01(value) { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)); }
function hash(value) { let h = 2166136261; for (const c of String(value ?? '')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function random01(seed, index = 0) { let x = hash(`${seed}|${index}`); x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16; return (x >>> 0) / 0x100000000; }

function biomeAtWorldXZ(x, z) {
  const map = terrainMapUvAt(x, z); const nx = clamp01(map.u); const ny = clamp01(1 - map.v);
  let winner = null;
  for (const zone of REFERENCE_BIOME_ZONES) { const influence = sampleReferenceInfluence(nx, ny, zone); if (!winner || influence > winner.influence) winner = { zone, influence }; }
  return Object.freeze({ biomeId: winner?.zone?.id ?? 'temperate', biomeKind: winner?.zone?.kind ?? 'temperate', influence: winner?.influence ?? 0, nx, ny });
}

export function vegetationBiomeAtWorldXZ(x, z) { return biomeAtWorldXZ(x, z); }
export function chooseGeographicVegetationFamily({ biomeKind = 'temperate', roadDistance = 1e9, cryosphere = {}, seed = 0, index = 0 } = {}) {
  const region = GEOGRAPHIC_VEGETATION_REGION_POLICY[biomeKind] || GEOGRAPHIC_VEGETATION_REGION_POLICY.temperate;
  const families = region.families;
  if (cryosphere.permanentIce >= 0.55 || cryosphere.tundra >= 0.82) return families.includes('birch') ? 'birch' : families[0];
  if (biomeKind === 'marsh' || biomeKind === 'desert' || biomeKind === 'arid') return biomeKind === 'marsh' ? 'birch' : 'dead';
  if (roadDistance < 18 && families.includes('birch')) return 'birch';
  let roll = random01(`${seed}|${biomeKind}`, index);
  for (const family of families) { roll -= GEOGRAPHIC_VEGETATION_ASSETS[family]?.weight ?? 0.2; if (roll <= 0) return family; }
  return families[families.length - 1];
}

function collectModelMeshes(model) { const meshes = []; model?.updateMatrixWorld?.(true); model?.traverse?.((node) => { if (!node?.isMesh || !node.geometry?.getAttribute?.('position') || !node.material || Array.isArray(node.material)) return; meshes.push(node); }); return meshes; }
function hasTextureMaterial(material) { return Boolean(material) && ['map','normalMap','roughnessMap','metalnessMap','aoMap'].some((key) => material[key]?.isTexture); }

export function measureGeographicVegetationAsset(model) {
  if (!model) return null; model.updateMatrixWorld?.(true); _box.setFromObject(model); if (_box.isEmpty()) return null; _box.getSize(_size); _box.getCenter(_center);
  return Object.freeze({ size: _size.clone(), center: _center.clone(), bounds: _box.clone(), horizontalToHeightRatio: _size.y > 0 ? Math.max(_size.x,_size.z) / _size.y : Infinity });
}

export function validateGeographicVegetationAsset(model, policy = GEOGRAPHIC_VEGETATION_ASSET_POLICY) {
  if (!model || model.userData?.isPlaceholder) return Object.freeze({ valid:false, reason:'placeholder' });
  const meshes = collectModelMeshes(model); if (!meshes.length) return Object.freeze({ valid:false, reason:'no-renderable-mesh' });
  if (meshes.length > policy.maximumRenderableMeshes) return Object.freeze({ valid:false, reason:'too-many-meshes' });
  const measurement = measureGeographicVegetationAsset(model); if (!measurement) return Object.freeze({ valid:false, reason:'empty-bounds' });
  if (!Number.isFinite(measurement.horizontalToHeightRatio)) return Object.freeze({ valid:false, reason:'non-finite-shape' });
  if (measurement.horizontalToHeightRatio > policy.maximumHorizontalToHeightRatio) return Object.freeze({ valid:false, reason:'too-wide' });
  if (measurement.size.y < 0.05) return Object.freeze({ valid:false, reason:'degenerate-height' });
  if (Math.max(measurement.size.x,measurement.size.y,measurement.size.z) > policy.maximumSourceExtentMeters) return Object.freeze({ valid:false, reason:'source-too-large' });
  return Object.freeze({ valid:true, meshes, measurement });
}

export function createGeographicVegetationNormalization(measurement, targetHeightMeters = GEOGRAPHIC_VEGETATION_ASSET_POLICY.targetSingleTreeHeightMeters) {
  const scale = targetHeightMeters / measurement.size.y;
  return _normalization.makeScale(scale,scale,scale).multiply(new THREE.Matrix4().makeTranslation(-measurement.center.x,-measurement.bounds.min.y,-measurement.center.z));
}

export function sourceVegetationMaterialEvidence(model) {
  const meshes = collectModelMeshes(model); return Object.freeze({ meshCount: meshes.length, mappedMaterialCount: meshes.filter((mesh) => hasTextureMaterial(mesh.material)).length, hasAuthoredPbr: meshes.some((mesh) => hasTextureMaterial(mesh.material)) });
}

function surfaceSlopeDegrees(x,z,sampleHeightMeters) {
  const d = 3; const c=Number(sampleHeightMeters(x,z)); const e=Number(sampleHeightMeters(x+d,z)); const w=Number(sampleHeightMeters(x-d,z)); const s=Number(sampleHeightMeters(x,z+d)); const n=Number(sampleHeightMeters(x,z-d));
  if (![c,e,w,s,n].every(Number.isFinite)) return Infinity; return Math.atan(Math.hypot((e-w)/(2*d),(s-n)/(2*d))) * 180 / Math.PI;
}

function distanceToNearestRoad(x,z,roadEdges=[]) {
  let nearest=Infinity; for(const edge of roadEdges){const points=Array.isArray(edge?.points)?edge.points:[];for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],abx=b.x-a.x,abz=b.z-a.z,l2=abx*abx+abz*abz;const t=l2<=1e-9?0:Math.max(0,Math.min(1,((x-a.x)*abx+(z-a.z)*abz)/l2));nearest=Math.min(nearest,Math.hypot(x-(a.x+abx*t),z-(a.z+abz*t)));}} return Number.isFinite(nearest)?nearest:1e9;
}

function applyTreeWeathering(material, family, biomeKind, seed) {
  if (!material) return material;
  const priorCompile = material.onBeforeCompile;
  material.onBeforeCompile = function geographicVegetationCompile(shader, renderer) {
    priorCompile?.call(this, shader, renderer);
    shader.vertexShader = shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vGeographicVegetationWorldPosition;').replace('#include <begin_vertex>','#include <begin_vertex>\nvGeographicVegetationWorldPosition=(modelMatrix*vec4(transformed,1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vGeographicVegetationWorldPosition;\nfloat gvHash(vec2 p){p=fract(p*vec2(127.1,311.7));p+=dot(p,p+34.5);return fract(p.x*p.y);}\nfloat gvNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(gvHash(i),gvHash(i+vec2(1.,0.)),f.x),mix(gvHash(i+vec2(0.,1.)),gvHash(i+vec2(1.,1.)),f.x),f.y);}').replace('#include <color_fragment>',`#include <color_fragment>\nvec2 gvXZ=vGeographicVegetationWorldPosition.xz;float gvMacro=gvNoise(gvXZ*0.021+vec2(${(seed%17)*0.31},${(seed%23)*-0.27}));float gvFine=gvNoise(gvXZ*0.43+vec2(7.3,-11.9));float gvDry=${biomeKind==='desert'||biomeKind==='arid'||biomeKind==='steppe'?'0.15':biomeKind==='jungle'?'-0.03':'0.0'};diffuseColor.rgb*=1.0+(gvMacro-0.5)*0.15+(gvFine-0.5)*0.05+gvDry;`);
  };
  material.customProgramCacheKey=()=>`${GEOGRAPHIC_VEGETATION_ASSET_POLICY.id}:${family}:${biomeKind}`;
  material.userData.geographicVegetationWeathering=Object.freeze({family,biomeKind,worldSpace:true,authoredTexturePreserved:true});
  material.needsUpdate=true; return material;
}

function matrixForInstance(mesh,index){ mesh.getMatrixAt(index,_matrix); _matrix.decompose(_position,_quaternion,_scale); return {position:_position.clone(),quaternion:_quaternion.clone(),scale:_scale.clone()}; }
function ensureInstancedMesh(group,sourceMesh,family,index,materialCache){const key=`${family}:${index}`;let material=materialCache.get(key);if(!material){material=sourceMesh.material.clone();materialCache.set(key,material);}const mesh=new THREE.InstancedMesh(sourceMesh.geometry,material,1);mesh.name=`geographic-vegetation-${family}-${index}`;mesh.castShadow=true;mesh.receiveShadow=true;mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);mesh.userData.geographicVegetationAsset=family;mesh.userData.sourceMaterialMapped=hasTextureMaterial(sourceMesh.material);mesh.userData.geographicVegetationTexturePreserved=hasTextureMaterial(sourceMesh.material);group.add(mesh);return mesh;}
function addInstance(mesh,index,instanceTransform,sourceMesh,normalization){if(mesh.count<index+1)mesh.count=index+1;_final.copy(instanceTransform).multiply(normalization).premultiply(sourceMesh.matrixWorld);mesh.setMatrixAt(index,_final);}

export function describeGeographicVegetationPlan(){return Object.freeze(Object.entries(GEOGRAPHIC_VEGETATION_REGION_POLICY).map(([biomeKind,policy])=>Object.freeze({biomeKind,families:policy.families,densityMultiplier:policy.densityMultiplier,maxSlopeDegrees:policy.maxSlopeDegrees})));}

export async function probeGeographicVegetationAsset(assetUrl,{fetchImpl=globalThis.fetch,signal,minBytes=GEOGRAPHIC_VEGETATION_ASSET_POLICY.minimumSourceBytes}={}){if(typeof fetchImpl!=='function')return Object.freeze({status:'unknown',shouldLoad:true,reason:'fetch-unavailable'});let response;try{response=await fetchImpl(assetUrl,{method:'HEAD',cache:'no-store',signal});}catch(error){if(signal?.aborted)return Object.freeze({status:'cancelled',shouldLoad:false,reason:'aborted'});return Object.freeze({status:'unknown',shouldLoad:true,reason:'head-failed'});}if(signal?.aborted)return Object.freeze({status:'cancelled',shouldLoad:false,reason:'aborted'});if(!response.ok){if(response.status===405||response.status===501)return Object.freeze({status:'unknown',shouldLoad:true,reason:'head-unsupported'});return Object.freeze({status:'rejected',shouldLoad:false,reason:'http-error',statusCode:response.status});}const length=Number.parseInt(response.headers?.get?.('content-length')??'',10);if(Number.isFinite(length)&&length>0&&length<minBytes)return Object.freeze({status:'rejected',shouldLoad:false,reason:'pointer-sized-response',contentLength:length});const type=String(response.headers?.get?.('content-type')??'').toLowerCase();if(type.startsWith('text/'))return Object.freeze({status:'rejected',shouldLoad:false,reason:'text-response',contentType:type});return Object.freeze({status:'accepted',shouldLoad:true,reason:'binary-candidate',contentLength:Number.isFinite(length)?length:null,contentType:type});}

export async function upgradeGeographicVegetationAssets(group,{sampleHeightMeters,roadEdges=[],seed=0,assetLoader=new AssetLoader(),assetProbe=null,signal}={}){
  if(!group?.userData)return Object.freeze({status:'invalid-group',replacedCount:0});
  const existing=group.userData.geographicVegetationAssetUpgrade;if(['active','procedural-fallback','no-procedural-trees','invalid-input'].includes(existing?.status))return existing;
  if(typeof sampleHeightMeters!=='function')return Object.freeze({status:'invalid-input',replacedCount:0});
  const procedural=group.children.filter((child)=>child?.isInstancedMesh&&PROCEDURAL_TREE_NAMES.includes(child.name)&&child.count>0);
  if(!procedural.length)return Object.freeze({status:'no-procedural-trees',replacedCount:0});
  const cache=new Map(),materialCache=new Map(),entries=new Map(),counts=new Map(),rejected=[],familyCounts=new Map();
  let replacedCount=0;
  const loadedFamilies=new Set();
  for(const mesh of procedural){
    if(signal?.aborted)break;
    const sample=matrixForInstance(mesh,0); const seedBiome=biomeAtWorldXZ(sample.position.x,sample.position.z).biomeKind;
    const candidateFamilies=(GEOGRAPHIC_VEGETATION_REGION_POLICY[seedBiome]||GEOGRAPHIC_VEGETATION_REGION_POLICY.temperate).families;
    let chosen=null;
    for(const family of candidateFamilies){const asset=GEOGRAPHIC_VEGETATION_ASSETS[family];if(!asset||!asset.regions.includes(seedBiome))continue;if(cache.has(asset.src)){chosen={family,asset,model:cache.get(asset.src)};break;}let model=null;try{model=await assetLoader.loadModel(asset.src,{fallbackColor:0xff00ff,fallbackSize:1});}catch(error){rejected.push({family,src:asset.src,reason:'loader-threw',error:String(error)});continue;}const validation=validateGeographicVegetationAsset(model);if(!validation.valid){rejected.push({family,src:asset.src,reason:validation.reason});AssetLoader.disposeObject3D(model);continue;}cache.set(asset.src,model);chosen={family,asset,model};break;}
    if(!chosen)continue;
    loadedFamilies.add(chosen.family); const meshes=collectModelMeshes(chosen.model); const normalization=createGeographicVegetationNormalization(measureGeographicVegetationAsset(chosen.model));
    let localIndex=0;
    for(let i=0;i<mesh.count;i++){
      const transform=matrixForInstance(mesh,i); const biome=biomeAtWorldXZ(transform.position.x,transform.position.z); const cryo=northReferenceCryosphereAtWorldXZ(transform.position.x,transform.position.z); const roadDistance=distanceToNearestRoad(transform.position.x,transform.position.z,roadEdges); const slope=surfaceSlopeDegrees(transform.position.x,transform.position.z,sampleHeightMeters); const region=GEOGRAPHIC_VEGETATION_REGION_POLICY[biome.biomeKind]||GEOGRAPHIC_VEGETATION_REGION_POLICY.temperate; if(!chosen.asset.regions.includes(biome.biomeKind)||slope>region.maxSlopeDegrees)continue; if(cryo.permanentIce>0.7&&chosen.family!=='birch')continue; const target=GEOGRAPHIC_VEGETATION_ASSET_POLICY.replacementRatioMin+(GEOGRAPHIC_VEGETATION_ASSET_POLICY.replacementRatioMax-GEOGRAPHIC_VEGETATION_ASSET_POLICY.replacementRatioMin)*0.58+(roadDistance<24?0.08:0);if(random01(`${seed}|${mesh.name}`,i)>Math.min(0.58,target))continue; if(region.densityMultiplier<0.35&&random01(`${seed}|density`,i)>region.densityMultiplier+0.15)continue;
      for(let j=0;j<meshes.length;j++){const source=meshes[j];const key=`${chosen.family}:${j}`;let targetMesh=entries.get(key);if(!targetMesh){targetMesh=ensureInstancedMesh(group,source,chosen.family,j,materialCache);entries.set(key,targetMesh);applyTreeWeathering(targetMesh.material,chosen.family,biome.biomeKind,seed);}const outIndex=counts.get(key)||0;_matrix.compose(transform.position,transform.quaternion,transform.scale);addInstance(targetMesh,outIndex,_matrix,source,normalization);counts.set(key,outIndex+1);}
      replacedCount++;localIndex++;
    }
    if(localIndex>0){mesh.visible=false;mesh.userData.geographicVegetationReplacement=Object.freeze({family:chosen.family,replaced:localIndex,originalCount:mesh.count});}
  }
  for(const [key,mesh] of entries){const count=counts.get(key)||0;if(!count){mesh.parent?.remove(mesh);mesh.geometry=new THREE.BufferGeometry();continue;}mesh.count=count;mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere?.();}
  const status=Object.freeze({policyId:GEOGRAPHIC_VEGETATION_ASSET_POLICY.id,status:replacedCount?'active':'procedural-fallback',replacedCount,loadedFamilies:[...loadedFamilies].sort(),familyCounts:Object.fromEntries([...familyCounts.entries()].sort()),rejected:Object.freeze(rejected.map((entry)=>Object.freeze(entry))),proceduralFallbackVisible:procedural.some((mesh)=>mesh.visible)});
  group.userData.geographicVegetationAssetUpgrade=status;group.userData.geographicVegetationRealAssetPolicy=Object.freeze({policyId:GEOGRAPHIC_VEGETATION_ASSET_POLICY.id,deterministic:true,preserveSourcePbr:true,mapAligned:true,biomePlan:describeGeographicVegetationPlan()});return status;
}

export function summarizeGeographicVegetationAssets(group){const status=group?.userData?.geographicVegetationAssetUpgrade;const realMeshes=(group?.children||[]).filter((child)=>child?.isInstancedMesh&&child.userData?.geographicVegetationAsset);const mappedRealMeshes=realMeshes.filter((mesh)=>mesh.userData?.sourceMaterialMapped);return Object.freeze({policyId:GEOGRAPHIC_VEGETATION_ASSET_POLICY.id,status:status?.status??'not-run',replacedCount:status?.replacedCount??0,realMeshCount:realMeshes.length,mappedRealMeshCount:mappedRealMeshes.length,authoredTexturePreserved:mappedRealMeshes.every((mesh)=>mesh.userData.geographicVegetationTexturePreserved),proceduralFallbackVisible:status?.proceduralFallbackVisible??true});}
