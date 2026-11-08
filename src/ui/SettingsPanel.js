import { DEFAULTS } from '../settings.js';

/**
 * Compact settings sheet. Every control writes straight into the Settings
 * store, which persists to localStorage and notifies the renderer/camera.
 * Also hosts the About section with the model's CC BY 4.0 attribution, so the
 * credit is always reachable from the UI.
 */
export class SettingsPanel {
  constructor(container, settings, { credit = null, onAction = () => {}, getAudioStatus = null, install = null, cars = null } = {}) {
    this.settings = settings;
    this.onAction = onAction;
    this.getAudioStatus = getAudioStatus;
    this.install = install;
    this.cars = cars;
    this.credit = credit;

    this.button = document.createElement('button');
    this.button.className = 'icon-btn settings-btn';
    this.button.innerHTML = '<span>⚙</span>';
    this.button.setAttribute('aria-label', 'Settings');
    container.appendChild(this.button);

    this.el = document.createElement('div');
    this.el.className = 'sheet';
    this.el.hidden = true;
    container.appendChild(this.el);

    this.button.addEventListener('click', () => this.toggle());
    this.#render(credit);
    install?.subscribe(() => this.refreshInstall());
  }

  toggle(force) {
    this.el.hidden = force === undefined ? !this.el.hidden : !force;
    this.button.classList.toggle('active', !this.el.hidden);
    if (!this.el.hidden) {
      this.refreshStatus();
      this.refreshInstall();
    }
  }

  /**
   * What "install" means depends on the browser, so the row says what this one
   * actually offers instead of showing a button that may do nothing.
   */
  refreshInstall() {
    const row = this.el.querySelector('[data-install]');
    if (!row) return;
    row.innerHTML = this.#installHtml();
  }

