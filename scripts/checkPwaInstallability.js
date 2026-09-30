#!/usr/bin/env node
/* TypeScript ownership compatibility boundary. */
const mod = await import('./checkPwaInstallability.ts');
mod.main();
