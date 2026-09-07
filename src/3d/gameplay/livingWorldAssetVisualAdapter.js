/**
 * Şafak Kartalı — runtime actor visual evidence seam over the shared material/placement core.
 * It audits the actual Three.js actor, preserves healthy authored materials and only uses the shared
 * layered/auto dressing fallback when the model is under-specified. No spawning or editor ownership.
 */
import { analyzeMaterialSurfaces, autoAssignMaterials, buildRecommendedLayerRecipe, createMaterialManifest, validateMaterialAssignment } from '../materials/MaterialAssignmentCore.js';
import { auditWorldAssetPlacement } from '../world/WorldAssetPlacementPipeline.js';
import { resolveLivingWorldGeography, resolveLivingWorldAssetProfile } from './livingWorldGeographyAdapter.js';

export const LIVING_WORLD_VISUAL_POLICY = Object.freeze({
  id: 'living-world-actor-visual-2026-09-07-v2', deterministic: true, noSecondMaterialFramework: true,
  materialAuthority: 'MaterialAssignmentCore.js', placementAuthority: 'WorldAssetPlacementPipeline.js', editorMaterialStudioRuntimeImport: false,
  preserveAuthoredMaterialsWhenHealthy: true, layeredFallbackOnlyWhenUnderSpecified: true,
  semanticCoverageThreshold: 0.55, texturedMaterialRatioThreshold: 0.50, strongTexturedMaterialRatioThreshold: 0.80,
  minimumTextureDimension: 128, preferredTextureDimension: 512, mobilePreferredTextureDimension: 256,
});

export const LIVING_WORLD_ROLE_SURFACES = Object.freeze({
  human: ['skin', 'hair', 'eyes', 'clothing', 'boots', 'gear'], guard: ['skin', 'hair', 'eyes', 'clothing', 'boots', 'gear'],
  farmer: ['skin', 'hair', 'eyes', 'clothing', 'boots', 'gear'], companion: ['skin', 'hair', 'eyes', 'clothing', 'boots', 'gear'],
  horse: ['coat', 'mane', 'tail', 'hoof', 'saddle', 'harness'], wildlife: ['fur', 'eye', 'claw', 'tooth'],
  wolf: ['fur', 'eye', 'claw', 'tooth'], bear: ['fur', 'eye', 'claw', 'tooth'], deer: ['fur', 'eye', 'hoof', 'antler'],
  bison: ['fur', 'eye', 'hoof', 'horn'], sheep: ['fur', 'eye', 'hoof', 'horn'], cow: ['fur', 'eye', 'hoof', 'horn'], goat: ['fur', 'eye', 'hoof', 'horn'],
  fox: ['fur', 'eye', 'claw', 'tooth'], bird: ['feather', 'eye', 'beak', 'claw'], dragon: ['scale', 'wing', 'eye', 'horn', 'claw'],
});

