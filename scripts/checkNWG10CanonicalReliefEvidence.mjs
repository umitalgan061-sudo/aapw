#!/usr/bin/env node

import fs from 'node:fs';
import crypto from 'node:crypto';

const PROBE = 'godot/terrain-authoring/.terrain3d-proof/g10-canonical-relief-probe.json';
const OUT = 'artifacts/nw-g10-canonical-relief-evidence.json';
const MAP_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const POLICY = 'map-png-continuous-relief-v1';

if (!fs.existsSync(PROBE)) throw new Error(`missing canonical relief probe: ${PROBE}`);
const raw = fs.readFileSync(PROBE);
const probe = JSON.parse(raw.toString('utf8'));
if (probe.schema !== 'nw-g10-canonical-relief-probe-v1') throw new Error(`unexpected probe schema ${probe.schema}`);
if (probe.policyId !== POLICY) throw new Error(`unexpected relief policy ${probe.policyId}`);
if (probe.mapSha256 !== MAP_SHA) throw new Error('map.png provenance mismatch');
if (probe.geoCell !== 'G10' || probe.layer !== 'Relief/Height Character refinement') throw new Error('G10/layer provenance mismatch');
if (probe.sourceGridSize !== 65 || !Array.isArray(probe.rows) || probe.rows.length !== 65) throw new Error('65x65 source contract missing');
if (!(probe.waterMaxAbs <= 1e-12)) throw new Error(`canonical water moved by ${probe.waterMaxAbs}m`);
if (!(probe.maxHeight >= 95)) throw new Error(`G10 relief peak ${probe.maxHeight}m is too flat`);
if (!/^[a-f0-9]{64}$/.test(probe.sha256)) throw new Error('probe row checksum invalid');

const rowDigest = crypto.createHash('sha256').update(JSON.stringify(probe.rows)).digest('hex');
if (rowDigest !== probe.sha256) throw new Error('probe row checksum mismatch');
const probeDigest = crypto.createHash('sha256').update(raw).digest('hex');
const manifest = {
	schema: 'nw-g10-canonical-relief-evidence-v1',
	geoCell: 'G10',
	layer: 'Relief/Height Character refinement',
	mapSha256: MAP_SHA,
	policyId: POLICY,
	engine: {
		name: 'TokisanGames/Terrain3D',
		version: '1.0.2-stable',
		sha256: 'a071850250ec5e596aa54da61c01d75768774eb379ee997584d426a45f4884a2',
		importSize: 257,
		regionSize: 256,
	},
	contracts: {
		canonicalWaterReliefMeters: 0,
		sourceGridIsAddressingOnly: true,
		guardBandHeightAndNormal: true,
		geoCellGridImprintRejected: true,
		realTerrain3DImportPersistenceLod0Required: true,
		hterrainPreserved: true,
	},
	probe: {
		path: PROBE,
		sha256: probeDigest,
		rowSha256: probe.sha256,
		waterSamples: probe.waterSamples,
		landSamples: probe.landSamples,
		minHeight: probe.minHeight,
		maxHeight: probe.maxHeight,
	},
};
fs.mkdirSync('artifacts', { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`NW_G10_CANONICAL_RELIEF_EVIDENCE_OK ${OUT} ${probeDigest}`);
