import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root=process.cwd();
for (const path of ['src/3d/modern/platformRuntimeV4.ts','tests/nextgen/platformRuntimeV4.test.ts','docs/PLATFORM_RUNTIME_V4.md']) if (!(await readFile(resolve(root,path),'utf8')).trim()) throw new Error(`empty:${path}`);
const source=await readFile(resolve(root,'src/3d/modern/platformRuntimeV4.ts'),'utf8');
for (const symbol of ['detectPlatformSignals','resolvePlatformPolicy','platformFingerprint']) if (!source.includes(`function ${symbol}`)) throw new Error(`missing:${symbol}`);
console.log('platform-runtime-v4:ok');
