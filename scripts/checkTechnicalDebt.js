#!/usr/bin/env node
/* TypeScript ownership compatibility boundary. */
const mod = await import('./checkTechnicalDebt.ts');
mod.main();
