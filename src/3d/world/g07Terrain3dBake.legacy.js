/**
 * Günbatımı Ustası / G07 compact Three.js runtime payload.
 *
 * The packed data modules are generated from real pinned Terrain3D v1.0.2 CI bake run
 * 31665397412. CI re-bakes and compares the payload before parity can be accepted.
 */
import { DATA as HEIGHTS_BASE64 } from './g07Terrain3dBakeHeights.js';
import { DATA as ROCK_BASE64 } from './g07Terrain3dBakeRock.js';
import { DATA as COLOR_ROUGHNESS_BASE64 } from './g07Terrain3dBakeColor.js';

export const G07_TERRAIN3D_RUNTIME_BAKE = Object.freeze({
	id: 'gunbatimi-ustasi-g07-terrain3d-runtime-bake-2026-08-13-v2',
	artifactRunId: 31665397412,
	artifactId: 9167770008,
	artifactDigestSha256: 'a1d33e7b98cccba28241300a95b18a18da0844a4a9d7620c2f92af7bdd73a3f3',
	canonicalBakeSha256: 'b534ab9c162872d23e6d46577c752f3f44d125fea87be3c83e1b0caa52bd4acd',
	importedTopdownSha256: '1f54dc059b602736f00f1078795c5b75dd9642cb0888af48ed5afe88b571f38f',
	sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
	terrain3dVersion: '1.0.2',
	terrain3dImportSize: 257,
	terrain3dRegionSize: 256,
	terrain3dRegionCount: 4,
	terrain3dBakedVertices: 263169,
	terrain3dSavedRegionFiles: 4,
	gridSize: 33,
	normalizedBounds: Object.freeze({ xMin: 0, xMax: 0.125, yMin: 0.875, yMax: 1 }),
	heightOffsetMeters: -9,
	heightQuantumMeters: 0.0001,
	maxDownsampleHeightErrorMeters: 0.00188423,
	maxDownsampleRockError: 0.0019608,
	maxDownsampleColorError: 0.0019608,
	maxDownsampleRoughnessError: 0.00294118,
	maxTerrain3dRoundtripHeightErrorMeters: 0.00000048,
	maxTerrain3dFractionalHeightErrorMeters: 0.00000110,
	maxTerrain3dBoundaryHeightStepMeters: 0.00296498,
});

function decodeBase64Bytes(encoded) {
	const binary = atob(encoded);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
	return out;
}

let decoded = null;
function decodedBake() {
	if (decoded) return decoded;
	const heightBytes = decodeBase64Bytes(HEIGHTS_BASE64);
	const rock = decodeBase64Bytes(ROCK_BASE64);
	const colorRoughness = decodeBase64Bytes(COLOR_ROUGHNESS_BASE64);
	const sampleCount = G07_TERRAIN3D_RUNTIME_BAKE.gridSize ** 2;
	if (heightBytes.length !== sampleCount * 2 || rock.length !== sampleCount || colorRoughness.length !== sampleCount * 4) {
		throw new Error('G07 Terrain3D packed runtime payload has invalid dimensions');
	}
	const heights = new Float64Array(sampleCount);
	for (let i = 0; i < sampleCount; i += 1) {
		const quantized = heightBytes[i * 2] | (heightBytes[i * 2 + 1] << 8);
		heights[i] = G07_TERRAIN3D_RUNTIME_BAKE.heightOffsetMeters + quantized * G07_TERRAIN3D_RUNTIME_BAKE.heightQuantumMeters;
	}
	decoded = Object.freeze({ heights, rock, colorRoughness });
	return decoded;
}

function query(normalizedX, normalizedY) {
	if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) throw new TypeError('normalized coordinates must be finite');
	const b = G07_TERRAIN3D_RUNTIME_BAKE.normalizedBounds;
	if (normalizedX < b.xMin || normalizedX > b.xMax || normalizedY < b.yMin || normalizedY > b.yMax) return null;
	const size = G07_TERRAIN3D_RUNTIME_BAKE.gridSize;
	const gx = ((normalizedX - b.xMin) / (b.xMax - b.xMin)) * (size - 1);
	const gy = ((normalizedY - b.yMin) / (b.yMax - b.yMin)) * (size - 1);
	const x0 = Math.floor(gx), y0 = Math.floor(gy);
	return { x0, y0, x1: Math.min(x0 + 1, size - 1), y1: Math.min(y0 + 1, size - 1), tx: gx - x0, ty: gy - y0, size };
}

function bilerp(a, b, c, d, tx, ty) {
	return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
}

export function sampleG07Terrain3dBakeNormalized(normalizedX, normalizedY) {
	const q = query(normalizedX, normalizedY);
	if (!q) return null;
	const data = decodedBake();
	const i00 = q.y0 * q.size + q.x0, i10 = q.y0 * q.size + q.x1;
	const i01 = q.y1 * q.size + q.x0, i11 = q.y1 * q.size + q.x1;
	const height = bilerp(data.heights[i00], data.heights[i10], data.heights[i01], data.heights[i11], q.tx, q.ty);
	const rockBlend = bilerp(data.rock[i00], data.rock[i10], data.rock[i01], data.rock[i11], q.tx, q.ty) / 255;
	const color = [];
	for (let channel = 0; channel < 3; channel += 1) {
		color.push(bilerp(data.colorRoughness[i00 * 4 + channel], data.colorRoughness[i10 * 4 + channel], data.colorRoughness[i01 * 4 + channel], data.colorRoughness[i11 * 4 + channel], q.tx, q.ty) / 255);
	}
	const roughness = bilerp(data.colorRoughness[i00 * 4 + 3], data.colorRoughness[i10 * 4 + 3], data.colorRoughness[i01 * 4 + 3], data.colorRoughness[i11 * 4 + 3], q.tx, q.ty) / 255;
	return Object.freeze({ height, rockBlend, color: Object.freeze(color), roughness, snowBlend: 0, roadBlend: 0, pathBlend: 0 });
}

export function getG07Terrain3dPackedPayloadForVerification() {
	return Object.freeze({ heights: HEIGHTS_BASE64, rock: ROCK_BASE64, colorRoughness: COLOR_ROUGHNESS_BASE64 });
}
