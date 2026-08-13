#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { G17, sampleG17HydrologyHeight, sampleG17WaterConfidence } from '../godot/terrain-authoring/geocells/sw/g17_hydrology.mjs';
import { sampleReferencePindexQualityV2 } from '../src/3d/world/worldReferenceSurfacePindexes.js';

const OUT_ARG = process.argv.find((arg) => arg.startsWith('--out-dir='));
const OUT_DIR = path.resolve(OUT_ARG ? OUT_ARG.slice('--out-dir='.length) : 'artifacts/sw-g17-hydrology-visual');
fs.mkdirSync(OUT_DIR, { recursive: true });

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); name.copy(out, 4); data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return out;
}
function writePng(filename, width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1); raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r,g,b,a=255] = pixel(x,y); const o = row + 1 + x * 4;
      raw[o]=r; raw[o+1]=g; raw[o+2]=b; raw[o+3]=a;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width,0); ihdr.writeUInt32BE(height,4); ihdr[8]=8; ihdr[9]=6;
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);
  fs.writeFileSync(path.join(OUT_DIR, filename), png);
  return png.length;
}
const palette={sea:[39,78,98],lake:[65,117,132],soil:[128,137,87],rock:[112,105,95],snow:[218,224,222]};
const fullW=1200, fullH=800;
const topBytes=writePng('g17-full-world-topdown.png',fullW,fullH,(x,y)=>{
  const nx=(x+0.5)/fullW, ny=(y+0.5)/fullH;
  const s=sampleReferencePindexQualityV2(nx,ny); const base=palette[s.dominantSurface]||palette.soil;
  const shade=0.9+0.1*s.reliefInfluence;
  let r=Math.round(base[0]*shade),g=Math.round(base[1]*shade),b=Math.round(base[2]*shade);
  const bx=G17.normalizedBounds, inside=nx>=bx.minX&&nx<=bx.maxX&&ny>=bx.minY&&ny<=bx.maxY;
  if(inside){const w=sampleG17WaterConfidence(nx,ny); r=Math.round(r*(1-0.12*w));g=Math.round(g*(1-0.02*w));b=Math.min(255,Math.round(b*(1+0.16*w)));}
  return [r,g,b,255];
});
function perspective(name, far=false){
  const width=960,height=640;
  return writePng(name,width,height,(x,y)=>{
    const u=x/(width-1), v=y/(height-1);
    const nx=G17.normalizedBounds.minX+(G17.normalizedBounds.maxX-G17.normalizedBounds.minX)*u;
    const ny=G17.normalizedBounds.minY+(G17.normalizedBounds.maxY-G17.normalizedBounds.minY)*v;
    const h=sampleG17HydrologyHeight(nx,ny); const w=sampleG17WaterConfidence(nx,ny);
    const horizon=far?0.38:0.22; const depth=Math.max(0,(v-horizon)/(1-horizon));
    const light=far?0.72+0.20*(1-depth):0.58+0.32*(1-depth);
    const relief=Math.max(-8,Math.min(4,h));
    return [Math.round((18+10*w)*light),Math.round((62+30*w)*light),Math.round((90+48*w+relief)*light),255];
  });
}
const nearBytes=perspective('g17-near.png',false); const farBytes=perspective('g17-far.png',true);
let coreMin=1,coreMax=0,coreSamples=0;
for(let y=0;y<65;y+=1)for(let x=0;x<65;x+=1){const nx=G17.normalizedBounds.minX+(G17.normalizedBounds.maxX-G17.normalizedBounds.minX)*x/64;const ny=G17.normalizedBounds.minY+(G17.normalizedBounds.maxY-G17.normalizedBounds.minY)*y/64;const w=sampleG17WaterConfidence(nx,ny);coreMin=Math.min(coreMin,w);coreMax=Math.max(coreMax,w);coreSamples+=1;}
if(coreMin!==1||coreMax!==1) throw new Error(`G17 visual proof expected open sea confidence 1, got ${coreMin}..${coreMax}`);
const metrics={schema:'westeros-g17-hydrology-visual-v1',cell:'G17',layer:'Coast/Hydrology',sourceMapSha256:'20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',referenceContext:'committed-owner-map-pindex-quality-v2',gridVisible:false,coreSamples,waterConfidence:[coreMin,coreMax],nearBytes,farBytes,topdownBytes:topBytes};
fs.writeFileSync(path.join(OUT_DIR,'metrics.json'),`${JSON.stringify(metrics,null,2)}\n`);
console.log(JSON.stringify(metrics)); console.log('SW_G17_HYDROLOGY_VISUAL_OK');
