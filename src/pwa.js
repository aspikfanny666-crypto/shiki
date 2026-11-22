/**
 * Installing the simulator as an app.
 *
 * Two different things live here:
 *
 *  1. the service worker registration, which is what makes the game start
 *     without a network once it has been played through once, and
 *  2. the install affordance, which is deliberately platform-aware because the
 *     platforms genuinely differ: Chrome/Edge fire `beforeinstallprompt` and we
 *     can install with one tap, while iOS has no such event at all — Safari
 *     only installs through Share → Add to Home Screen, so there the honest
 *     thing to show is the instruction, not a button that cannot work.
 *
 * Nothing here runs in an embedded frame (a Claude artifact, an <iframe>
 * preview): a service worker registered from a sandboxed frame either throws
 * or is useless, and an app cannot be installed from inside someone else's
 * page.
 */

export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches
  || window.matchMedia('(display-mode: fullscreen)').matches
  || window.navigator.standalone === true;

export const isEmbedded = () => {
  try {
    return window.top !== window.self;
  } catch {
    return true; // cross-origin parent — embedded by definition
  }
};

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
  // iPadOS 13+ reports as a Mac; a Mac with a touchscreen is still an iPad.
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  // The single-page artifact bundle sets this: it ships no worker, and there is
  // nothing for one to cache that the page does not already carry inline.
  if (window.__NO_SERVICE_WORKER__) return Promise.resolve(null);
  if (isEmbedded()) return Promise.resolve(null);
  if (!import.meta.env.PROD) return Promise.resolve(null);
  // `base: './'` means the worker sits next to index.html whatever subdirectory
  // the build is hosted from, so the URL has to be resolved against the page.
  const url = new URL('sw.js', window.location.href);
  return navigator.serviceWorker.register(url, { scope: './' }).catch((err) => {
    console.warn('[pwa] service worker not registered:', err.message);
    return null;
  });
}

/**
 * Tracks whether the browser is willing to install the app right now.
 * `onChange` fires whenever the answer changes, so the settings panel can show
 * the right row without polling.
 */
export class InstallManager {
  constructor() {
    this.deferred = null;
    this.listeners = new Set();
    this.installed = isStandalone();

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); // we show our own button instead of Chrome's mini-bar
      this.deferred = e;
      this.#emit();
    });
    window.addEventListener('appinstalled', () => {
      this.deferred = null;
      this.installed = true;
      this.#emit();
    });
  }

  /** 'installed' | 'prompt' | 'ios' | 'unavailable' */
  get status() {
    if (this.installed || isStandalone()) return 'installed';
    if (this.deferred) return 'prompt';
    if (isEmbedded()) return 'unavailable';
    if (isIOS()) return 'ios';
    return 'unavailable';
  }

  async install() {
    if (!this.deferred) return false;
    const event = this.deferred;
    this.deferred = null;
    event.prompt();
    const { outcome } = await event.userChoice;
    this.#emit();
    return outcome === 'accepted';
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  #emit() {
    for (const fn of this.listeners) fn(this.status, this);
  }
}