const ALIASES = Object.freeze({
  skin: ['skin', 'body', 'flesh', 'human'], hair: ['hair', 'beard', 'brow'], eyes: ['eye', 'eyes', 'iris', 'pupil'],
  clothing: ['cloth', 'clothing', 'shirt', 'tunic', 'robe', 'armor', 'dress', 'jacket', 'torso'], boots: ['boot', 'boots', 'shoe', 'foot', 'feet', 'leg'],
  gear: ['gear', 'belt', 'bag', 'weapon', 'shield', 'strap', 'equipment', 'metal'], coat: ['coat', 'body', 'hide', 'fur', 'horse'], mane: ['mane'], tail: ['tail'],
  hoof: ['hoof', 'hooves', 'foot', 'feet'], saddle: ['saddle', 'seat'], harness: ['harness', 'bridle', 'reins', 'halter'], fur: ['fur', 'pelt', 'hide', 'coat', 'body'],
  eye: ['eye', 'eyes', 'iris', 'pupil'], claw: ['claw', 'talon', 'nail', 'paw'], tooth: ['tooth', 'teeth', 'fang', 'mouth'], antler: ['antler', 'antlers'],
  horn: ['horn', 'horns'], feather: ['feather', 'feathers', 'plume', 'wing'], beak: ['beak', 'bill'], scale: ['scale', 'scales', 'hide', 'armor'], wing: ['wing', 'wings', 'membrane'],
});
const CLIMATE = Object.freeze({
  snow: [1,.55,.15,0,'snow',.98], north:[.82,.50,.18,0,'boreal',1], marsh:[.22,1,.05,0,'marsh',.99], mountain:[.65,.35,.28,.08,'highland',.99],
  westerlands:[.28,.43,.26,0,'temperate',1], reach:[.18,.40,.20,0,'fertile',1.01], desert:[.02,.05,1,.05,'dorne',.99], steppe:[.20,.18,.72,0,'steppe',1.01],
  arid:[.04,.08,.92,.18,'red-waste',.99], coast:[.16,.72,.24,0,'maritime',1], jungle:[.02,.95,.08,0,'jungle',1.02], valyria:[.02,.04,.65,1,'volcanic',1.03], temperate:[.18,.42,.24,0,'temperate',1],
});
const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
const mats = (v) => !v ? [] : Array.isArray(v) ? v.filter(Boolean) : [v];
function family({ role = 'guard', speciesId = null } = {}) { const s = norm(speciesId); if (s && LIVING_WORLD_ROLE_SURFACES[s]) return s; const r = norm(role); return LIVING_WORLD_ROLE_SURFACES[r] ? r : 'human'; }
function expected(options) { return [...(LIVING_WORLD_ROLE_SURFACES[family(options)] || LIVING_WORLD_ROLE_SURFACES.human)]; }
function textureSize(texture) { const i = texture?.image || texture?.source?.data || null; const w = Number(i?.width ?? i?.videoWidth ?? 0); const h = Number(i?.height ?? i?.videoHeight ?? 0); return w > 0 && h > 0 ? { width:w, height:h, min:Math.min(w,h), max:Math.max(w,h) } : null; }
function texture(texture) { return texture ? { size:textureSize(texture), colorSpace:texture.colorSpace ?? null } : null; }
function tokenScore(name, aliases) { const n = norm(name); return Math.max(0, ...(aliases || []).map((a) => { const x = norm(a); return n === x ? 1 : n.includes(x) ? .6 : 0; })); }
function roleMatch(mesh, material, roles) { return roles.map((role) => ({ role, score: tokenScore(`${mesh?.name || ''} ${material?.name || ''}`, ALIASES[role] || [role]) })).filter((x) => x.score > 0).sort((a,b) => b.score - a.score || a.role.localeCompare(b.role))[0] || { role:null, score:0 }; }
function materialFeatures(material) { return { baseColor:texture(material?.map ?? material?.diffuseMap), normal:texture(material?.normalMap), roughness:texture(material?.roughnessMap), metalness:texture(material?.metalnessMap), ao:texture(material?.aoMap), emissive:texture(material?.emissiveMap), displacement:texture(material?.displacementMap) }; }
function pbrScore(f) { let score = f.baseColor ? .45 : 0; if (f.normal) score += .2; if (f.roughness) score += .15; if (f.metalness) score += .1; if (f.ao) score += .1; return Math.min(1, score); }
function textureScore(f, mobile) { const size = f.baseColor?.size?.min; if (!Number.isFinite(size)) return 0; const preferred = mobile ? 256 : 512; return size < 128 ? .15 : size < preferred ? .6 : size < preferred * 2 ? .9 : 1; }

export function geographicVisualClimate(region, { moisture = 0, waterDepth = 0, slopeDegrees = 0, dayTemperatureBias = 0 } = {}) {
  const base = CLIMATE[norm(region)] || CLIMATE.temperate; const wet = Math.max(0, Math.min(1, base[1] + Math.max(0,finite(moisture))*.35 + Math.max(0,finite(waterDepth))*.4)); const exposure = Math.max(0, Math.min(1, Math.abs(finite(slopeDegrees))/45));
  return Object.freeze({ region:norm(region)||'temperate', cold:+Math.max(0,Math.min(1,base[0]-finite(dayTemperatureBias)*.08+exposure*.08)).toFixed(3), wet:+wet.toFixed(3), dry:+Math.max(0,Math.min(1,base[2]+(1-wet)*.15)).toFixed(3), volcanic:base[3], paletteBias:base[4], scaleBias:base[5], exposure:+exposure.toFixed(3) });
}

