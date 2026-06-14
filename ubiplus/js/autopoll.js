// AUTOPOLL — automatic periodic check-all with countdown display
const AUTOPOLL = {
  interval: 0,   // seconds between polls (0 = off)
  retention: 7,  // days to keep history snapshots

  _timer: null,
  _nextAt: null,

  init() {
    HISTORY.load();
    let savedNextAt = 0;
    try {
      const s = JSON.parse(localStorage.getItem('ubiplus_autopoll') || '{}');
      this.interval  = +s.interval  || 0;
      this.retention = +s.retention || 7;
      savedNextAt    = +s.nextAt    || 0;
    } catch {}
    this._syncUI();
    if (this.interval > 0) {
      const remaining = savedNextAt - Date.now();
      if (savedNextAt && remaining > 0) {
        // resume: timer was running when the browser closed — pick up where it left off
        this._nextAt = savedNextAt;
        this._timer  = setTimeout(() => this._fire(), remaining);
      } else if (savedNextAt && remaining <= 0) {
        // overdue: the check was due while the app was closed — run it right away
        this._fire();
      } else {
        this._arm(); // no saved state — start fresh
      }
    }
    setInterval(() => this._tick(), 1000);
  },

  setInterval(val) {
    this.interval = +val;
    clearTimeout(this._timer);
    this._nextAt = null;
    this._save(); // writes nextAt: null, clearing the stored timestamp
    if (this.interval > 0) this._arm();
    this._tick();
    UI.toast(this.interval > 0 ? `Auto-poll every ${this._fmtInterval(this.interval)}` : 'Auto-poll off');
  },

  setRetention(val) {
    this.retention = +val;
    this._save();
    // update snap count label if modal is open
    const sc = document.getElementById('hmSnapCount');
    if (sc && document.getElementById('histModal').classList.contains('open'))
      sc.textContent = `${HISTORY.entries.length} snapshot${HISTORY.entries.length !== 1 ? 's' : ''} · ${HISTORY.sizeKB()} KB`;
  },

  _save() {
    localStorage.setItem('ubiplus_autopoll', JSON.stringify({
      interval: this.interval, retention: this.retention,
      nextAt: this._nextAt || null,
    }));
  },

  _arm() {
    this._nextAt = Date.now() + this.interval * 1000;
    this._save(); // persist so the countdown survives a browser close
    this._timer  = setTimeout(() => this._fire(), this.interval * 1000);
  },

  async _fire() {
    this._nextAt = null;
    this._tick();
    await CHECK.all();          // CHECK.all() saves the snapshot itself on completion
    if (this.interval > 0) this._arm();
    this._tick();
  },

  _tick() {
    const el = document.getElementById('pollCountdown');
    if (!el) return;
    if (!this._nextAt) { el.textContent = ''; return; }
    const rem = Math.max(0, Math.ceil((this._nextAt - Date.now()) / 1000));
    el.textContent = `next in ${this._fmt(rem)}`;
  },

  _fmt(s) {
    if (s < 60) return `${s}s`;
    if (s < 3600) { const m = Math.floor(s / 60), sec = s % 60; return sec ? `${m}m ${sec}s` : `${m}m`; }
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  },

  _fmtInterval(s) {
    if (s < 3600) return `${s / 60}m`;
    return `${s / 3600}h`;
  },

  _syncUI() {
    const sel = document.getElementById('pollIntervalSel');
    if (sel) sel.value = this.interval;
    const ret = document.getElementById('pollRetentionSel');
    if (ret) ret.value = this.retention;
  },
};
