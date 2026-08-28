/**
 * Writes a single-mesh `.glb`, carrying the source model's material and images through unchanged.
 *
 * The companion to `scripts/lib/glbDecimate.mjs`: that one flattens and thins the geometry, this one
 * puts the result back on disk as a file a rigger (or three.js) will open. Deliberately narrow — one
 * mesh, one material, `POSITION`/`NORMAL`/`TEXCOORD_0` and indices — because that is exactly the shape
 * a decimated sculpt has, and a general glTF writer would be a lot of code nobody here needs.
 *
 * Images are copied byte-for-byte out of the source's binary chunk into the new one, so the model
 * keeps its own texture rather than being re-encoded.
 *
 * @module scripts/lib/glbWrite
 */

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const pad4 = (n) => (4 - (n % 4)) % 4;

/**
 * @param {{positions: Float32Array, normals: Float32Array, uvs: Float32Array, indices: Uint32Array}} mesh
 * @param {{json: object, bin: Buffer}} source Parsed source GLB, for its material and images.
 * @returns {Buffer} A complete `.glb`.
 */
export function writeSingleMeshGlb(mesh, source) {
	const { positions, normals, uvs, indices } = mesh;
	const chunks = [];
	const bufferViews = [];
	let byteLength = 0;

	const pushView = (data, target) => {
		const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
		const padding = pad4(byteLength);
		if (padding) { chunks.push(Buffer.alloc(padding)); byteLength += padding; }
		const view = { buffer: 0, byteOffset: byteLength, byteLength: bytes.length };
		if (target !== undefined) view.target = target;
		bufferViews.push(view);
		chunks.push(bytes);
		byteLength += bytes.length;
		return bufferViews.length - 1;
	};

	const bounds = (array, components) => {
		const min = new Array(components).fill(Infinity);
		const max = new Array(components).fill(-Infinity);
		for (let i = 0; i < array.length; i += components) {
			for (let c = 0; c < components; c += 1) {
				if (array[i + c] < min[c]) min[c] = array[i + c];
				if (array[i + c] > max[c]) max[c] = array[i + c];
			}
		}
		return { min, max };
	};

	const positionView = pushView(positions, 34962);
	const normalView = pushView(normals, 34962);
	const uvView = pushView(uvs, 34962);
	const indexView = pushView(indices, 34963);

	const positionBounds = bounds(positions, 3);
	const accessors = [
		{ bufferView: positionView, componentType: 5126, count: positions.length / 3, type: 'VEC3', min: positionBounds.min, max: positionBounds.max },
		{ bufferView: normalView, componentType: 5126, count: normals.length / 3, type: 'VEC3' },
		{ bufferView: uvView, componentType: 5126, count: uvs.length / 2, type: 'VEC2' },
		{ bufferView: indexView, componentType: 5125, count: indices.length, type: 'SCALAR' },
	];

	// Carry the source's images through, byte for byte, and rebuild the tables that point at them.
	const images = [];
	const samplers = source.json.samplers ? source.json.samplers.map((s) => ({ ...s })) : [];
	const textures = [];
	for (const image of source.json.images ?? []) {
		if (image.bufferView === undefined) { images.push({ ...image }); continue; }
		const view = source.json.bufferViews[image.bufferView];
		const start = view.byteOffset ?? 0;
		const bytes = source.bin.subarray(start, start + view.byteLength);
		const padding = pad4(byteLength);
		if (padding) { chunks.push(Buffer.alloc(padding)); byteLength += padding; }
		bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length });
		chunks.push(Buffer.from(bytes));
		byteLength += bytes.length;
		images.push({ bufferView: bufferViews.length - 1, mimeType: image.mimeType ?? 'image/png', name: image.name });
	}
	for (const texture of source.json.textures ?? []) textures.push({ ...texture });

	const sourceMaterial = source.json.materials?.[0];
	const material = sourceMaterial ? JSON.parse(JSON.stringify(sourceMaterial)) : { pbrMetallicRoughness: { baseColorFactor: [0.8, 0.8, 0.8, 1] } };

	const json = {
		asset: { version: '2.0', generator: 'westeros-pwa glbDecimate' },
		scene: 0,
		scenes: [{ nodes: [0] }],
		nodes: [{ mesh: 0, name: 'decimated' }],
		meshes: [{
			primitives: [{
				attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
				indices: 3,
				material: 0,
				mode: 4,
			}],
		}],
		materials: [material],
		accessors,
		bufferViews,
		buffers: [{ byteLength }],
	};
	if (images.length) json.images = images;
	if (textures.length) json.textures = textures;
	if (samplers.length) json.samplers = samplers;

	const binary = Buffer.concat(chunks);
	const jsonText = Buffer.from(JSON.stringify(json), 'utf8');
	const jsonPadded = Buffer.concat([jsonText, Buffer.alloc(pad4(jsonText.length), 0x20)]);
	const binPadded = Buffer.concat([binary, Buffer.alloc(pad4(binary.length), 0)]);

	const header = Buffer.alloc(12);
	header.writeUInt32LE(GLB_MAGIC, 0);
	header.writeUInt32LE(2, 4);
	header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binPadded.length, 8);

	const jsonHeader = Buffer.alloc(8);
	jsonHeader.writeUInt32LE(jsonPadded.length, 0);
	jsonHeader.writeUInt32LE(CHUNK_JSON, 4);

	const binHeader = Buffer.alloc(8);
	binHeader.writeUInt32LE(binPadded.length, 0);
	binHeader.writeUInt32LE(CHUNK_BIN, 4);

	return Buffer.concat([header, jsonHeader, jsonPadded, binHeader, binPadded]);
}