export function resolveLivingWorldVisualContext(options = {}) {
  const { worldX=0, worldZ=0, role='guard', speciesId=null, groundHeight=null, slopeDegrees=0, waterDepth=0, settlementDistance=Infinity, roadDistance=Infinity, moisture=0, seed=0x51afac } = options;
  const geography = resolveLivingWorldGeography({ worldX, worldZ, role, speciesId, groundHeight, slopeDegrees, waterDepth, settlementDistance, roadDistance, seed });
  const profile = resolveLivingWorldAssetProfile({ worldX, worldZ, role, speciesId });
  return Object.freeze({ ok:geography.ok, region:geography.region, reason:geography.reason, profileId:geography.profileId, normalizedReference:geography.normalizedReference, climate:geographicVisualClimate(geography.region,{ moisture, waterDepth, slopeDegrees }), expectedSurfaces:expected({role,speciesId}), assetCandidates:(profile?.assetCandidates||[]).map((p)=>typeof p==='string'&&/^assets\/models\//.test(p)?p:null).filter(Boolean), assetFamily:profile?.family||family({role,speciesId}) });
}

export function inspectLivingWorldAssetVisual(object, { role='guard', speciesId=null, region='temperate', mobile=false, requireGeneratedTexture=false, sourcePath=null, assetId=null } = {}) {
  const roles = expected({role,speciesId}); const analysis = analyzeMaterialSurfaces(object); const surfaces = [];
  for (const mesh of analysis.meshes) for (const [materialIndex, material] of mats(mesh.material).entries()) {
    const f = materialFeatures(material); const match = roleMatch(mesh, material, roles); surfaces.push({ meshName:mesh.name||'', materialName:material?.name||'', materialIndex, role:match.role, roleScore:match.score, features:f, ...(() => ({ hasBaseColor:Boolean(f.baseColor), hasNormal:Boolean(f.normal), hasRoughness:Boolean(f.roughness), hasMetalness:Boolean(f.metalness), hasAo:Boolean(f.ao), pbrScore:pbrScore(f), textureScore:textureScore(f,mobile) }))(), generatedByFactory:Boolean(material?.userData?.generatedByTextureFactory), layeredMaterial:Boolean(material?.userData?.layeredMaterial) });
  }
  const validation = validateMaterialAssignment(object,{requireGeneratedTexture}); const present = new Set(surfaces.filter((s)=>s.role&&s.roleScore>=.6).map((s)=>s.role)); const semanticCoverage = roles.length ? present.size/roles.length : 1; const texturedMaterialRatio = surfaces.length ? surfaces.filter((s)=>s.hasBaseColor).length/surfaces.length : 0;
  let fallbackReason = null; if (!validation.ok) fallbackReason='validation-failure'; else if (semanticCoverage < LIVING_WORLD_VISUAL_POLICY.semanticCoverageThreshold) fallbackReason='semantic-under-specification'; else if (texturedMaterialRatio < LIVING_WORLD_VISUAL_POLICY.texturedMaterialRatioThreshold) fallbackReason='texture-under-specification';
  const normalMappedMaterialRatio = surfaces.length ? surfaces.filter((s)=>s.hasNormal).length/surfaces.length : 0;
  return Object.freeze({ policyId:LIVING_WORLD_VISUAL_POLICY.id, ok:validation.ok, role:family({role,speciesId}), speciesId, region:norm(region)||'temperate', climate:geographicVisualClimate(region), expectedSurfaces:roles, presentRoles:[...present].sort(), missingRoles:roles.filter((r)=>!present.has(r)), semanticCoverage:+semanticCoverage.toFixed(3), texturedMaterialRatio:+texturedMaterialRatio.toFixed(3), normalMappedMaterialRatio:+normalMappedMaterialRatio.toFixed(3), averageTextureQuality:surfaces.length?+(surfaces.reduce((n,s)=>n+s.textureScore,0)/surfaces.length).toFixed(3):0, averagePbrScore:surfaces.length?+(surfaces.reduce((n,s)=>n+s.pbrScore,0)/surfaces.length).toFixed(3):0, meshCount:analysis.meshCount, surfaceCount:analysis.surfaceCount, materialSlotCount:surfaces.length, generatedMaterialCount:validation.generatedMaterialCount, warnings:[...validation.warnings], errors:[...validation.errors], fallbackReason, sourcePath, assetId, surfaces });
}

export function shouldPreserveAuthoredVisuals(audit) { return Boolean(audit?.ok && !audit.fallbackReason && audit.semanticCoverage >= LIVING_WORLD_VISUAL_POLICY.semanticCoverageThreshold && audit.texturedMaterialRatio >= LIVING_WORLD_VISUAL_POLICY.strongTexturedMaterialRatioThreshold); }
export function prepareLivingWorldAssetVisual(object, { role='guard', speciesId=null, region='temperate', paletteId=null, textureSize=512, mobile=false, allowLayeredFallback=true, requireGeneratedTexture=false, metadata={} } = {}) {
  const before = inspectLivingWorldAssetVisual(object,{role,speciesId,region,mobile,requireGeneratedTexture,sourcePath:metadata.src,assetId:metadata.id}); if (shouldPreserveAuthoredVisuals(before)) return Object.freeze({ok:true,status:'authored-preserved',changed:false,before,after:before}); if (!allowLayeredFallback) return Object.freeze({ok:false,error:before.fallbackReason||'visual-quality-below-threshold',changed:false,before,after:before});
  let operation; if (before.meshCount===1&&before.materialSlotCount===1) { const recipe=buildRecommendedLayerRecipe(object,{metadata,paletteId,textureSize:mobile?256:textureSize,targetMeshIndex:0}); if(!recipe)return Object.freeze({ok:false,error:'layered-fallback-recipe-unavailable',changed:false,before,after:before}); operation={mode:'layers',recipe}; } else { const result=autoAssignMaterials(object,{metadata,paletteId,textureSize:mobile?256:textureSize}); if(!result?.ok)return Object.freeze({ok:false,error:`auto-dressing:${result?.error||'failed'}`,changed:false,before,after:before}); operation={mode:'auto',recipe:result.recipe,result}; }
  const after=inspectLivingWorldAssetVisual(object,{role,speciesId,region,mobile,requireGeneratedTexture,sourcePath:metadata.src,assetId:metadata.id}); return Object.freeze({ok:after.ok&&!after.fallbackReason,status:operation.mode==='layers'?'shared-layered-fallback':'shared-auto-dressing',changed:true,before,after,operation});
}

export function createLivingWorldVisualManifest(object, { role='guard', speciesId=null, region='temperate', placement=null, metadata={} } = {}) {
  const audit=inspectLivingWorldAssetVisual(object,{role,speciesId,region,sourcePath:metadata.src,assetId:metadata.id}); return Object.freeze({version:1,policyId:LIVING_WORLD_VISUAL_POLICY.id,asset:{id:metadata.id||object?.userData?.assetId||null,src:metadata.src||object?.userData?.assetSrc||null,role:audit.role,speciesId,region:audit.region},geographicVisual:{climate:audit.climate,expectedSurfaces:audit.expectedSurfaces,semanticCoverage:audit.semanticCoverage,texturedMaterialRatio:audit.texturedMaterialRatio,normalMappedMaterialRatio:audit.normalMappedMaterialRatio,averageTextureQuality:audit.averageTextureQuality,averagePbrScore:audit.averagePbrScore},surfaces:audit.surfaces.map((s)=>({meshName:s.meshName,materialName:s.materialName,role:s.role,roleScore:s.roleScore,baseColor:s.features.baseColor,normal:s.features.normal,roughness:s.features.roughness,metalness:s.features.metalness,ao:s.features.ao,generatedByFactory:s.generatedByFactory,layeredMaterial:s.layeredMaterial})),materialManifest:createMaterialManifest(object,{metadata,placement}),validation:{ok:audit.ok,errors:[...audit.errors],warnings:[...audit.warnings],fallbackReason:audit.fallbackReason}});
}
export function auditLivingWorldVisualPlacement(object, options = {}) { const visual=inspectLivingWorldAssetVisual(object,options); const placement=auditWorldAssetPlacement(object); return Object.freeze({ok:visual.ok&&placement.ok,visual,placement,errors:[...visual.errors,...placement.errors.map((e)=>`placement:${e}`)],warnings:[...visual.warnings,...placement.warnings.map((w)=>`placement:${w}`)]}); }
export function buildLivingWorldVisualEvidence(object, context = {}) { const geography=resolveLivingWorldVisualContext(context); const visual=inspectLivingWorldAssetVisual(object,{role:context.role,speciesId:context.speciesId,region:geography.region,mobile:context.mobile,sourcePath:context.sourcePath,assetId:context.assetId}); return Object.freeze({ok:visual.ok,geography,visual,manifest:createLivingWorldVisualManifest(object,{role:context.role,speciesId:context.speciesId,region:geography.region,placement:context.placement,metadata:{id:context.assetId,src:context.sourcePath}}),acceptance:{missingAsset:!(context.sourcePath||geography.assetCandidates.length),sourcePathIsRepositoryAsset:Boolean(context.sourcePath?.startsWith('assets/models/')),semanticCoveragePass:visual.semanticCoverage>=LIVING_WORLD_VISUAL_POLICY.semanticCoverageThreshold,textureCoveragePass:visual.texturedMaterialRatio>=LIVING_WORLD_VISUAL_POLICY.texturedMaterialRatioThreshold,authoredPreserved:shouldPreserveAuthoredVisuals(visual),fallbackApplied:Boolean(object?.userData?.materialRecipe||object?.userData?.editorMaterialRecipe)}}); }
export function mergeVisualContextIntoActorMetadata(object, context = {}) { if(!object)return null; const visual=resolveLivingWorldVisualContext(context); object.userData ||= {}; object.userData.livingWorldVisualContext=visual; object.userData.livingWorldVisualTags=[visual.assetFamily,visual.region,visual.climate.paletteBias].filter(Boolean); object.userData.livingWorldVisualVariant=`${context.seed||0}:${context.assetId||object.userData.assetId||''}:${visual.region}`; return visual; }
