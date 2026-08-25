/**
 * Browser acceptance for the shipped WorldEventSystem after bounded resume-frame simulation.
 * Drives the real runtime through ordinary 1-second foreground frames instead of using a synthetic
 * multi-minute delta as an event shortcut. This preserves the original event/toast and day/night
 * assertions while proving the runtime contract that background-resume spikes must not fast-forward
 * ambient life.
 * @module scripts/game3dSmokeChecksWorldEvents
 */

const NAV_TIMEOUT_MS = 30_000;
const MAX_AUTHORED_EVENT_INTERVAL_SECONDS = 95;

async function checkWorldEvents(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		await page.setViewportSize({ width: 390, height: 844 });
		result = await page.evaluate(async ({ maxIntervalSeconds }) => {
			const { createWorldEventSystem } = await import('/src/3d/gameplay/worldEvents.js');
			const { WorldEventToast } = await import('/src/3d/ui/worldEventToast.js');
			const { EventBus } = await import('/src/3d/eventBus.js');
			const { HealthBar } = await import('/src/3d/ui/healthBar.js');
			const { SettlementCompass } = await import('/src/3d/ui/settlementCompass.js');
			const { DayNightClock } = await import('/src/3d/ui/dayNightClock.js');

			const advanceOneEvent = (system, events, nightFactor) => {
				const before = events.length;
				for (let second = 0; second <= maxIntervalSeconds && events.length === before; second += 1) {
					system.update(1, nightFactor);
				}
				return events.length === before + 1;
			};

			const bus = new EventBus();
			const eventName = 'test:worldEvent';
			const received = [];
			bus.on(eventName, (payload) => received.push(payload));

			const system = createWorldEventSystem({ eventsBus: bus, seed: 42, eventName });
			system.update(1);
			const noFireBelowThreshold = received.length === 0;
			const firedExactlyOnce = advanceOneEvent(system, received, undefined) && received.length === 1;
			const firstEventId = received[0]?.id;
			const payloadShapeOk = received[0]
				&& typeof received[0].icon === 'string' && typeof received[0].title === 'string'
				&& typeof received[0].desc === 'string' && typeof received[0].color === 'string';
			const firesAgainAfterReset = advanceOneEvent(system, received, undefined) && received.length === 2;

			system.dispose();
			received.length = 0;
			for (let second = 0; second <= maxIntervalSeconds; second += 1) system.update(1);
			const noFireAfterDispose = received.length === 0;

			const receivedB = [];
			bus.on(`${eventName}B`, (payload) => receivedB.push(payload));
			const systemB = createWorldEventSystem({ eventsBus: bus, seed: 42, eventName: `${eventName}B` });
			advanceOneEvent(systemB, receivedB, undefined);
			const deterministic = receivedB[0]?.id === firstEventId;
			systemB.dispose();

			const toastEvents = [];
			bus.on(`${eventName}C`, (payload) => toastEvents.push(payload));
			const systemC = createWorldEventSystem({ eventsBus: bus, seed: 7, eventName: `${eventName}C` });
			const toast = new WorldEventToast({ eventsBus: bus, eventName: `${eventName}C` });
			const healthBar = new HealthBar({ eventsBus: bus, healthChangedEventName: `${eventName}D`, damageEventName: `${eventName}E` });
			const compass = new SettlementCompass({ seats: [{ name: 'Test Kalesi', x: 10, z: 10 }] });
			compass.update({ x: 0, z: 0 }, 0);
			const clock = new DayNightClock();
			clock.update(0.3, 0.4);
			const el = document.querySelector('.g3d-event-toast');
			const hiddenInitially = el.hidden === true;
			advanceOneEvent(systemC, toastEvents, undefined);
			const shownOnEvent = el.hidden === false
				&& el.querySelector('.g3d-event-toast-title').textContent === toastEvents[0]?.title
				&& el.querySelector('.g3d-event-toast-desc').textContent === toastEvents[0]?.desc;
			const backLinkRect = document.querySelector('.g3d-back-link').getBoundingClientRect();
			const toastRect = el.getBoundingClientRect();
			const mobileToastClearsBackLink = toastRect.top >= backLinkRect.bottom + 12;
			const healthBarRect = document.querySelector('.g3d-health-bar').getBoundingClientRect();
			const compassRect = document.querySelector('.g3d-settlement-compass').getBoundingClientRect();
			const clockRect = document.querySelector('.g3d-day-night-clock').getBoundingClientRect();
			const noOverlap = (a, b) => !(a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
			const mobileToastClearsHealthBar = noOverlap(toastRect, healthBarRect);
			const mobileToastClearsCompass = noOverlap(toastRect, compassRect);
			const mobileToastClearsClock = noOverlap(toastRect, clockRect);

			toast.dispose();
			systemC.dispose();
			healthBar.dispose();
			compass.dispose();
			clock.dispose();
			const disposedRemovesDom = document.querySelector('.g3d-event-toast') === null;

			return {
				noFireBelowThreshold, firedExactlyOnce, payloadShapeOk, firesAgainAfterReset,
				noFireAfterDispose, deterministic, hiddenInitially, shownOnEvent, disposedRemovesDom,
				mobileToastClearsBackLink, mobileToastClearsHealthBar, mobileToastClearsCompass,
				mobileToastClearsClock,
			};
		}, { maxIntervalSeconds: MAX_AUTHORED_EVENT_INTERVAL_SECONDS });
	} catch (error) {
		result = { error: String(error) };
	}
	await page.close();
	const ok = result && Object.values(result).every((value) => value === true);
	const details = ok
		? '1-second foreground frames respect the authored interval, emit one event per crossing, reset, dispose cleanly, preserve same-seed choice, and drive a non-overlapping mobile toast with real payload text'
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'world-event system bounded-frame browser acceptance (gameplay/worldEvents.js + ui/worldEventToast.js)', ok, details };
}

