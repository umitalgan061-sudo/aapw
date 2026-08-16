import crypto from 'node:crypto';
import fs from 'node:fs';

export const CANONICAL_MAP = Object.freeze({
  version: 'map.png-r1',
  sha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  width: 1536,
  height: 1024,
  historicalPath: 'map.png',
});

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

export function decodeImageIdentity(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);

  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    if (bytes.subarray(12, 16).toString('ascii') !== 'IHDR') {
      throw new Error('PNG signature found but IHDR is missing');
    }
    return {
      encoding: 'png',
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    };
  }

  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) break;

      const marker = bytes[offset];
      offset += 1;
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 1 >= bytes.length) break;

      const segmentLength = bytes.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > bytes.length) {
        throw new Error('Malformed JPEG segment');
      }
      if (JPEG_SOF_MARKERS.has(marker)) {
        if (segmentLength < 7) throw new Error('Malformed JPEG SOF segment');
        return {
          encoding: 'jpeg',
          height: bytes.readUInt16BE(offset + 3),
          width: bytes.readUInt16BE(offset + 5),
        };
      }
      offset += segmentLength;
    }
    throw new Error('JPEG SOF dimensions not found');
  }

  throw new Error('Unsupported canonical map image encoding');
}

export function inspectCanonicalMapFile(filePath) {
  const bytes = fs.readFileSync(filePath);
  return {
    path: filePath,
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    ...decodeImageIdentity(bytes),
  };
}

export function assertCanonicalMapFile(filePath, expected = CANONICAL_MAP) {
  const actual = inspectCanonicalMapFile(filePath);
  if (actual.sha256 !== expected.sha256) {
    throw new Error(`canonical map SHA256 mismatch: ${actual.sha256}`);
  }
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new Error(`canonical map dimensions mismatch: ${actual.width}x${actual.height}`);
  }
  return { ...actual, version: expected.version };
}

export function findCanonicalMapFile(paths = ['map.png', 'resimler/map.png', 'public/map.png']) {
  for (const filePath of paths) {
    if (fs.existsSync(filePath)) return assertCanonicalMapFile(filePath);
  }
  throw new Error(`canonical map file not tracked at any expected path: ${paths.join(', ')}`);
}
