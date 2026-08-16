import assert from 'node:assert/strict';
import { decodeImageIdentity } from './canonicalMapProvenance.mjs';

const png = Buffer.alloc(24);
Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
Buffer.from('IHDR').copy(png, 12);
png.writeUInt32BE(1536, 16);
png.writeUInt32BE(1024, 20);
assert.deepEqual(decodeImageIdentity(png), { encoding: 'png', width: 1536, height: 1024 });

const jpeg = Buffer.from([
  0xff, 0xd8,
  0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0x00, 0x06, 0x00, 0x03,
  0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
  0xff, 0xd9,
]);
assert.deepEqual(decodeImageIdentity(jpeg), { encoding: 'jpeg', height: 1024, width: 1536 });

assert.throws(() => decodeImageIdentity(Buffer.from('not an image')), /Unsupported canonical map image encoding/);
console.log('CANONICAL_MAP_PROVENANCE_TEST_OK');
