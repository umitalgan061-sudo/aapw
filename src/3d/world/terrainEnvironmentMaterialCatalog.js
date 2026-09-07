export const TERRAIN_ENVIRONMENT_MATERIAL_CATALOG=Object.freeze({
  meadow:Object.freeze({albedo:[0.19,0.23,0.13],secondary:[0.31,0.34,0.18],roughness:[0.74,0.96],normal:0.055}),
  dampMoss:Object.freeze({albedo:[0.08,0.12,0.07],secondary:[0.18,0.21,0.12],roughness:[0.52,0.9],normal:0.075}),
  dryHeath:Object.freeze({albedo:[0.24,0.22,0.15],secondary:[0.35,0.31,0.2],roughness:[0.79,0.98],normal:0.06}),
  ferricEarth:Object.freeze({albedo:[0.3,0.25,0.18],secondary:[0.42,0.34,0.22],roughness:[0.81,0.99],normal:0.075}),
  granite:Object.freeze({albedo:[0.27,0.29,0.3],secondary:[0.43,0.44,0.43],roughness:[0.7,0.98],normal:0.11}),
  quartz:Object.freeze({albedo:[0.52,0.54,0.54],secondary:[0.7,0.69,0.64],roughness:[0.62,0.94],normal:0.125}),
  scree:Object.freeze({albedo:[0.28,0.27,0.24],secondary:[0.4,0.37,0.31],roughness:[0.84,0.995],normal:0.1}),
  snow:Object.freeze({albedo:[0.72,0.76,0.78],secondary:[0.9,0.91,0.9],roughness:[0.5,0.9],normal:0.035}),
  shoreline:Object.freeze({albedo:[0.13,0.15,0.13],secondary:[0.27,0.25,0.2],roughness:[0.42,0.87],normal:0.065}),
});
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
export function materialResponseForContext(substrate,{wetness=0.5,exposure=0.5,detail=0.5}={}){const base=TERRAIN_ENVIRONMENT_MATERIAL_CATALOG[substrate]??TERRAIN_ENVIRONMENT_MATERIAL_CATALOG.meadow;const wet=clamp(wetness),exp=clamp(exposure),d=clamp(detail);const contrast=0.84+exp*0.22+d*0.12;const albedo=base.albedo.map((value)=>clamp(value*contrast*(1-wet*.18)));const secondary=base.secondary.map((value)=>clamp(value*contrast*(1-wet*.12)));return Object.freeze({substrate,albedo,secondary,roughness:lerp(base.roughness[1],base.roughness[0],wet*.72+d*.18),normalGain:clamp(base.normal*(.72+d*.65+exp*.25),.015,.18)});}
export function blendMaterialResponses(from,to,t=.5){const a=TERRAIN_ENVIRONMENT_MATERIAL_CATALOG[from]??TERRAIN_ENVIRONMENT_MATERIAL_CATALOG.meadow;const b=TERRAIN_ENVIRONMENT_MATERIAL_CATALOG[to]??TERRAIN_ENVIRONMENT_MATERIAL_CATALOG.meadow;const x=clamp(t);return Object.freeze({from,to,blend:x,albedo:a.albedo.map((v,i)=>lerp(v,b.albedo[i],x)),secondary:a.secondary.map((v,i)=>lerp(v,b.secondary[i],x)),roughness:[lerp(a.roughness[0],b.roughness[0],x),lerp(a.roughness[1],b.roughness[1],x)],normalGain:lerp(a.normal,b.normal,x)});}
export function validateMaterialCatalog(){const errors=[];for(const [name,entry] of Object.entries(TERRAIN_ENVIRONMENT_MATERIAL_CATALOG)){if(entry.albedo.length!==3)errors.push(`albedo:${name}`);if(entry.secondary.length!==3)errors.push(`secondary:${name}`);if(entry.roughness[0]<.35||entry.roughness[1]>1)errors.push(`roughness:${name}`);if(entry.normal<=0||entry.normal>.2)errors.push(`normal:${name}`);}return Object.freeze({ok:errors.length===0,errors:Object.freeze(errors),count:Object.keys(TERRAIN_ENVIRONMENT_MATERIAL_CATALOG).length});}
