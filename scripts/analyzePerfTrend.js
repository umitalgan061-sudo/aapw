#!/usr/bin/env node
/**
 * analyzePerfTrend.js — reads `perf_log.csv`'s accumulated per-run samples (GOVERNANCE.md §13's
 * "Hafif Performans Günlüğü": raw data only, no dashboard, accumulated one line per run) and
 * prints a plain-text trend summary: min/max/avg per metric, first-vs-last for the GPU-submission
 * counts (drawCalls/triangles/geometries/textures — expected to move only when real world content
 * changes), and a first-half-vs-second-half drift check for `jsHeapUsedMB` (the one metric expected
 * to be noisy run-to-run without a real leak).
 *
 * This is GOVERNANCE.md §16's deferred "30-commit performans trend grafiği" item — the row-count
 * threshold (30+) was crossed at run 96, not a forcing requirement, just something that became a
 * real, doable sub-task at that point ("ilk uygun boşlukta ele alınabilir"). Picked up here at its
 * first genuinely open run (110 — priority items 1-13 all closed/blocked, no fresher tech-debt
 * candidate, see this run's own priority re-scan). Deliberately a plain-text/table report, not a
 * rendered chart image — see DECISIONS.md ADR-0137 for the reasoning (no charting dependency exists
 * anywhere in this project, and a private single-owner repo with ~50 rows of already-flat data
 * doesn't justify adding one).
 *
 * Never asserts pass/fail and is not wired into `checkSmokeCheckRegistry.js` or the Playwright
 * smoke suite — purely informational, same "measure and record, never gate" role
 * `collectPerfSnapshot.js`'s own header already claims for its sampling half. Run manually:
 * `node scripts/analyzePerfTrend.js`.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOG_PATH = path.join(ROOT, 'perf_log.csv');
const NUMERIC_COLUMNS = ['fps', 'drawCalls', 'triangles', 'geometries', 'textures', 'jsHeapUsedMB'];

/** Columns whose value is only expected to move when real world content changes (new geometry/
 * texture) — not run-to-run noise — so they're reported as "first vs. last", not a drift ratio. */
const CONTENT_COLUMNS = new Set(['drawCalls', 'triangles', 'geometries', 'textures']);

/** How much `jsHeapUsedMB`'s second-half average may exceed its first-half average before it's
 * flagged as worth a closer look for a leak — this run's own engineering judgment, chosen loose
 * enough that the real observed sample-to-sample noise (52 real rows: 257-368MB, a ~35% band
 * around the mean) doesn't itself trip it; not derived from a formal profiling target. */
const HEAP_DRIFT_WARN_RATIO = 1.5;

/** Minimum row count before the first-half/second-half drift comparison is considered meaningful
 * (below this, "halves" are too small to say anything about a trend vs. plain noise). */
const MIN_ROWS_FOR_DRIFT_CHECK = 10;

/**
 * @param {string} text raw CSV file contents (header row + one data row per run).
 * @returns {Array<Record<string, string|number>>}
 */
function parseCsv(text) {
	const lines = text.trim().split('\n');
	const header = lines[0].split(',');
	return lines.slice(1).map((line) => {
		const cells = line.split(',');
		const row = {};
		header.forEach((key, i) => {
			const raw = cells[i];
			row[key] = NUMERIC_COLUMNS.includes(key) && raw !== '' && raw !== undefined ? Number(raw) : raw;
		});
		return row;
	});
}

/**
 * @param {number[]} values
 * @returns {{min: number, max: number, avg: number, count: number}|null}
 */
function summarize(values) {
	const clean = values.filter((v) => Number.isFinite(v));
	if (clean.length === 0) return null;
	return {
		min: Math.min(...clean),
		max: Math.max(...clean),
		avg: clean.reduce((a, b) => a + b, 0) / clean.length,
		count: clean.length,
	};
}

function main() {
	if (!fs.existsSync(LOG_PATH)) {
		console.error(`[analyzePerfTrend] SKIP: ${LOG_PATH} does not exist yet — run collectPerfSnapshot.js first.`);
		process.exit(2);
	}

	const rows = parseCsv(fs.readFileSync(LOG_PATH, 'utf8'));
	if (rows.length < 2) {
		console.log(`[analyzePerfTrend] only ${rows.length} row(s) in perf_log.csv — not enough data for a trend yet.`);
		return;
	}

	const first = rows[0];
	const last = rows[rows.length - 1];
	console.log(`[analyzePerfTrend] ${rows.length} rows: ${first.run} (${first.date}) .. ${last.run} (${last.date})`);
	console.log('');

	for (const column of NUMERIC_COLUMNS) {
		const values = rows.map((r) => r[column]);
		const s = summarize(values);
		if (!s) {
			console.log(`  ${column.padEnd(12)} no numeric data`);
			continue;
		}
		if (CONTENT_COLUMNS.has(column)) {
			const firstValue = values.find(Number.isFinite);
			const lastValue = [...values].reverse().find(Number.isFinite);
			const delta = lastValue - firstValue;
			console.log(
				`  ${column.padEnd(12)} min=${s.min} max=${s.max} avg=${s.avg.toFixed(1)}  first=${firstValue} last=${lastValue} (${delta >= 0 ? '+' : ''}${delta})`,
			);
		} else {
			console.log(`  ${column.padEnd(12)} min=${s.min} max=${s.max} avg=${s.avg.toFixed(1)} (n=${s.count})`);
		}
	}
	console.log('');

	const heapValues = rows.map((r) => r.jsHeapUsedMB).filter(Number.isFinite);
	if (heapValues.length >= MIN_ROWS_FOR_DRIFT_CHECK) {
		const mid = Math.floor(heapValues.length / 2);
		const firstHalf = summarize(heapValues.slice(0, mid));
		const secondHalf = summarize(heapValues.slice(mid));
		const ratio = secondHalf.avg / firstHalf.avg;
		const flagged = ratio >= HEAP_DRIFT_WARN_RATIO;
		console.log(
			`[analyzePerfTrend] jsHeapUsedMB drift check: first-half avg=${firstHalf.avg.toFixed(1)}MB, ` +
				`second-half avg=${secondHalf.avg.toFixed(1)}MB (ratio ${ratio.toFixed(2)}x)`,
		);
		console.log(
			flagged
				? `[analyzePerfTrend] WARN: second-half average is ${ratio.toFixed(2)}x the first-half average ` +
						`(>= ${HEAP_DRIFT_WARN_RATIO}x threshold) — worth a closer look for a leak.`
				: '[analyzePerfTrend] OK: no sustained upward drift beyond expected run-to-run noise.',
		);
	} else {
		console.log(
			`[analyzePerfTrend] only ${heapValues.length} jsHeapUsedMB sample(s) — need >= ${MIN_ROWS_FOR_DRIFT_CHECK} ` +
				'for a meaningful first-half/second-half drift comparison.',
		);
	}
	console.log('');

	const contentChanged = [...CONTENT_COLUMNS].some((col) => {
		const values = rows.map((r) => r[col]).filter(Number.isFinite);
		return values.length > 0 && values[0] !== values[values.length - 1];
	});
	console.log(
		contentChanged
			? '[analyzePerfTrend] GPU-submission counts changed since the first sample (expected — real world content grew).'
			: '[analyzePerfTrend] GPU-submission counts (drawCalls/triangles/geometries/textures) unchanged since the first sample.',
	);
}

main();
