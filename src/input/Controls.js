/**
 * Input: keyboard and touch.
 *
 *   W / ↑            throttle              S / ↓   brake (and reverse once stopped)
 *   A / ← , D / →    steer                 Space   handbrake
 *   R  reset   C  camera   L  lights   Z / X  indicators   M  mute
 *
 * The touch pad gives the same set: pedals, steering, handbrake, an explicit
 * reverse toggle, camera switch and reset.
 *
 * Buttons can never stick: every button captures the pointer on press and
 * releases on pointerup / pointercancel / lostpointercapture, and a global
 * pointerup plus `visibilitychange`/`blur` clears anything still held.
 */
export class Controls {
  constructor(container, { settings, onReset, onCamera, onLights, onIndicator, onReverse, onMute } = {}) {
    this.settings = settings;
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.keys = new Set();
    this.touch = { throttle: 0, brake: 0, steerLeft: 0, steerRight: 0, handbrake: false };
    this.reverseLatch = false;
    this.callbacks = { onReset, onCamera, onLights, onIndicator, onReverse, onMute };
    this.isTouch = matchMedia('(hover: none), (pointer: coarse)').matches || navigator.maxTouchPoints > 0;

    this.#bindKeyboard();
    this.pad = this.#buildTouchPad(container);
    this.setTouchPadVisible(this.isTouch);
    this.applyLayout();

    settings?.subscribe((key) => {
      if (key === 'controlLayout' || key === '*') this.applyLayout();
    });
  }

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
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
  }

  /** Clears every held input — used on blur, tab switch and pointer loss. */
  releaseAll() {
    this.keys.clear();
    this.touch.throttle = 0;
    this.touch.brake = 0;
    this.touch.steerLeft = 0;
    this.touch.steerRight = 0;
    this.touch.handbrake = false;
    if (this.pad) for (const b of this.pad.querySelectorAll('.touch-btn')) b.classList.remove('active');
  }

  #buildTouchPad(container) {
    const pad = document.createElement('div');
    pad.className = 'touch-pad';
    pad.innerHTML = `
      <div class="touch-side touch-steer">
        <button class="touch-btn wide" data-hold="left" aria-label="Steer left">◀</button>
        <button class="touch-btn wide" data-hold="right" aria-label="Steer right">▶</button>
      </div>
      <div class="touch-side touch-actions">
        <div class="touch-row">
          <button class="touch-btn mini" data-tap="camera" aria-label="Camera">CAM</button>
          <button class="touch-btn mini" data-tap="reset" aria-label="Reset car">RESET</button>
          <button class="touch-btn mini" data-tap="lights" aria-label="Lights">LIGHT</button>
        </div>
        <div class="touch-row">
          <button class="touch-btn mini" data-toggle="reverse" aria-label="Reverse gear">R</button>
          <button class="touch-btn mini" data-hold="handbrake" aria-label="Handbrake">P</button>
          <button class="touch-btn pedal brake" data-hold="brake" aria-label="Brake">BRAKE</button>
          <button class="touch-btn pedal gas" data-hold="gas" aria-label="Accelerate">GAS</button>
        </div>
      </div>`;
    container.appendChild(pad);

    const setHold = (action, on) => {
      switch (action) {
        case 'left': this.touch.steerLeft = on ? 1 : 0; break;
        case 'right': this.touch.steerRight = on ? 1 : 0; break;
        case 'gas': this.touch.throttle = on ? 1 : 0; break;
        case 'brake': this.touch.brake = on ? 1 : 0; break;
        case 'handbrake': this.touch.handbrake = on; break;
        default: break;
      }
    };

    for (const btn of pad.querySelectorAll('[data-hold]')) {
      const action = btn.dataset.hold;
      const press = (e) => {
        e.preventDefault();
        btn.setPointerCapture?.(e.pointerId);
        btn.classList.add('active');
        setHold(action, true);
      };
      const release = (e) => {
        e?.preventDefault?.();
        btn.classList.remove('active');
        setHold(action, false);
      };
      btn.addEventListener('pointerdown', press);
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('lostpointercapture', release);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    for (const btn of pad.querySelectorAll('[data-tap]')) {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.classList.add('active');
        const action = btn.dataset.tap;
        if (action === 'camera') this.callbacks.onCamera?.();
        if (action === 'reset') this.callbacks.onReset?.();
        if (action === 'lights') this.callbacks.onLights?.();
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

    // anything still held when the pointer dies anywhere gets cleared
    window.addEventListener('pointerup', () => {
      for (const b of pad.querySelectorAll('.touch-btn.active')) {
        b.classList.remove('active');
        if (b.dataset.hold) setHold(b.dataset.hold, false);
      }
    });

    return pad;
  }

  setReverseLatch(on) {
    this.reverseLatch = on;
    this.reverseBtn?.classList.toggle('latched', on);
  }

  applyLayout() {
    const left = this.settings?.get('controlLayout') === 'left';
    this.pad?.classList.toggle('mirrored', left);
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
    const throttleKey = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    const brakeKey = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    const left = (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + this.touch.steerLeft;
    const right = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) + this.touch.steerRight;

    this.state.throttle = Math.min(1, Math.max(throttleKey, this.touch.throttle));
    this.state.brake = Math.min(1, Math.max(brakeKey, this.touch.brake));
    this.state.steer = Math.max(-1, Math.min(1, left - right));
    this.state.handbrake = k.has('Space') || this.touch.handbrake;
    return this.state;
  }
}
