/**
 * Automotive HUD: speed, revs, gear and the warning lamps a driver expects.
 * Built once, then updated by mutating text/style — no innerHTML per frame, so
 * it costs nothing at 60 fps on a phone.
 */
export class Hud {
  constructor(container) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="hud-main">
        <div class="hud-speed"><b data-speed>0</b><span>km/h</span></div>
        <div class="hud-gear">
          <div class="hud-prnd" data-prnd>
            <span data-prnd-p>P</span><span data-prnd-r>R</span><span data-prnd-n>N</span><span data-prnd-d>D</span>
          </div>
          <b data-gear>1</b>
        </div>
      </div>
      <div class="hud-rpm">
        <i data-rpm></i>
        <u data-redline></u>
      </div>
      <div class="hud-rpm-scale"><span>0</span><span>3.5k</span><span>7k</span></div>
      <div class="hud-pedals">
        <div class="hud-pedal"><label>THR</label><div class="bar"><i data-throttle class="thr"></i></div></div>
        <div class="hud-pedal"><label>BRK</label><div class="bar"><i data-brake class="brk"></i></div></div>
      </div>
      <div class="hud-lamps">
        <span class="lamp" data-lamp-hand>P!</span>
        <span class="lamp" data-lamp-abs>ABS</span>
        <span class="lamp" data-lamp-tc>TC</span>
        <span class="lamp" data-lamp-lights>LIGHTS</span>
        <span class="lamp" data-lamp-air>AIR</span>
      </div>
      <div class="hud-foot"><span data-cam>chase</span><span data-fps>60 fps</span></div>
      <div class="hud-notice" data-notice hidden></div>
      <button class="hud-sound" data-sound hidden>🔊 TAP FOR SOUND</button>`;
    container.appendChild(this.el);

    const q = (sel) => this.el.querySelector(sel);
    this.refs = {
      speed: q('[data-speed]'),
      gear: q('[data-gear]'),
      prnd: { P: q('[data-prnd-p]'), R: q('[data-prnd-r]'), N: q('[data-prnd-n]'), D: q('[data-prnd-d]') },
      rpm: q('[data-rpm]'),
      redline: q('[data-redline]'),
      throttle: q('[data-throttle]'),
      brake: q('[data-brake]'),
      hand: q('[data-lamp-hand]'),
      abs: q('[data-lamp-abs]'),
      tc: q('[data-lamp-tc]'),
      lights: q('[data-lamp-lights]'),
      air: q('[data-lamp-air]'),
      cam: q('[data-cam]'),
      fps: q('[data-fps]'),
      notice: q('[data-notice]'),
      sound: q('[data-sound]'),
    };
    this._last = {};
  }

  /**
   * Shows a tap target while the engine audio is switched on but the browser
   * has not let it start — a tap on this button is a gesture the page is sure
   * to see, which is what phones and embedded frames require.
   */
  bindSound(onTap) {
    this.refs.sound.addEventListener('click', (e) => {
      e.preventDefault();
      onTap();
    });
  }

  setSoundPrompt(visible) {
    if (this._last.soundPrompt === visible) return;
    this._last.soundPrompt = visible;
    this.refs.sound.hidden = !visible;
  }

  /** One-line banner under the HUD (used when physics runs in fallback mode). */
  setNotice(text) {
    this.refs.notice.textContent = text ?? '';
    this.refs.notice.hidden = !text;
  }

  #text(ref, value) {
    if (this._last[ref] === value) return;
    this._last[ref] = value;
    this.refs[ref].textContent = value;
  }

  #lamp(ref, on, cls = 'on') {
    const key = `lamp:${ref}:${cls}`;
    if (this._last[key] === on) return;
    this._last[key] = on;
    this.refs[ref].classList.toggle(cls, on);
  }

  /**
   * @param {object} t   VehiclePhysics telemetry
   * @param {object} ui  { fps, camera, headlights, redlineRpm }
   */
  update(t, { fps = 60, camera = 'chase', headlights = false, redlineRpm = 7200, soundBlocked = false } = {}) {
    this.setSoundPrompt(soundBlocked);
    const speed = Math.abs(Math.round(t.speedKmh ?? 0));
    this.#text('speed', String(speed));

    const gear = t.gear ?? '1';
    const mode = t.handbrake && speed < 1 ? 'P' : gear === 'R' ? 'R' : gear === 'N' ? 'N' : 'D';
    for (const [key, el] of Object.entries(this.refs.prnd)) {
      const active = key === mode;
      if (this._last[`prnd${key}`] !== active) {
        this._last[`prnd${key}`] = active;
        el.classList.toggle('active', active);
      }
    }
    this.#text('gear', gear === 'R' ? 'R' : gear);

    const rpm = t.rpm ?? 800;
    const pct = Math.min(100, (rpm / redlineRpm) * 100);
    const rpmKey = Math.round(pct);
    if (this._last.rpmPct !== rpmKey) {
      this._last.rpmPct = rpmKey;
      this.refs.rpm.style.width = `${pct}%`;
      this.refs.rpm.classList.toggle('red', rpm > redlineRpm * 0.92);
    }

    const thr = Math.round((t.throttle ?? 0) * 100);
    if (this._last.thr !== thr) {
      this._last.thr = thr;
      this.refs.throttle.style.width = `${thr}%`;
    }
    const brk = Math.round(Math.max(t.brake ?? 0, t.handbrake ? 1 : 0) * 100);
    if (this._last.brk !== brk) {
      this._last.brk = brk;
      this.refs.brake.style.width = `${brk}%`;
    }

    this.#lamp('hand', Boolean(t.handbrake));
    this.#lamp('abs', Boolean(t.absActive));
    this.#lamp('tc', Boolean(t.tractionLoss));
    this.#lamp('lights', headlights);
    this.#lamp('air', (t.wheelsOnGround ?? 4) < 4);

    this.#text('cam', camera);
    this.#text('fps', `${Math.round(fps)} fps`);
  }
}
