/**
 * Günbatımı Ustası / G27 source-resolution coastline mask.
 *
 * Derived offline from the immutable owner map.png (1536x1024) after verifying
 * SHA-256 20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1.
 * G27 crop: x=384..576, y=896..1024 (192x128 RGB pixels).
 *
 * Deterministic semantic extraction rule for this cell:
 *   land = green >= blue, water = green < blue
 *
 * This rule follows the actual source crop's land/water chroma separation and
 * excludes blue map lettering/water decoration from land. The packed bitset
 * stores LAND=1, WATER=0, row-major, MSB-first. It is authoring/QA data only;
 * no runtime terrain or physics is changed by this module.
 */

export const G27_SOURCE_COAST_POLICY = Object.freeze({
  id: 'gunbatimi-ustasi-g27-source-coast-2026-08-12-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  cropRgbSha256: '2e08d9cc3dfc56f0c3e946018a479873c71e0f37a5e20f22ada81c7995578cbe',
  packedLandMaskSha256: '091b3bc1537781637bc61d2ff243f97bcdab42bc85bb768d18ee017fce8500cd',
  geoCell: 'G27',
  gx: 2,
  gy: 7,
  width: 192,
  height: 128,
  pixelBounds: Object.freeze({ xMin: 384, xMax: 576, yMin: 896, yMax: 1024 }),
  normalizedBounds: Object.freeze({ xMin: 0.25, xMax: 0.375, yMin: 0.875, yMax: 1.0 }),
  extractionRule: 'land iff green >= blue; water iff green < blue',
  landPixels: 5042,
  waterPixels: 19534,
});

