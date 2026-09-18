/**
 * Engine audio — synthesised, no sample files.
 *
 * The previous version stacked three sawtooth oscillators on the firing
 * frequency, which reads as a buzz rather than an engine. This one is built the
 * way engine noise is actually analysed, in ENGINE ORDERS:
 *
 *   - A four-stroke cycle takes two crank revolutions, so the fundamental is
 *     `rpm / 120` and engine order N sits on harmonic 2N. A cross-plane V8
 *     fires four times per cycle → order 4 dominates, and the uneven bank
 *     spacing puts real energy on the half orders (0.5, 1.5, 2.5 …). That
 *     half-order content IS the V8 burble.
 *   - Two PeriodicWaves carry that spectrum: one for light load, one for full
 *     throttle (far more upper-order energy), crossfaded by load.
 *   - The signal then goes through a soft-clipping waveshaper (exhaust
 *     non-linearity), three peaking resonators (pipe and body formants) and a
 *     short feedback delay (the pipe itself).
 *   - Around it: intake noise that opens with throttle, twin-turbo whistle
 *     driven by modelled boost with turbo lag, a wastegate chuff when you lift,
 *     overrun crackle, a rev-limiter chop, and road/wind noise.
 *   - The cabin filter follows the camera: muffled inside, bright outside.
 *
 * Everything is scheduled on AudioParams, so it costs almost nothing per frame.
 */

const CYLINDERS = 8;

/** Deterministic phase per harmonic — random phases avoid a buzzy, in-phase stack. */
function phaseFor(k) {
  return (Math.sin(k * 12.9898) * 43758.5453) % (Math.PI * 2);
}

/**
 * @param {Record<number, number>} orders harmonic index (2 × engine order) → amplitude
 */
