#!/usr/bin/env node
const fs=require('fs');const path=require('path');const file=path.join(__dirname,'..','src','3d','world','worldReferencePindex05Detail.js');const source=fs.readFileSync(file,'utf8');
for(const token of["pindex: 5","sea: 0.008","soil: 0.043","if (c.pindex !== PINDEX05_DETAIL_POLICY.pindex) continue;","run285Pindex05Detail"]){if(!source.includes(token))throw new Error(`Run285 contract missing: ${token}`)}
if(source.includes('Math.random('))throw new Error('Run285 detail must remain deterministic');
console.log('[checkRun285Pindex05Detail] PASS: deterministic Pindex-05-only micro-detail contract locked');
