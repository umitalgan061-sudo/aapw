#!/usr/bin/env node
const fs=require('fs');const path=require('path');
const file=path.join(__dirname,'..','experiments','run290','worldReferencePindex05Detail.js');
const source=fs.readFileSync(file,'utf8');
for(const token of["pindex: 5","sea: 0.008","soil: 0.043","rock: 0.043","snow: 0.02","if (c.pindex !== PINDEX05_DETAIL_POLICY.pindex) continue;","run290Pindex05Candidate"]){if(!source.includes(token))throw new Error(`Run290 contract missing: ${token}`)}
if(source.includes('Math.random('))throw new Error('Run290 candidate must remain deterministic');
if(!source.includes("../../src/3d/world/worldReferenceSurfacePindexes.js"))throw new Error('Run290 candidate must consume canonical owner-map semantics');
console.log('[checkRun290Pindex05Detail] PASS: dormant deterministic Pindex-05 candidate contract locked outside src/3d');
