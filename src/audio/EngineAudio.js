/**
 * Engine, transmission and road audio, synthesised with Web Audio — no sample
 * files, so it costs nothing to load and follows the physics exactly.
 *
 * Voices:
 *   - three oscillators driven by the crank firing rate (rpm / 60 × cylinders / 2),
 *     which gives a V8 beat rather than a single whine;
 *   - a band-passed noise layer for intake and exhaust roar, opened by throttle;
 *   - a low-passed wind/road layer that rises with speed;
 *   - a filtered-noise chirp for tyre slip, and a torque-cut blip on gear changes.
 *
 * Browsers will not start audio without a gesture, so the context stays
 * suspended until the first touch or key press.
 */

const CYLINDERS = 8;

export class EngineAudio {
  constructor({ settings } = {}) {
    this.settings = settings;
    this.ctx = null;
    this.started = false;
    this.enabled = settings?.get('sound') ?? true;
    this.volume = settings?.get('volume') ?? 0.7;
    this.lastGear = '1';
    this.slipCooldown = 0;

    settings?.subscribe((key) => {
      if (key === 'sound' || key === '*') this.setEnabled(settings.get('sound'));
      if (key === 'volume' || key === '*') this.setVolume(settings.get('volume'));
    });

    const unlock = () => this.resume();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this._unlock = unlock;
  }

  /** Builds the graph on first use (after a gesture). */
  #build() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    const ctx = new Ctx();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    // a gentle limiter so a hard rev cannot clip on phone speakers
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -10;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.004;
    this.limiter.release.value = 0.12;
    this.master.connect(this.limiter).connect(ctx.destination);

    // ---- engine: layered oscillators through a body filter ------------------
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 900;
    this.engineFilter.Q.value = 0.8;
    this.engineGain.connect(this.engineFilter).connect(this.master);

    this.oscillators = [0.5, 1, 2].map((ratio, i) => {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? 'square' : 'sawtooth';
      osc.frequency.value = 60 * ratio;
      const gain = ctx.createGain();
      gain.gain.value = [0.5, 0.35, 0.12][i];
      osc.connect(gain).connect(this.engineGain);
      osc.start();
      return { osc, ratio };
    });

    // ---- intake / exhaust roar ---------------------------------------------
    this.noiseBuffer = this.#noiseBuffer(ctx, 2);
    this.roar = ctx.createBufferSource();
    this.roar.buffer = this.noiseBuffer;
    this.roar.loop = true;
    this.roarFilter = ctx.createBiquadFilter();
    this.roarFilter.type = 'bandpass';
    this.roarFilter.frequency.value = 220;
    this.roarFilter.Q.value = 1.1;
    this.roarGain = ctx.createGain();
    this.roarGain.gain.value = 0;
    this.roar.connect(this.roarFilter).connect(this.roarGain).connect(this.master);
    this.roar.start();

    // ---- wind / road noise --------------------------------------------------
    this.wind = ctx.createBufferSource();
    this.wind.buffer = this.noiseBuffer;
    this.wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 500;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    this.wind.start();

    this.started = true;
    return true;
  }

  #noiseBuffer(ctx, seconds) {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      // brown-ish noise: warmer than white, closer to exhaust than hiss
      last = (last + (Math.random() * 2 - 1) * 0.12) * 0.985;
      data[i] = last;
    }
    return buffer;
  }

  resume() {
    if (!this.started && !this.#build()) return false;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }

  get running() {
    return Boolean(this.ctx && this.ctx.state === 'running');
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(enabled ? this.volume : 0, this.ctx.currentTime, 0.05);
    if (enabled) this.resume();
  }

  setVolume(volume) {
    this.volume = volume;
    if (this.ctx && this.enabled) this.master.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.05);
  }

  /** Short chirp — tyre slip or a gear change. */
  #blip({ frequency = 800, duration = 0.09, gain = 0.25, type = 'bandpass' }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = 2.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    src.connect(filter).connect(g).connect(this.master);
    src.start();
    src.stop(ctx.currentTime + duration);
  }

  /**
   * @param {number} dt seconds
   * @param {object} t VehiclePhysics telemetry
   */
  update(dt, t) {
    if (!this.running) return;

    const now = this.ctx.currentTime;
    const rpm = Math.max(700, t.rpm ?? 800);
    const throttle = t.throttle ?? 0;
    const braking = (t.brake ?? 0) > 0.05;
    const speed = Math.abs(t.speedKmh ?? 0);

    // crank firing rate: the fundamental a V8 actually makes
    const firing = (rpm / 60) * (CYLINDERS / 2);
    for (const { osc, ratio } of this.oscillators) {
      osc.frequency.setTargetAtTime(firing * ratio, now, 0.04);
    }

    // load: throttle dominates, revs add presence, and idle is always there
    const load = Math.min(1, throttle * 0.85 + (rpm / 7200) * 0.5);
    const engineTarget = 0.055 + load * 0.3;
    this.engineGain.gain.setTargetAtTime(engineTarget, now, 0.05);
    this.engineFilter.frequency.setTargetAtTime(500 + (rpm / 7200) * 2600 + throttle * 700, now, 0.06);

    this.roarFilter.frequency.setTargetAtTime(160 + (rpm / 7200) * 900, now, 0.06);
    this.roarGain.gain.setTargetAtTime(0.02 + throttle * 0.16 + (rpm > 6400 ? 0.06 : 0), now, 0.07);

    this.windFilter.frequency.setTargetAtTime(320 + speed * 4, now, 0.1);
    this.windGain.gain.setTargetAtTime(Math.min(0.12, (speed / 260) * 0.14), now, 0.15);

    // gear change: brief torque cut, like the gearbox actually does
    if (t.gear !== this.lastGear) {
      this.lastGear = t.gear;
      if (speed > 5) {
        this.engineGain.gain.setTargetAtTime(engineTarget * 0.45, now, 0.01);
        this.#blip({ frequency: 1400, duration: 0.06, gain: 0.1, type: 'highpass' });
      }
    }

    // tyre slip / ABS squeal
    this.slipCooldown -= dt;
    if ((t.tractionLoss || (braking && t.absActive)) && this.slipCooldown <= 0 && speed > 8) {
      this.#blip({ frequency: 1900, duration: 0.22, gain: 0.16 });
      this.slipCooldown = 0.18;
    }
  }
}
