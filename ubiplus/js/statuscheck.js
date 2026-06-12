// CHECK — status check flow: telnet via server proxy, output parsing, demo mode
const CHECK = {
  demo: false,
  _running: false,
  _abort: false,

  initDemo() {
    this.demo = localStorage.getItem('ubiplus_demo') === '1';
    document.getElementById('chkDemo').checked = this.demo;
  },

  setDemo(on) {
    this.demo = on;
    localStorage.setItem('ubiplus_demo', on ? '1' : '0');
    UI.toast(on ? 'Demo mode ON — telnet output is fabricated' : 'Demo mode OFF');
  },

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
    if (this.demo) {
      result = await this._demoFetch(u);
    } else {
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

    const c = UDATA.counts();
    const chg = UDATA.units.filter(u => UDATA.changed(u)).length;
    const prefix = aborted ? 'Stopped' : 'Done';
    UI.toast(`${prefix} — ${c.inline} inline · ${c.mixed} mixed · ${c.bypass} bypass · ${c.transparent} unknown · ${c.offline} offline · ${chg} changed`);
  },

  // ---- demo mode: fabricated telnet sessions ----
  // Mimics the real Gen4 transcript captured via PuTTY (see CLAUDE.md)
  _demoFetch(u) {
    const roll = Math.random();
    if (roll < 0.08) {
      return new Promise(r => setTimeout(() =>
        r({ error: 'Timeout after 30s — unit unreachable' }), 900 + Math.random() * 800));
    }

    // sites are usually uniform: pick one mode for the whole site, then a
    // small chance that a single sector deviates (that's the interesting case)
    const nSec = 1 + Math.floor(Math.random() * 4); // 1–4 sectors per site
    const r = Math.random();
    const base = r < 0.72 ? 'inline' : (r < 0.92 ? 'bypass' : 'transparent');
    const sectors = Array.from({ length: nSec }, () => base);
    if (nSec > 1 && Math.random() < 0.18) {
      sectors[Math.floor(Math.random() * nSec)] = base === 'inline' ? 'bypass' : 'inline';
    }

    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    const ts = `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} - ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    const load = () => (Math.random() * 0.5).toFixed(2);
    const rnd = (min, max, dec = 2) => (min + Math.random() * (max - min)).toFixed(dec);

    const sfpRows = [];
    for (let i = 0; i < nSec; i++) {
      for (const kind of ['BBU', 'RRU']) {
        sfpRows.push(
          `${kind}${i}:   ${rnd(35, 40)}°C    ${rnd(3.20, 3.28)}V   ${rnd(18, 46)}mA   ` +
          `${rnd(0.29, 0.76)}mW/${rnd(-5.3, -1.2)}dBm   ${rnd(0.06, 0.11, 3)}mW/${rnd(-11.8, -9.6)}dBm   0.00°C   -0.09m`,
          `  A   0     0     0     0     0     7 (7)     0`);
      }
    }

    const body = [
      `Enter your user name--->${u.user || 'idfuser'}`,
      `${ts}  --Server ACK`,
      `Enter your pasword--->${u.pass || '********'}`,
      `${ts}  --Server ACK`,
      '',
      'Welcome to Gen4 ver 2.3.31.00 Built on 18:10:58 Nov  6 2024. FPGA version is  45230',
      'Used Gen4 is /p2/Gen4Target_Gnueabihf',
      `Gen4 uptime: ${Math.floor(Math.random() * 200)}:${p(Math.floor(Math.random() * 60))}:${p(Math.floor(Math.random() * 60))}`,
      `System uptime:  ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
      '',
      `up 20:42,  2 users,  load average: ${load()}, ${load()}, ${load()}`,
      '',
      `${ts} **** ${1000 + Math.floor(Math.random() * 9000)} **** --GEN4 TERMINALL -->`,
      'get status',
      '',
      `${ts}  --Server ACK`,
      `JC status 0xf${Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0')}`,
      '',
      sectors.join('--'),
      '',
      'SFPs: Temperature    VCC     TX bias     TX power           RX power            Laser temp   TEC',
      '  LOS   LOF   TX Dis   TX Fault   RX LOS   CPRI Status   8/10 Errors',
      '====================================================================================',
      ...sfpRows,
    ].join('\n');

    return new Promise(r => setTimeout(() =>
      r({ ok: true, output: body }), 500 + Math.random() * 900));
  },
};
