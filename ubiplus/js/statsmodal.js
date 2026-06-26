// UVSETTINGS + STATSMODAL — frontend for the UbiView NMS integration.
//
// UVSETTINGS: small modal under TOOLS > UbiView Stats. Stores the two pairs of
//   credentials (outer "Please enter password" gate + inner UbiView app login)
//   in localStorage. Has a TEST button that does a live login round-trip.
//
// STATSMODAL: per-card modal opened by the STATS button. Four tabs:
//   - LIVE       — current wb_power_a/b + in/out power per channel + tiny TD chart
//   - SPECTROGRAM — heatmap of the latest in/out spectrum from getUbifixInoutData
//   - OPTiX      — current OPTiX mode per sector with a small timeline
//   - DEVICE     — getDeviceInfo key/value table
//
// All four tabs target ONE sector at a time (A/B/C/D pills at the top). Live
// data is fetched on tab activation, cached per (unit, sector, tab) until
// REFRESH is clicked. Canvas charts are inlined (no chart library) so this
// works offline on the OSP.

// ============================================================================
// UVSETTINGS
// ============================================================================
const UVSETTINGS = {
  open() {
    const cfg = UVCLIENT.cfg || {};
    document.getElementById('uvBaseUrl').value   = cfg.baseUrl   || 'http://172.19.15.51/NMS';
    document.getElementById('uvOuterUser').value = cfg.outerUser || '';
    document.getElementById('uvOuterPass').value = cfg.outerPass || '';
    document.getElementById('uvInnerUser').value = cfg.innerUser || '';
    document.getElementById('uvInnerPass').value = cfg.innerPass || '';
    this._setStatus('', '');
    document.getElementById('uvSettingsModal').classList.add('open');
    setTimeout(() => document.getElementById('uvOuterUser').focus(), 60);
  },

  close() { document.getElementById('uvSettingsModal').classList.remove('open'); },

  _readForm() {
    return {
      baseUrl:   document.getElementById('uvBaseUrl').value.trim() || 'http://172.19.15.51/NMS',
      outerUser: document.getElementById('uvOuterUser').value.trim(),
      outerPass: document.getElementById('uvOuterPass').value,
      innerUser: document.getElementById('uvInnerUser').value.trim(),
      innerPass: document.getElementById('uvInnerPass').value,
    };
  },

  _setStatus(text, kind) {
    const el = document.getElementById('uvStatus');
    el.textContent = text;
    el.className = 'uv-status' + (kind ? ' uv-status-' + kind : '');
  },

  save() {
    const f = this._readForm();
    if (!f.outerUser || !f.outerPass || !f.innerUser || !f.innerPass) {
      this._setStatus('All four credentials are required.', 'err'); return;
    }
    UVCLIENT.saveCfg(f);
    UI.toast('UbiView settings saved');
    UI.renderGrid();   // re-render cards so STATS buttons enable
    this.close();
  },

  clear() {
    if (!confirm('Forget UbiView credentials? (cached fleet tree will also be cleared)')) return;
    UVCLIENT.clearCfg();
    ['uvBaseUrl','uvOuterUser','uvOuterPass','uvInnerUser','uvInnerPass'].forEach(id =>
      document.getElementById(id).value = id === 'uvBaseUrl' ? 'http://172.19.15.51/NMS' : '');
    this._setStatus('Cleared.', 'ok');
    UI.renderGrid();
  },

  // Save creds temporarily into UVCLIENT, run a live login, report result.
  // We don't persist on test failure — saver is a separate explicit action.
  async test() {
    const f = this._readForm();
    if (!f.outerUser || !f.outerPass || !f.innerUser || !f.innerPass) {
      this._setStatus('Fill all four credentials first.', 'err'); return;
    }
    const prev = UVCLIENT.cfg;
    UVCLIENT.cfg = f;
    this._setStatus('Testing connection...', 'pending');
    try {
      const r = await UVCLIENT.testLogin();
      const role = r && r.userData && r.userData.role || '';
      this._setStatus(`Connected as ${f.innerUser} ${role ? '· role: ' + role.split(',')[0] + '...' : ''}`, 'ok');
    } catch (e) {
      this._setStatus('Failed: ' + e.message, 'err');
      UVCLIENT.cfg = prev;
    }
  },
};

