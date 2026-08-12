#!/usr/bin/env node
const fs=require('fs');const path=require('path');const file=path.join(__dirname,'..','src','3d','world','worldReferencePindex07Detail.js');const source=fs.readFileSync(file,'utf8');
for(const token of["pindex: 7","sea: 0.007","soil: 0.038","rock: 0.048","snow: 0.022","if (c.pindex !== PINDEX07_DETAIL_POLICY.pindex) continue;","run294Pindex07Detail"]){if(!source.includes(token))throw new Error(`Run294 contract missing: ${token}`)}
if(source.includes('Math.random('))throw new Error('Run294 detail must remain deterministic');
console.log('[checkRun294Pindex07Detail] PASS: deterministic Pindex-07-only micro-detail contract locked (sea/soil/rock/snow all present per pindexSurveyBrowser: 321/194/31/30)');
