#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = JSON.parse(fs.readFileSync(path.join(ROOT,'godot/terrain-authoring/.terrain3d-proof/g77-near-detail-probe.json'),'utf8'));
const need = (ok,message) => { if (!ok) throw new Error(`[checkSEG77NearDetailContinuity] ${message}`); };
const tintDelta = (a,b) => Math.max(Math.abs(a[11]-b[11]),Math.abs(a[12]-b[12]),Math.abs(a[13]-b[13]));
let maxTintStep = 0, maxRoughStep = 0, maxTintKink = 0, maxRoughKink = 0;
for (let y=0;y<257;y+=1) for (let x=0;x<257;x+=1) {
  const s=p.rows[y][x];
  if (x<256) { const n=p.rows[y][x+1]; maxTintStep=Math.max(maxTintStep,tintDelta(s,n)); maxRoughStep=Math.max(maxRoughStep,Math.abs(s[14]-n[14])); }
  if (y<256) { const n=p.rows[y+1][x]; maxTintStep=Math.max(maxTintStep,tintDelta(s,n)); maxRoughStep=Math.max(maxRoughStep,Math.abs(s[14]-n[14])); }
}
for (const boundary of [64,128,192]) {
  for (let i=0;i<257;i+=1) {
    const a=p.rows[i][boundary-1], b=p.rows[i][boundary], c=p.rows[i][boundary+1];
    maxTintKink=Math.max(maxTintKink,Math.abs(tintDelta(a,b)-tintDelta(b,c))); maxRoughKink=Math.max(maxRoughKink,Math.abs(Math.abs(a[14]-b[14])-Math.abs(b[14]-c[14])));
    const d=p.rows[boundary-1][i], e=p.rows[boundary][i], f=p.rows[boundary+1][i];
    maxTintKink=Math.max(maxTintKink,Math.abs(tintDelta(d,e)-tintDelta(e,f))); maxRoughKink=Math.max(maxRoughKink,Math.abs(Math.abs(d[14]-e[14])-Math.abs(e[14]-f[14])));
  }
}
const blockHash = (x0,y0) => { const h=crypto.createHash('sha256'); for(let y=y0;y<y0+64;y+=1) for(let x=x0;x<x0+64;x+=1){const s=p.rows[y][x]; h.update(Buffer.from([Math.round(s[11]*255),Math.round(s[12]*255),Math.round(s[13]*255),Math.round(s[14]*255)]));} return h.digest('hex'); };
const quadrantHashes=[blockHash(0,0),blockHash(64,0),blockHash(128,0),blockHash(192,0),blockHash(0,64),blockHash(64,64),blockHash(128,64),blockHash(192,64),blockHash(0,128),blockHash(64,128),blockHash(128,128),blockHash(192,128),blockHash(0,192),blockHash(64,192),blockHash(128,192),blockHash(192,192)];
need(new Set(quadrantHashes).size >= 12, `Near Detail repeated 64x64 tiles: ${new Set(quadrantHashes).size}/16 unique`);
need(maxTintStep <= 0.16 && maxRoughStep <= 0.22, `adjacent continuity failed: ${maxTintStep}/${maxRoughStep}`);
need(maxTintKink <= 0.16 && maxRoughKink <= 0.22, `quarter-grid derivative kink too large: ${maxTintKink}/${maxRoughKink}`);
need(p.maxNorthWestTintGuardDelta <= 0.16 && p.maxNorthWestRoughnessGuardDelta <= 0.22, 'north/west owner guard failed');
console.log(`SE_G77_NEAR_DETAIL_CONTINUITY_METRICS=${JSON.stringify({maxTintStep,maxRoughStep,maxTintKink,maxRoughKink,uniqueQuadrants:new Set(quadrantHashes).size,quadrantHashes})}`);
console.log('SE_G77_NEAR_DETAIL_CONTINUITY_OK');
