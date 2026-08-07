#!/usr/bin/env node
/**
 * Static integrity guard for the FAZ 8 WORLD_EVENTS catalog.
 *
 * It validates the source catalog without importing gameplay code, so it can run in
 * lightweight CI/automation environments before browser smoke tests are available.
 *
 * Usage:
 *   node scripts/checkWorldEventCatalog.js [worldEventsSourcePath]
 *
 * Defaults to src/3d/gameplay/worldEvents.js.
 */
import fs from 'node:fs';
import path from 'node:path';

const sourcePath = process.argv[2] || path.join('src', '3d', 'gameplay', 'worldEvents.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const startMarker = 'const WORLD_EVENTS = Object.freeze([';
const start = source.indexOf(startMarker);
const end = source.indexOf('\n]);', start);

if (start < 0 || end < 0) {
  console.error('[world-event-catalog] FAIL: WORLD_EVENTS catalog block not found.');
  process.exit(1);
}

const block = source.slice(start + startMarker.length, end);
const entryLines = block
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.startsWith('{ id:'));
const errors = [];
const ids = new Set();
let gatedCount = 0;

if (entryLines.length === 0) errors.push('catalog contains no event entries');

for (const [index, line] of entryLines.entries()) {
  const label = `entry ${index + 1}`;
  const id = line.match(/\bid:\s*'([a-z0-9_]+)'/)?.[1];
  if (!id) errors.push(`${label}: missing/invalid snake_case id`);
  else if (ids.has(id)) errors.push(`duplicate id: ${id}`);
  else ids.add(id);

  for (const field of ['icon', 'title', 'desc']) {
    if (!new RegExp(`\\b${field}:\\s*'`).test(line)) {
      errors.push(`${id || label}: missing ${field}`);
    }
  }

  const color = line.match(/\bcolor:\s*'(#[0-9a-fA-F]{6})'/)?.[1];
  if (!color) errors.push(`${id || label}: color must be a 6-digit hex value`);

  const weight = line.match(/\bweight:\s*WEIGHT\.(COMMON|UNCOMMON|RARE)\b/)?.[1];
  if (!weight) {
    errors.push(`${id || label}: weight must use WEIGHT.COMMON/UNCOMMON/RARE`);
  }

  const timeMatch = line.match(/\btimeOfDay:\s*'([^']+)'/);
  if (timeMatch) {
    gatedCount += 1;
    if (timeMatch[1] !== 'day' && timeMatch[1] !== 'night') {
      errors.push(`${id || label}: timeOfDay must be 'day' or 'night'`);
    }
  }
}

const liveCountMatches = [
  ...source.matchAll(/Run\s+\d+\s+live count:\s*(\d+)\s+of\s+(\d+)\s+entries are time-gated/g),
];
if (liveCountMatches.length > 0) {
  const latest = liveCountMatches[liveCountMatches.length - 1];
  const documentedGated = Number(latest[1]);
  const documentedTotal = Number(latest[2]);
  if (documentedGated !== gatedCount || documentedTotal !== entryLines.length) {
    errors.push(
      `latest live-count comment says ${documentedGated}/${documentedTotal}, ` +
      `actual catalog is ${gatedCount}/${entryLines.length}`,
    );
  }
}

if (errors.length > 0) {
  console.error(`[world-event-catalog] FAIL: ${errors.length} catalog issue(s).`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  `[world-event-catalog] PASS: ${entryLines.length} unique events, ` +
  `${gatedCount} time-gated, schema valid.`,
);
