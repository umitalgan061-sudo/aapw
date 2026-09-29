#!/usr/bin/env node
/* TypeScript ownership compatibility boundary. */
const mod = await import('./checkAssetsManifest.ts');
mod.main();
