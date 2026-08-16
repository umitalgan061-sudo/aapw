/**
 * Small DOM quest journal projected from `gameplay/questSystem.js` snapshots.
 *
 * This is intentionally a view only: it owns no quest state, rewards, persistence, dialogue, or
 * input framework. It listens to the shared quest events, asks the quest system for a fresh plain
 * snapshot, and renders accepted/completed quests. The browser-only singleton is created by
 * `gameplay/interaction.js`; headless imports remain safe because this module touches the DOM only
 * when `QuestJournal` is constructed.
 * @module ui/questJournal
 */

const STYLE_ID = 'g3d-quest-journal-style';
const VISIBLE_STATUSES = new Set(['active', 'ready', 'completed']);

/**
 * Pure projection used by both the DOM view and headless contract tests.
 * Locked/available quests stay hidden so the journal never spoils content before the player has
 * accepted it; completed quests remain visible as a lightweight play-history trail.
 * @param {unknown} snapshot
 */
export function buildQuestJournalModel(snapshot) {
	const source = Array.isArray(snapshot) ? snapshot : [];
	const visibleQuests = source
		.filter((quest) => quest && VISIBLE_STATUSES.has(quest.status))
		.map((quest) => {
			const objectives = Array.isArray(quest.objectives)
				? quest.objectives.map((objective) => ({
					id: objective?.id ?? '',
					label: objective?.label ?? '',
					completed: objective?.completed === true,
				}))
				: [];
			return {
				id: quest.id ?? '',
				title: quest.title ?? 'İsimsiz görev',
				description: quest.description ?? '',
				status: quest.status,
				objectives,
				completedObjectiveCount: objectives.filter((objective) => objective.completed).length,
				reward: quest.reward && typeof quest.reward === 'object' ? { ...quest.reward } : null,
				rewardGranted: quest.rewardGranted === true,
			};
		});

	const activeCount = visibleQuests.filter((quest) => quest.status === 'active' || quest.status === 'ready').length;
	const readyCount = visibleQuests.filter((quest) => quest.status === 'ready').length;
	const completedCount = visibleQuests.filter((quest) => quest.status === 'completed').length;
	return {
		activeCount,
		readyCount,
		completedCount,
		visibleCount: visibleQuests.length,
		quests: visibleQuests,
	};
}