function buildWave(ctx, orders, { tilt = 1, harmonics = 64 } = {}) {
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let k = 1; k <= harmonics; k++) {
    let amp = orders[k] ?? 0;
    if (!amp) {
      // filler between the named orders: a little broadband content keeps the
      // note from sounding like a synthesiser, rolled off with frequency
      amp = 0.035 / Math.pow(k, 0.85);
    }
    amp *= Math.pow(1 / k, Math.max(0, 1 - tilt) * 0.6);
    const phase = phaseFor(k);
    real[k] = amp * Math.cos(phase);
    imag[k] = amp * Math.sin(phase);
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

/** Cross-plane V8 exhaust spectrum. Keys are harmonics of rpm/120, so k = 2 × order. */
const ORDERS_CRUISE = {
  1: 0.10, 2: 0.20, 3: 0.12, 4: 0.26, 5: 0.10, 6: 0.22, 7: 0.09,
  8: 1.00, 9: 0.08, 10: 0.15, 12: 0.18, 14: 0.09,
  16: 0.42, 20: 0.10, 24: 0.16, 28: 0.07, 32: 0.09, 40: 0.05, 48: 0.03,
};

const ORDERS_LOAD = {
  1: 0.14, 2: 0.24, 3: 0.16, 4: 0.30, 5: 0.14, 6: 0.26, 7: 0.13,
  8: 1.00, 9: 0.14, 10: 0.22, 12: 0.30, 14: 0.18,
  16: 0.72, 20: 0.26, 24: 0.44, 28: 0.22, 32: 0.30, 40: 0.20, 48: 0.14, 56: 0.09,
};

export class EngineAudio {
  /**
   * @param {object} opts
   *   settings  persisted user settings (sound on/off, volume)
   *   engine    { idleRpm, redlineRpm } from the vehicle tuning
   *   context   an existing AudioContext — pass an OfflineAudioContext to
   *             render the engine to a file instead of the speakers
   */
  constructor({ settings, engine = {}, context = null } = {}) {
    this.settings = settings;
    this.idleRpm = engine.idleRpm ?? 800;
    this.redlineRpm = engine.redlineRpm ?? 7200;

    this.ctx = null;
    this.externalContext = context;
    this.started = false;
    this.enabled = settings?.get('sound') ?? true;
    this.volume = settings?.get('volume') ?? 0.7;

    this.lastGear = '1';
    this.lastThrottle = 0;
    this.boost = 0;
    this.slipCooldown = 0;
    this.crackleUntil = 0;
    this.nextCrackle = 0;
    this.limiterPhase = 0;
    this.jitter = 0;
    this.camera = 'chase';

    settings?.subscribe((key) => {
      if (key === 'sound' || key === '*') this.setEnabled(settings.get('sound'));
      if (key === 'volume' || key === '*') this.setVolume(settings.get('volume'));
    });

    const unlock = () => this.resume();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  // ---------------------------------------------------------------- graph ---
  #build() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!this.externalContext && !Ctx) return false;
    const ctx = this.externalContext ?? new Ctx();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;

    this.limiterNode = ctx.createDynamicsCompressor();
    this.limiterNode.threshold.value = -12;
    this.limiterNode.knee.value = 6;
    this.limiterNode.ratio.value = 14;
    this.limiterNode.attack.value = 0.003;
    this.limiterNode.release.value = 0.14;
    this.master.connect(this.limiterNode).connect(ctx.destination);

    // cabin: how much of the car is between you and the engine
    this.cabin = ctx.createBiquadFilter();
    this.cabin.type = 'lowpass';
    this.cabin.frequency.value = 7000;
    this.cabin.Q.value = 0.4;
    this.cabin.connect(this.master);

    this.#buildEngine(ctx);
    this.#buildNoiseLayers(ctx);

    this.started = true;
    return true;
  }

  #buildEngine(ctx) {
    this.waveCruise = buildWave(ctx, ORDERS_CRUISE, { tilt: 0.55 });
    this.waveLoad = buildWave(ctx, ORDERS_LOAD, { tilt: 1 });

    // output of the whole exhaust chain
    this.engineOut = ctx.createGain();
    this.engineOut.gain.value = 0;
    this.engineOut.connect(this.cabin);

    // --- pipe: a short feedback delay gives the note a hollow, tubular tail
    this.pipe = ctx.createDelay(0.05);
    this.pipe.delayTime.value = 0.0065;
    this.pipeFeedback = ctx.createGain();
    this.pipeFeedback.gain.value = 0.32;
    this.pipeDamp = ctx.createBiquadFilter();
    this.pipeDamp.type = 'lowpass';
    this.pipeDamp.frequency.value = 2400;
    this.pipe.connect(this.pipeDamp).connect(this.pipeFeedback).connect(this.pipe);
    this.pipe.connect(this.engineOut);

    // --- formants: exhaust and body resonances
    this.formants = [
      { freq: 95, q: 5.5, gain: 9 },
      { freq: 240, q: 4.0, gain: 7 },
      { freq: 680, q: 2.5, gain: 5 },
    ].map(({ freq, q, gain }) => {
      const f = ctx.createBiquadFilter();
      f.type = 'peaking';
      f.frequency.value = freq;
      f.Q.value = q;
      f.gain.value = gain;
      return f;
    });

    // --- non-linearity: what makes an exhaust bark instead of hum
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = EngineAudio.#softClipCurve(2.6);
    this.shaper.oversample = '2x';

    // drive into the shaper rises with load, so full throttle sounds harder
    this.drive = ctx.createGain();
    this.drive.gain.value = 0.6;

    let chain = this.drive;
    chain.connect(this.shaper);
    let node = this.shaper;
    for (const f of this.formants) {
      node.connect(f);
      node = f;
    }
    node.connect(this.pipe);
    node.connect(this.engineOut); // dry path, so it is not all resonance

    // --- the two spectra
    const makeVoice = (wave, gain) => {
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(wave);
      osc.frequency.value = this.idleRpm / 120;
      const g = ctx.createGain();
      g.gain.value = gain;
      osc.connect(g).connect(this.drive);
      osc.start();
      return { osc, gain: g };
    };
    this.voiceCruise = makeVoice(this.waveCruise, 0.9);
    this.voiceLoad = makeVoice(this.waveLoad, 0.0);

    // a sub layer an octave down fills in the chest-thump a phone speaker misses
    this.sub = ctx.createOscillator();
    this.sub.type = 'sine';
    this.sub.frequency.value = this.idleRpm / 120;
    this.subGain = ctx.createGain();
    this.subGain.gain.value = 0.0;
    this.sub.connect(this.subGain).connect(this.engineOut);
    this.sub.start();
  }

  #buildNoiseLayers(ctx) {
    this.noiseBuffer = this.#noiseBuffer(ctx, 3);

    const noiseSource = () => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      src.start();
      return src;
    };

    // intake: broad, opens with throttle, tracks rpm
    this.intakeFilter = ctx.createBiquadFilter();
    this.intakeFilter.type = 'bandpass';
    this.intakeFilter.frequency.value = 420;
    this.intakeFilter.Q.value = 0.9;
    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0;
    noiseSource().connect(this.intakeFilter).connect(this.intakeGain).connect(this.cabin);

    // twin-turbo whistle: narrow noise band plus a faint tone
    this.turboFilter = ctx.createBiquadFilter();
    this.turboFilter.type = 'bandpass';
    this.turboFilter.frequency.value = 3200;
    this.turboFilter.Q.value = 11;
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    noiseSource().connect(this.turboFilter).connect(this.turboGain).connect(this.cabin);

    this.turboTone = ctx.createOscillator();
    this.turboTone.type = 'triangle';
    this.turboTone.frequency.value = 3200;
    this.turboToneGain = ctx.createGain();
    this.turboToneGain.gain.value = 0;
    this.turboTone.connect(this.turboToneGain).connect(this.cabin);
    this.turboTone.start();

    // road and wind, straight to master: they are outside the cabin filter
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 450;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    noiseSource().connect(this.windFilter).connect(this.windGain).connect(this.master);
  }

  static #softClipCurve(drive = 2.5, size = 1024) {
    const curve = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      const x = (i / (size - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
    }
    return curve;
  }

  #noiseBuffer(ctx, seconds) {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      // brown-ish noise: warmer than white, closer to air than hiss
      last = (last + (Math.random() * 2 - 1) * 0.11) * 0.986;
      data[i] = last * 1.6;
    }
    return buffer;
  }

  // ------------------------------------------------------------- lifecycle ---
  resume() {
    if (!this.started && !this.#build()) return false;
    // an OfflineAudioContext is 'suspended' until it renders, and resuming it
    // throws — only a live context gets resumed
    if (!this.externalContext && this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }

  get running() {
    // an OfflineAudioContext is never 'running', but it is always ready to take
    // scheduled values
    return Boolean(this.ctx && (this.ctx.state === 'running' || this.externalContext));
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

  /** Cockpit is muffled, outside is bright. */
  setCamera(mode) {
    this.camera = mode;
    if (this.ctx) {
      const inside = mode === 'cockpit' || mode === 'hood';
      this.cabin.frequency.setTargetAtTime(inside ? 1500 : 7000, this.ctx.currentTime, 0.2);
    }
    return mode;
  }

  // ----------------------------------------------------------- one-shots ---
  #burst({ frequency = 900, duration = 0.12, gain = 0.2, q = 2.5, type = 'bandpass', sweepTo = null }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.8 + Math.random() * 0.5;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(frequency, now);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, now + duration);
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    src.connect(filter).connect(g).connect(this.cabin);
    src.start(now, Math.random() * 2);
    src.stop(now + duration);
  }

  /** Exhaust pop on a closed throttle — short, bright, irregular. */
  #crackle() {
    this.#burst({ frequency: 1200 + Math.random() * 1800, duration: 0.05 + Math.random() * 0.05, gain: 0.10 + Math.random() * 0.1, q: 1.6 });
  }

  /** Wastegate / blow-off chuff when you lift off boost. */
  #wastegate(strength) {
    this.#burst({ frequency: 5200, sweepTo: 1400, duration: 0.3, gain: 0.05 + strength * 0.09, q: 1.2 });
  }

  // ---------------------------------------------------------------- frame ---
  /**
   * @param {number} dt seconds
   * @param {object} t VehiclePhysics telemetry
   * @param {number|null} atTime schedule at this context time instead of "now"
   *        — used when rendering offline, where currentTime does not advance
   */
  update(dt, t, atTime = null) {
    if (!this.running) return;

    const ctx = this.ctx;
    const now = atTime ?? ctx.currentTime;
    const rpm = Math.max(this.idleRpm * 0.8, t.rpm ?? this.idleRpm);
    const throttle = t.throttle ?? 0;
    const speed = Math.abs(t.speedKmh ?? 0);
    const rpmNorm = Math.min(1, rpm / this.redlineRpm);

    // --- pitch: fundamental is one four-stroke cycle, with a little wander so
    //     the note never sounds mathematically pure
    this.jitter += (Math.random() - 0.5) * 0.4 * dt;
    this.jitter *= 0.9;
    const idleLump = rpm < this.idleRpm * 1.4 ? Math.sin(now * 7.3) * 0.006 + Math.sin(now * 3.1) * 0.004 : 0;
    const f0 = (rpm / 120) * (1 + this.jitter * 0.01 + idleLump);
    const smoothing = 0.035;
    this.voiceCruise.osc.frequency.setTargetAtTime(f0, now, smoothing);
    this.voiceLoad.osc.frequency.setTargetAtTime(f0, now, smoothing);
    this.sub.frequency.setTargetAtTime(f0 * 2, now, smoothing); // one order down

    // --- load: throttle plus how hard the engine is actually pulling
    const load = Math.min(1, throttle * 0.8 + rpmNorm * 0.35 + (t.engineForce > 0 ? 0.1 : 0));
    this.voiceCruise.gain.gain.setTargetAtTime(0.9 * (1 - load * 0.55), now, 0.08);
    this.voiceLoad.gain.gain.setTargetAtTime(1.15 * load, now, 0.08);
    this.drive.gain.setTargetAtTime(0.5 + load * 0.9, now, 0.1);
    this.subGain.gain.setTargetAtTime(0.05 + load * 0.16, now, 0.1);

    // overall level: idle is quiet, full load is loud, plus a rev-limiter chop
    let level = 0.06 + load * 0.34 + rpmNorm * 0.06;
    if (rpm > this.redlineRpm - 120 && throttle > 0.3) {
      this.limiterPhase += dt * 26;
      if (Math.sin(this.limiterPhase) < 0) level *= 0.25;
    }
    this.engineOut.gain.setTargetAtTime(level, now, 0.02);

    // formants open slightly with load — a real exhaust gets brighter, not just louder
    this.formants[2].frequency.setTargetAtTime(680 + load * 520, now, 0.12);
    this.pipeFeedback.gain.setTargetAtTime(0.22 + (1 - load) * 0.16, now, 0.15);
    this.pipeDamp.frequency.setTargetAtTime(1800 + load * 2600, now, 0.12);

    // --- intake
    this.intakeFilter.frequency.setTargetAtTime(300 + rpmNorm * 1500, now, 0.07);
    this.intakeGain.gain.setTargetAtTime(0.015 + throttle * 0.11, now, 0.08);

    // --- turbo: boost builds with revs and throttle, and bleeds away with lag
    const boostTarget = throttle * Math.min(1, (rpm - 1500) / 3000);
    const lag = throttle > this.lastThrottle ? 0.55 : 2.2; // spools slower than it drops
    this.boost += (Math.max(0, boostTarget) - this.boost) * Math.min(1, dt * lag * 2);
    const whistle = 2600 + this.boost * 5200 + rpmNorm * 900;
    this.turboFilter.frequency.setTargetAtTime(whistle, now, 0.08);
    this.turboGain.gain.setTargetAtTime(this.boost * 0.05, now, 0.1);
    this.turboTone.frequency.setTargetAtTime(whistle, now, 0.08);
    this.turboToneGain.gain.setTargetAtTime(this.boost * this.boost * 0.012, now, 0.1);

    // lifting off boost: wastegate chuff, then crackle on the overrun
    if (this.lastThrottle > 0.45 && throttle < 0.12) {
      if (this.boost > 0.25) this.#wastegate(this.boost);
      if (rpm > 3000) {
        this.crackleUntil = now + 0.5 + Math.random() * 0.6;
        this.nextCrackle = now;
      }
    }
    if (now < this.crackleUntil && now >= this.nextCrackle && rpm > 2200) {
      this.#crackle();
      this.nextCrackle = now + 0.03 + Math.random() * 0.12;
    }
    this.lastThrottle = throttle;

    // --- road and wind
    this.windFilter.frequency.setTargetAtTime(280 + speed * 5, now, 0.15);
    this.windGain.gain.setTargetAtTime(Math.min(0.1, (speed / 250) * 0.12), now, 0.2);

    // --- gear change: the torque cut you can hear in a ZF box
    if (t.gear !== this.lastGear) {
      const upshift = Number(t.gear) > Number(this.lastGear);
      this.lastGear = t.gear;
      if (speed > 5) {
        this.engineOut.gain.setTargetAtTime(level * 0.35, now, 0.008);
        this.engineOut.gain.setTargetAtTime(level, now + 0.07, 0.05);
        if (upshift && load > 0.5) this.#crackle();
      }
    }

    // --- tyres
    this.slipCooldown -= dt;
    const squeal = t.tractionLoss || (t.absActive && (t.brake ?? 0) > 0.2);
    if (squeal && this.slipCooldown <= 0 && speed > 8) {
      this.#burst({ frequency: 1500 + Math.random() * 900, duration: 0.25, gain: 0.13, q: 6 });
      this.slipCooldown = 0.16;
    }
  }
}
