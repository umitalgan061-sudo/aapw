#!/usr/bin/env node
const fs=require('fs');const path=require('path');const file=path.join(__dirname,'..','src','3d','world','worldReferencePindex03Detail.js');const source=fs.readFileSync(file,'utf8');
for(const token of["pindex: 3","sea: 0.01","soil: 0.05","rock: 0.06","snow: 0.025","if (c.pindex !== PINDEX03_DETAIL_POLICY.pindex) continue;","run281Pindex03Detail"]){if(!source.includes(token))throw new Error(`Run281 contract missing: ${token}`)}
if(source.includes('Math.random('))throw new Error('Run281 detail must remain deterministic');
console.log('[checkRun281Pindex03Detail] PASS: deterministic Pindex-03-only micro-detail contract locked');
