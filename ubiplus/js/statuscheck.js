// CHECK — status check flow: telnet via server proxy, output parsing
const CHECK = {
  _running: false,
  _abort: false,

  // ---- parse raw telnet output → per-sector modes ----
  // Verified from a real PuTTY capture (Gen4 ver 2.3.31.00): after `get status`
  // the unit prints `JC status 0x....` then one line with one mode per sector:
  //   inline--inline--bypass--bypass
  // `transparent` as a sector token is still an assumption (never captured).
  _parseSectors(raw) {
    if (!raw) return [];
    const m = raw.match(
      /^[ \t]*((?:inline|bypass|transparent)(?:[ \t]*--[ \t]*(?:inline|bypass|transparent))*)[ \t]*$/im);
    if (!m) return [];
    return m[1].toLowerCase().split('--').map(t => t.trim());
  },

  // aggregate unit status: all sectors agree → that mode, disagree → 'mixed',
  // no sector line found in a reachable session → 'transparent' (unknown)
  _aggregate(sectors) {
    if (!sectors.length) return 'transparent';
    return new Set(sectors).size === 1 ? sectors[0] : 'mixed';
  },

  async unit(id) {
    const u = UDATA.get(id);
    if (!u || u._checking) return;

    u._checking = true;
    UI.renderCard(id);

    // solo check: send the cat over (check-all dispatches it itself)
    const solo = !this._running && CAT.enabled;
    if (solo) CAT.visit(id);

    let result;
    try {
      const res = await fetch('/ubi/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: u.ip, port: u.port, user: u.user, pass: u.pass }),
      });
      result = await res.json();
    } catch (e) {
      result = { error: 'Server unreachable — is server.ps1 running?' };
    }

    u._checking = false;
    const now = new Date().toISOString();
    // one-deep history: the previous completed check becomes the comparison
    // baseline and is overwritten by the next one (first check = no baseline)
    const prev = u.status !== 'unchecked'
      ? { prevStatus: u.status, prevSectors: u.sectors || [], prevCheck: u.lastCheck }
      : {};
    if (result.ok) {
      const sectors = this._parseSectors(result.output);
      UDATA.update(id, Object.assign({}, prev, {
        status: this._aggregate(sectors),
        sectors,
        lastCheck: now,
        lastRaw: result.output,
      }));
    } else {
      UDATA.update(id, Object.assign({}, prev, {
        status: 'offline',
        sectors: [],
        lastCheck: now,
        lastRaw: result.error || 'Unknown error',
      }));
    }

    UI.renderCard(id);
    UI.renderStats();
    if (solo) { CAT.endWork(); CAT.park(); }
    return UDATA.get(id).status;
  },

  // sequential check of every unit (server is single-threaded)
  async all() {
    if (this._running) { this._abort = true; return; }
    if (!UDATA.units.length) { UI.toast('No units to check', true); return; }

    this._running = true;
    this._abort = false;
    const btn = document.getElementById('btnCheckAll');
    const total = UDATA.units.length;
    btn.classList.add('is-stop');

    let done = 0;
    for (const u of [...UDATA.units]) {
      if (this._abort) break;
      btn.textContent = `■ STOP  ${++done}/${total}`;
      // cat walks over while the check is already in flight
      const p = this.unit(u.id);
      await CAT.visit(u.id);
      await p;
      await CAT.endWork();
    }

    const aborted = this._abort;
    this._running = false;
    this._abort = false;
    btn.classList.remove('is-stop');
    btn.textContent = '▶ CHECK ALL';
    CAT.celebrate();
    CAT.park();

    if (!aborted) HISTORY.snapshot();

    const c = UDATA.counts();
    const chg = UDATA.units.filter(u => UDATA.changed(u)).length;
    const prefix = aborted ? 'Stopped' : 'Done';
    UI.toast(`${prefix} — ${c.inline} inline · ${c.mixed} mixed · ${c.bypass} bypass · ${c.transparent} unknown · ${c.offline} offline · ${chg} changed`);
  },

};
