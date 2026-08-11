#!/usr/bin/env node
const fs=require('fs');const path=require('path');const file=path.join(__dirname,'..','src','3d','world','worldReferencePindex02Detail.js');const source=fs.readFileSync(file,'utf8');
for(const token of["pindex: 2","sea: 0.012","soil: 0.055","rock: 0.065","snow: 0.03","if (c.pindex !== PINDEX02_DETAIL_POLICY.pindex) continue;","run278Pindex02Detail"]){if(!source.includes(token))throw new Error(`Run278 contract missing: ${token}`)}
if(source.includes('Math.random('))throw new Error('Run278 detail must remain deterministic');
console.log('[checkRun278Pindex02Detail] PASS: deterministic Pindex-02-only micro-detail contract locked');
