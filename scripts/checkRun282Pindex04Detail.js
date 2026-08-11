#!/usr/bin/env node
const fs=require('fs');const path=require('path');const file=path.join(__dirname,'..','src','3d','world','worldReferencePindex04Detail.js');const source=fs.readFileSync(file,'utf8');
for(const token of["pindex: 4","sea: 0.009","soil: 0.045","if (c.pindex !== PINDEX04_DETAIL_POLICY.pindex) continue;","run282Pindex04Detail"]){if(!source.includes(token))throw new Error(`Run282 contract missing: ${token}`)}
if(source.includes('Math.random('))throw new Error('Run282 detail must remain deterministic');
console.log('[checkRun282Pindex04Detail] PASS: deterministic Pindex-04-only micro-detail contract locked');