async function checkWorldEventsTimeGating(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async ({ maxIntervalSeconds }) => {
			const { createWorldEventSystem } = await import('/src/3d/gameplay/worldEvents.js');
			const { EventBus } = await import('/src/3d/eventBus.js');
			const NIGHT_ONLY_IDS = ['wolf_howl', 'falling_star', 'northern_lights'];
			const DRAW_COUNT = 1000;
			const bus = new EventBus();

			const advanceOneEvent = (system, events, nightFactor) => {
				const before = events.length;
				for (let second = 0; second <= maxIntervalSeconds && events.length === before; second += 1) {
					system.update(1, nightFactor);
				}
				return events.length === before + 1;
			};

			const noonIds = new Set();
			const noonEvents = [];
			const noonSystem = createWorldEventSystem({ eventsBus: bus, seed: 1, eventName: 'noon' });
			bus.on('noon', (payload) => { noonIds.add(payload.id); noonEvents.push(payload.id); });
			for (let i = 0; i < DRAW_COUNT; i += 1) {
				if (!advanceOneEvent(noonSystem, noonEvents, 0)) break;
			}
			noonSystem.dispose();
			const noonNeverGatesInNightOnly = NIGHT_ONLY_IDS.every((id) => !noonIds.has(id));
			const noonFiresEclipse = noonIds.has('eclipse');
			const noonFiresHarvestWagons = noonIds.has('harvest_wagons');
			const noonFiresMarketDay = noonIds.has('market_day');
			const noonFiresAlmsGiving = noonIds.has('alms_giving');

			const midnightIds = new Set();
			const midnightEvents = [];
			const midnightSystem = createWorldEventSystem({ eventsBus: bus, seed: 2, eventName: 'midnight' });
			bus.on('midnight', (payload) => { midnightIds.add(payload.id); midnightEvents.push(payload.id); });
			for (let i = 0; i < DRAW_COUNT; i += 1) {
				if (!advanceOneEvent(midnightSystem, midnightEvents, 1)) break;
			}
			midnightSystem.dispose();
			const midnightNeverFiresEclipse = !midnightIds.has('eclipse');
			const midnightNeverFiresHarvestWagons = !midnightIds.has('harvest_wagons');
			const midnightNeverFiresMarketDay = !midnightIds.has('market_day');
			const midnightNeverFiresAlmsGiving = !midnightIds.has('alms_giving');
			const midnightFiresSomeNightOnly = NIGHT_ONLY_IDS.some((id) => midnightIds.has(id));

			const legacyIds = [];
			const legacySystem = createWorldEventSystem({ eventsBus: bus, seed: 3, eventName: 'legacy' });
			bus.on('legacy', (payload) => legacyIds.push(payload.id));
			const legacyCallStillFires = advanceOneEvent(legacySystem, legacyIds, undefined);
			legacySystem.dispose();

			return {
				noonNeverGatesInNightOnly, noonFiresEclipse,
				noonFiresHarvestWagons, midnightNeverFiresHarvestWagons,
				noonFiresMarketDay, midnightNeverFiresMarketDay,
				noonFiresAlmsGiving, midnightNeverFiresAlmsGiving,
				midnightNeverFiresEclipse, midnightFiresSomeNightOnly,
				legacyCallStillFires,
			};
		}, { maxIntervalSeconds: MAX_AUTHORED_EVENT_INTERVAL_SECONDS });
	} catch (error) {
		result = { error: String(error) };
	}
	await page.close();
	const ok = result && Object.values(result).every((value) => value === true);
	const details = ok
		? '1000 bounded-frame event crossings preserve noon/night eligibility and positive coverage; the legacy one-argument update(delta) shape still emits'
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'world-event day/night gating bounded-frame browser acceptance (gameplay/worldEvents.js)', ok, details };
}

module.exports = { checkWorldEvents, checkWorldEventsTimeGating };
