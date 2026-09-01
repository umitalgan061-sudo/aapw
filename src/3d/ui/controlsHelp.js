/** Accessible desktop/mobile controls reference for the 3D mode (FAZ 8 UI). */

let controlsHelpInstanceCounter = 0;

const DESKTOP_CONTROLS = Object.freeze([
	['WASD / Oklar', 'Yürü'],
	['Shift', 'Koş'],
	['Space', 'Zıpla'],
	['E', 'Yakındaki kişiyle konuş'],
	['C / Sol tık', 'Hafif saldırı'],
	['R', 'Ağır saldırı'],
	['Q / Sağ tık', 'Savunmayı basılı tut'],
	['Tab', 'Yakındaki hedefe kilitlen veya kilidi kaldır'],
	['Fare', 'Kamerayı döndür ve yakınlaştır'],
	['Gamepad sol çubuk / L3', 'Yürü / koş'],
	['Gamepad A / B', 'Zıpla / kaçın'],
	['Gamepad X / Y', 'Hafif / ağır saldırı'],
	['Gamepad LB / RB', 'Savun / savuştur'],
	['Gamepad sağ çubuk / R3', 'Kamera / hedef kilidi'],
]);

const TOUCH_CONTROLS = Object.freeze([
	['Sol çubuk', 'Yürü; dış halkaya iterek koş'],
	['Zıpla', 'Sağdaki Zıpla düğmesine dokun'],
	['Savun', 'Savunmayı basılı tut'],
	['Kaçın', 'Hareket ederken kaçınma hamlesi yap'],
	['Savuştur', 'Kısa savuşturma penceresi aç'],
	['Hedef', 'Yakındaki hedefe kilitlen veya kilidi kaldır'],
	['Hafif', 'Hafif saldırı'],
	['Ağır', 'Ağır saldırı'],
	['Selamla', 'Yakındaki etkileşim istemine dokun'],
	['Diyalog', 'Bir yanıta dokun veya kapat'],
	['Sürükle', 'Kamerayı döndür'],
	['İki parmak', 'Kamerayı yakınlaştır'],
]);

export class ControlsHelp {
	/** @param {{container?: HTMLElement, isMobileClass?: boolean}} [options] */
	constructor({ container = document.body, isMobileClass = false } = {}) {
		this._open = false;
		this._root = document.createElement('div');
		this._root.className = 'g3d-controls-help';

		this._button = document.createElement('button');
		this._button.type = 'button';
		this._button.className = 'g3d-controls-help-button';
		this._button.textContent = '?';
		this._button.setAttribute('aria-label', 'Kontrolleri göster');
		this._button.setAttribute('aria-expanded', 'false');

		this._panel = document.createElement('section');
		this._panel.id = `g3d-controls-help-panel-${++controlsHelpInstanceCounter}`;
		this._button.setAttribute('aria-controls', this._panel.id);
		this._panel.className = 'g3d-controls-help-panel';
		this._panel.hidden = true;
		this._panel.setAttribute('aria-label', 'Oyun kontrolleri');
		const title = document.createElement('h2');
		title.textContent = isMobileClass ? 'Dokunmatik Kontroller' : 'Masaüstü Kontrolleri';
		this._panel.appendChild(title);

		const list = document.createElement('dl');
		for (const [input, action] of isMobileClass ? TOUCH_CONTROLS : DESKTOP_CONTROLS) {
			const term = document.createElement('dt');
			term.textContent = input;
			const description = document.createElement('dd');
			description.textContent = action;
			list.append(term, description);
		}
		this._panel.appendChild(list);

		this._onButtonClick = () => this.setOpen(!this._open);
		this._onKeyDown = (event) => {
			if (event.code !== 'Escape' || !this._open) return;
			this.setOpen(false);
			event.stopImmediatePropagation();
		};
		this._button.addEventListener('click', this._onButtonClick);
		window.addEventListener('keydown', this._onKeyDown);
		this._root.append(this._panel, this._button);
		container.appendChild(this._root);
	}

	setOpen(open) {
		if (this._open === open) return;
		this._open = open;
		this._panel.hidden = !open;
		this._button.setAttribute('aria-expanded', String(open));
		this._button.setAttribute('aria-label', open ? 'Kontrolleri gizle' : 'Kontrolleri göster');
	}

	get isOpen() {
		return this._open;
	}

	dispose() {
		this._button.removeEventListener('click', this._onButtonClick);
		window.removeEventListener('keydown', this._onKeyDown);
		this._root.remove();
	}
}