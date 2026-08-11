#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const workflowPath = path.resolve('.github/workflows/run283-final-head-governance.yml');
if (!fs.existsSync(workflowPath)) throw new Error('Run283 final-head governance workflow is missing');
const source = fs.readFileSync(workflowPath, 'utf8');

const required = [
  'name: Run 283 Final Head Governance Gate',
  'branches-ignore: [main]',
  'pull_request:',
  'branches: [main]',
  'permissions:',
  'contents: read',
  'git fetch origin main',
  'node scripts/checkAdditiveOnlyDiff.js "$BASE_SHA" HEAD',
  'node scripts/checkSeededRandomPolicy.js',
  'node scripts/checkAssetsManifest.js',
  'node scripts/checkServiceWorkerCache.js',
  'node scripts/checkPwaInstallability.js',
  'node scripts/checkSmokeCheckRegistry.js',
  'node scripts/checkWorldReferenceMap.js',
  'node scripts/checkWorldReferenceWaterMask.js',
  'node scripts/checkWorldReferenceAlignment.js',
  'node scripts/checkWorldReferenceHydrologyExtent.js',
  'node scripts/checkMobilePerfBudget.js',
  'node scripts/terrainSeatSafetyCheck.js',
  'node scripts/roadNetworkSafetyCheck.js',
  'node scripts/analyzePerfTrend.js',
  'node scripts/checkTechnicalDebt.js',
  'node scripts/smokeTestGame3D.js',
  'Final exact-main concurrency and additive-only gate',
];

for (const token of required) {
  if (!source.includes(token)) throw new Error(`Run283 governance contract missing: ${token}`);
}

if (/contents:\s*write/.test(source)) throw new Error('Run283 governance gate must remain read-only');
if (/git\s+push\b/.test(source)) throw new Error('Run283 governance gate must never mutate/push a branch');

const fetchCount = (source.match(/git fetch origin main/g) || []).length;
if (fetchCount < 2) throw new Error('Run283 must check remote main at both entry and final concurrency gates');

console.log('[checkRun283FinalHeadGovernance] PASS: read-only final-head governance contract locked');