const LAND_MASK_BASE64 = [
  'AAAAAAAAAAAAAf8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8AAAAAAAAAAAAAAAAAAAAAYAAAAAAAAP+AAAAAAAAAAAAAAAAA',
  'AAAA8AAAAAAAAP/AAAAAAAAAAAAAAAAAAAAAeAAAAAAAAf/AAAAAAAAAAAAAAAAAAAAAPAAAAAAAD//AwAAAAAAAAAAAAAAAAAAAPwAAAAAAD//g4AAAAAAAAAAAAAAA',
  'AAAAP8AAAAAAH//B4AAAAAAAAAAAAAAAAAAAH8AeAAAAP//BwAAAAAAAAAAAAAAAAAAAH///AAAH//+BAAAAAAAAAAAAAAAAAAAAH///wAAP//+AAAAAAAAAAAAAAAAA',
  'AAAAD///weD///+AAAAAAAAAAAAAAAAAAAAAB///5//////gAAAAAAAAAAAAAAAAAAAAAf/////////gAAAAAAAAAAAAAAAAAAAAAP/////////gAAAAAAAAAAAAAAAA',
  'AAAAAH/////////gAAAAAAAAAAAAAAAAAAAAAH/////////AAAAAAAAAAAAAAAAAAAAAAD////////+AAAAAAAAAAAAAAAAAAAAAAB////////8AAAAAAAAAAAAAAAAA',
  'AAAAAAf///////8AAAAAAAAAAAAAAAAAAAAAAAP///////4AAAAAAAAAAAAAAAAAAAAAAAB///////gAAAAAAAAAAAAAAAAAAAAAAAAP/////8AAAAAAAAAAAAAAAAAA',
  'AAAAAAAD/////wAAAAAAAAAAAAAAAAAAAAAAAAAD///+AAAAAAAAAAAAAAAAAAAAAAAAAAAP//w4AAAA/AAAAAAAAAAAAAAAAAAAAAA///gAAAAA/AAAAAAAAAAAAAAA',
  'ADAAAAB//4AAAAAA/AAAAAAAAAAAAAAAAHAAAAB/8AAAAAAB/AAAAAAAAAAAAAAAAHAAAAB/gAAAAAAD/AAAAAAAAAAAAAAAAHAAAAA/AAAAAAAD/gAAAAAAAAAAAAAA',
  'ADAAAAAeAAAAAAAD/gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAX/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAH//wAAAAAAAAAAAAAAAAAAAAAAAAAAAAP//wAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAf///4AAAAAAAAAAAAAAAAAAAAAAAAAA/////8AAAAAAAAAAAAAAAAAAAAAAAAA4/////+AAAAAAAAAAAAAAAAAAAAAAAAD//////+AAAAAAAAAAAAAA',
  'AAAAAAAAAA///////+AAAAAAAAAAAAAAAAAAAAAAAD///////+AAAAAAAAAAAAAAAAAAAAAAAH///////+AAAAAAAAAAAAAAAAAAAAAAAP////////AAAAAAAAAAAAAA',
  'AAAAAAAAA/////////gAAAAAAAAAAAAAAHAAAAAAD/////////wAAAAAAAAAAAAAAPAAAAAAH/////////wAAAAAAAAAAAAAAfAAAAABf/////////4AAAAAAAAAAAAA',
  'B/AAAAAP//////////wAAAAAAAAAAAAAD+AAAAAf//////////wAAAAAAAAAAAAAD+AAAAAf//////////8AAAAAAAAAAAAAH+AAAAA///////////8AAAAAAAAAAAAA',
  'H8AAAAD///////////+AAAAAAAAAAAAAH8AAAAH////////////AAAAACAAAAAAAD8AAAAP////////////AAAAAOAAAAAAAD4AMAAP////////////gAAAAPAAAAAAA',
  'D4AMAAf////////////8AAAAPAAAAAAAD4AAAA/////////////+AAAAPAAAAAAAD4AAAB//////////////AAAAHAAAAAAADwAAAD//////////////gAAAAAAAAAAA',
  'DwAAAD//////////////gAAAAAAAAAAADwAAAH//////////////gAAAAAAAAAAAH4AAAH//////////////gAAAAAAAAAAAD8AAAH/////////+////gAAAAAAAAAAA',
  'D8AAAf/////////8P///4AAAcAAAAAAAB8AAA//////////4H///+AAA8AAAAAAAB8AAA////////nwAD////gAA8AAAAAAAB4AAA///////+AAAD////wAB8AAAAAAA',
  'DwAAA///////+AAAB////wAf8AAAAAAADwAAAf//////8AAAAf///wP/8AAAAAAAHgAAAP//////wAAAAP//////8AAAAAAAHwAAAP//////AAAAAD//////8AAAAAAA',
  'HwAAAP/////+AAAAAB//////8AAAAAAAHwAAAH/////8AAAAAAf/////4AAAAAAADwAAAH/////AAAAAAAH/////wAAAAAAADwAAAH////+AAAAAAAD/////gAAAAAAA',
  'DwAAAH////+AAAAAAAB/////AAAAAAAAAwAAAH////8AAAAAAAB////+AAAAAAAAAAAAAP////8AAAAAAAAB///wAAAAAAAAAAAAAP////8AAAAAAAAAf/4AAAAAAAAA',
  'AAAAAP////8AAAAAAAAAAPAAAAAAAAAAAAAAAH////8AAAAAAAAAAAAAAAAAAAAAAAAABD////8AMAAAAAAAAAAAAAAAAAAAAAAAAj////8AeAAAAAAAAAAAAAAAAAAA',
  'AAAAAB////4A+AAAAAAAAAAAAAAAAAAAAAAAAB////wB+AAAAAAAAAAAAAAAAAAAAAAAAD////gB+AAAAAAAAAAAAAAAAAAAAAAAAD////gB8AAAAAAAAAAAAAAAAAAA',
  'AAAAAD////AD4AAAAAAAAAAAAAAAAAAAAAAAAB////ADwAAAAAAAAAAAAAAAAAAAAAAAAB////AHwAAAAAAAAAAAAAAAAAAAAAAAAA///+AHgAAAAAAAAAAAAAAAAAAA',
  'AAAAAA///8AHAAAAAAAAAAAAAAAAAAAAAAAAAA///8ADAAAAAAAAAAAAAAAAAAAAAAAAAA///8AAAAAAAAAAAAAAAAAAAAAAAAAAAA///8AAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAA///8AAAAAAAAAAAAAAAAAAAAAAAAAAAA///8AAAAAAAAAAAAAAAAAAAAAAAAAAAA///4AAAAAAAAAAAAAAAAAAAAAAAAAAAAf//4AAAIAAAAAAAAAAAAAAAAAA',
  'AAAAAAD//wAAA8AAAAAAAAAAAAAAAAAAAAAAAAB//gAAA8AAAAAAAAAAAAAAAAAAAAAAAAA/8AAAB8AAAAAAAAAAAAAAAAAAAAAAAAA/4AAAB8AAAAAAAAAAAAAAAAAA',
  'AAAAAAAfwAAAB8AAAAAAAAAAAAAAAAAAAAAAAAAHgAAAB8AAAAAAAAAAAAAAAAAAAAAAAAADAAAAD4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHwAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAPgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8AAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
].join('');

let cachedMaskBytes = null;

