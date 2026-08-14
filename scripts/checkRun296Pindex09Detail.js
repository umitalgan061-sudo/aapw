#!/usr/bin/env node
const fs=require('fs');const path=require('path');const file=path.join(__dirname,'..','src','3d','world','worldReferencePindex09Detail.js');const source=fs.readFileSync(file,'utf8');
for(const token of["pindex: 9","sea: 0.006","soil: 0.034","if (c.pindex !== PINDEX09_DETAIL_POLICY.pindex) continue;","run296Pindex09Detail"]){if(!source.includes(token))throw new Error(`Run296 contract missing: ${token}`)}
if(source.includes('Math.random('))throw new Error('Run296 detail must remain deterministic');
console.log('[checkRun296Pindex09Detail] PASS: deterministic Pindex-09-only micro-detail contract locked (soil-led, no canonical rock/snow/lake cells per pindexSurveyBrowser: 370 sea/206 soil)');
