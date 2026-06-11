// CHECK — status check flow: telnet via server proxy, output parsing, demo mode
const CHECK = {
  demo: false,
  _running: false,

  initDemo() {
    this.demo = localStorage.getItem('ubiplus_demo') === '1';
    document.getElementById('chkDemo').checked = this.demo;
  },

  setDemo(on) {
    this.demo = on;
    localStorage.setItem('ubiplus_demo', on ? '1' : '0');
    UI.toast(on ? 'Demo mode ON — telnet output is fabricated' : 'Demo mode OFF');
  },

  // ---- parse raw telnet output → status ----
  // PLACEHOLDER parser: keyword match until a real `get status` transcript
  // from a Ubiqam unit is captured on the OSP. Refine then.
  _parseStatus(raw) {
    if (!raw) return 'offline';
    const s = raw.toLowerCase();
    if (s.includes('bypass')) return 'bypass';
    if (s.includes('transparent')) return 'transparent';
    if (s.includes('inline')) return 'inline';
    return 'transparent'; // reachable but unrecognised output → treat as unknown
  },

  async unit(id) {
    const u = UDATA.get(id);
    if (!u || u._checking) return;

    u._checking = true;
    UI.renderCard(id);

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
    if (result.ok) {
      UDATA.update(id, {
        status: this._parseStatus(result.output),
        lastCheck: now,
        lastRaw: result.output,
      });
    } else {
      UDATA.update(id, {
        status: 'offline',
        lastCheck: now,
        lastRaw: result.error || 'Unknown error',
      });
    }

    UI.renderCard(id);
    UI.renderStats();
    return UDATA.get(id).status;
  },

  // sequential check of every unit (server is single-threaded)
  async all() {
    if (this._running) return;
    if (!UDATA.units.length) { UI.toast('No units to check', true); return; }

    this._running = true;
    const btn = document.getElementById('btnCheckAll');
    const total = UDATA.units.length;
    btn.disabled = true;

    let done = 0;
    for (const u of [...UDATA.units]) {
      btn.textContent = `CHECKING ${++done}/${total}…`;
      await this.unit(u.id);
    }

    this._running = false;
    btn.disabled = false;
    btn.textContent = '▶ CHECK ALL';

    const c = UDATA.counts();
    UI.toast(`Done — ${c.inline} inline · ${c.bypass} bypass · ${c.transparent} unknown · ${c.offline} offline`);
  },

  // ---- demo mode: fabricated telnet sessions ----
  _demoFetch(u) {
    const roll = Math.random();
    let mode, body;
    if (roll < 0.08) {
      return new Promise(r => setTimeout(() =>
        r({ error: 'Timeout after 30s — unit unreachable' }), 900 + Math.random() * 800));
    }
    if (roll < 0.60) mode = 'inline';
    else if (roll < 0.82) mode = 'bypass';
    else mode = 'transparent';

    body = [
      `Trying ${u.ip}...`,
      `Connected to ${u.ip}.`,
      '',
      'UBiFiX Control Console',
      `login: ${u.user || 'ubiqam'}`,
      'password: ********',
      '',
      '> get status',
      `  unit mode      : ${mode.toUpperCase()}`,
      `  uptime         : ${Math.floor(Math.random() * 900) + 1}h`,
      `  control link   : ${mode === 'transparent' ? 'DOWN' : 'OK'}`,
      '',
      '> exit',
      'Connection closed.',
    ].join('\n');

    return new Promise(r => setTimeout(() =>
      r({ ok: true, output: body }), 500 + Math.random() * 900));
  },
};
