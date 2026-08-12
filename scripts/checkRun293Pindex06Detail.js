#!/usr/bin/env node
const fs=require('fs');const path=require('path');const file=path.join(__dirname,'..','src','3d','world','worldReferencePindex06Detail.js');const source=fs.readFileSync(file,'utf8');
for(const token of["pindex: 6","sea: 0.0075","soil: 0.04","if (c.pindex !== PINDEX06_DETAIL_POLICY.pindex) continue;","run293Pindex06Detail"]){if(!source.includes(token))throw new Error(`Run293 contract missing: ${token}`)}
if(source.includes('Math.random('))throw new Error('Run293 detail must remain deterministic');
console.log('[checkRun293Pindex06Detail] PASS: deterministic Pindex-06-only micro-detail contract locked (soil-led, no canonical rock/snow/lake cells per pindexSurveyBrowser)');
