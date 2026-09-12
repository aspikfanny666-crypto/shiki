/**
 * User settings, persisted in localStorage.
 *
 * Everything here is a rendering/feel preference — nothing that changes the
 * physics model. `Settings.subscribe` lets each system react when a value
 * changes, so the panel never has to know what a setting actually does.
 */

const KEY = 'bmw-f90-sim.settings.v1';

export const QUALITY_PRESETS = {
  low: { pixelRatio: 1.0, shadowMapSize: 512, shadowDistance: 14, antialias: false, envIntensity: 0.7, contactShadow: true, anisotropy: 1 },
  medium: { pixelRatio: 1.5, shadowMapSize: 1024, shadowDistance: 18, antialias: true, envIntensity: 0.9, contactShadow: true, anisotropy: 2 },
  high: { pixelRatio: 2.0, shadowMapSize: 2048, shadowDistance: 24, antialias: true, envIntensity: 1.15, contactShadow: true, anisotropy: 8 },
};

export const DEFAULTS = {
  quality: 'medium', // low | medium | high
  shadows: true,
  reflections: true,
  headlightBeams: false, // real spot lights; off by default, they cost a shadow pass
  cameraSensitivity: 1.0, // 0.4 – 2.0
  steeringSensitivity: 1.0, // 0.5 – 1.6
  controlLayout: 'right', // right | left  (which thumb gets the pedals)
  debug: false,
};

function detectDefaults() {
  const mobile = matchMedia('(hover: none), (pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  return { ...DEFAULTS, quality: mobile || cores <= 4 ? 'medium' : 'high' };
}

export class Settings {
  constructor() {
    this.values = detectDefaults();
    this.listeners = new Set();
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.values, JSON.parse(raw));
    } catch {
      /* private mode / blocked storage — defaults are fine */
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.values));
    } catch {
      /* ignore: settings simply will not persist */
    }
  }

  get(key) {
    return this.values[key];
  }

  get preset() {
    return QUALITY_PRESETS[this.values.quality] ?? QUALITY_PRESETS.medium;
  }

  set(key, value) {
    if (this.values[key] === value) return;
    this.values[key] = value;
    this.save();
    for (const fn of this.listeners) fn(key, value, this);
  }

  reset() {
    this.values = detectDefaults();
    this.save();
    for (const fn of this.listeners) fn('*', null, this);
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const settings = new Settings();
