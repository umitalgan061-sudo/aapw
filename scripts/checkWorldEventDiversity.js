#!/usr/bin/env node
/**
 * Content-diversity regression guard for the growing FAZ 8 WORLD_EVENTS catalog.
 *
 * The structural catalog guard already protects ids/schema/timeOfDay. This companion guard protects
 * player-facing copy from accidental exact duplication as the catalog grows across autonomous runs:
 * every event title and every event description must remain unique after case/whitespace
 * normalization. Icons/colors are deliberately allowed to repeat because they are visual categories,
 * not player-facing copy identities.
 *
 * Usage:
 *   node scripts/checkWorldEventDiversity.js [worldEventsSourcePath]
 */
import fs from 'node:fs';
import path from 'node:path';

const sourcePath = process.argv[2] || path.join('src', '3d', 'gameplay', 'worldEvents.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const startMarker = 'const WORLD_EVENTS = Object.freeze([';
const start = source.indexOf(startMarker);
const end = source.indexOf('\n]);', start);

if (start < 0 || end < 0) {
  console.error('[world-event-diversity] FAIL: WORLD_EVENTS catalog block not found.');
  process.exit(1);
}

const block = source.slice(start + startMarker.length, end);
const entryLines = block
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.startsWith('{ id:'));

const normalize = (value) => value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr-TR');
const seenTitles = new Map();
const seenDescriptions = new Map();
const errors = [];

for (const [index, line] of entryLines.entries()) {
  const id = line.match(/\bid:\s*'([a-z0-9_]+)'/)?.[1] || `entry-${index + 1}`;
  const title = line.match(/\btitle:\s*'((?:\\'|[^'])*)'/)?.[1]?.replace(/\\'/g, "'");
  const desc = line.match(/\bdesc:\s*'((?:\\'|[^'])*)'/)?.[1]?.replace(/\\'/g, "'");

  if (!title || !desc) continue; // Schema/missing-field failures belong to checkWorldEventCatalog.js.

  const normalizedTitle = normalize(title);
  const normalizedDesc = normalize(desc);
  const priorTitle = seenTitles.get(normalizedTitle);
  const priorDesc = seenDescriptions.get(normalizedDesc);

  if (priorTitle) errors.push(`duplicate title: ${id} matches ${priorTitle} ("${title}")`);
  else seenTitles.set(normalizedTitle, id);

  if (priorDesc) errors.push(`duplicate description: ${id} matches ${priorDesc}`);
  else seenDescriptions.set(normalizedDesc, id);
}

if (errors.length > 0) {
  console.error(`[world-event-diversity] FAIL: ${errors.length} duplicate copy issue(s).`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  `[world-event-diversity] PASS: ${entryLines.length} events have unique normalized titles and descriptions.`,
);
