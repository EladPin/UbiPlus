// HISTORY — fleet snapshot storage and comparison
// Each completed check-all saves a compact snapshot (status+sectors per unit,
// no raw output) to localStorage. Snapshots are pruned to the retention window.
const HISTORY = {
  _KEY: 'ubiplus_history',
  entries: [], // [{ ts: ISO, snap: [{id, name, status, sectors}] }]

  load() {
    try { this.entries = JSON.parse(localStorage.getItem(this._KEY) || '[]'); }
    catch { this.entries = []; }
  },

  save() {
    try {
      localStorage.setItem(this._KEY, JSON.stringify(this.entries));
    } catch {
      // storage full — drop oldest half and retry
      this.entries = this.entries.slice(Math.ceil(this.entries.length / 2));
      try { localStorage.setItem(this._KEY, JSON.stringify(this.entries)); } catch {}
    }
  },

  snapshot() {
    if (!UDATA.units.length) return;
    const snap = UDATA.units.map(u => ({
      id: u.id, name: u.name,
      status: u.status, sectors: u.sectors || [],
    }));
    this.entries.push({ ts: new Date().toISOString(), snap });
    this._prune(typeof AUTOPOLL !== 'undefined' ? AUTOPOLL.retention : 7);
    this.save();
  },

  _prune(days) {
    const cutoff = Date.now() - days * 86400000;
    this.entries = this.entries.filter(e => new Date(e.ts).getTime() > cutoff);
    if (this.entries.length > 500) this.entries = this.entries.slice(-500);
  },

  latest() { return this.entries[this.entries.length - 1] || null; },

  // newest entry whose timestamp is ≤ ms
  atOrBefore(ms) {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (new Date(this.entries[i].ts).getTime() <= ms) return this.entries[i];
    }
    return null;
  },

  // diff two snap arrays — returns units that changed status or sectors
  diff(snapA, snapB) {
    const mapA = Object.fromEntries(snapA.map(u => [u.id, u]));
    const out = [];
    for (const b of snapB) {
      const a = mapA[b.id];
      if (!a) continue;
      if (a.status !== b.status || JSON.stringify(a.sectors) !== JSON.stringify(b.sectors))
        out.push({ id: b.id, name: b.name, from: a, to: b });
    }
    return out;
  },

  // approx storage used in KB
  sizeKB() { return Math.round(JSON.stringify(this.entries).length / 102.4) / 10; },

  // Per-unit timeline for the card sparkline. Returns up to `limit` most-recent
  // snapshots in chronological order; each entry is {ts, status, sectors}. Skips
  // snapshots that don't include this unit (e.g. it was added after that check).
  unitTimeline(unitId, limit = 40) {
    const out = [];
    for (const e of this.entries) {
      const u = e.snap.find(s => s.id === unitId);
      if (u) out.push({ ts: e.ts, status: u.status, sectors: u.sectors || [] });
    }
    return limit ? out.slice(-limit) : out;
  },
};

