import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  WORLD_REFERENCE_WATER_MASK,
  classifyReferenceWaterCell,
  WORLD_REFERENCE_WATER_BODY_STATS,
} from '../src/3d/world/worldReferenceWaterMask.js';

const outDir = 'artifacts/run263-water-classifier';
await mkdir(outDir, { recursive: true });

const { width, height } = WORLD_REFERENCE_WATER_MASK;
assert.equal(WORLD_REFERENCE_WATER_BODY_STATS.seaCellCount, 4046);
assert.equal(WORLD_REFERENCE_WATER_BODY_STATS.lakeCellCount, 6);

function overviewSvg() {
  const scale = 8;
  const cells = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const kind = classifyReferenceWaterCell(x, y);
      const fill = kind === 'sea' ? '#3b82f6' : kind === 'lake' ? '#06b6d4' : '#d6c7a1';
      cells.push(`<rect x="${x * scale}" y="${y * scale}" width="${scale}" height="${scale}" fill="${fill}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale + 48}" viewBox="0 0 ${width * scale} ${height * scale + 48}"><rect width="100%" height="100%" fill="#111827"/><g>${cells.join('')}</g><text x="12" y="${height * scale + 30}" fill="white" font-family="sans-serif" font-size="18">Run263 semantic overview — sea 4046 / lake 6 / deterministic 96×64 mask</text></svg>`;
}

function lakeDetailSvg() {
  const lakeCells = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) if (classifyReferenceWaterCell(x, y) === 'lake') lakeCells.push([x, y]);
  }
  assert.equal(lakeCells.length, 6);
  const minX = Math.min(...lakeCells.map(([x]) => x)) - 3;
  const maxX = Math.max(...lakeCells.map(([x]) => x)) + 3;
  const minY = Math.min(...lakeCells.map(([, y]) => y)) - 3;
  const maxY = Math.max(...lakeCells.map(([, y]) => y)) + 3;
  const scale = 34;
  const cells = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const inBounds = x >= 0 && x < width && y >= 0 && y < height;
      const kind = inBounds ? classifyReferenceWaterCell(x, y) : 'land';
      const fill = kind === 'sea' ? '#3b82f6' : kind === 'lake' ? '#06b6d4' : '#d6c7a1';
      cells.push(`<rect x="${(x - minX) * scale}" y="${(y - minY) * scale}" width="${scale - 1}" height="${scale - 1}" fill="${fill}"/>`);
    }
  }
  const w = (maxX - minX + 1) * scale;
  const h = (maxY - minY + 1) * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h + 54}" viewBox="0 0 ${w} ${h + 54}"><rect width="100%" height="100%" fill="#111827"/><g>${cells.join('')}</g><text x="10" y="${h + 32}" fill="white" font-family="sans-serif" font-size="18">Run263 enclosed-water detail — cyan cells are lake-classified</text></svg>`;
}

await writeFile(`${outDir}/overview.svg`, overviewSvg());
await writeFile(`${outDir}/lake-detail.svg`, lakeDetailSvg());
console.log('[createRun263WaterClassifierEvidence] PASS: wrote overview.svg and lake-detail.svg');