  #installHtml() {
    switch (this.install?.status) {
      case 'installed':
        return '<p class="about ok">Running as an installed app — it works offline, '
          + 'and the car model is already stored on the device.</p>';
      case 'prompt':
        return '<p class="about">Add the simulator to your home screen; it then opens '
          + 'full-screen and runs without a network.</p>'
          + '<div class="row actions"><button data-action="install">Install app</button></div>';
      case 'ios':
        return '<p class="about">iOS installs web apps from the Share menu, not from a button:<br>'
          + '<b>1.</b> tap <b>Share</b> (the square with the arrow) in the Safari toolbar<br>'
          + '<b>2.</b> scroll down and tap <b>Add to Home Screen</b><br>'
          + '<b>3.</b> tap <b>Add</b> — an M5 icon appears on the home screen.</p>'
          + '<p class="about dim">It has to be Safari: Chrome and Firefox on iOS cannot add web '
          + 'apps to the home screen. Once added it opens full-screen and plays offline.</p>';
      default:
        return '<p class="about dim">Open this page in its own browser tab (not embedded in '
          + 'another page) to install it as an app that runs offline.</p>';
    }
  }

  /** Live audio state, so "no sound" is diagnosable instead of mysterious. */
  refreshStatus() {
    const el = this.el.querySelector('[data-audio-status]');
    if (!el || !this.getAudioStatus) return;
    const s = this.getAudioStatus();
    const blockedByHost = s.autoplayAllowed === false;
    el.textContent = blockedByHost
      ? 'blocked by this page\u2019s frame'
      : s.running
        ? `running · ${Math.round(s.sampleRate / 1000)} kHz`
        : s.built
          ? `${s.state} — tap the screen`
          : 'waiting for a tap';
    el.className = s.running && !blockedByHost ? 'ok' : 'warn';
  }

  /** After a car swap, the About section has to name the new model's author. */
  setCredit(credit) {
    this.credit = credit;
    const el = this.el.querySelector('[data-credit]');
    if (el) el.innerHTML = this.#creditHtml();
  }

  #creditHtml() {
    const c = this.credit ?? {};
    const licenceUrl = c.license?.match(/\((https?:[^)]+)\)/)?.[1] ?? 'https://creativecommons.org/licenses/by/4.0/';
    const author = (c.author ?? 'unknown').split(' (')[0];
    return `Vehicle model: <b>${c.title ?? 'unknown'}</b> by <b>${author}</b>, licensed `
      + `<a href="${licenceUrl}" target="_blank" rel="noopener">CC BY 4.0</a>. `
      + `<a href="${c.source ?? 'https://sketchfab.com'}" target="_blank" rel="noopener">Model page</a>.`;
  }

  #render(credit = this.credit) {
    this.credit = credit;
    const s = this.settings;
    const seg = (key, options) => `
      <div class="seg" data-seg="${key}">
        ${options.map((o) => `<button data-value="${o.value}" class="${s.get(key) === o.value ? 'on' : ''}">${o.label}</button>`).join('')}
      </div>`;
    const toggle = (key, label) => `
      <div class="row"><span>${label}</span>
        <button class="switch ${s.get(key) ? 'on' : ''}" data-toggle="${key}"><i></i></button>
      </div>`;
    const slider = (key, label, min, max, step) => `
      <div class="row col"><span>${label} <b data-out="${key}">${key === 'volume' ? `${Math.round(Number(s.get(key)) * 100)}%` : `${Number(s.get(key)).toFixed(2)}×`}</b></span>
        <input type="range" data-slider="${key}" min="${min}" max="${max}" step="${step}" value="${s.get(key)}">
      </div>`;

    this.el.innerHTML = `
      <header>
        <h2>Settings</h2>
        <button class="icon-btn close" data-close>✕</button>
      </header>

      ${this.cars ? `<h3>Car</h3>
      <div class="row col"><span>Vehicle</span>
        ${seg('car', Object.values(this.cars).map((c) => ({ value: c.id, label: c.label })))}
      </div>
      <p class="about dim">Switching reloads the model, the physics tuning and the
      engine note — no page reload, and the sound stays unlocked.</p>` : ''}

      <h3>Install</h3>
      <div data-install>${this.#installHtml()}</div>

      <h3>Graphics</h3>
      <div class="row col"><span>Quality</span>
        ${seg('quality', [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }])}
      </div>
      ${toggle('shadows', 'Shadows')}
      ${toggle('reflections', 'Reflections')}
      ${toggle('headlightBeams', 'Headlight beams')}

      <h3>Sound</h3>
      ${toggle('sound', 'Engine sound')}
      ${slider('volume', 'Volume', 0, 1, 0.05)}
      <div class="row"><span>Status</span><span data-audio-status class="dim">—</span></div>
      <p class="about dim">No sound? If the status says <b>blocked by this page\u2019s frame</b>,
      the page is embedded somewhere that forbids audio — open it in its own tab and it will play.
      On a phone also check the ringer switch: iPhones mute web audio when it is set to silent.</p>

      <h3>Feel</h3>
      ${slider('cameraSensitivity', 'Camera follow', 0.4, 2, 0.05)}
      ${slider('steeringSensitivity', 'Steering', 0.5, 1.6, 0.05)}

      <h3>Controls</h3>
      <div class="row col"><span>Touch layout</span>
        ${seg('controlLayout', [{ value: 'right', label: 'Pedals right' }, { value: 'left', label: 'Pedals left' }])}
      </div>
      <div class="row col"><span>Touch steering</span>
        ${seg('touchSteering', [{ value: 'wheel', label: 'Wheel' }, { value: 'arrows', label: 'Arrows' }])}
      </div>
      ${toggle('debug', 'Debug panel')}

      <div class="row actions">
        <button data-action="reset-car">Reset car (R)</button>
        <button data-action="defaults">Restore defaults</button>
      </div>

      <h3>About</h3>
      <p class="about">
        Browser driving simulator — Three.js + Rapier 3D physics.<br>
        <span data-credit>${this.#creditHtml()}</span>
      </p>
      <p class="about dim">
        Keys: W/S or ↑/↓ drive · A/D or ←/→ steer · Space handbrake ·
        C camera · R reset · L lights · Z/X indicators · M mute
      </p>`;

    this.el.addEventListener('click', (e) => {
      const close = e.target.closest('[data-close]');
      if (close) return this.toggle(false);

      const segBtn = e.target.closest('.seg button');
      if (segBtn) {
        const key = segBtn.parentElement.dataset.seg;
        this.settings.set(key, segBtn.dataset.value);
        for (const b of segBtn.parentElement.children) b.classList.toggle('on', b === segBtn);
        return;
      }

      const sw = e.target.closest('[data-toggle]');
      if (sw) {
        const key = sw.dataset.toggle;
        const next = !this.settings.get(key);
        this.settings.set(key, next);
        sw.classList.toggle('on', next);
        return;
      }

      const action = e.target.closest('[data-action]');
      if (action) {
        if (action.dataset.action === 'install') {
          this.install?.install().then(() => this.refreshInstall());
        } else if (action.dataset.action === 'defaults') {
          this.settings.reset();
          this.#render(credit);
        } else {
          this.onAction(action.dataset.action);
        }
      }
    });

    this.el.addEventListener('input', (e) => {
      const slider = e.target.closest('[data-slider]');
      if (!slider) return;
      const key = slider.dataset.slider;
      const value = Number(slider.value);
      this.settings.set(key, value);
      const out = this.el.querySelector(`[data-out="${key}"]`);
      if (out) out.textContent = `${value.toFixed(2)}×`;
    });
  }
}

export { DEFAULTS };
