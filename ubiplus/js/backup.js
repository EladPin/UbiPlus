// BACKUP — full database export / import between OSP machines.
// Each OSP runs UbiPlus locally with its own isolated localStorage and there is
// no shared backend, so an OSP that has been auto-polling for days builds up a
// rich inventory + history the other machines never see. This module snapshots
// that "database" to a single JSON file and loads it on another OSP.
//
// Export bundles the data keys below. Import REPLACES the inventory + settings
// from the file but MERGES history (union by timestamp) so importing can never
// destroy snapshots already recorded on the target machine.
const BACKUP = {
  // The keys that make up the database. Cosmetic prefs (theme, cat), seed flags
  // and the UbiView tree cache are intentionally excluded — they're per-machine
  // and the tree cache re-fetches itself on demand.
  KEYS: ['ubiplus_units', 'ubiplus_history', 'ubiplus_autopoll', 'ubiplus_uv_cfg'],

  _pending: null, // parsed bundle awaiting the user's confirmation

  // human label for an autopoll interval (seconds)
  _POLL: { 0: 'Off', 1800: '30m', 3600: '1h', 10800: '3h', 21600: '6h', 43200: '12h', 86400: '24h' },

  // ---- EXPORT ----

  export() {
    const bundle = {
      app: 'ubiplus',
      kind: 'backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {},
    };
    for (const k of this.KEYS) {
      const v = localStorage.getItem(k);
      if (v != null) bundle.data[k] = v; // stored verbatim as strings, re-parsed on import
    }

    const units = this._safeArr(bundle.data.ubiplus_units).length;
    const snaps = this._safeArr(bundle.data.ubiplus_history).length;

    const d = new Date(), p = n => String(n).padStart(2, '0');
    const fname = `ubiplus-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.json`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
    a.download = fname;
    a.click();
    URL.revokeObjectURL(a.href);
    UI.toast(`Exported ${units} units · ${snaps} snapshots → ${fname}`);
  },

  // ---- IMPORT ----

  pick() { document.getElementById('backupFile').click(); },

  onFile(input) {
    const file = input.files[0];
    if (!file) return;
    input.value = ''; // reset so the same file can be re-picked
    const reader = new FileReader();
    reader.onload = e => {
      try { this._prepare(e.target.result); }
      catch (err) { UI.toast('Could not read backup: ' + err.message, true); }
    };
    reader.readAsText(file, 'utf-8');
  },

  // parse + validate the file, then show the confirm modal with a summary
  _prepare(text) {
    let bundle;
    try { bundle = JSON.parse(text); }
    catch { UI.toast('Not a valid backup file (bad JSON)', true); return; }
    if (!bundle || bundle.app !== 'ubiplus' || !bundle.data) {
      UI.toast('That file is not a UbiPlus backup', true);
      return;
    }
    this._pending = bundle;

    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const inUnits = this._safeArr(bundle.data.ubiplus_units);
    const inHist  = this._safeArr(bundle.data.ubiplus_history);
    const curUnits = this._safeArr(localStorage.getItem('ubiplus_units'));
    const curHist  = this._safeArr(localStorage.getItem('ubiplus_history'));
    const merged   = this._mergeHistory(curHist, inHist);

    const fmtD = ts => { const d = new Date(ts); return isNaN(d) ? '?' : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); };
    const span = arr => arr.length ? `${fmtD(arr[0].ts)} → ${fmtD(arr[arr.length - 1].ts)}` : '—';

    let pollTxt = 'not included';
    if (bundle.data.ubiplus_autopoll != null) {
      try {
        const ap = JSON.parse(bundle.data.ubiplus_autopoll);
        pollTxt = `interval ${this._POLL[ap.interval] || (ap.interval + 's')} · ${ap.retention ?? 7}-day retention`;
      } catch { pollTxt = 'included'; }
    }
    const uvTxt = bundle.data.ubiplus_uv_cfg != null ? 'included (overwrites current)' : 'not included';

    const made = bundle.exportedAt ? new Date(bundle.exportedAt).toLocaleString() : 'unknown date';
    const gained = merged.length - curHist.length;

    const row = (label, value, sub) =>
      `<div class="bk-row">
         <div class="bk-row-label">${label}</div>
         <div class="bk-row-value">${value}${sub ? `<span class="bk-row-sub">${sub}</span>` : ''}</div>
       </div>`;

    document.getElementById('bkSummary').innerHTML = `
      <div class="bk-made">Backup created <strong>${esc(made)}</strong></div>
      ${row('Inventory', `${inUnits.length} units`, `replaces the ${curUnits.length} unit${curUnits.length !== 1 ? 's' : ''} on this machine`)}
      ${row('History', `${inHist.length} snapshots <span class="bk-span">${span(inHist)}</span>`,
            `merged with ${curHist.length} here → <strong>${merged.length} total</strong>${gained > 0 ? ` (+${gained} new)` : ' (all already present)'}`)}
      ${row('Auto-poll', esc(pollTxt), '')}
      ${row('UbiView creds', esc(uvTxt), '')}
      <div class="bk-note">Inventory and settings are <strong>replaced</strong> from the file.
        History is <strong>merged</strong>, so snapshots already on this machine are kept.</div>`;

    document.getElementById('backupModal').classList.add('open');
  },

  confirm() {
    const b = this._pending;
    if (!b) return;
    const d = b.data;

    // history: merge so the target never loses its own recorded snapshots
    if (d.ubiplus_history != null) {
      const merged = this._mergeHistory(
        this._safeArr(localStorage.getItem('ubiplus_history')),
        this._safeArr(d.ubiplus_history));
      localStorage.setItem('ubiplus_history', JSON.stringify(merged));
    }
    // inventory + settings + creds: replace from the backup when present
    if (d.ubiplus_units != null)    localStorage.setItem('ubiplus_units', d.ubiplus_units);
    if (d.ubiplus_autopoll != null) localStorage.setItem('ubiplus_autopoll', d.ubiplus_autopoll);
    if (d.ubiplus_uv_cfg != null) {
      localStorage.setItem('ubiplus_uv_cfg', d.ubiplus_uv_cfg);
      // drop any cached tree so it re-fetches against the imported NMS creds
      localStorage.removeItem('ubiplus_uv_tree_cache_v2');
      localStorage.removeItem('ubiplus_uv_tree_cache');
    }

    this._pending = null;
    this.close();
    UI.toast('Database imported — reloading…');
    setTimeout(() => location.reload(), 600);
  },

  close() {
    this._pending = null;
    document.getElementById('backupModal').classList.remove('open');
  },

  // ---- helpers ----

  _safeArr(v) {
    try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; }
    catch { return []; }
  },

  // union two snapshot arrays by `ts` (incoming wins on an exact-timestamp tie),
  // sorted oldest→newest, capped to the same 500-entry hard limit HISTORY uses.
  _mergeHistory(cur, incoming) {
    const byTs = new Map();
    for (const e of cur)      if (e && e.ts) byTs.set(e.ts, e);
    for (const e of incoming) if (e && e.ts) byTs.set(e.ts, e);
    const out = [...byTs.values()].sort((a, b) => new Date(a.ts) - new Date(b.ts));
    return out.length > 500 ? out.slice(-500) : out;
  },
};
