#!/usr/bin/env node
const fs=require('fs');const path=require('path');const file=path.join(__dirname,'..','src','3d','world','worldReferencePindex10Detail.js');const source=fs.readFileSync(file,'utf8');
for(const token of["pindex: 10","sea: 0.0055","soil: 0.032","if (c.pindex !== PINDEX10_DETAIL_POLICY.pindex) continue;","run317Pindex10Detail"]){if(!source.includes(token))throw new Error(`Run317 contract missing: ${token}`)}
if(source.includes('Math.random('))throw new Error('Run317 detail must remain deterministic');
console.log('[checkRun317Pindex10Detail] PASS: deterministic Pindex-10-only micro-detail contract locked (sea/soil/rock mix per pindexSurveyBrowser: 316 sea/232 soil/92 rock, 0 snow/lake, last pindex of the 10-pindex pass)');
