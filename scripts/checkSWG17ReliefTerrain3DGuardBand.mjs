import { G17_RELIEF_POLICY, sampleG17SeabedHeight, sampleG17SeabedNormal } from '../godot/terrain-authoring/geocells/sw/g17_relief.mjs';
const SAMPLES=513, EPSILON=1/1536;
function need(ok,message){if(!ok)throw new Error(`SW G17 Terrain3D guard band: ${message}`);}
function nd(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);}
function fnv(hash,value){return Math.imul(hash^Math.round((value+32)*100000),16777619)>>>0;}
need(G17_RELIEF_POLICY.geoCell==='G17'&&G17_RELIEF_POLICY.layer==='Relief/Height Character','ownership changed');
need(G17_RELIEF_POLICY.sourceMapSha256==='20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1','map provenance changed');
const b=G17_RELIEF_POLICY.normalizedBounds;
const boundaries=[
 ['west',t=>[b.xMin-EPSILON,b.yMin+(b.yMax-b.yMin)*t],t=>[b.xMin+EPSILON,b.yMin+(b.yMax-b.yMin)*t]],
 ['east',t=>[b.xMax-EPSILON,b.yMin+(b.yMax-b.yMin)*t],t=>[b.xMax+EPSILON,b.yMin+(b.yMax-b.yMin)*t]],
 ['north',t=>[b.xMin+(b.xMax-b.xMin)*t,b.yMin-EPSILON],t=>[b.xMin+(b.xMax-b.xMin)*t,b.yMin+EPSILON]],
];
let maxHeightDelta=0,maxNormalDelta=0,checksum=2166136261,pairs=0;const perBoundary={};
for(const [name,aAt,bAt] of boundaries){let localH=0,localN=0;for(let i=0;i<SAMPLES;i+=1){const t=i/(SAMPLES-1),a=aAt(t),c=bAt(t);const ha=sampleG17SeabedHeight(a[0],a[1]).height,hb=sampleG17SeabedHeight(c[0],c[1]).height,na=sampleG17SeabedNormal(a[0],a[1]),nb=sampleG17SeabedNormal(c[0],c[1]);need(Number.isFinite(ha)&&Number.isFinite(hb)&&na.every(Number.isFinite)&&nb.every(Number.isFinite),`${name} non-finite sample`);need(ha<G17_RELIEF_POLICY.waterCeilingMeters&&hb<G17_RELIEF_POLICY.waterCeilingMeters,`${name} marine ceiling changed`);const dh=Math.abs(ha-hb),dn=nd(na,nb);localH=Math.max(localH,dh);localN=Math.max(localN,dn);maxHeightDelta=Math.max(maxHeightDelta,dh);maxNormalDelta=Math.max(maxNormalDelta,dn);checksum=fnv(fnv(checksum,ha),hb);pairs+=1;}perBoundary[name]={maxHeightDelta:+localH.toFixed(8),maxNormalDelta:+localN.toFixed(8)};}
need(pairs===SAMPLES*boundaries.length,'guard pair count changed');need(maxHeightDelta<=0.05,'high-density guard height discontinuity');need(maxNormalDelta<=0.012,'high-density guard normal discontinuity');
console.log(`SW_G17_RELIEF_GUARD_METRICS=${JSON.stringify({pairs,epsilon:EPSILON,maxHeightDelta:+maxHeightDelta.toFixed(8),maxNormalDelta:+maxNormalDelta.toFixed(8),checksum,perBoundary})}`);
console.log('SW_G17_RELIEF_TERRAIN3D_GUARD_BAND_OK');
