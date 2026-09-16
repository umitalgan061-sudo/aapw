#!/usr/bin/env node
import {mkdir,writeFile} from 'node:fs/promises';
const OUT='artifacts/persistence/save-repository-contract.matrix';const V=['1','2','3','4'];const B=['local','indexeddb','hybrid','memory'];const P=['tiny','player','world','large'];const C=['none','checksum','schema','size'];const S=['missing','fresh','stale','duplicate'];const E=['normal','autosave','manual','recovery'];
function expected(v,c,s,p){if(c==='checksum'||c==='schema')return'reject-integrity';if(c==='size'||p==='large')return'reject-size';if(s==='missing')return'create-or-not-found';if(s==='stale')return'reject-stale';if(v==='4')return'reject-version';if(v==='1'||v==='2')return'migrate-v3';return'accept-v3'}
function bytes(p){return p==='tiny'?512:p==='player'?8192:p==='world'?65536:900000}
function row(id,v,b,p,c,s,e){return[id,v,b,p,bytes(p),c,s,e,expected(v,c,s,p),b!=='indexeddb'?1:0,v!=='4'?1:0,e==='recovery'?1:0].join('|')}
function build(){const rows=[];let id=1;for(const v of V)for(const b of B)for(const p of P)for(const c of C)for(const s of S)for(const e of E){rows.push(row(String(id).padStart(4,'0'),v,b,p,c,s,e));id++}return rows}
export function validateRows(rows){if(rows.length!==4096)throw Error(`expected 4096 cases, got ${rows.length}`);if(new Set(rows.map(x=>x.split('|')[0])).size!==4096)throw Error('duplicate ids');if(rows.some(x=>x.split('|').length!==12))throw Error('expected 12 fields');return true}
export async function main(){const rows=build();validateRows(rows);await mkdir('artifacts/persistence',{recursive:true});await writeFile(OUT,`# AAPW save repository deterministic contract corpus R1\n# 4 versions x 4 backends x 4 payloads x 4 corruption modes x 4 slot states x 4 events = 4096\n# fields=id|version|backend|payload|payloadBytes|corruption|slot|event|expected|backendReady|versionSupported|recoveryPath\n${rows.join('\n')}\n`);console.log(`wrote ${rows.length} save contract cases`)}
if(import.meta.url===`file://${process.argv[1]}`)await main();