// ============================================================================
// STATSMODAL — per-card live stats from UbiView
// ============================================================================
const STATSMODAL = {
  _unit:    null,     // UDATA unit (our side)
  _uvUnit:  null,     // UbiView mapping (UVCLIENT.tree.units entry)
  _sector:  'A',
  _tab:     'live',
  _cache:   {},       // { 'live:A': data, 'spectro:A': data, ... }
  _treeBusy: false,

  async open(unitId) {
    const u = UDATA.get(unitId);
    if (!u) return;
    this._unit = u;
    this._sector = 'A';
    this._tab = 'live';
    this._cache = {};

    document.getElementById('stTitle').textContent = `STATS - ${u.name}`;
    document.getElementById('stFootMeta').textContent = `${u.ip}:${u.port}`;
    document.querySelectorAll('.st-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === 'live'));
    document.getElementById('statsModal').classList.add('open');

    if (!UVCLIENT.isConfigured()) {
      this._renderError('UbiView credentials not set. Open TOOLS > UbiView Stats first.');
      return;
    }

    this._setBody('<div class="st-placeholder"><span class="spin"></span> Resolving unit in UbiView tree...</div>');

    // Ensure the tree is loaded and find this unit's mapping
    try {
      if (!UVCLIENT.tree && !this._treeBusy) {
        this._treeBusy = true;
        try { await UVCLIENT.getTree(); } finally { this._treeBusy = false; }
      } else if (!UVCLIENT.tree && this._treeBusy) {
        // Another caller is fetching; wait briefly
        while (this._treeBusy) await new Promise(r => setTimeout(r, 200));
      }
    } catch (e) {
      this._renderError('Could not load UbiView fleet tree: ' + e.message);
      return;
    }

    this._uvUnit = UVCLIENT.findByIp(u.ip);
    if (!this._uvUnit) {
      this._renderError(
        `This unit's IP (${u.ip}) wasn't found in the UbiView fleet tree.\n\n` +
        `Tree diagnostic: ${UVCLIENT.describeTree()}\n\n` +
        `If the tree has 0 units, the parser couldn't extract anything — check the browser console (F12) for [UV] log lines.\n` +
        `If the tree has units but yours isn't among them, UbiView might track this site under a different IP.`
      );
      return;
    }

    this._renderSectorPills();
    this._loadTab();
  },

  close() {
    document.getElementById('statsModal').classList.remove('open');
    this._unit = null; this._uvUnit = null; this._cache = {};
  },

  setTab(tab) {
    if (this._tab === tab) return;
    this._tab = tab;
    document.querySelectorAll('.st-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    this._loadTab();
  },

  setSector(letter) {
    if (this._sector === letter) return;
    this._sector = letter;
    document.querySelectorAll('.st-sector-pill').forEach(b => b.classList.toggle('active', b.dataset.s === letter));
    this._loadTab();
  },

  refresh() {
    const key = this._tab + ':' + this._sector;
    delete this._cache[key];
    this._loadTab();
  },

  // ---- internal ----

  _renderSectorPills() {
    const pills = this._uvUnit.sectors.map(s =>
      `<button class="st-sector-pill${s.letter === this._sector ? ' active' : ''}" data-s="${s.letter}" onclick="STATSMODAL.setSector('${s.letter}')">S${s.letter.charCodeAt(0) - 64}</button>`
    ).join('');
    document.getElementById('stSectorPills').innerHTML = pills;
  },

  _setBody(html) { document.getElementById('stBody').innerHTML = html; },

  _renderError(msg) {
    this._setBody(`<div class="st-error">${this._esc(msg).replace(/\n/g, '<br>')}</div>`);
  },

  _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  },

  async _loadTab() {
    const key = this._tab + ':' + this._sector;
    if (this._cache[key]) { this._render(this._cache[key]); return; }

    this._setBody('<div class="st-placeholder"><span class="spin"></span> Fetching from UbiView...</div>');
    try {
      let data;
      switch (this._tab) {
        case 'live':    data = await UVCLIENT.getRRD(this._uvUnit, this._sector, 'last1hour', 20); break;
        case 'spectro': data = await UVCLIENT.getInout(this._uvUnit, this._sector, 'last1hour', 60); break;
        case 'optix':   data = await UVCLIENT.getOptix(this._uvUnit, 'last6hours'); break;
        case 'device':  data = await UVCLIENT.getDeviceInfo(this._uvUnit, this._sector); break;
      }
      this._cache[key] = data;
      this._render(data);
    } catch (e) {
      this._renderError('Fetch failed: ' + e.message);
    }
  },

  _render(data) {
    switch (this._tab) {
      case 'live':    this._renderLive(data); break;
      case 'spectro': this._renderSpectro(data); break;
      case 'optix':   this._renderOptix(data); break;
      case 'device':  this._renderDevice(data); break;
    }
  },

  // ---- Live tab ----
  _renderLive(rrd) {
    if (!rrd || !rrd.data || !rrd.data.length) {
      this._renderError(`No RSSI data returned for sector ${this._sector}. Maybe this sector doesn't exist on this unit.`);
      return;
    }
    const latest = UVCLIENT.latestRrdPoint(rrd);
    const series = UVCLIENT.rrdSeries(rrd);
    // Sentinel values (-99, -136, 0) all mean "no signal" - render as dim/dash
    const isEmpty = v => v == null || v === 0 || v <= -135 || v >= 0;
    const fmt = v => isEmpty(v) ? '—' : v.toFixed(1) + ' dBm';
    const cellsFor = (prefix) => [0,1,2,3].map(i => {
      const empty = isEmpty(latest[prefix + i]);
      return `<div class="st-chan${empty ? ' st-chan-empty' : ''}"><div class="st-chan-lbl">Ch ${i}</div><div class="st-chan-val">${fmt(latest[prefix + i])}</div></div>`;
    }).join('');

    const html = `
      <div class="st-live-grid">
        <div class="st-card">
          <div class="st-card-hd">WIDEBAND POWER</div>
          <div class="st-wb-row${isEmpty(latest.wb_power_a) ? ' st-wb-empty' : ''}"><span class="st-wb-lbl">Antenna A</span><span class="st-wb-val">${fmt(latest.wb_power_a)}</span></div>
          <div class="st-wb-row${isEmpty(latest.wb_power_b) ? ' st-wb-empty' : ''}"><span class="st-wb-lbl">Antenna B</span><span class="st-wb-val">${fmt(latest.wb_power_b)}</span></div>
          <div class="st-card-foot">
            <span class="st-alarm ${latest.alarm_reg ? 'on' : ''}">${latest.alarm_reg ? '⚠ ALARM REG = ' + latest.alarm_reg : 'no alarms'}</span>
          </div>
        </div>
        <div class="st-card">
          <div class="st-card-hd">INPUT POWER — antenna A</div>
          <div class="st-chan-row">${cellsFor('input_power_a')}</div>
          <div class="st-card-hd">INPUT POWER — antenna B</div>
          <div class="st-chan-row">${cellsFor('input_power_b')}</div>
        </div>
        <div class="st-card">
          <div class="st-card-hd">OUTPUT POWER — antenna A</div>
          <div class="st-chan-row">${cellsFor('output_power_a')}</div>
          <div class="st-card-hd">OUTPUT POWER — antenna B</div>
          <div class="st-chan-row">${cellsFor('output_power_b')}</div>
        </div>
      </div>
      <div class="st-chart-hd">CHANNEL 0 INPUT/OUTPUT — last hour (UbiView RRD)</div>
      <canvas class="st-chart" id="stChart" width="800" height="200"></canvas>
      <div class="st-legend">
        <span class="st-leg-sw" style="background:#19b563"></span> A In
        <span class="st-leg-sw" style="background:#2e77e5"></span> B In
        <span class="st-leg-sw" style="background:#f5a142"></span> A Out
        <span class="st-leg-sw" style="background:#d678a8"></span> B Out
      </div>`;
    this._setBody(html);
    this._drawTdChart(document.getElementById('stChart'), series);
  },

  // Tiny no-dependency line chart on canvas. Plots 4 series (A In, B In, A Out, B Out)
  // sharing one Y axis (dBm). Filters out the sentinel -99 / -136 values that
  // UbiView uses for "no signal" so they don't drag the Y range down.
  _drawTdChart(canvas, series) {
    if (!canvas || !series) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const padL = 38, padR = 12, padT = 10, padB = 22;
    const css = getComputedStyle(document.documentElement);
    const gridColor = css.getPropertyValue('--line').trim() || '#d9dde6';
    const axisColor = css.getPropertyValue('--txt-faint').trim() || '#9da3af';
    const textColor = css.getPropertyValue('--txt-dim').trim() || '#656565';

    ctx.clearRect(0, 0, W, H);

    // determine Y range from non-sentinel values
    const all = [].concat(series.inA, series.inB, series.outA, series.outB)
                  .filter(v => v != null && v > -135 && v < 0);
    if (!all.length) {
      ctx.fillStyle = textColor; ctx.font = '12px sans-serif';
      ctx.fillText('No live signal in window.', padL, H / 2);
      return;
    }
    let yMin = Math.min(...all), yMax = Math.max(...all);
    const pad = Math.max(2, (yMax - yMin) * 0.15);
    yMin -= pad; yMax += pad;
    const xMin = series.ts[0], xMax = series.ts[series.ts.length - 1];

    const xFor = t => padL + ((t - xMin) / Math.max(1, xMax - xMin)) * (W - padL - padR);
    const yFor = v => padT + (1 - (v - yMin) / Math.max(1, yMax - yMin)) * (H - padT - padB);

    // grid + Y labels (5 lines)
    ctx.strokeStyle = gridColor; ctx.lineWidth = 1;
    ctx.fillStyle = textColor; ctx.font = '10px Consolas, monospace';
    for (let i = 0; i <= 4; i++) {
      const v = yMin + (yMax - yMin) * (1 - i / 4);
      const y = padT + (i / 4) * (H - padT - padB);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      ctx.fillText(v.toFixed(0), 4, y + 3);
    }
    // X axis line
    ctx.strokeStyle = axisColor;
    ctx.beginPath(); ctx.moveTo(padL, H - padB); ctx.lineTo(W - padR, H - padB); ctx.stroke();

    // X labels: first + last
    const fmtTs = ms => {
      const d = new Date(ms), p = n => String(n).padStart(2, '0');
      return `${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    ctx.fillStyle = textColor;
    ctx.fillText(fmtTs(xMin), padL, H - 6);
    const lastLbl = fmtTs(xMax);
    ctx.fillText(lastLbl, W - padR - ctx.measureText(lastLbl).width, H - 6);

    // line plot helper
    const plotLine = (ys, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1.5;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < ys.length; i++) {
        const v = ys[i];
        if (v == null || v <= -135 || v >= 0) { started = false; continue; }
        const x = xFor(series.ts[i]);
        const y = yFor(v);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    plotLine(series.inA,  '#19b563');
    plotLine(series.inB,  '#2e77e5');
    plotLine(series.outA, '#f5a142');
    plotLine(series.outB, '#d678a8');
  },

  // ---- Spectrogram tab ----
  _renderSpectro(io) {
    if (!io || !io.data || !io.data.length) {
      this._renderError('No spectrogram data for sector ' + this._sector + '.');
      return;
    }
    const bins = io.numOfBins || (io.data[0].a_in || []).length;
    const rows = io.data.length;
    const html = `
      <div class="st-spec-hd">A In / B In / A Out / B Out · ${rows} time samples × ${bins} freq bins</div>
      <div class="st-spec-grid">
        <div class="st-spec-cell"><div class="st-spec-cap">A IN</div><canvas class="st-heat" id="stHeatAIn" width="380" height="120"></canvas></div>
        <div class="st-spec-cell"><div class="st-spec-cap">B IN</div><canvas class="st-heat" id="stHeatBIn" width="380" height="120"></canvas></div>
        <div class="st-spec-cell"><div class="st-spec-cap">A OUT</div><canvas class="st-heat" id="stHeatAOut" width="380" height="120"></canvas></div>
        <div class="st-spec-cell"><div class="st-spec-cap">B OUT</div><canvas class="st-heat" id="stHeatBOut" width="380" height="120"></canvas></div>
      </div>
      <div class="st-spec-scale">
        <span>weakest</span>
        <span class="st-spec-grad"></span>
        <span>strongest</span>
      </div>`;
    this._setBody(html);
    // Each canvas gets a heatmap: rows = time, cols = freq bins
    this._drawHeatmap(document.getElementById('stHeatAIn'),  io.data.map(d => d.a_in));
    this._drawHeatmap(document.getElementById('stHeatBIn'),  io.data.map(d => d.b_in));
    this._drawHeatmap(document.getElementById('stHeatAOut'), io.data.map(d => d.a_out));
    this._drawHeatmap(document.getElementById('stHeatBOut'), io.data.map(d => d.b_out));
  },

  // Resolves a CSS variable to an [r,g,b] tuple. Used so the spectrogram's
  // "no signal" background matches the live theme instead of being a hardcoded
  // bright parchment color (which looked harsh on dark mode).
  _cssRgb(varName, fallback) {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    if (!raw) return fallback;
    // hex like #2e2b29 or #aabbcc
    const m = raw.match(/^#([0-9a-f]{6})$/i);
    if (m) {
      const n = parseInt(m[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    // rgb()/rgba() literal
    const rgb = raw.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgb) return [+rgb[1], +rgb[2], +rgb[3]];
    return fallback;
  },

  // matrix is an array of rows; each row is an array of dBm values per freq bin.
  _drawHeatmap(canvas, matrix) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (!matrix || !matrix.length || !matrix[0]) return;
    const rows = matrix.length;
    const cols = matrix[0].length;
    let vmin = Infinity, vmax = -Infinity;
    for (const r of matrix) for (const v of r) {
      if (v == null || v <= -135 || v >= 0) continue;
      if (v < vmin) vmin = v; if (v > vmax) vmax = v;
    }
    if (!isFinite(vmin)) {
      const c = getComputedStyle(document.documentElement).getPropertyValue('--txt-faint').trim() || '#999';
      ctx.fillStyle = c; ctx.font = '11px sans-serif'; ctx.fillText('No signal', 8, H / 2); return;
    }
    if (vmax === vmin) vmax = vmin + 1;
    // Theme-aware "no signal" color sampled from the modal surface; this lets
    // the silent bins blend into the modal background instead of forming a
    // jarring bright band against the data.
    const noSig = this._cssRgb('--surface-hi', [235, 230, 222]);
    const img = ctx.createImageData(W, H);
    for (let py = 0; py < H; py++) {
      const ri = Math.floor(py / H * rows);
      const row = matrix[ri];
      for (let px = 0; px < W; px++) {
        const ci = Math.floor(px / W * cols);
        const v = row[ci];
        let r, g, b;
        if (v == null || v <= -135 || v >= 0) {
          [r, g, b] = noSig;
        } else {
          const t = Math.max(0, Math.min(1, (v - vmin) / (vmax - vmin)));
          [r, g, b] = this._turbo(t);
        }
        const idx = (py * W + px) * 4;
        img.data[idx] = r; img.data[idx + 1] = g; img.data[idx + 2] = b; img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  },

  // Approximate turbo colormap: t in [0,1] -> [r,g,b]
  _turbo(t) {
    // five-stop linear gradient
    const stops = [
      [40, 30, 120],     // deep indigo
      [40, 160, 200],    // cyan-teal
      [120, 220, 80],    // green
      [240, 200, 60],    // yellow
      [230, 50, 90],     // magenta-red
    ];
    const seg = t * (stops.length - 1);
    const i = Math.floor(seg);
    const f = seg - i;
    const a = stops[i], b = stops[Math.min(stops.length - 1, i + 1)];
    return [
      Math.round(a[0] + (b[0] - a[0]) * f),
      Math.round(a[1] + (b[1] - a[1]) * f),
      Math.round(a[2] + (b[2] - a[2]) * f),
    ];
  },

  // ---- OPTiX tab ----
  _renderOptix(data) {
    if (!data || !data.devices) { this._renderError('No OPTiX data.'); return; }
    const dev = data.devices[0];
    if (!dev || !dev.data) { this._renderError('No OPTiX data for this device.'); return; }
    const fmtTs = sec => {
      const d = new Date(sec * 1000), p = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    const rows = dev.data.map(s => {
      const m = (s.optixModeData || []);
      if (!m.length) {
        return `<tr><td>${this._esc(s.actName)}</td><td colspan="3" class="st-dim">no data in window</td></tr>`;
      }
      // most recent first
      const sorted = m.slice().sort((a,b) => +b.endSecEpoch - +a.endSecEpoch);
      return sorted.map(e => `<tr>
        <td>${this._esc(s.actName)}</td>
        <td>${fmtTs(+e.startSecEpoch)}</td>
        <td>${fmtTs(+e.endSecEpoch)}</td>
        <td>mode ${e.modeNumber} · link ${e.linkStatus}</td>
      </tr>`).join('');
    }).join('');

    this._setBody(`
      <div class="st-spec-hd">OPTiX mode timeline · ${fmtTs(data.startSecEpoch)} → ${fmtTs(data.endSecEpoch)}</div>
      <table class="st-table">
        <thead><tr><th>Sector</th><th>Start</th><th>End</th><th>State</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`);
  },

  // ---- Device tab ----
  _renderDevice(info) {
    if (!info || typeof info !== 'object') { this._renderError('No device info returned.'); return; }
    const rows = Object.keys(info).map(k =>
      `<tr><th>${this._esc(k)}</th><td>${this._esc(info[k])}</td></tr>`).join('');
    this._setBody(`
      <div class="st-spec-hd">Device info — ${this._esc(this._unit.name)} Sector ${this._sector.charCodeAt(0)-64}</div>
      <table class="st-table st-kv"><tbody>${rows}</tbody></table>`);
  },
};
