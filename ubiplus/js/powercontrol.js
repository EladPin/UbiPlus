// POWER — sector mode control (set link N mode bypass|inline via telnet)
// Opens the power modal; sector list is gated on u.sectors.length > 0 so
// we never send a link number beyond what the unit actually has.
const POWER = {
  _id: null,
  _link: null,
  _mode: null,

  open(id) {
    const u = UDATA.get(id);
    if (!u) return;
    this._id = id;
    this._link = null;
    this._mode = null;
    document.getElementById('pmTitle').textContent = `SET MODE — ${u.name}`;
    this._buildSectors(u);
    document.querySelectorAll('.pm-mode').forEach(b => b.classList.remove('active'));
    this._refreshPreview();
    document.getElementById('powerModal').classList.add('open');
  },

  close() {
    document.getElementById('powerModal').classList.remove('open');
    this._id = null;
    this._link = null;
    this._mode = null;
  },

  _buildSectors(u) {
    const sectors = u.sectors || [];
    const el = document.getElementById('pmSectors');
    if (!sectors.length) {
      el.innerHTML = '<div class="pm-warn">No sector data — run a status check first to discover how many sectors this unit has.</div>';
      return;
    }
    el.innerHTML = sectors.map((s, i) => {
      const cls = UI.STATUS_META[s] ? s : 'unchecked';
      const lbl = (UI.STATUS_META[s] || UI.STATUS_META.unchecked).label;
      return `<button class="pm-sec" data-link="${i + 1}" onclick="POWER.selectSector(${i + 1})">
        <span class="pm-sec-num">S${i + 1}</span><span class="schip st-${cls}">${lbl}</span>
      </button>`;
    }).join('');
  },

  selectSector(n) {
    this._link = n;
    document.querySelectorAll('.pm-sec').forEach(b =>
      b.classList.toggle('active', +b.dataset.link === n));
    this._refreshPreview();
  },

  selectMode(m) {
    this._mode = m;
    document.querySelectorAll('.pm-mode').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === m));
    this._refreshPreview();
  },

  _refreshPreview() {
    const btn = document.getElementById('pmApply');
    const prev = document.getElementById('pmPreview');
    const u = this._id ? UDATA.get(this._id) : null;
    const hasSectors = u && (u.sectors || []).length > 0;
    if (!hasSectors) { btn.disabled = true; prev.textContent = ''; return; }
    const ready = !!(this._link && this._mode);
    btn.disabled = !ready;
    prev.textContent = ready
      ? `set link ${this._link} mode ${this._mode}`
      : '';
  },

  async execute() {
    if (!this._id || !this._link || !this._mode) return;
    const u = UDATA.get(this._id);
    if (!u) return;
    const link = this._link, mode = this._mode;
    const cmd = `set link ${link} mode ${mode}`;
    const btn = document.getElementById('pmApply');
    btn.disabled = true;
    btn.textContent = 'SENDING…';

    let result;
    try {
      const res = await fetch('/ubi/power', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: u.ip, port: u.port, user: u.user, pass: u.pass, cmd }),
      });
      result = await res.json();
    } catch {
      result = { error: 'Server unreachable — is server.ps1 running?' };
    }

    btn.textContent = 'APPLY';
    if (result.ok || result.output) {
      UI.toast(`${u.name} S${link} → ${mode.toUpperCase()} sent. Re-checking…`);
      this.close();
      await CHECK.unit(u.id);
    } else {
      const msg = result.error || 'Unknown error';
      UI.toast(`Set mode failed: ${msg}`, true);
      btn.disabled = false;
      this._refreshPreview();
    }
  },

};