function decodeMaskBytes() {
  if (cachedMaskBytes) return cachedMaskBytes;
  if (typeof Buffer !== 'undefined') {
    cachedMaskBytes = Uint8Array.from(Buffer.from(LAND_MASK_BASE64, 'base64'));
    return cachedMaskBytes;
  }
  if (typeof atob === 'function') {
    const decoded = atob(LAND_MASK_BASE64);
    cachedMaskBytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
    return cachedMaskBytes;
  }
  throw new Error('No base64 decoder is available for G27 source coastline mask');
}

export function getG27SourceLandMaskBytes() {
  return decodeMaskBytes().slice();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function isG27SourceLandPixel(pixelX, pixelY) {
  if (!Number.isInteger(pixelX) || !Number.isInteger(pixelY)) {
    throw new TypeError('source pixel coordinates must be integers');
  }
  if (
    pixelX < 0 || pixelX >= G27_SOURCE_COAST_POLICY.width ||
    pixelY < 0 || pixelY >= G27_SOURCE_COAST_POLICY.height
  ) {
    throw new RangeError('source pixel outside G27 crop');
  }
  const index = pixelY * G27_SOURCE_COAST_POLICY.width + pixelX;
  const bytes = decodeMaskBytes();
  return ((bytes[index >> 3] >> (7 - (index & 7))) & 1) === 1;
}

function sampleWaterAtSourcePixel(pixelX, pixelY) {
  const x = clamp(pixelX, 0, G27_SOURCE_COAST_POLICY.width - 1);
  const y = clamp(pixelY, 0, G27_SOURCE_COAST_POLICY.height - 1);
  return isG27SourceLandPixel(x, y) ? 0 : 1;
}

export function isInsideG27Source(normalizedX, normalizedY) {
  const { xMin, xMax, yMin, yMax } = G27_SOURCE_COAST_POLICY.normalizedBounds;
  return normalizedX >= xMin && normalizedX <= xMax && normalizedY >= yMin && normalizedY <= yMax;
}

/**
 * Source-resolution continuous water confidence. At every original G27 source
 * pixel centre this returns exactly the map-derived binary land/water class.
 */
export function sampleG27SourceWaterConfidence(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  if (!isInsideG27Source(normalizedX, normalizedY)) return null;

  const bounds = G27_SOURCE_COAST_POLICY.normalizedBounds;
  const localX = (normalizedX - bounds.xMin) / (bounds.xMax - bounds.xMin);
  const localY = (normalizedY - bounds.yMin) / (bounds.yMax - bounds.yMin);
  const gridX = localX * G27_SOURCE_COAST_POLICY.width - 0.5;
  const gridY = localY * G27_SOURCE_COAST_POLICY.height - 0.5;
  const x0 = Math.floor(gridX);
  const y0 = Math.floor(gridY);
  const tx = gridX - x0;
  const ty = gridY - y0;

  const w00 = sampleWaterAtSourcePixel(x0, y0);
  const w10 = sampleWaterAtSourcePixel(x0 + 1, y0);
  const w01 = sampleWaterAtSourcePixel(x0, y0 + 1);
  const w11 = sampleWaterAtSourcePixel(x0 + 1, y0 + 1);
  const top = w00 + (w10 - w00) * tx;
  const bottom = w01 + (w11 - w01) * tx;
  return clamp(top + (bottom - top) * ty, 0, 1);
}

export function measureG27SourceMask() {
  let landPixels = 0;
  let waterPixels = 0;
  let boundaryEdges = 0;
  let checksum = 2166136261;

  for (let y = 0; y < G27_SOURCE_COAST_POLICY.height; y += 1) {
    for (let x = 0; x < G27_SOURCE_COAST_POLICY.width; x += 1) {
      const land = isG27SourceLandPixel(x, y);
      if (land) landPixels += 1;
      else waterPixels += 1;
      if (x + 1 < G27_SOURCE_COAST_POLICY.width && land !== isG27SourceLandPixel(x + 1, y)) boundaryEdges += 1;
      if (y + 1 < G27_SOURCE_COAST_POLICY.height && land !== isG27SourceLandPixel(x, y + 1)) boundaryEdges += 1;
      checksum ^= land ? 1 : 0;
      checksum = Math.imul(checksum, 16777619) >>> 0;
    }
  }

  return Object.freeze({
    geoCell: 'G27',
    sourcePixels: G27_SOURCE_COAST_POLICY.width * G27_SOURCE_COAST_POLICY.height,
    landPixels,
    waterPixels,
    boundaryEdges,
    checksum,
  });
}
