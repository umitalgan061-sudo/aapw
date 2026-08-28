/**
 * Grid-cluster decimation for a `.glb`, in plain Node — no Blender, no three.js, no network.
 *
 * **Why this exists.** The owner's uploads keep arriving as Tripo/Sketchfab sculpts at roughly two
 * million triangles each: `bas_melek.glb` is 1,963,878 across 21 mesh chunks, and nine of its siblings
 * are the same shape. That is about four times the whole 500,000-triangle mobile scene budget for one
 * model, so none of them can enter the world however good they look — and it is also what stops them
 * being rigged, because Mixamo and every other auto-rigger wants a single, sane-density mesh.
 *
 * This removes that half of the blocker. It cannot rig anything: auto-rigging an arbitrary mesh is an
 * open problem, as `src/3d/gameplay/creatureRig.js` already records. What it does is take a model from
 * "no tool will touch this" to "a rigger will".
 *
 * **The algorithm, and why this one.** Vertex clustering: lay a uniform grid over the bounding box,
 * collapse every vertex in a cell to that cell's average position, remap the triangles, and drop the
 * ones that collapsed into a line or a point. It is not the highest-quality decimator — quadric edge
 * collapse preserves silhouettes better — but it is O(n), needs no adjacency structure, cannot fail on
 * the non-manifold geometry these sculpts are full of, and is exactly deterministic, which matters
 * because `scripts/checkSeededRandomPolicy.js` and this project's whole determinism contract say a
 * given input must always give the same output.
 *
 * Normals are averaged per cell and renormalised; UVs take the cell's first-seen value, which is right
 * for a sculpt with a single baked texture and wrong for an atlas — stated rather than hidden. Images,
 * materials and samplers are copied through untouched, so the model keeps its own texture.
 *
 * @module scripts/lib/glbDecimate
 */

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const COMPONENT_TYPES = new Map([
	[5120, { array: Int8Array, size: 1 }],
	[5121, { array: Uint8Array, size: 1 }],
	[5122, { array: Int16Array, size: 2 }],
	[5123, { array: Uint16Array, size: 2 }],
	[5125, { array: Uint32Array, size: 4 }],
	[5126, { array: Float32Array, size: 4 }],
]);
const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** Splits a `.glb` into its glTF JSON and its binary chunk. */
export function parseGlb(buffer) {
	if (buffer.readUInt32LE(0) !== GLB_MAGIC) throw new Error('not a GLB (bad magic)');
	let offset = 12;
	let json = null;
	let bin = null;
	while (offset < buffer.length) {
		const length = buffer.readUInt32LE(offset);
		const type = buffer.readUInt32LE(offset + 4);
		const body = buffer.subarray(offset + 8, offset + 8 + length);
		if (type === CHUNK_JSON) json = JSON.parse(body.toString('utf8'));
		else if (type === CHUNK_BIN) bin = body;
		offset += 8 + length + ((4 - (length % 4)) % 4);
	}
	if (!json) throw new Error('GLB has no JSON chunk');
	return { json, bin: bin ?? Buffer.alloc(0) };
}

/** Reads one accessor out of the binary chunk as a flat typed array, honouring byteStride. */
function readAccessor(json, bin, accessorIndex) {
	const accessor = json.accessors[accessorIndex];
	const spec = COMPONENT_TYPES.get(accessor.componentType);
	if (!spec) throw new Error(`unsupported componentType ${accessor.componentType}`);
	const components = TYPE_COMPONENTS[accessor.type];
	const out = new spec.array(accessor.count * components);
	if (accessor.bufferView === undefined) return out; // Spec-legal: all zeroes.
	const view = json.bufferViews[accessor.bufferView];
	const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
	const stride = view.byteStride ?? components * spec.size;
	for (let i = 0; i < accessor.count; i += 1) {
		const at = base + i * stride;
		for (let c = 0; c < components; c += 1) {
			const byteAt = at + c * spec.size;
			out[i * components + c] = spec.array === Float32Array
				? bin.readFloatLE(byteAt)
				: readInteger(bin, byteAt, spec);
		}
	}
	return out;
}

