import {describe,expect,it} from 'vitest';import {existsSync,readdirSync} from 'node:fs';import {join} from 'node:path';
const root=join(process.cwd(),'src','3d');
function walk(dir){const out=[];for(const e of readdirSync(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory()){if(e.name!=='vendor')out.push(...walk(p));}else if(e.isFile())out.push(p);}return out;}
describe('TypeScript ownership V14',()=>it('covers every non-vendor 3D JS module',()=>{const js=walk(root).filter(f=>f.endsWith('.js'));expect(js.length).toBeGreaterThan(650);for(const file of js)expect(existsSync(file.replace(/\\.js$/u,'.ts'))).toBe(true);}));
