/**
 * Deterministic asset admission queue.
 *
 * The existing AssetLoader owns fetch/decode/disposal. This queue owns only admission order and bounded
 * concurrency bookkeeping. It prevents a burst of ambient world hydration from competing with player,
 * UI or combat-critical downloads. No Promise is created until a caller asks for the next admissions.
 */

import { evaluateAssetRequest, sortAssetRequests, createAssetLoadBudget } from './assetLoadPolicy.js';

const freeze = (value) => {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) freeze(child);
	return value;
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;

export class RuntimeAssetAdmissionQueue {
	constructor({ matrix, budget, now = () => 0, offline = false, saveData = false, storageLimited = false } = {}) {
		this.budget = budget ?? createAssetLoadBudget(matrix);
		this.now = typeof now === 'function' ? now : () => 0;
		this.offline = Boolean(offline);
		this.saveData = Boolean(saveData);
		this.storageLimited = Boolean(storageLimited);
		this.pending = new Map();
		this.active = new Map();
		this.completed = new Map();
		this.failed = new Map();
		this.sequence = 0;
	}

	enqueue(request) {
		const id = String(request?.id ?? `request-${this.sequence + 1}`);
		if (this.pending.has(id) || this.active.has(id)) return false;
		if (this.pending.size >= this.budget.maxDeferredQueue) return false;
		this.pending.set(id, freeze({ ...request, id, enqueuedAt: finiteOr(this.now(), 0), sequence: ++this.sequence }));
		return true;
	}

	enqueueMany(requests) {
		let admitted = 0;
		for (const request of sortAssetRequests(requests ?? [])) admitted += this.enqueue(request) ? 1 : 0;
		return admitted;
	}

	setNetworkState({ offline = this.offline, saveData = this.saveData, storageLimited = this.storageLimited } = {}) {
		this.offline = Boolean(offline);
		this.saveData = Boolean(saveData);
		this.storageLimited = Boolean(storageLimited);
		return this.snapshot();
	}

	nextAdmissions() {
	const capacity = Math.max(0, this.budget.concurrencyLimit - this.active.size);
	if (!capacity) return [];
	const requests = sortAssetRequests([...this.pending.values()]);
	const result = [];
	for (const request of requests) {
		if (result.length >= capacity) break;
		const decision = evaluateAssetRequest(request, {
			activeLoads: this.active.size + result.length,
			concurrencyLimit: this.budget.concurrencyLimit,
			offline: this.offline,
			saveData: this.saveData,
			storageLimited: this.storageLimited,
		});
		if (decision.action === 'admit') {
			result.push(freeze({ request, decision }));
			continue;
		}
		if (decision.action === 'reject') this.failed.set(request.id, freeze({ request, decision, completedAt: finiteOr(this.now(), 0) }));
	}
	for (const admission of result) {
		this.pending.delete(admission.request.id);
		this.active.set(admission.request.id, freeze({ ...admission.request, startedAt: finiteOr(this.now(), 0) }));
	}
	return result;
	}

	complete(id, result = {}) {
		const key = String(id);
		const active = this.active.get(key);
		if (!active) return false;
		this.active.delete(key);
		this.completed.set(key, freeze({ id: key, startedAt: active.startedAt, completedAt: finiteOr(this.now(), 0), result: { ...result } }));
		return true;
	}

	fail(id, error = 'asset-load-failed') {
		const key = String(id);
		const active = this.active.get(key);
		if (!active) return false;
		this.active.delete(key);
		this.failed.set(key, freeze({ id: key, startedAt: active.startedAt, completedAt: finiteOr(this.now(), 0), error: String(error).slice(0, 160) }));
		return true;
	}

	cancel(id) {
		const key = String(id);
		if (this.pending.delete(key)) return true;
		if (this.active.delete(key)) return true;
		return false;
	}

	retryFailed({ maxItems = 16 } = {}) {
		const limit = clamp(Math.round(finiteOr(maxItems, 16)), 1, 128);
		let queued = 0;
		for (const [id, record] of [...this.failed.entries()].slice(0, limit)) {
			if (record.request && this.enqueue(record.request)) {
				this.failed.delete(id);
				queued += 1;
			}
		}
		return queued;
	}

	stats() {
		return freeze({ pending: this.pending.size, active: this.active.size, completed: this.completed.size, failed: this.failed.size, capacity: this.budget.concurrencyLimit });
	}

	snapshot() {
	return freeze({
		version: 1,
		sequence: this.sequence,
		network: { offline: this.offline, saveData: this.saveData, storageLimited: this.storageLimited },
		budget: this.budget,
		stats: this.stats(),
		pendingIds: [...this.pending.keys()].sort(),
		activeIds: [...this.active.keys()].sort(),
		completedIds: [...this.completed.keys()].sort(),
		failedIds: [...this.failed.keys()].sort(),
	});
	}
}

export function createRuntimeAssetAdmissionQueue(options) { return new RuntimeAssetAdmissionQueue(options); }
