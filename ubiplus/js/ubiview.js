// UVCLIENT - browser-side UbiView NMS client. Wraps the server's /ubi/uv/*
// proxy endpoints, stores credentials in localStorage, caches getTreeData,
// and resolves UbiPlus units (IP-keyed) to UbiView IDs (ucuXXXX-A / D_un_N).
//
// Why this exists: the vendor's telnet ACL gives us only `get status` and
// `set link N mode` per unit. But their UbiView NMS web UI shows full RSSI
// time-series, spectrograms, OPTiX mode, device info. We replicate the
// HTTP calls UbiView's frontend makes -- same credentials, same endpoints.
// Discovered via OSP HAR capture 2026-06-25; see CLAUDE.md "UbiView integration".
const UVCLIENT = {
  _CFG_KEY:  'ubiplus_uv_cfg',
  // Tree cache key bumped to v2 on 2026-06-26 - the v1 wrapper protocol could
  // cache an empty parsed tree on parse failure, and old caches must be ignored.
  _TREE_KEY: 'ubiplus_uv_tree_cache_v2',
  _TREE_KEY_LEGACY: 'ubiplus_uv_tree_cache',
  _TREE_TTL_MS: 6 * 3600 * 1000,  // re-fetch tree once every 6h

  cfg: null,      // { baseUrl, outerUser, outerPass, innerUser, innerPass }
  tree: null,     // { ts, units: [{ip, siteName, ucuName, treeId, sectors:[{nodeName, displayName, treeId, sectorLetter}]}] }

  // ---- config ----

  loadCfg() {
    try {
      this.cfg = JSON.parse(localStorage.getItem(this._CFG_KEY)) || null;
    } catch { this.cfg = null; }
    // Default base URL based on the OSP NMS that the user runs against
    if (this.cfg && !this.cfg.baseUrl) this.cfg.baseUrl = 'http://172.19.15.51/NMS';
    // One-shot cleanup of the legacy cache key
    try { localStorage.removeItem(this._TREE_KEY_LEGACY); } catch {}
  },

  saveCfg(cfg) {
    this.cfg = Object.assign({ baseUrl: 'http://172.19.15.51/NMS' }, cfg || {});
    localStorage.setItem(this._CFG_KEY, JSON.stringify(this.cfg));
    // Drop any cached tree - the new creds might point at a different NMS,
    // and we want a fresh fetch on the next STATS click anyway.
    this.tree = null;
    try { localStorage.removeItem(this._TREE_KEY); } catch {}
  },

  clearCfg() {
    this.cfg = null;
    localStorage.removeItem(this._CFG_KEY);
    localStorage.removeItem(this._TREE_KEY);
    localStorage.removeItem(this._TREE_KEY_LEGACY);
    this.tree = null;
  },

  // True when all four credentials + base URL are stored. Until then, the
  // STATS button on cards is disabled and we never auto-fetch the tree.
  isConfigured() {
    return !!(this.cfg && this.cfg.baseUrl && this.cfg.outerUser && this.cfg.outerPass
              && this.cfg.innerUser && this.cfg.innerPass);
  },

  // ---- low-level fetch ----

  // POSTs to /ubi/uv/<endpoint> with credentials + any extra body params.
  // Response protocol:
  //   - login: server returns @{ok, userData} via Send-Json (small, fine to wrap)
  //   - data endpoints (tree/rrd/inout/optix/devinfo): server writes UbiView's
  //     own JSON body directly via Send-Raw. HTTP 200 = success, body IS the
  //     parsed JSON. HTTP 4xx/5xx = error, body is {error: '...'} from Send-Json.
  // This avoids PowerShell 5.1's ConvertTo-Json choking on the 100KB+ tree/rrd
  // responses (the old wrapping approach was producing output the browser
  // couldn't parse, leading to silent empty trees).
  async _post(endpoint, extra = {}) {
    if (!this.isConfigured()) {
      throw new Error('UbiView credentials not set - open TOOLS > UbiView Settings');
    }
    const body = Object.assign({}, this.cfg, extra);
    let res, text;
    try {
      res = await fetch('/ubi/uv/' + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      text = await res.text();
    } catch (e) {
      throw new Error('Server unreachable - is server.ps1 running?');
    }
    // Empty body = treat as null. Non-2xx = expect {error}.
    if (!res.ok) {
      let err;
      try { err = JSON.parse(text); } catch { err = { error: text || ('HTTP ' + res.status) }; }
      throw new Error((err.error || 'Unknown error') + (err.stage ? ` (stage: ${err.stage})` : ''));
    }
    if (!text) return null;
    // login wraps {ok, userData}; data endpoints return UbiView's JSON directly.
    try { return JSON.parse(text); }
    catch (e) {
      console.error('[UV] JSON.parse failed for /ubi/uv/' + endpoint + ' (' + text.length + ' chars)', e);
      throw new Error('Bad JSON from UbiView (' + text.length + ' chars) - check server.ps1 console');
    }
  },

  // Test login - returns { ok, userData } or throws
  async testLogin() {
    return this._post('login');
  },

  // ---- tree (cached) ----

  // Returns the cached tree if fresh, else fetches a new one.
  async getTree(forceRefresh = false) {
    if (!forceRefresh) {
      // try in-memory cache
      if (this.tree && (Date.now() - this.tree.ts) < this._TREE_TTL_MS) return this.tree;
      // try localStorage
      try {
        const cached = JSON.parse(localStorage.getItem(this._TREE_KEY));
        if (cached && cached.ts && (Date.now() - cached.ts) < this._TREE_TTL_MS) {
          this.tree = cached;
          console.log('[UV] tree restored from localStorage cache:', cached.units.length, 'units');
          return cached;
        }
      } catch {}
    }
    console.log('[UV] fetching fresh tree from /ubi/uv/tree...');
    const raw = await this._post('tree');
    console.log('[UV] raw tree received:',
      'type=' + typeof raw,
      raw && typeof raw === 'object' ? 'keys=' + Object.keys(raw).slice(0, 8).join(',') : '',
      raw && raw.treeNodesData ? 'treeNodesData.length=' + raw.treeNodesData.length : 'NO treeNodesData');
    const parsed = this._parseTree(raw);
    parsed.ts = Date.now();
    parsed.rawTopKeys = (raw && typeof raw === 'object') ? Object.keys(raw).slice(0, 12) : [];
    parsed.rawNodeCount = (raw && raw.treeNodesData) ? raw.treeNodesData.length : 0;
    this.tree = parsed;
    console.log('[UV] parsed tree:', parsed.units.length, 'units,',
      'sample IPs:', parsed.units.slice(0, 5).map(u => u.ip + '/' + u.siteName).join(' | '));
    try { localStorage.setItem(this._TREE_KEY, JSON.stringify(parsed)); } catch {}
    return parsed;
  },

  // Diagnostic helper - returns a one-liner about the cached tree state,
  // suitable for error messages. (used by STATSMODAL when IP isn't found.)
  describeTree() {
    if (!this.tree) return 'tree not loaded';
    const t = this.tree;
    const ips = t.units.map(u => u.ip).slice(0, 5).join(', ');
    return `${t.units.length} units in tree (raw had ${t.rawNodeCount || '?'} nodes, top-level keys: ${(t.rawTopKeys || []).join(',')}). Sample IPs: ${ips || '(none)'}`;
  },

  // Parse a getTreeData response into a flat unit list. The tree has two
  // useful arrays:
  //   treeNodesData = unit-level rows (one per UbiFiX) with node_name like
  //                   "Iftah 172.18.17.177" and act_name like "ucu2314".
  //   treeDataH     = per-parent children lists (sparse - only populated for
  //                   tree branches that were expanded in UbiView during the
  //                   getTreeData call, so we can't rely on it being complete).
  //
  // **We synthesize sectors from the unit's base treeId rather than reading
  // them from treeDataH.** Empirical convention from HAR data: each unit owns
  // 5 consecutive treeIds starting at base = the unit's treeId. Slots are:
  //   base+0 -> Sector A   (nodeName = ucuXXXX-A, customTreeId = un_<base+0>)
  //   base+1 -> Sector B   (etc)
  //   base+2 -> Sector C
  //   base+3 -> Sector D
  //   base+4 -> the UCU controller itself
  // Units with fewer than 4 sectors will just return empty data for the
  // non-existent ones (the UI handles that gracefully).
  _parseTree(raw) {
    const result = { units: [] };
    if (!raw || !raw.treeNodesData) return result;

    const ipRe = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/;
    for (const node of raw.treeNodesData) {
      // Only unit-level rows: act_name = "ucuXXXX" without hyphen (sector-level
      // entries look like "ucuXXXX-A" and we don't want those at the unit level).
      if (!node.act_name || !node.act_name.startsWith('ucu') || node.act_name.includes('-')) continue;
      const nm = String(node.node_name || '');
      const ipM = nm.match(ipRe);
      if (!ipM) continue;  // grouping/internal nodes have no IP

      const ip = ipM[1];
      const siteName = nm.replace(ipRe, '').replace(/[\s_-]+$/, '').trim();
      const treeIdM = String(node.id || '').match(/_(\d+)$/);
      if (!treeIdM) continue;
      const baseTreeId = parseInt(treeIdM[1], 10);
      const ucuName = node.act_name;

      const sectors = ['A', 'B', 'C', 'D'].map((letter, i) => ({
        letter,
        nodeName:     `${ucuName}-${letter}`,
        customTreeId: `un_${baseTreeId + i}`,
        treeId:       baseTreeId + i,
        displayName:  `${siteName} Sector ${i + 1}`,
      }));

      result.units.push({
        ip, siteName, ucuName,
        treeId:     baseTreeId,
        treeNodeId: node.id,
        sectors,
      });
    }
    return result;
  },

  // Look up the UbiView entry for one of our UDATA units (by IP).
  // Returns null if there's no mapping (unit isn't in UbiView's tree, or
  // tree hasn't been fetched yet).
  findByIp(ip) {
    if (!this.tree) return null;
    return this.tree.units.find(u => u.ip === ip) || null;
  },

  // ---- data calls ----
  // All take a `unit` (from findByIp) and a sector letter ('A'/'B'/'C'/'D').

  _sectorOf(unit, letter) {
    if (!unit || !unit.sectors) return null;
    return unit.sectors.find(s => s.letter === letter) || null;
  },

  // TD Graph time-series: wb_power_a/b, input_power_aN/bN, output_power_aN/bN
  async getRRD(unit, letter, presetPeriod = 'last1hour', secPerPixel = 20) {
    const s = this._sectorOf(unit, letter);
    if (!s) throw new Error(`Sector ${letter} not found in UbiView tree`);
    return this._post('rrd', {
      childId: s.treeId,
      customTreeId: s.customTreeId,
      nodeName: s.nodeName,
      numOfAnts: 0,
      presetPeriod, secPerPixel, antsCombo: 0,
    });
  },

  // Spectrogram per-bin data: a_in/b_in/a_out/b_out arrays (~120 freq bins)
  async getInout(unit, letter, presetPeriod = 'last1hour', secPerPixel = 60) {
    const s = this._sectorOf(unit, letter);
    if (!s) throw new Error(`Sector ${letter} not found in UbiView tree`);
    return this._post('inout', {
      childId: s.treeId,
      customTreeId: s.customTreeId,
      nodeName: s.nodeName,
      numOfAnts: 2,
      presetPeriod, secPerPixel,
    });
  },

  // OPTiX mode timeline for all sectors of a unit at once
  async getOptix(unit, presetPeriod = 'last6hours') {
    if (!unit) throw new Error('No UbiView mapping for this unit');
    const nodes = unit.sectors.map(s => s.nodeName);
    const childrenData = JSON.stringify([{ deviceName: unit.ucuName, nodes }]);
    return this._post('optix', { childrenData, presetPeriod });
  },

  // Static device info for one sector (part #, FW, frequencies)
  async getDeviceInfo(unit, letter) {
    const s = this._sectorOf(unit, letter);
    if (!s) throw new Error(`Sector ${letter} not found in UbiView tree`);
    return this._post('devinfo', {
      isUCU: 'false',
      deviceDisplayName: s.displayName,  // e.g. "Iftah Sector 1"
    });
  },

  // ---- helpers for the Stats UI ----

  // Pull the latest data point from a getRRD response. Returns the most recent
  // {wb_power_a, wb_power_b, input_power_*, output_power_*, alarm_reg, msec_epoch}.
  latestRrdPoint(rrd) {
    if (!rrd || !rrd.data || !rrd.data.length) return null;
    return rrd.data[rrd.data.length - 1];
  },

  // For the small input/output sparkline. Returns parallel arrays:
  //   { ts: [...], inA: [...], inB: [...], outA: [...], outB: [...] }
  // We use the channel-0 input/output as the canonical signal (matches what
  // UbiView's "A In/Out" header line shows in the TD Graph screenshot).
  rrdSeries(rrd) {
    if (!rrd || !rrd.data) return null;
    const ts  = [], inA = [], inB = [], outA = [], outB = [], wbA = [], wbB = [];
    for (const p of rrd.data) {
      ts.push(p.msec_epoch);
      inA.push(p.input_power_a0);  inB.push(p.input_power_b0);
      outA.push(p.output_power_a0); outB.push(p.output_power_b0);
      wbA.push(p.wb_power_a);       wbB.push(p.wb_power_b);
    }
    return { ts, inA, inB, outA, outB, wbA, wbB };
  },
};
