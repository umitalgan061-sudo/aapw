import {readdir,readFile} from 'node:fs/promises';import {join,relative} from 'node:path';
const ROOT=new URL('../src/3d/',import.meta.url).pathname;
async function walk(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory()){if(e.name!=='vendor')out.push(...await walk(p));}else if(e.isFile())out.push(p);}return out;}
const files=await walk(ROOT);const failures=[];let javascript=0;
for(const file of files){if(!file.endsWith('.js'))continue;javascript++;const rel=relative(ROOT,file).replaceAll('\\\\','/');const name=rel.slice(0,-3).split('/').pop();const source=await readFile(file,'utf8');const owner=await readFile(file.replace(/\\.js$/u,'.ts'),'utf8').catch(()=>null);if(!owner)failures.push(rel+': missing TypeScript owner');if(!source.includes('TypeScript ownership compatibility boundary.'))failures.push(rel+': JavaScript is not compatibility-only');if(!source.includes("import * as __typed from './"+name+".ts';"))failures.push(rel+': typed owner import missing');if(!source.includes('export * from'))failures.push(rel+': named bridge missing');}
if(failures.length){console.error('[typescript-ownership-v14] FAIL '+failures.length);for(const f of failures.slice(0,200))console.error(f);process.exit(1);}
console.log('[typescript-ownership-v14] PASS '+JSON.stringify({javascript,typedOwners:javascript}));
