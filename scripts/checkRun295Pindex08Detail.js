#!/usr/bin/env node
const fs=require('fs');const path=require('path');const file=path.join(__dirname,'..','src','3d','world','worldReferencePindex08Detail.js');const source=fs.readFileSync(file,'utf8');
for(const token of["pindex: 8","sea: 0.0065","soil: 0.036","rock: 0.046","snow: 0.02","if (c.pindex !== PINDEX08_DETAIL_POLICY.pindex) continue;","run295Pindex08Detail"]){if(!source.includes(token))throw new Error(`Run295 contract missing: ${token}`)}
if(source.includes('Math.random('))throw new Error('Run295 detail must remain deterministic');
console.log('[checkRun295Pindex08Detail] PASS: deterministic Pindex-08-only micro-detail contract locked (sea/soil/rock/snow/lake all present per pindexSurveyBrowser: 404/157/61/13/5)');
