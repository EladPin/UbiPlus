// UI — dashboard grid, header stats, raw output modal, toasts
const UI = {
  STATUS_META: {
    inline:      { label: 'INLINE',    color: 'var(--st-inline)' },
    bypass:      { label: 'BYPASS',    color: 'var(--st-bypass)' },
    transparent: { label: 'UNKNOWN',   color: 'var(--st-transparent)' },
    offline:     { label: 'OFFLINE',   color: 'var(--st-offline)' },
    unchecked:   { label: 'UNCHECKED', color: 'var(--st-unchecked)' },
  },

  renderAll() {
    this.renderStats();
    this.renderGrid();
  },

  renderStats() {
    const c = UDATA.counts();
    const order = ['inline', 'bypass', 'transparent', 'offline', 'unchecked'];
    document.getElementById('hdrStats').innerHTML = order.map(k => {
      const m = this.STATUS_META[k];
      return `<div class="hstat" title="${m.label}">
        <span class="dot" style="background:${m.color}"></span>
        <span class="num">${c[k] || 0}</span>
        <span class="lbl">${m.label}</span>
      </div>`;
    }).join('');
  },

  renderGrid() {
    const grid = document.getElementById('unitGrid');
    const hint = document.getElementById('emptyHint');
    const has = UDATA.units.length > 0;
    hint.style.display = has ? 'none' : '';
    grid.innerHTML = has ? UDATA.units.map(u => this._cardHTML(u)).join('') : '';
  },

  renderCard(id) {
    const u = UDATA.get(id);
    const el = document.querySelector(`.card[data-id="${id}"]`);
    if (u && el) el.outerHTML = this._cardHTML(u);
    else this.renderGrid();
  },

  _cardHTML(u) {
    const m = this.STATUS_META[u.status] || this.STATUS_META.unchecked;
    const checking = !!u._checking;
    const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

    return `<div class="card" data-id="${u.id}" data-st="${u.status}" style="--st-col:${m.color}">
      <div class="card-top">
        <div class="card-name">${esc(u.name)}</div>
        <button class="card-edit" title="Edit unit" onclick="UNITMODAL.open('${u.id}')">✎</button>
      </div>
      <div class="card-addr">${esc(u.ip)}:${u.port}</div>
      ${u.note ? `<div class="card-note">${esc(u.note)}</div>` : ''}
      <div class="card-status-row">
        <span class="status-pill"><span class="sp-dot"></span>${m.label}</span>
        <span class="card-last">${this._relTime(u.lastCheck)}</span>
      </div>
      <div class="card-actions">
        <button class="btn-check ${checking ? 'checking' : ''}" onclick="CHECK.unit('${u.id}')">
          ${checking ? '<span class="spin"></span>CHECKING…' : '▶ CHECK'}
        </button>
        <button class="btn-raw" onclick="UI.openRaw('${u.id}')" ${u.lastRaw ? '' : 'disabled'}>OUTPUT</button>
      </div>
    </div>`;
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
