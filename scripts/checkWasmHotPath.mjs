import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const MATRIX = resolve(ROOT, 'artifacts/wasm-hotpath/validation-matrix.ndjson');
const REQUIRED = ['wasm/Cargo.toml','wasm/src/lib.rs','src/engine-ts/wasmHotPath.ts','src/engine-ts/workerSimulation.ts','scripts/generateWasmHotPathMatrix.mjs'];
const fail = message => { console.error(`[wasm-hotpath] ${message}`); process.exitCode = 1; };
for (const path of REQUIRED) { try { await access(resolve(ROOT,path)); } catch { fail(`missing ${path}`); } }
let matrixText=''; try { matrixText=await readFile(MATRIX,'utf8'); } catch { fail(`missing validation matrix ${MATRIX}`); }
const rows=matrixText.trim().split('\n').filter(Boolean); const seen=new Set(); const counts=new Map(); let malformed=0, boundaryCoverage=0;
for(const row of rows){try{const entry=JSON.parse(row);if(!entry||entry.schema!==1||typeof entry.id!=='number'||typeof entry.group!=='string'||typeof entry.boundary!=='boolean'||!entry.input){malformed++;continue;}if(seen.has(entry.id))malformed++;seen.add(entry.id);counts.set(entry.group,(counts.get(entry.group)??0)+1);if(entry.boundary)boundaryCoverage++;}catch{malformed++;}}
const sourceChars=(await Promise.all(REQUIRED.map(async path=>(await readFile(resolve(ROOT,path),'utf8')).length))).reduce((sum,length)=>sum+length,0);
if(rows.length!==4096)fail(`expected 4096 validation vectors, got ${rows.length}`);if(seen.size!==rows.length)fail('validation IDs are not unique');if(malformed>0)fail(`malformed validation rows: ${malformed}`);for(const group of ['height','lod','distance','spatial','bilinear','quantize'])if((counts.get(group)??0)<680)fail(`coverage unexpectedly low for ${group}: ${counts.get(group)??0}`);if(boundaryCoverage<700)fail(`boundary coverage unexpectedly low: ${boundaryCoverage}`);if(sourceChars<20_000)fail(`implementation unexpectedly small: ${sourceChars} chars`);
console.log(JSON.stringify({contractVersion:1,vectors:rows.length,uniqueIds:seen.size,groupCounts:Object.fromEntries(counts),boundaryCoverage,implementationCharacters:sourceChars,requiredFiles:REQUIRED,status:process.exitCode?'failed':'passed'},null,2));
