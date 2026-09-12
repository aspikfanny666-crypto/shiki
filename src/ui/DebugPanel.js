/** Debug overlay: the model import report. Live telemetry lives in Hud.js. */
export class DebugPanel {
  constructor(container) {
    this.el = document.createElement('div');
    this.el.className = 'debug-panel';
    container.appendChild(this.el);

    this.controls = document.createElement('div');
    this.controls.className = 'debug-controls';
    container.appendChild(this.controls);

    this.collapsed = false;
    this.el.addEventListener('click', (e) => {
      if (e.target.closest('h1')) this.toggle();
    });
  }

  toggle() {
    this.collapsed = !this.collapsed;
    this.el.classList.toggle('collapsed', this.collapsed);
  }

  static #mark(ok) {
    return ok ? '<span class="ok">✓</span>' : '<span class="bad">✗</span>';
  }

  static #row(label, value) {
    return `<div class="row"><span class="k">${label}</span><span class="v">${value}</span></div>`;
  }

  renderLoading(message = 'loading model…') {
    this.el.innerHTML = `<h1>BMW M5 F90</h1><div class="sub">${message}</div>`;
  }

  render(visual, physics) {
    const P = DebugPanel;
    const { stats, parts, measurements, normalization } = visual;

    const wheelRow = (key) => {
      const w = visual.wheels[key];
      if (!w) return `${P.#mark(false)} <span class="dim">not detected</span>`;
      return `${P.#mark(true)} <span class="dim">${w.method} · r=${w.radius}m · ${w.triangles.toLocaleString()} tris</span>`;
    };
    const partRow = (res) => {
      if (!res.found) return `${P.#mark(false)} <span class="dim">not identifiable</span>`;
      const names = res.names.slice(0, 2).join(', ') + (res.names.length > 2 ? ` +${res.names.length - 2}` : '');
      return `${P.#mark(true)} <span class="dim">${names}${res.merged ? ' <span class="warn">(merged)</span>' : ''}</span>`;
    };

    const glbOk = !visual.isPlaceholder;
    const banner = glbOk
      ? `<div class="banner ok-banner">GLB loaded · ${visual.source.loadMs} ms${visual.credit ? `<br><span class="dim">${visual.credit.title} — ${visual.credit.author?.split(' (')[0]} · ${visual.credit.license?.split(' (')[0]}</span>` : ''}</div>`
      : `<div class="banner bad-banner">GLB NOT loaded — showing PLACEHOLDER_ geometry.<br>Put the model at public/models/bmw-f90.glb</div>`;

    const delta = (v) => `<span class="${Math.abs(v) > 10 ? 'warn' : 'dim'}">(${v > 0 ? '+' : ''}${v}%)</span>`;
    const physicsOk = Boolean(physics?.ready);

    this.el.innerHTML = `
      <h1>BMW M5 F90 <span class="fold">▾</span></h1>
      ${banner}
      ${P.#row('GLB loaded', glbOk ? '<span class="ok">YES</span>' : '<span class="bad">NO</span>')}
      ${P.#row('Physics connected', physicsOk ? '<span class="ok">YES</span>' : `<span class="bad">NO</span> <span class="dim">${physics?.error ?? ''}</span>`)}

      <h2>Model</h2>
      ${P.#row('Triangles', stats.triangles.toLocaleString())}
      ${P.#row('Vertices', stats.vertices.toLocaleString())}
      ${P.#row('Meshes', stats.meshes)}
      ${P.#row('Materials', stats.materials)}
      ${P.#row('Textures', stats.textures)}
      ${P.#row('Draw calls (est.)', stats.estimatedDrawCalls)}

      <h2>Dimensions</h2>
      ${P.#row('Length', `${measurements.length} m ${delta(normalization.deltaPct.length)}`)}
      ${P.#row('Width', `${measurements.width} m ${delta(normalization.deltaPct.width)}`)}
      ${P.#row('Height', `${measurements.height} m ${delta(normalization.deltaPct.height)}`)}
      ${P.#row('Wheelbase', visual.wheelbase ? `${visual.wheelbase} m` : '<span class="dim">n/a</span>')}
      ${P.#row('Track F/R', visual.trackFront ? `${visual.trackFront} / ${visual.trackRear} m` : '<span class="dim">n/a</span>')}
      ${P.#row('Scale applied', `×${normalization.scaleApplied.toFixed(4)}`)}

      <h2>Detected wheels</h2>
      ${P.#row('FL', wheelRow('frontLeft'))}
      ${P.#row('FR', wheelRow('frontRight'))}
      ${P.#row('RL', wheelRow('rearLeft'))}
      ${P.#row('RR', wheelRow('rearRight'))}

      <h2>Detected parts</h2>
      ${P.#row('Steering wheel', partRow(parts.steeringWheel))}
      ${P.#row('Dashboard', partRow(parts.dashboard))}
      ${P.#row('Interior', partRow(parts.interior))}
      ${P.#row('Headlights', partRow(parts.headlights))}
      ${P.#row('Brake lights', partRow(parts.brakeLights))}
      ${P.#row('Turn signals', partRow(parts.turnSignals))}

      <h2>Orientation</h2>
      ${P.#row('Up / forward / right', '+Y / −Z / +X')}
      ${P.#row('Nose check', `<span class="dim">${normalization.forwardHint?.method ?? 'undetermined'}</span>`)}

      ${visual.warnings.length ? `<h2>Warnings</h2><ul class="warns">${visual.warnings.map((w) => `<li>${w}</li>`).join('')}</ul>` : ''}
      <div class="hint">Full hierarchy dump in the console · <code>window.__BMW__</code></div>
    `;
  }

  addButton(label, onClick) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => onClick(b));
    this.controls.appendChild(b);
    return b;
  }
}