function isEditableTarget(target) {
	if (!target || typeof target !== 'object') return false;
	const tagName = String(target.tagName ?? '').toLowerCase();
	return target.isContentEditable === true || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

function ensureStyles(doc) {
	if (doc.getElementById(STYLE_ID)) return;
	const style = doc.createElement('style');
	style.id = STYLE_ID;
	style.textContent = `
.g3d-quest-journal-button {
  position: fixed;
  top: max(58px, calc(env(safe-area-inset-top, 0px) + 58px));
  left: max(12px, env(safe-area-inset-left, 0px));
  z-index: 22;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid rgba(200, 150, 10, 0.58);
  border-radius: 8px;
  background: rgba(10, 6, 2, 0.84);
  color: #e8d4a0;
  font: 700 13px/1.2 Georgia, 'Times New Roman', serif;
  cursor: pointer;
  touch-action: manipulation;
  backdrop-filter: blur(6px);
}
.g3d-quest-journal-button[data-ready='true'] {
  border-color: rgba(159, 207, 138, 0.9);
  color: #c9efb7;
}
.g3d-quest-journal-button:focus-visible,
.g3d-quest-journal-close:focus-visible {
  outline: 2px solid #e8d4a0;
  outline-offset: 2px;
}
.g3d-quest-journal-panel {
  position: fixed;
  top: max(108px, calc(env(safe-area-inset-top, 0px) + 108px));
  left: max(12px, env(safe-area-inset-left, 0px));
  z-index: 22;
  width: min(360px, calc(100vw - 24px));
  max-height: min(470px, calc(100vh - 132px));
  padding: 14px;
  overflow-y: auto;
  border: 1px solid rgba(200, 150, 10, 0.55);
  border-radius: 10px;
  background: rgba(10, 6, 2, 0.93);
  color: #e8d4a0;
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.42);
  backdrop-filter: blur(8px);
}
.g3d-quest-journal-panel[hidden] { display: none; }
.g3d-quest-journal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
}
.g3d-quest-journal-title {
  margin: 0;
  color: #c8960a;
  font: 700 18px/1.2 Georgia, 'Times New Roman', serif;
}
.g3d-quest-journal-close {
  width: 44px;
  height: 44px;
  margin: -10px -8px -8px 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #e8d4a0;
  font-size: 22px;
  cursor: pointer;
  touch-action: manipulation;
}
.g3d-quest-journal-close:active { background: rgba(200, 150, 10, 0.16); }
.g3d-quest-journal-summary {
  margin: 0 0 12px;
  color: rgba(232, 212, 160, 0.72);
  font-size: 12px;
}
.g3d-quest-journal-empty {
  margin: 4px 0 2px;
  color: rgba(232, 212, 160, 0.78);
  font-size: 13px;
  line-height: 1.45;
}
.g3d-quest-journal-list {
  display: grid;
  gap: 10px;
}
.g3d-quest-journal-card {
  padding: 11px 12px;
  border: 1px solid rgba(200, 150, 10, 0.28);
  border-radius: 8px;
  background: rgba(40, 27, 8, 0.36);
}
.g3d-quest-journal-card[data-status='ready'] { border-color: rgba(159, 207, 138, 0.7); }
.g3d-quest-journal-card[data-status='completed'] { opacity: 0.72; }
.g3d-quest-journal-status {
  display: block;
  margin-bottom: 3px;
  color: #c8960a;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.g3d-quest-journal-card[data-status='ready'] .g3d-quest-journal-status { color: #9fcf8a; }
.g3d-quest-journal-name {
  margin: 0 0 5px;
  color: #f0d9a0;
  font: 700 15px/1.25 Georgia, 'Times New Roman', serif;
}
.g3d-quest-journal-description {
  margin: 0 0 8px;
  color: rgba(232, 212, 160, 0.82);
  font-size: 12px;
  line-height: 1.4;
}
.g3d-quest-journal-objectives {
  display: grid;
  gap: 5px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.g3d-quest-journal-objective {
  display: flex;
  gap: 7px;
  align-items: flex-start;
  color: #e8d4a0;
  font-size: 12px;
  line-height: 1.35;
}
.g3d-quest-journal-objective[data-complete='true'] { color: rgba(159, 207, 138, 0.86); }
.g3d-quest-journal-objective-mark { width: 14px; flex: 0 0 14px; text-align: center; }
.g3d-quest-journal-reward {
  margin: 8px 0 0;
  color: rgba(228, 198, 106, 0.9);
  font-size: 11px;
}
@media (max-width: 600px) {
  .g3d-quest-journal-panel {
    max-height: min(52vh, calc(100vh - 132px));
  }
}
`;
	(doc.head ?? doc.body).appendChild(style);
}

function statusLabel(status) {
	if (status === 'ready') return 'Teslime hazır';
	if (status === 'completed') return 'Tamamlandı';
	return 'Aktif';
}

/** Browser view that remains a pure projection of quest-system state. */
export class QuestJournal {
	/**
	 * @param {object} options
	 * @param {{on: (eventName: string, handler: Function) => (() => void)}} options.eventsBus
	 * @param {Record<string, string>} options.eventNames QUEST_EVENTS map.
	 * @param {() => unknown[]} options.snapshotProvider
	 * @param {HTMLElement} [options.container]
	 * @param {Window|null} [options.keyboardTarget]
	 */
	constructor({
		eventsBus,
		eventNames,
		snapshotProvider,
		container = document.body,
		keyboardTarget = globalThis.window ?? null,
	}) {
		if (!eventsBus || typeof eventsBus.on !== 'function') throw new TypeError('QuestJournal requires eventsBus.on().');
		if (typeof snapshotProvider !== 'function') throw new TypeError('QuestJournal requires snapshotProvider().');

		this._snapshotProvider = snapshotProvider;
		this._keyboardTarget = keyboardTarget;
		this._disposed = false;
		this._doc = container.ownerDocument ?? document;
		ensureStyles(this._doc);

		this._button = this._doc.createElement('button');
		this._button.type = 'button';
		this._button.className = 'g3d-quest-journal-button';
		this._button.setAttribute('aria-expanded', 'false');

		this._panel = this._doc.createElement('aside');
		this._panel.id = 'g3d-quest-journal-panel';
		this._panel.className = 'g3d-quest-journal-panel';
		this._panel.hidden = true;
		this._panel.setAttribute('aria-label', 'Görev günlüğü');
		this._button.setAttribute('aria-controls', this._panel.id);

		const header = this._doc.createElement('div');
		header.className = 'g3d-quest-journal-header';
		const title = this._doc.createElement('h2');
		title.className = 'g3d-quest-journal-title';
		title.textContent = 'Görev Günlüğü';
		this._closeButton = this._doc.createElement('button');
		this._closeButton.type = 'button';
		this._closeButton.className = 'g3d-quest-journal-close';
		this._closeButton.setAttribute('aria-label', 'Görev günlüğünü kapat');
		this._closeButton.textContent = '×';
		header.append(title, this._closeButton);
		this._panel.appendChild(header);

		this._summary = this._doc.createElement('p');
		this._summary.className = 'g3d-quest-journal-summary';
		this._panel.appendChild(this._summary);
		this._list = this._doc.createElement('div');
		this._list.className = 'g3d-quest-journal-list';
		this._panel.appendChild(this._list);
		container.append(this._button, this._panel);

		this._onToggle = () => this.setOpen(this._panel.hidden);
		this._onClose = () => this.setOpen(false);
		this._onKeyDown = (event) => {
			if (event?.code !== 'KeyJ' || event.repeat || event.defaultPrevented || isEditableTarget(event.target)) return;
			this.setOpen(this._panel.hidden);
		};
		this._onPageHide = () => this.dispose();
		this._button.addEventListener('click', this._onToggle);
		this._closeButton.addEventListener('click', this._onClose);
		this._keyboardTarget?.addEventListener('keydown', this._onKeyDown);
		this._keyboardTarget?.addEventListener('pagehide', this._onPageHide, { once: true });

		this._unsubscribers = [];
		for (const eventName of [
			eventNames?.UNLOCKED,
			eventNames?.ACCEPTED,
			eventNames?.UPDATED,
			eventNames?.READY_TO_TURN_IN,
			eventNames?.COMPLETED,
		]) {
			if (typeof eventName === 'string') this._unsubscribers.push(eventsBus.on(eventName, () => this.refresh()));
		}
		this.refresh();
	}

	setOpen(open) {
		if (this._disposed) return;
		this._panel.hidden = !open;
		this._button.setAttribute('aria-expanded', String(Boolean(open)));
		if (open) this.refresh();
	}

	refresh() {
		if (this._disposed) return;
		const model = buildQuestJournalModel(this._snapshotProvider());
		this._button.textContent = model.activeCount > 0 ? `Görevler · ${model.activeCount}` : 'Görevler';
		this._button.dataset.ready = String(model.readyCount > 0);
		this._summary.textContent = `${model.activeCount} etkin · ${model.completedCount} tamamlandı`;
		this._list.replaceChildren();

		if (model.visibleCount === 0) {
			const empty = this._doc.createElement('p');
			empty.className = 'g3d-quest-journal-empty';
			empty.textContent = 'Bir nöbetçiyle konuşup görev kabul ettiğinde ilerlemen burada görünecek.';
			this._list.appendChild(empty);
			return;
		}

		for (const quest of model.quests) {
			const card = this._doc.createElement('article');
			card.className = 'g3d-quest-journal-card';
			card.dataset.status = quest.status;
			const status = this._doc.createElement('span');
			status.className = 'g3d-quest-journal-status';
			status.textContent = statusLabel(quest.status);
			const name = this._doc.createElement('h3');
			name.className = 'g3d-quest-journal-name';
			name.textContent = quest.title;
			const description = this._doc.createElement('p');
			description.className = 'g3d-quest-journal-description';
			description.textContent = quest.description;
			card.append(status, name, description);

			const objectiveList = this._doc.createElement('ul');
			objectiveList.className = 'g3d-quest-journal-objectives';
			for (const objective of quest.objectives) {
				const item = this._doc.createElement('li');
				item.className = 'g3d-quest-journal-objective';
				item.dataset.complete = String(objective.completed);
				const mark = this._doc.createElement('span');
				mark.className = 'g3d-quest-journal-objective-mark';
				mark.setAttribute('aria-hidden', 'true');
				mark.textContent = objective.completed ? '✓' : '○';
				const label = this._doc.createElement('span');
				label.textContent = objective.label;
				item.append(mark, label);
				objectiveList.appendChild(item);
			}
			card.appendChild(objectiveList);

			if (quest.status === 'completed' && quest.rewardGranted && quest.reward?.label) {
				const reward = this._doc.createElement('p');
				reward.className = 'g3d-quest-journal-reward';
				reward.textContent = `Ödül: ${quest.reward.label}`;
				card.appendChild(reward);
			}
			this._list.appendChild(card);
		}
	}

	dispose() {
		if (this._disposed) return;
		this._disposed = true;
		for (const unsubscribe of this._unsubscribers) unsubscribe();
		this._unsubscribers.length = 0;
		this._button.removeEventListener('click', this._onToggle);
		this._closeButton.removeEventListener('click', this._onClose);
		this._keyboardTarget?.removeEventListener('keydown', this._onKeyDown);
		this._keyboardTarget?.removeEventListener('pagehide', this._onPageHide);
		this._button.remove();
		this._panel.remove();
	}
}