// HISTMODAL — fleet history summary modal
const HISTMODAL = {
  _range: '1check', // '1check' | '24h' | '7d' | '14d'

  open() {
    this._range = '1check';
    const ret = document.getElementById('pollRetentionSel');
    if (ret) ret.value = typeof AUTOPOLL !== 'undefined' ? AUTOPOLL.retention : 7;
    document.querySelectorAll('.hm-tab').forEach(b =>
      b.classList.toggle('active', b.dataset.r === this._range));
    this._renderBody();
    const sc = document.getElementById('hmSnapCount');
    if (sc) sc.textContent = `${HISTORY.entries.length} snapshot${HISTORY.entries.length !== 1 ? 's' : ''} · ${HISTORY.sizeKB()} KB`;
    document.getElementById('histModal').classList.add('open');
  },

  close() { document.getElementById('histModal').classList.remove('open'); },

  setRange(r) {
    this._range = r;
    document.querySelectorAll('.hm-tab').forEach(b =>
      b.classList.toggle('active', b.dataset.r === r));
    this._renderBody();
  },

  _pair() {
    const n = HISTORY.entries.length;
    if (!n) return null;
    const latest = HISTORY.entries[n - 1];
    let baseline;
    if (this._range === '1check') {
      baseline = n >= 2 ? HISTORY.entries[n - 2] : null;
    } else {
      const hours = { '24h': 24, '7d': 168, '14d': 336 }[this._range] || 24;
      const cutoffMs = new Date(latest.ts).getTime() - hours * 3600000;
      baseline = HISTORY.atOrBefore(cutoffMs);
      if (baseline && baseline.ts === latest.ts) baseline = HISTORY.entries[0] !== latest ? HISTORY.entries[0] : null;
    }
    return { baseline, latest };
  },

  _renderBody() {
    if (this._range === 'search') { this._renderSearchTab(); return; }
    const body = document.getElementById('hmBody');
    const exportBtn = document.getElementById('hmExport');
    const pair = this._pair();

    if (!pair || !pair.latest) {
      body.innerHTML = '<div class="hm-empty">No snapshots yet — run a Check All to start recording history.</div>';
      if (exportBtn) exportBtn.disabled = true;
      return;
    }
    if (!pair.baseline) {
      body.innerHTML = '<div class="hm-empty">Only one snapshot recorded so far — need at least two to compare.</div>';
      if (exportBtn) exportBtn.disabled = true;
      return;
    }

    const { baseline, latest } = pair;
    const stLbl = s => UI._meta(s).label;
    const stCls = s => UI.STATUS_META[s] ? s : 'unchecked';
    const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const fmt = ts => new Date(ts).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
    const countSt = (snap, st) => snap.filter(u => u.status === st).length;

    const statuses = ['inline', 'bypass', 'mixed', 'transparent', 'offline', 'unchecked'];
    const changed = HISTORY.diff(baseline.snap, latest.snap);

    const rows = statuses.map(st => {
      const before = countSt(baseline.snap, st);
      const after  = countSt(latest.snap, st);
      const d = after - before;
      const ds = d === 0 ? '—' : (d > 0 ? `+${d}` : `${d}`);
      const dcls = d === 0 ? '' : (st === 'inline' ? (d > 0 ? 'hm-d-good' : 'hm-d-bad') : (d > 0 ? 'hm-d-bad' : 'hm-d-good'));
      return `<div class="hm-sg-label"><span class="schip st-${stCls(st)}">${stLbl(st)}</span></div>
        <div class="hm-sg-val">${before}</div>
        <div class="hm-sg-val">${after}</div>
        <div class="hm-sg-val hm-delta ${dcls}">${ds}</div>`;
    }).join('');

    const changedHtml = changed.length
      ? `<div class="hm-section-title">${changed.length} unit${changed.length !== 1 ? 's' : ''} changed</div>
         <div class="hm-chg-list">${changed.map(c => {
            const secDiff = c.from.sectors.length && c.to.sectors.length
              ? c.from.sectors.map((s, i) => {
                  const t = c.to.sectors[i] || s;
                  return s !== t
                    ? `<span class="schip st-${stCls(s)}">${stLbl(s)}</span><span class="hm-chg-arr">→</span><span class="schip st-${stCls(t)}">${stLbl(t)}</span><span class="hm-sec-label">S${i+1}</span>`
                    : '';
                }).filter(Boolean).join('<span class="hm-sec-sep">·</span>')
              : '';
            const statDiff = c.from.status !== c.to.status
              ? `<span class="schip st-${stCls(c.from.status)}">${stLbl(c.from.status)}</span><span class="hm-chg-arr">→</span><span class="schip st-${stCls(c.to.status)}">${stLbl(c.to.status)}</span>`
              : '';
            return `<div class="hm-chg-row">
              <div class="hm-chg-name">${esc(c.name)}</div>
              <div class="hm-chg-detail">${secDiff || statDiff}</div>
            </div>`;
          }).join('')}</div>`
      : '<div class="hm-empty">No changes between these two snapshots.</div>';

    body.innerHTML = `
      <div class="hm-timerange">
        <span>${fmt(baseline.ts)}</span>
        <span class="hm-tr-arrow">→</span>
        <span>${fmt(latest.ts)}</span>
      </div>
      <div class="hm-summary-grid">
        <div class="hm-sg-head">STATUS</div>
        <div class="hm-sg-head">BEFORE</div>
        <div class="hm-sg-head">NOW</div>
        <div class="hm-sg-head">Δ</div>
        ${rows}
      </div>
      ${changedHtml}`;

    if (exportBtn) exportBtn.disabled = false;
  },

  exportCSV() {
    const pair = this._pair();
    if (!pair || !pair.latest) return;
    const { baseline, latest } = pair;
    const stLbl = s => UI._meta(s).label;
    const cell = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };

    const maxSec = Math.max(1, ...latest.snap.map(u => (u.sectors || []).length));
    const head = ['Site', 'Status (before)', 'Status (after)', 'Changed',
      ...Array.from({ length: maxSec }, (_, i) => `S${i + 1} before`),
      ...Array.from({ length: maxSec }, (_, i) => `S${i + 1} after`),
      'Changes'];

    const mapA = baseline ? Object.fromEntries(baseline.snap.map(u => [u.id, u])) : {};
    const rows = latest.snap.map(u => {
      const prev = mapA[u.id];
      const chg = prev && HISTORY.diff([prev], [u]).length > 0;
      let changes = '';
      if (chg && prev) {
        if (prev.sectors.length && u.sectors.length && prev.sectors.length === u.sectors.length) {
          changes = prev.sectors.map((s, i) => s !== u.sectors[i] ? `S${i+1} ${stLbl(s)} → ${stLbl(u.sectors[i])}` : '').filter(Boolean).join(', ');
        } else {
          changes = `${stLbl(prev.status)} → ${stLbl(u.status)}`;
        }
      }
      return [
        u.name,
        prev ? stLbl(prev.status) : '—',
        stLbl(u.status),
        chg ? 'YES' : '',
        ...Array.from({ length: maxSec }, (_, i) => prev?.sectors[i] ? stLbl(prev.sectors[i]) : ''),
        ...Array.from({ length: maxSec }, (_, i) => u.sectors[i] ? stLbl(u.sectors[i]) : ''),
        changes,
      ].map(cell).join(',');
    });

    const d = new Date(), p = n => String(n).padStart(2, '0');
    const fname = `ubiplus-history-${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.csv`;
    const csv = String.fromCharCode(0xFEFF) + [head.map(cell).join(','), ...rows].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = fname;
    a.click();
    URL.revokeObjectURL(a.href);
    UI.toast(`Exported → ${fname}`);
  },

  // ---- history search tab ----

  _renderSearchTab() {
    const body = document.getElementById('hmBody');
    const exportBtn = document.getElementById('hmExport');
    if (exportBtn) exportBtn.disabled = true;
    const names = new Set();
    for (const e of HISTORY.entries) for (const u of e.snap) names.add(u.name);
    const opts = [...names].sort().map(n => `<option value="${n}">`).join('');
    body.innerHTML = `<datalist id="hsSiteList">${opts}</datalist>
      <div class="hs-controls">
        <input class="hs-site-input" type="search" id="hsSiteSearch" placeholder="Site name…"
               list="hsSiteList" autocomplete="off" oninput="HISTMODAL._onSearchInput()">
        <input class="hs-date-input" type="date" id="hsDate" oninput="HISTMODAL._onSearchInput()">
        <input class="hs-time-input" type="time" id="hsTime" oninput="HISTMODAL._onSearchInput()">
        <button class="btn-ghost hs-clear-btn" onclick="HISTMODAL._clearSearch()">CLEAR</button>
      </div>
      <div id="hsResults"><div class="hm-empty">Type a site name, pick a date, or both.</div></div>`;
  },

  _onSearchInput() { this._renderSearchResults(); },

  _clearSearch() {
    const s = document.getElementById('hsSiteSearch');
    const d = document.getElementById('hsDate');
    const t = document.getElementById('hsTime');
    if (s) s.value = '';
    if (d) d.value = '';
    if (t) t.value = '';
    this._renderSearchResults();
  },

  _renderSearchResults() {
    const el = document.getElementById('hsResults');
    if (!el) return;
    const name  = (document.getElementById('hsSiteSearch')?.value || '').trim();
    const dateV = document.getElementById('hsDate')?.value  || '';
    const timeV = document.getElementById('hsTime')?.value  || '';
    if (!name && !dateV) {
      el.innerHTML = '<div class="hm-empty">Type a site name, pick a date, or both.</div>';
      return;
    }
    if (!HISTORY.entries.length) {
      el.innerHTML = '<div class="hm-empty">No history recorded yet — run a Check All first.</div>';
      return;
    }
    let targetMs = null;
    if (dateV) {
      targetMs = new Date(`${dateV}T${timeV || '00:00'}`).getTime();
      if (isNaN(targetMs)) targetMs = null;
    }
    if (name && !targetMs) el.innerHTML = this._renderUnitTimeline(name);
    else if (!name && targetMs) el.innerHTML = this._renderFleetAtTime(targetMs);
    else if (name && targetMs)  el.innerHTML = this._renderUnitAtTime(name, targetMs);
  },

  _nearestSnap(ms) {
    if (!HISTORY.entries.length) return null;
    let best = HISTORY.entries[0], bestDiff = Infinity, bestIdx = 0;
    for (let i = 0; i < HISTORY.entries.length; i++) {
      const d = Math.abs(new Date(HISTORY.entries[i].ts).getTime() - ms);
      if (d < bestDiff) { best = HISTORY.entries[i]; bestDiff = d; bestIdx = i; }
    }
    return { entry: best, prev: bestIdx > 0 ? HISTORY.entries[bestIdx - 1] : null, diffMs: bestDiff };
  },

  _renderUnitTimeline(name) {
    const q = name.toLowerCase();
    const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const stLbl = s => UI._meta(s).label;
    const stCls = s => UI.STATUS_META[s] ? s : 'unchecked';
    const fmt = ts => new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

    // collect all unique unit names that contain the query
    const allNames = new Set();
    for (const e of HISTORY.entries) for (const u of e.snap) {
      if (u.name.toLowerCase().includes(q)) allNames.add(u.name);
    }

    if (!allNames.size)
      return `<div class="hm-empty">No units found matching "<strong>${esc(name)}</strong>". Use the dropdown for autocomplete.</div>`;

    // if multiple matches, and query doesn't exactly match one, show a picker
    const exactName = [...allNames].find(n => n.toLowerCase() === q);
    if (!exactName && allNames.size > 1) {
      const pills = [...allNames].sort().map(n =>
        `<button class="hs-name-pill" onclick="document.getElementById('hsSiteSearch').value='${n.replace(/'/g, "\\'")}';HISTMODAL._onSearchInput()">${esc(n)}</button>`
      ).join('');
      return `<div class="hs-multi-header">${allNames.size} sites match — select one:</div><div class="hs-name-pills">${pills}</div>`;
    }

    const unitName = exactName || [...allNames][0];
    let prevStatus = null, prevSectors = null;
    const timeline = [];
    let total = 0;

    for (const entry of HISTORY.entries) {
      const u = entry.snap.find(u => u.name === unitName);
      if (!u) continue;
      total++;
      const secStr = JSON.stringify(u.sectors);
      const first = prevStatus === null;
      const changed = !first && (u.status !== prevStatus || secStr !== prevSectors);
      if (first || changed) timeline.push({ ts: entry.ts, status: u.status, sectors: u.sectors, first, changed });
      prevStatus = u.status;
      prevSectors = secStr;
    }

    if (!timeline.length)
      return `<div class="hm-empty">No recorded history for "<strong>${esc(unitName)}</strong>".</div>`;

    const changes = timeline.filter(e => e.changed).length;
    const rows = timeline.map(e => `
      <div class="hs-entry${e.first ? ' hs-first' : ''}">
        <div class="hs-ts">${fmt(e.ts)}</div>
        <div class="hs-state">
          <span class="schip st-${stCls(e.status)}">${stLbl(e.status)}</span>
          ${e.sectors.length ? `<span class="hs-secs">${e.sectors.map((s, i) =>
            `<span class="schip st-${stCls(s)}">S${i + 1}</span>`).join('')}</span>` : ''}
        </div>
        ${e.changed ? '<span class="hs-badge-chg">changed</span>' : e.first ? '<span class="hs-badge-first">first</span>' : ''}
      </div>`).join('');

    return `<div class="hs-tl-header">
        <span class="hs-tl-name">${esc(unitName)}</span>
        <span class="hs-tl-meta">${total} snapshots &nbsp;·&nbsp; ${changes} status change${changes !== 1 ? 's' : ''}</span>
      </div>
      <div class="hs-timeline">${rows}</div>`;
  },

  _renderFleetAtTime(ms) {
    const snap = this._nearestSnap(ms);
    if (!snap) return '<div class="hm-empty">No snapshots to compare.</div>';
    const stLbl = s => UI._meta(s).label;
    const stCls = s => UI.STATUS_META[s] ? s : 'unchecked';
    const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const fmt = ts => new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    const diffMin = Math.round(snap.diffMs / 60000);
    const direction = new Date(snap.entry.ts) > new Date(ms) ? 'after' : 'before';
    const diffStr = diffMin < 2 ? 'exact match' : diffMin < 60 ? `${diffMin} min ${direction}` : `${Math.round(diffMin / 60)}h ${direction}`;

    const counts = {};
    for (const u of snap.entry.snap) counts[u.status] = (counts[u.status] || 0) + 1;
    const countHtml = ['inline', 'bypass', 'mixed', 'transparent', 'offline', 'unchecked']
      .filter(st => counts[st])
      .map(st => `<span class="schip st-${stCls(st)}">${stLbl(st)} · ${counts[st]}</span>`).join('');

    const changed = snap.prev ? HISTORY.diff(snap.prev.snap, snap.entry.snap) : [];
    const changedHtml = changed.length
      ? `<div class="hs-chg-title">${changed.length} unit${changed.length !== 1 ? 's' : ''} changed from previous snapshot</div>
         <div class="hs-chg-list">${changed.map(c => `<div class="hs-chg-row">
           <div class="hs-chg-name">${esc(c.name)}</div>
           <span class="schip st-${stCls(c.from.status)}">${stLbl(c.from.status)}</span>
           <span class="hm-chg-arr">→</span>
           <span class="schip st-${stCls(c.to.status)}">${stLbl(c.to.status)}</span>
         </div>`).join('')}</div>`
      : `<div class="hm-empty-sm">${snap.prev ? 'No changes from the previous snapshot.' : 'First snapshot — no baseline to compare.'}</div>`;

    return `<div class="hs-snap-header">
        <div class="hs-snap-ts">${fmt(snap.entry.ts)}</div>
        <div class="hs-snap-diff">${diffStr} · ${snap.entry.snap.length} units</div>
      </div>
      <div class="hs-count-row">${countHtml}</div>
      ${changedHtml}`;
  },

  _renderUnitAtTime(name, ms) {
    const q = name.toLowerCase();
    const snap = this._nearestSnap(ms);
    if (!snap) return '<div class="hm-empty">No snapshots found.</div>';
    const stLbl = s => UI._meta(s).label;
    const stCls = s => UI.STATUS_META[s] ? s : 'unchecked';
    const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const fmt = ts => new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

    // find unit in nearest snapshot (partial name match)
    const u = snap.entry.snap.find(u => u.name.toLowerCase() === q)
           || snap.entry.snap.find(u => u.name.toLowerCase().includes(q));
    if (!u)
      return `<div class="hm-empty">"${esc(name)}" not found in the nearest snapshot (${fmt(snap.entry.ts)}).<br>It may not have been checked at that time.</div>`;

    const diffMin  = Math.round(snap.diffMs / 60000);
    const direction = new Date(snap.entry.ts) > new Date(ms) ? 'after' : 'before';
    const diffStr  = diffMin < 2 ? 'exact match' : `${fmt(snap.entry.ts)} (${diffMin < 60 ? `${diffMin} min` : `${Math.round(diffMin / 60)}h`} ${direction})`;
    const prevU    = snap.prev?.snap.find(p => p.id === u.id);

    const secRows = u.sectors.length
      ? u.sectors.map((s, i) =>
          `<div class="hs-sec-row"><span class="hs-sec-lbl">S${i + 1}</span><span class="schip st-${stCls(s)}">${stLbl(s)}</span></div>`
        ).join('')
      : '<div class="hm-empty-sm">No sector data in this snapshot.</div>';

    const prevHtml = prevU
      ? `<div class="hs-prev">
           <span class="hs-prev-lbl">Previous (${fmt(snap.prev.ts)}):</span>
           <span class="schip st-${stCls(prevU.status)}">${stLbl(prevU.status)}</span>
           ${prevU.sectors.map((s, i) => `<span class="schip st-${stCls(s)}">S${i + 1}</span>`).join('')}
         </div>` : '';

    return `<div class="hs-snap-header">
        <div class="hs-snap-ts">${esc(u.name)}</div>
        <div class="hs-snap-diff">Nearest snapshot: ${diffStr}</div>
      </div>
      <div class="hs-unit-status"><span class="schip st-${stCls(u.status)} hs-big-chip">${stLbl(u.status)}</span></div>
      <div class="hs-sec-list">${secRows}</div>
      ${prevHtml}`;
  },
};