function readInteger(bin, at, spec) {
	if (spec.array === Uint8Array) return bin.readUInt8(at);
	if (spec.array === Int8Array) return bin.readInt8(at);
	if (spec.array === Uint16Array) return bin.readUInt16LE(at);
	if (spec.array === Int16Array) return bin.readInt16LE(at);
	return bin.readUInt32LE(at);
}

/** Node-local TRS or matrix, as a flat column-major 4x4. */
function nodeMatrix(node) {
	if (node.matrix) return node.matrix.slice();
	const [tx, ty, tz] = node.translation ?? [0, 0, 0];
	const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
	const [sx, sy, sz] = node.scale ?? [1, 1, 1];
	const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
	const xx = qx * x2, xy = qx * y2, xz = qx * z2;
	const yy = qy * y2, yz = qy * z2, zz = qz * z2;
	const wx = qw * x2, wy = qw * y2, wz = qw * z2;
	return [
		(1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
		(xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
		(xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
		tx, ty, tz, 1,
	];
}

function multiply(a, b) {
	const out = new Array(16).fill(0);
	for (let col = 0; col < 4; col += 1) {
		for (let row = 0; row < 4; row += 1) {
			let sum = 0;
			for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[col * 4 + k];
			out[col * 4 + row] = sum;
		}
	}
	return out;
}

const applyPoint = (m, x, y, z) => [
	m[0] * x + m[4] * y + m[8] * z + m[12],
	m[1] * x + m[5] * y + m[9] * z + m[13],
	m[2] * x + m[6] * y + m[10] * z + m[14],
];
const applyDirection = (m, x, y, z) => [
	m[0] * x + m[4] * y + m[8] * z,
	m[1] * x + m[5] * y + m[9] * z,
	m[2] * x + m[6] * y + m[10] * z,
];

/**
 * Flattens every primitive in the file into one world-space vertex/index stream.
 * @returns {{positions: Float32Array, normals: Float32Array, uvs: Float32Array, indices: Uint32Array}}
 */
export function flattenToSingleMesh({ json, bin }) {
	const positions = [];
	const normals = [];
	const uvs = [];
	const indices = [];

	const walk = (nodeIndex, parentMatrix) => {
		const node = json.nodes[nodeIndex];
		const world = multiply(parentMatrix, nodeMatrix(node));
		if (node.mesh !== undefined) {
			for (const primitive of json.meshes[node.mesh].primitives) {
				if (primitive.mode !== undefined && primitive.mode !== 4) continue; // triangles only
				const position = readAccessor(json, bin, primitive.attributes.POSITION);
				const normal = primitive.attributes.NORMAL !== undefined
					? readAccessor(json, bin, primitive.attributes.NORMAL) : null;
				const uv = primitive.attributes.TEXCOORD_0 !== undefined
					? readAccessor(json, bin, primitive.attributes.TEXCOORD_0) : null;
				const base = positions.length / 3;
				const count = position.length / 3;
				for (let i = 0; i < count; i += 1) {
					const [px, py, pz] = applyPoint(world, position[i * 3], position[i * 3 + 1], position[i * 3 + 2]);
					positions.push(px, py, pz);
					if (normal) {
						const [nx, ny, nz] = applyDirection(world, normal[i * 3], normal[i * 3 + 1], normal[i * 3 + 2]);
						normals.push(nx, ny, nz);
					} else normals.push(0, 1, 0);
					uvs.push(uv ? uv[i * 2] : 0, uv ? uv[i * 2 + 1] : 0);
				}
				if (primitive.indices !== undefined) {
					const source = readAccessor(json, bin, primitive.indices);
					for (let i = 0; i < source.length; i += 1) indices.push(base + source[i]);
				} else {
					for (let i = 0; i < count; i += 1) indices.push(base + i);
				}
			}
		}
		for (const child of node.children ?? []) walk(child, world);
	};

	const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
	const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? json.nodes.map((_, i) => i);
	for (const root of roots) walk(root, identity);

	return {
		positions: Float32Array.from(positions),
		normals: Float32Array.from(normals),
		uvs: Float32Array.from(uvs),
		indices: Uint32Array.from(indices),
	};
}

/**
 * Collapses a mesh onto a uniform grid.
 *
 * @param {{positions: Float32Array, normals: Float32Array, uvs: Float32Array, indices: Uint32Array}} mesh
 * @param {number} gridResolution Cells along the longest bounding-box axis. Higher keeps more detail.
 */
export function decimateByGrid(mesh, gridResolution) {
	const { positions, normals, uvs, indices } = mesh;
	let minX = Infinity, minY = Infinity, minZ = Infinity;
	let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
	for (let i = 0; i < positions.length; i += 3) {
		if (positions[i] < minX) minX = positions[i];
		if (positions[i] > maxX) maxX = positions[i];
		if (positions[i + 1] < minY) minY = positions[i + 1];
		if (positions[i + 1] > maxY) maxY = positions[i + 1];
		if (positions[i + 2] < minZ) minZ = positions[i + 2];
		if (positions[i + 2] > maxZ) maxZ = positions[i + 2];
	}
	const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
	const cell = extent / gridResolution;

	const cellOf = new Int32Array(positions.length / 3);
	const byKey = new Map();
	const accum = [];
	for (let v = 0; v < positions.length / 3; v += 1) {
		const gx = Math.floor((positions[v * 3] - minX) / cell);
		const gy = Math.floor((positions[v * 3 + 1] - minY) / cell);
		const gz = Math.floor((positions[v * 3 + 2] - minZ) / cell);
		const key = `${gx}|${gy}|${gz}`;
		let target = byKey.get(key);
		if (target === undefined) {
			target = accum.length;
			byKey.set(key, target);
			accum.push({ x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, u: uvs[v * 2], v: uvs[v * 2 + 1], n: 0 });
		}
		const a = accum[target];
		a.x += positions[v * 3]; a.y += positions[v * 3 + 1]; a.z += positions[v * 3 + 2];
		a.nx += normals[v * 3]; a.ny += normals[v * 3 + 1]; a.nz += normals[v * 3 + 2];
		a.n += 1;
		cellOf[v] = target;
	}

	const outPositions = new Float32Array(accum.length * 3);
	const outNormals = new Float32Array(accum.length * 3);
	const outUvs = new Float32Array(accum.length * 2);
	for (let i = 0; i < accum.length; i += 1) {
		const a = accum[i];
		outPositions[i * 3] = a.x / a.n;
		outPositions[i * 3 + 1] = a.y / a.n;
		outPositions[i * 3 + 2] = a.z / a.n;
		const length = Math.hypot(a.nx, a.ny, a.nz) || 1;
		outNormals[i * 3] = a.nx / length;
		outNormals[i * 3 + 1] = a.ny / length;
		outNormals[i * 3 + 2] = a.nz / length;
		outUvs[i * 2] = a.u;
		outUvs[i * 2 + 1] = a.v;
	}

	// A triangle whose corners landed in fewer than three cells has collapsed to a line or a point.
	const outIndices = [];
	const seen = new Set();
	for (let t = 0; t < indices.length; t += 3) {
		const a = cellOf[indices[t]], b = cellOf[indices[t + 1]], c = cellOf[indices[t + 2]];
		if (a === b || b === c || a === c) continue;
		const sorted = [a, b, c].sort((x, y) => x - y).join('|');
		if (seen.has(sorted)) continue;
		seen.add(sorted);
		outIndices.push(a, b, c);
	}

	return {
		positions: outPositions,
		normals: outNormals,
		uvs: outUvs,
		indices: Uint32Array.from(outIndices),
	};
}
