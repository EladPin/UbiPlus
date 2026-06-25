// CHECK — status check flow: telnet via server proxy, output parsing
const CHECK = {
  _running: false,
  _abort: false,

  // ---- parse raw telnet output → per-sector modes ----
  // Verified from real OSP captures (Gen4 ver 2.3.31.00 + 2.3.27.00): after
  // `get status` the unit prints `JC status 0x....` then ONE line with one
  // mode per sector joined by `--`:
  //   inline--inline--bypass--bypass
  //   inline--bypass--half-inline--inline    ← new mode discovered 2026-06-24
  // Token regex was originally `inline|bypass|transparent` (strict), which made
  // any unfamiliar mode like `half-inline` silently fail → unit went TRANSPARENT
  // with "no sector line". Now permissive: any lowercase word with up to one
  // hyphen, separated by `--`, alone on its own line. Whole-line + `--`
  // separator make false positives extremely unlikely.
  _parseSectors(raw) {
    if (!raw) return [];
    const tok = '[a-z]+(?:-[a-z]+)?';
    const re  = new RegExp(`^[ \\t]*(${tok}(?:[ \\t]*--[ \\t]*${tok})*)[ \\t]*$`, 'im');
    const m = raw.match(re);
    if (!m) return [];
    return m[1].toLowerCase().split('--').map(t => t.trim());
  },

  // aggregate unit status: all sectors agree → that mode, disagree → 'mixed',
  // no sector line found in a reachable session → 'transparent' (unknown)
  _aggregate(sectors) {
    if (!sectors.length) return 'transparent';
    return new Set(sectors).size === 1 ? sectors[0] : 'mixed';
  },

  // Map a raw server error string (or absence of a sector line) to a short tag
  // suitable for the card. The full message stays in lastRaw — this is just the
  // headline that prints next to the IP so the engineer doesn't have to open
  // OUTPUT every time to know why a unit is offline/transparent.
  _reasonFor(err) {
    if (!err) return null;
    const e = String(err);
    if (/no tcp answer/i.test(e))                  return 'no TCP';
    if (/tcp connect.*failed/i.test(e))            return 'TCP refused';
    if (/no username prompt/i.test(e))             return 'no login prompt';
    if (/no password prompt/i.test(e))             return 'auth stuck';
    if (/no terminal prompt/i.test(e))             return 'auth failed';
    if (/server unreachable/i.test(e))             return 'server down';
    if (/session error/i.test(e))                  return 'session error';
    return e.length <= 24 ? e : e.slice(0, 22) + '…';
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
      const status = this._aggregate(sectors);
      // status==='transparent' from _aggregate means "got output but no sector line"
      UDATA.update(id, Object.assign({}, prev, {
        status,
        sectors,
        reason: status === 'transparent' ? 'no sector line' : null,
        lastCheck: now,
        lastRaw: result.output || result.error || '',
      }));
    } else {
      UDATA.update(id, Object.assign({}, prev, {
        status: 'offline',
        sectors: [],
        reason: this._reasonFor(result.error),
        lastCheck: now,
        // server may have returned a partial transcript alongside the error
        lastRaw: (result.output ? result.output + '\n\n' : '') + (result.error || 'Unknown error'),
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
