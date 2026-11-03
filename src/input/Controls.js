/**
 * Input: keyboard, and a touch layout built around a steering wheel and two
 * pedals rather than four square buttons.
 *
 *   W / ↑            throttle              S / ↓   brake (reverse once stopped)
 *   A / ← , D / →    steer                 Space   handbrake
 *   R reset   C camera   L lights   Z / X indicators   M mute
 *
 * Touch:
 *   - a wheel you turn with a finger, analogue and self-centring;
 *   - pedals that ramp in like a real throttle instead of snapping to full;
 *   - the arrows are still available (Settings → Touch steering).
 *
 * Buttons cannot stick: every press is tracked by pointerId, every release
 * clears only the finger that ended, and a pointer lost anywhere releases just
 * that finger. Losing window focus clears the keyboard only — an embedded page
 * can lose focus to its host while a finger is still on a pedal.
 */

const WHEEL_MAX_DEG = 135; // lock to lock on screen
const WHEEL_RETURN_PER_S = 6.5; // self-centring rate; ~0.35 s from full lock
const THROTTLE_RAMP_MS = 170;
const BRAKE_RAMP_MS = 110;

export class Controls {
  constructor(container, { settings, onReset, onCamera, onLights, onIndicator, onReverse, onMute, onSound } = {}) {
    this.settings = settings;
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.keys = new Set();
    this.touch = { throttleAt: 0, brakeAt: 0, steerLeft: 0, steerRight: 0, handbrake: false };
    /** pointerId -> { btn, action } for every finger holding a control */
    this.held = new Map();
    this.wheel = { angle: 0, grabbed: false, pointerId: null, lastAngle: 0 };
    this.lastSampleAt = performance.now();
    this.reverseLatch = false;
    this.callbacks = { onReset, onCamera, onLights, onIndicator, onReverse, onMute, onSound };
    this.isTouch = matchMedia('(hover: none), (pointer: coarse)').matches || navigator.maxTouchPoints > 0;

    this.#bindKeyboard();
    this.pad = this.#buildPad(container);
    this.setTouchPadVisible(this.isTouch);
    this.applyLayout();

    settings?.subscribe((key) => {
      if (key === 'controlLayout' || key === 'touchSteering' || key === '*') this.applyLayout();
    });
  }

  // ------------------------------------------------------------- keyboard ---
  #bindKeyboard() {
    const handled = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (handled.includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      switch (e.code) {
        case 'KeyR': this.callbacks.onReset?.(); break;
        case 'KeyC': this.callbacks.onCamera?.(); break;
        case 'KeyL': this.callbacks.onLights?.(); break;
        case 'KeyZ': this.callbacks.onIndicator?.(-1); break;
        case 'KeyX': this.callbacks.onIndicator?.(1); break;
        case 'KeyM': this.callbacks.onMute?.(); break;
        default: break;
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
  }

  releaseAll() {
    this.keys.clear();
    this.held.clear();
    this.touch.throttleAt = 0;
    this.touch.brakeAt = 0;
    this.touch.steerLeft = 0;
    this.touch.steerRight = 0;
    this.touch.handbrake = false;
    this.wheel.grabbed = false;
    this.wheel.pointerId = null;
    if (this.pad) for (const b of this.pad.querySelectorAll('.touch-btn, .pedal')) b.classList.remove('active');
  }

  // ------------------------------------------------------------------ pad ---
  #buildPad(container) {
    const pad = document.createElement('div');
    pad.className = 'touch-pad';
    pad.innerHTML = `
      <div class="touch-left">
        <div class="wheel" data-wheel>
          <svg viewBox="0 0 200 200" aria-hidden="true">
            <defs>
              <radialGradient id="wheelFace" cx="50%" cy="38%">
                <stop offset="0%" stop-color="#2a323c"/><stop offset="100%" stop-color="#11161c"/>
              </radialGradient>
            </defs>
            <g data-wheel-rotor>
              <circle cx="100" cy="100" r="92" fill="none" stroke="url(#wheelFace)" stroke-width="16"/>
              <circle cx="100" cy="100" r="92" fill="none" stroke="#5d6672" stroke-width="2"/>
              <path d="M100 108 L36 140 M100 108 L164 140 M100 108 L100 176" stroke="#39414c" stroke-width="13" stroke-linecap="round"/>
              <circle cx="100" cy="100" r="26" fill="#1b2127" stroke="#46505c" stroke-width="2"/>
              <path d="M100 86 l8 14 h-16 z" fill="#62c8ff"/>
              <rect x="88" y="4" width="24" height="9" rx="4" fill="#62c8ff"/>
            </g>
          </svg>
        </div>
        <div class="touch-arrows" data-arrows>
          <button class="touch-btn wide" data-hold="left" aria-label="Steer left">◀</button>
          <button class="touch-btn wide" data-hold="right" aria-label="Steer right">▶</button>
        </div>
      </div>

      <div class="touch-right">
        <div class="touch-row">
          <button class="touch-btn mini" data-tap="camera" aria-label="Camera">CAM</button>
          <button class="touch-btn mini" data-tap="reset" aria-label="Reset car">RESET</button>
          <button class="touch-btn mini" data-tap="lights" aria-label="Lights">LIGHT</button>
          <button class="touch-btn mini" data-tap="sound" aria-label="Sound">SND</button>
        </div>
        <div class="touch-row pedals">
          <div class="touch-stack">
            <button class="touch-btn mini" data-toggle="reverse" aria-label="Reverse gear">R</button>
            <button class="touch-btn mini" data-hold="handbrake" aria-label="Handbrake">P</button>
          </div>
          <button class="pedal brake" data-hold="brake" aria-label="Brake"><i data-fill></i><span>BRAKE</span></button>
          <button class="pedal gas" data-hold="gas" aria-label="Accelerate"><i data-fill></i><span>GAS</span></button>
        </div>
      </div>`;
    container.appendChild(pad);

    this.#bindHoldButtons(pad);
    this.#bindTapButtons(pad);
    this.#bindWheel(pad);
    return pad;
  }

