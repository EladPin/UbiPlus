// UI — dashboard grid, header stats, raw output modal, toasts
const UI = {
  selectMode: false,
  selected: new Set(),
  _filterSt: '',
  _filterQ: '',

  STATUS_META: {
    inline:      { label: 'INLINE',    color: 'var(--st-inline)' },
    mixed:       { label: 'MIXED',     color: 'var(--st-mixed)' },
    bypass:      { label: 'BYPASS',    color: 'var(--st-bypass)' },
    transparent: { label: 'TRANSPARENT', color: 'var(--st-transparent)' },
    offline:     { label: 'OFFLINE',   color: 'var(--st-offline)' },
    unchecked:   { label: 'UNCHECKED', color: 'var(--st-unchecked)' },
  },

  renderAll() {
    this.renderStats();
    this.renderGrid();
  },

  renderStats() {
    const c = UDATA.counts();
    const order = ['inline', 'mixed', 'bypass', 'transparent', 'offline', 'unchecked'];
    document.getElementById('hdrStats').innerHTML = order.map(k => {
      const m = this.STATUS_META[k];
      return `<div class="hstat" title="${m.label}">
        <span class="dot" style="background:${m.color}"></span>
        <span class="num">${c[k] || 0}</span>
        <span class="lbl">${m.label}</span>
      </div>`;
    }).join('');
    // update filter pill counts
    document.querySelectorAll('#filterPills .fpill').forEach(b => {
      const st = b.dataset.st;
      const n = st ? (c[st] || 0) : UDATA.units.length;
      const lbl = st ? (this.STATUS_META[st]?.label || st.toUpperCase()) : 'ALL';
      b.textContent = n ? `${lbl} · ${n}` : lbl;
    });
  },

  renderGrid() {
    const grid = document.getElementById('unitGrid');
    const hint = document.getElementById('emptyHint');
    const has = UDATA.units.length > 0;
    hint.style.display = has ? 'none' : '';
    if (!has) { grid.innerHTML = ''; return; }
    let units = UDATA.units;
    if (this._filterSt) units = units.filter(u => u.status === this._filterSt);
    if (this._filterQ)  units = units.filter(u => (u.name || '').toLowerCase().includes(this._filterQ));
    grid.innerHTML = units.length
      ? units.map(u => this._cardHTML(u)).join('')
      : '<div class="filter-empty">No units match the current filter.</div>';
  },

  renderCard(id) {
    const u = UDATA.get(id);
    if (this._filterSt || this._filterQ) { this.renderGrid(); return; }
    const el = document.querySelector(`.card[data-id="${id}"]`);
    if (u && el) el.outerHTML = this._cardHTML(u);
    else this.renderGrid();
  },

  setFilter(st) {
    this._filterSt = st;
    document.querySelectorAll('#filterPills .fpill').forEach(b =>
      b.classList.toggle('active', b.dataset.st === st));
    this.renderGrid();
  },

  setSearch(q) {
    this._filterQ = q.trim().toLowerCase();
    this.renderGrid();
  },

  _cardHTML(u) {
    const m = this.STATUS_META[u.status] || this.STATUS_META.unchecked;
    const checking = !!u._checking;
    const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const sel = this.selectMode && this.selected.has(u.id);
    const sp = this.selectMode ? 'event.stopPropagation();' : '';

    const stCls = s => `st-${this.STATUS_META[s] ? s : 'unchecked'}`; // badge color pair lives in CSS
    const sectors = u.sectors || [];
    const statusHTML = sectors.length
      ? `<span class="sector-chips">${sectors.map((s, i) => {
          const sm = this.STATUS_META[s] || this.STATUS_META.unchecked;
          return `<span class="schip ${stCls(s)}" title="Sector ${i + 1}: ${sm.label}">S${i + 1}</span>`;
        }).join('')}</span>`
      : `<span class="status-pill ${stCls(u.status)}"><span class="sp-dot"></span>${m.label}</span>`;

    return `<div class="card${this.selectMode ? ' selectable' : ''}${sel ? ' selected' : ''}" data-id="${u.id}" data-st="${u.status}"${this.selectMode ? ` onclick="UI.toggleSelect('${u.id}')"` : ''}>
      <div class="card-top">
        ${this.selectMode ? `<div class="card-sel-dot">${sel ? '✓' : ''}</div>` : ''}
        <div class="card-name">${esc(u.name)}</div>
        <button class="card-edit" title="Edit unit" onclick="${sp}UNITMODAL.open('${u.id}')">✎</button>
      </div>
      <div class="card-addr">${esc(u.ip)}:${u.port}</div>
      ${u.note ? `<div class="card-note">${esc(u.note)}</div>` : ''}
      <div class="card-status-row">
        ${statusHTML}
        ${UDATA.changed(u) ? `<span class="chg-flag" title="Changed since previous check — was ${this._prevLabel(u)}">CHG</span>` : ''}
        <span class="card-last">${this._relTime(u.lastCheck)}</span>
      </div>
      <div class="card-actions">
        <button class="btn-check ${checking ? 'checking' : ''}" onclick="${sp}CHECK.unit('${u.id}')">
          ${checking ? '<span class="spin"></span>CHECKING…' : '▶ CHECK'}
        </button>
        <button class="btn-raw" onclick="${sp}UI.openRaw('${u.id}')" ${u.lastRaw ? '' : 'disabled'}>OUTPUT</button>
        <button class="btn-set" onclick="${sp}POWER.open('${u.id}')" title="Set sector mode via telnet">SET</button>
      </div>
    </div>`;
  },

  // ---- select mode: click cards to pick them, then bulk-delete ----
  toggleSelectMode() {
    this.selectMode = !this.selectMode;
    if (!this.selectMode) this.selected.clear();
    const btn = document.getElementById('btnSelect');
    btn.textContent = this.selectMode ? 'CANCEL' : 'SELECT';
    btn.classList.toggle('active', this.selectMode);
    this._updateDeleteBtn();
    this.renderGrid();
  },

  toggleSelect(id) {
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    this._updateDeleteBtn();
    const u = UDATA.get(id);
    const el = document.querySelector(`.card[data-id="${id}"]`);
    if (u && el) el.outerHTML = this._cardHTML(u);
  },

  _updateDeleteBtn() {
    const btn = document.getElementById('btnDeleteSel');
    const n = this.selected.size;
    btn.style.display = (this.selectMode && n > 0) ? '' : 'none';
    btn.textContent = `DELETE ${n}`;
  },

  deleteSelected() {
    const n = this.selected.size;
    if (!n) return;
    if (!confirm(`Delete ${n} unit${n > 1 ? 's' : ''}?`)) return;
    for (const id of [...this.selected]) UDATA.remove(id);
    this.selected.clear();
    this.selectMode = false;
    document.getElementById('btnSelect').classList.remove('active');
    document.getElementById('btnSelect').textContent = 'SELECT';
    this._updateDeleteBtn();
    this.toast(`Deleted ${n} unit${n > 1 ? 's' : ''}`);
    this.renderAll();
  },

  _prevLabel(u) {
    if (u.prevSectors && u.prevSectors.length) return u.prevSectors.join('--');
    return (this.STATUS_META[u.prevStatus] || this.STATUS_META.unchecked).label;
  },

  // ---- changes modal: previous check vs latest ----
  openDiff() {
    const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const stCls = s => `st-${this.STATUS_META[s] ? s : 'unchecked'}`;
    const chips = (status, sectors) => {
      if (sectors && sectors.length) {
        return sectors.map((s, i) => {
          const sm = this.STATUS_META[s] || this.STATUS_META.unchecked;
          return `<span class="schip ${stCls(s)}" title="Sector ${i + 1}: ${sm.label}">S${i + 1}</span>`;
        }).join('');
      }
      const m = this.STATUS_META[status] || this.STATUS_META.unchecked;
      return `<span class="schip ${stCls(status)}">${m.label}</span>`;
    };

    const changed = UDATA.units.filter(u => UDATA.changed(u));
    document.getElementById('diffList').innerHTML = changed.length
      ? changed.map(u => `
        <div class="diff-row">
          <div class="diff-name">${esc(u.name)}<span class="diff-when">${this._relTime(u.prevCheck)} → ${this._relTime(u.lastCheck)}</span></div>
          <div class="diff-states">
            <span class="diff-side">${chips(u.prevStatus, u.prevSectors)}</span>
            <span class="diff-arrow">→</span>
            <span class="diff-side">${chips(u.status, u.sectors)}</span>
          </div>
        </div>`).join('')
      : '<div class="diff-empty">No changes — every unit matches its previous check.</div>';
    document.getElementById('diffModal').classList.add('open');
  },

  closeDiff() {
    document.getElementById('diffModal').classList.remove('open');
  },

  _relTime(iso) {
    if (!iso) return 'never checked';
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  },

  // ---- raw output modal ----
  openRaw(id) {
    const u = UDATA.get(id);
    if (!u || !u.lastRaw) return;
    const m = this.STATUS_META[u.status] || this.STATUS_META.unchecked;
    document.getElementById('rawTitle').textContent = `${u.name} — SESSION OUTPUT`;
    document.getElementById('rawMeta').innerHTML =
      `${u.ip}:${u.port} · <span style="color:${m.color}">${m.label}</span> · ${this._relTime(u.lastCheck)}`;
    document.getElementById('rawPre').textContent = u.lastRaw;
    document.getElementById('rawModal').classList.add('open');
  },

  closeRaw() {
    document.getElementById('rawModal').classList.remove('open');
  },

  // ---- CSV export (opens in Excel; UTF-8 BOM so Hebrew site names survive) ----
  exportCSV() {
    if (!UDATA.units.length) { this.toast('No units to export', true); return; }

    const maxSec = Math.max(1, ...UDATA.units.map(u => (u.sectors || []).length));
    const head = ['Site', 'IP', 'Port', 'Status',
      ...Array.from({ length: maxSec }, (_, i) => `Sector ${i + 1}`),
      'Changed', 'Changes (prev -> now)', 'Last Checked', 'Note'];

    const cell = v => {
      v = v == null ? '' : String(v);
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    const label = s => s ? (this.STATUS_META[s] || this.STATUS_META.unchecked).label : '';

    // explicit before->after text, only for units that actually changed:
    // per-sector when both checks have the same sector count, otherwise full-state
    const changes = u => {
      if (!UDATA.changed(u)) return '';
      const a = u.prevSectors || [], b = u.sectors || [];
      if (a.length && b.length && a.length === b.length) {
        const parts = [];
        for (let i = 0; i < b.length; i++) {
          if (a[i] !== b[i]) parts.push(`S${i + 1} ${label(a[i])} -> ${label(b[i])}`);
        }
        return parts.join(', ');
      }
      const prev = a.length ? a.map(label).join('--') : label(u.prevStatus);
      const cur = b.length ? b.map(label).join('--') : label(u.status);
      return `${prev} -> ${cur}`;
    };

    const rows = UDATA.units.map(u => {
      const sec = u.sectors || [];
      return [
        u.name, u.ip, u.port, label(u.status),
        ...Array.from({ length: maxSec }, (_, i) => sec[i] ? label(sec[i]) : ''),
        UDATA.changed(u) ? 'YES' : '',
        changes(u),
        u.lastCheck ? new Date(u.lastCheck).toLocaleString() : 'never',
        u.note || '',
      ].map(cell).join(',');
    });

    const csv = String.fromCharCode(0xFEFF) + [head.map(cell).join(','), ...rows].join('\r\n'); // BOM so Excel decodes UTF-8 (Hebrew notes)
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    const fname = `ubiplus-status-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.csv`;

    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = fname;
    a.click();
    URL.revokeObjectURL(a.href);
    this.toast(`Exported ${UDATA.units.length} units → ${fname}`);
  },

  // ---- toasts ----
  toast(msg, isErr = false) {
    const wrap = document.getElementById('toastWrap');
    const el = document.createElement('div');
    el.className = 'toast' + (isErr ? ' err' : '');
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  },
};

// keep "Xm ago" labels fresh
setInterval(() => { if (UDATA.units.length) UI.renderGrid(); }, 60000);
