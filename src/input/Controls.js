/**
 * Keyboard + touch input.
 *
 *   W / ↑        throttle          S / ↓   brake (and reverse from a standstill)
 *   A / ← D / →  steer             Space   handbrake
 *   R            reset the car     C       camera mode
 *
 * On touch devices an on-screen pad appears: throttle and brake pedals on the
 * right, steering arrows on the left, handbrake and reset buttons.
 */
export class Controls {
  constructor(container, { onReset, onCamera } = {}) {
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.keys = new Set();
    this.touch = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.onReset = onReset;
    this.onCamera = onCamera;
    this.isTouch = matchMedia('(hover: none), (pointer: coarse)').matches || 'ontouchstart' in window;

    this.#bindKeyboard();
    this.pad = this.#buildTouchPad(container);
    if (!this.isTouch) this.pad.style.display = 'none';
  }

  #bindKeyboard() {
    const down = (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyR') this.onReset?.();
      if (e.code === 'KeyC') this.onCamera?.();
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    };
    const up = (e) => this.keys.delete(e.code);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', () => this.keys.clear());
  }

  #buildTouchPad(container) {
    const pad = document.createElement('div');
    pad.className = 'touch-pad';
    pad.innerHTML = `
      <div class="touch-steer">
        <button class="touch-btn steer-left" data-act="left">◀</button>
        <button class="touch-btn steer-right" data-act="right">▶</button>
      </div>
      <div class="touch-pedals">
        <button class="touch-btn small" data-act="handbrake">P</button>
        <button class="touch-btn small" data-act="reset">R</button>
        <button class="touch-btn brake" data-act="brake">BRAKE</button>
        <button class="touch-btn gas" data-act="gas">GAS</button>
      </div>`;
    container.appendChild(pad);

    const setFromAct = (act, on) => {
      switch (act) {
        case 'left': this.touch.steer = on ? 1 : 0; break;
        case 'right': this.touch.steer = on ? -1 : 0; break;
        case 'gas': this.touch.throttle = on ? 1 : 0; break;
        case 'brake': this.touch.brake = on ? 1 : 0; break;
        case 'handbrake': this.touch.handbrake = on; break;
        case 'reset': if (on) this.onReset?.(); break;
        default: break;
      }
    };

    for (const btn of pad.querySelectorAll('[data-act]')) {
      const act = btn.dataset.act;
      const on = (e) => { e.preventDefault(); btn.classList.add('active'); setFromAct(act, true); };
      const off = (e) => { e.preventDefault(); btn.classList.remove('active'); setFromAct(act, false); };
      btn.addEventListener('pointerdown', on);
      btn.addEventListener('pointerup', off);
      btn.addEventListener('pointercancel', off);
      btn.addEventListener('pointerleave', off);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    return pad;
  }

  /** Force the touch pad on/off (used by the debug panel to test it on desktop). */
  setTouchPadVisible(visible) {
    this.pad.style.display = visible ? '' : 'none';
    return visible;
  }

  get touchPadVisible() {
    return this.pad.style.display !== 'none';
  }

  /** Merges keyboard and touch into one input state. */
  sample() {
    const k = this.keys;
    const throttleKey = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    const brakeKey = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    const left = k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0;
    const right = k.has('KeyD') || k.has('ArrowRight') ? 1 : 0;

    this.state.throttle = Math.max(throttleKey, this.touch.throttle);
    this.state.brake = Math.max(brakeKey, this.touch.brake);
    this.state.steer = Math.max(-1, Math.min(1, left - right + this.touch.steer));
    this.state.handbrake = k.has('Space') || this.touch.handbrake;
    return this.state;
  }
}