  #setHold(action, on) {
    const now = performance.now();
    switch (action) {
      case 'left': this.touch.steerLeft = on ? 1 : 0; break;
      case 'right': this.touch.steerRight = on ? 1 : 0; break;
      case 'gas': this.touch.throttleAt = on ? now : 0; break;
      case 'brake': this.touch.brakeAt = on ? now : 0; break;
      case 'handbrake': this.touch.handbrake = on; break;
      default: break;
    }
  }

  #bindHoldButtons(pad) {
    const press = (btn, action, pointerId) => {
      this.held.set(pointerId, { btn, action });
      btn.classList.add('active');
      this.#setHold(action, true);
    };
    const release = (pointerId) => {
      const entry = this.held.get(pointerId);
      if (!entry) return;
      this.held.delete(pointerId);
      const stillHeld = [...this.held.values()].some((h) => h.action === entry.action);
      entry.btn.classList.toggle('active', stillHeld);
      if (!stillHeld) this.#setHold(entry.action, false);
    };
    this._releasePointer = release;

    for (const btn of pad.querySelectorAll('[data-hold]')) {
      const action = btn.dataset.hold;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try { btn.setPointerCapture(e.pointerId); } catch { /* unsupported */ }
        press(btn, action, e.pointerId);
      });
      const up = (e) => { e.preventDefault(); release(e.pointerId); };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    for (const type of ['pointerup', 'pointercancel']) {
      window.addEventListener(type, (e) => release(e.pointerId));
    }
  }

  #bindTapButtons(pad) {
    for (const btn of pad.querySelectorAll('[data-tap]')) {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.classList.add('active');
        const action = btn.dataset.tap;
        if (action === 'camera') this.callbacks.onCamera?.();
        if (action === 'reset') this.callbacks.onReset?.();
        if (action === 'lights') this.callbacks.onLights?.();
        if (action === 'sound') this.callbacks.onSound?.();
      });
      const off = () => btn.classList.remove('active');
      btn.addEventListener('pointerup', off);
      btn.addEventListener('pointercancel', off);
      btn.addEventListener('lostpointercapture', off);
    }

    const reverseBtn = pad.querySelector('[data-toggle="reverse"]');
    reverseBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.reverseLatch = !this.reverseLatch;
      reverseBtn.classList.toggle('latched', this.reverseLatch);
      this.callbacks.onReverse?.(this.reverseLatch);
    });
    this.reverseBtn = reverseBtn;
  }

  /**
   * The wheel turns with the finger: the angle is taken around the wheel's own
   * centre and accumulated, so you can keep turning past where you grabbed it,
   * and it springs back when you let go.
   */
  #bindWheel(pad) {
    const el = pad.querySelector('[data-wheel]');
    const rotor = pad.querySelector('[data-wheel-rotor]');
    this.wheelEl = el;
    this.wheelRotor = rotor;

    const angleAt = (e) => {
      const r = el.getBoundingClientRect();
      return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
    };

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* unsupported */ }
      this.wheel.grabbed = true;
      this.wheel.pointerId = e.pointerId;
      this.wheel.lastAngle = angleAt(e);
      el.classList.add('active');
    });

    el.addEventListener('pointermove', (e) => {
      if (!this.wheel.grabbed || e.pointerId !== this.wheel.pointerId) return;
      e.preventDefault();
      const a = angleAt(e);
      let delta = a - this.wheel.lastAngle;
      // shortest way round, so crossing the top of the wheel does not jump
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      this.wheel.lastAngle = a;
      const limit = (WHEEL_MAX_DEG * Math.PI) / 180;
      this.wheel.angle = Math.max(-limit, Math.min(limit, this.wheel.angle + delta));
    });

    const letGo = (e) => {
      if (e && this.wheel.pointerId !== null && e.pointerId !== this.wheel.pointerId) return;
      this.wheel.grabbed = false;
      this.wheel.pointerId = null;
      el.classList.remove('active');
    };
    el.addEventListener('pointerup', letGo);
    el.addEventListener('pointercancel', letGo);
    window.addEventListener('pointerup', letGo);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ----------------------------------------------------------------- state ---
  setSoundState(on) {
    this.pad?.querySelector('[data-tap="sound"]')?.classList.toggle('latched', Boolean(on));
  }

  setReverseLatch(on) {
    this.reverseLatch = on;
    this.reverseBtn?.classList.toggle('latched', on);
  }

  applyLayout() {
    const left = this.settings?.get('controlLayout') === 'left';
    this.pad?.classList.toggle('mirrored', left);
    const useWheel = (this.settings?.get('touchSteering') ?? 'wheel') === 'wheel';
    this.pad?.classList.toggle('arrows-mode', !useWheel);
    if (!useWheel) this.wheel.angle = 0;
  }

  setTouchPadVisible(visible) {
    if (this.pad) this.pad.style.display = visible ? '' : 'none';
    return visible;
  }

  get touchPadVisible() {
    return this.pad?.style.display !== 'none';
  }

  /** Merged keyboard + touch state for this frame. */
  sample() {
    const k = this.keys;
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.lastSampleAt) / 1000));
    this.lastSampleAt = now;
    const useWheel = (this.settings?.get('touchSteering') ?? 'wheel') === 'wheel';

    // pedals ramp in like a real one; a tap is a blip, a hold is full throttle
    const ramp = (since, ms) => (since ? Math.min(1, (now - since) / ms) : 0);
    const throttleKey = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    const brakeKey = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    this.state.throttle = Math.max(throttleKey, ramp(this.touch.throttleAt, THROTTLE_RAMP_MS));
    this.state.brake = Math.max(brakeKey, ramp(this.touch.brakeAt, BRAKE_RAMP_MS));

    // steering: keys, arrows, and the wheel, whichever is in use
    const keyLeft = k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0;
    const keyRight = k.has('KeyD') || k.has('ArrowRight') ? 1 : 0;
    let steer = keyLeft - keyRight + this.touch.steerLeft - this.touch.steerRight;

    if (useWheel) {
      if (!this.wheel.grabbed) {
        // Self-centring: the rim returns while no one is holding it. Framed in
        // seconds, not frames, so it feels the same at 30 and at 120 fps.
        this.wheel.angle *= Math.exp(-WHEEL_RETURN_PER_S * dt);
        if (Math.abs(this.wheel.angle) < 0.002) this.wheel.angle = 0;
      }
      const limit = (WHEEL_MAX_DEG * Math.PI) / 180;
      // screen angles grow clockwise, and clockwise is a right turn, which is
      // negative steering in this project
      steer += -this.wheel.angle / limit;
      if (this.wheelRotor) {
        this.wheelRotor.setAttribute('transform', `rotate(${(this.wheel.angle * 180) / Math.PI} 100 100)`);
      }
    }

    this.state.steer = Math.max(-1, Math.min(1, steer));
    this.state.handbrake = k.has('Space') || this.touch.handbrake;

    // pedal fill, so you can see how far in they are
    this.#paintPedal('gas', this.state.throttle);
    this.#paintPedal('brake', this.state.brake);
    return this.state;
  }

  #paintPedal(action, value) {
    const fill = this.pad?.querySelector(`[data-hold="${action}"] [data-fill]`);
    if (!fill) return;
    const pct = Math.round(value * 100);
    if (fill.dataset.pct === String(pct)) return;
    fill.dataset.pct = String(pct);
    fill.style.height = `${pct}%`;
  }
}
