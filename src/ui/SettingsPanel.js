import { DEFAULTS } from '../settings.js';

/**
 * Compact settings sheet. Every control writes straight into the Settings
 * store, which persists to localStorage and notifies the renderer/camera.
 * Also hosts the About section with the model's CC BY 4.0 attribution, so the
 * credit is always reachable from the UI.
 */
export class SettingsPanel {
  constructor(container, settings, { credit = null, onAction = () => {}, getAudioStatus = null } = {}) {
    this.settings = settings;
    this.onAction = onAction;
    this.getAudioStatus = getAudioStatus;

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
  }

  toggle(force) {
    this.el.hidden = force === undefined ? !this.el.hidden : !force;
    this.button.classList.toggle('active', !this.el.hidden);
    if (!this.el.hidden) this.refreshStatus();
  }

  /** Live audio state, so "no sound" is diagnosable instead of mysterious. */
  refreshStatus() {
    const el = this.el.querySelector('[data-audio-status]');
    if (!el || !this.getAudioStatus) return;
    const s = this.getAudioStatus();
    el.textContent = s.running ? `running · ${Math.round(s.sampleRate / 1000)} kHz` : s.built ? `${s.state} — tap the screen` : 'waiting for a tap';
    el.className = s.running ? 'ok' : 'warn';
  }

  #render(credit) {
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
      <p class="about dim">No sound on a phone? Check the ringer switch — iPhones
      mute web audio when it is set to silent. Tap the 🔊 button on the dial if it appears.</p>

      <h3>Feel</h3>
      ${slider('cameraSensitivity', 'Camera follow', 0.4, 2, 0.05)}
      ${slider('steeringSensitivity', 'Steering', 0.5, 1.6, 0.05)}

      <h3>Controls</h3>
      <div class="row col"><span>Touch layout</span>
        ${seg('controlLayout', [{ value: 'right', label: 'Pedals right' }, { value: 'left', label: 'Pedals left' }])}
      </div>
      ${toggle('debug', 'Debug panel')}

      <div class="row actions">
        <button data-action="reset-car">Reset car (R)</button>
        <button data-action="defaults">Restore defaults</button>
      </div>

      <h3>About</h3>
      <p class="about">
        Browser driving simulator — Three.js + Rapier 3D physics.<br>
        Vehicle model: <b>${credit?.title ?? 'BMW M5 CS (F90)'}</b> by
        <b>${(credit?.author ?? 'fvrenbld').split(' (')[0]}</b>,
        licensed <a href="${credit?.license?.match(/\((https?:[^)]+)\)/)?.[1] ?? 'https://creativecommons.org/licenses/by/4.0/'}" target="_blank" rel="noopener">CC BY 4.0</a>.
        <a href="${credit?.source ?? 'https://sketchfab.com/3d-models/bmw-m5-cs-f90-8f74fb3420e24213aaeea33dc99450a3'}" target="_blank" rel="noopener">Model page</a>.
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
        if (action.dataset.action === 'defaults') {
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
