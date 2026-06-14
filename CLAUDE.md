# UbiPlus — Ubiqam Fleet Monitor
## Project Guide for Claude

---

## What this app does

UbiPlus is a desktop dashboard for monitoring **Ubiqam UBiFiX** interference-mitigation units
deployed at IDF LTE sites. It is a friendlier, faster replacement for the vendor's **UbiView** GUI.

Ubiqam (ubiqam.net) makes LTE interference-cancellation / relay hardware (UBiFiX) installed at
cell sites. The vendor gave us a **restricted user**: the only allowed operations are logging in
to a unit via PuTTY (telnet, IP + port) and running `get status` / turning the unit on or off.
No API, no bulk query — UbiView exists but its GUI is poor and we want our own.

**Ubiqam unit modes (the core domain model):**
| Mode | Meaning | UbiView color | UbiPlus (parchment / dark theme) |
|---|---|---|---|
| `inline` | Unit working, actively cancelling interference | dark green | green — `#2e7d4f` / `#19b563` |
| `bypass` | Unit not working — RF passes through untouched | dark purple | purple — mauve `#9d4d77` / `#8b3df5` |
| `transparent` | **Unknown** — control artery down, unit may be on or off | — | ochre `#7f6c1f` / steel blue `#7eb8d4` |
| (unreachable) | Telnet connect failed / timeout | — | red — `#c0394b` / `#ff3b5c` |

All of these live only in the CSS vars `--st-*` (per theme, with `--st-*-bg`/`--st-*-fg`
badge pairs) — JS never hardcodes a status color.

`transparent` is the painful one: the control channel is dead so the real RF state cannot be
determined remotely. UbiPlus surfaces it honestly as UNKNOWN instead of hiding it.

**A unit is per SITE but reports per SECTOR.** One telnet session returns one mode per sector
on a single `--`-joined line, e.g. a 4-sector site: `inline--inline--bypass--bypass`.
UbiPlus stores the array (`u.sectors`), renders a chip per sector on the card (S1, S2…), and
aggregates for the card border / header counts: all sectors agree → that mode; they disagree
→ `mixed` (blue, `--st-mixed`).

---

## How to run it

```powershell
cd d:\projects\ubiplus
.\server.ps1
# Opens http://localhost:8090/ubiplus/ in the browser automatically
```

Port **8090** (Interfex uses 8080 — both can run side by side on the OSP).

---

## OSP computer context (shared with Interfex)

The OSP (Operations Support Platform) is a **separate, isolated office computer** with
**no internet access**, sitting on the internal network that can reach the Ubiqam units
and ENM. The developer's home computer **cannot reach any Ubiqam unit**.

- PuTTY is installed on the OSP; standalone `plink.exe` lives at `C:\tools\plink.exe`
- `server.ps1` searches for plink in: PATH, `C:\Program Files\PuTTY`, `C:\PuTTY`,
  `C:\tools`, Desktop, Downloads
- Fonts are self-hosted in `ubiplus/fonts/` (copied from Interfex) — never use a CDN

---

## Telnet / plink integration

Units are reached with **telnet** (NOT ssh): `plink -telnet {ip} -P {port}`.

Pattern (inherited from Interfex AMOS work — same rules apply):
1. Server writes a commands file with **Unix `\n` line endings only** (`[IO.File]::WriteAllText`).
   CRITICAL: `\r\n` corrupts interactive prompts because the remote PTY translates `\r`→`\n`,
   producing an extra empty answer to the next prompt.
2. Feeds it to plink via stdin redirect: `plink -telnet {ip} -P {port} < commands.txt`
3. Captures stdout/stderr concurrently with `ReadToEndAsync()` (prevents pipe-buffer deadlock).
4. Strips ANSI escapes + control chars before JSON encoding:
   ```powershell
   $stdout = $stdout -replace '\x1b\[[0-9;]*[A-Za-z]', ''
   $stdout = $stdout -replace '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', ''
   ```
5. Returns `{ok, output}` JSON to the browser, which parses the status.

### Real session format (VERIFIED from a PuTTY photo, Gen4 ver 2.3.31.00, 2025-07-30)

```
Enter your user name--->idfuser
2025/07/30 - 14:04:32  --Server ACK
Enter your pasword--->6ehdZgg4              ← "pasword" typo is in the firmware; echoed in clear
2025/07/30 - 14:05:19  --Server ACK
Welcome to Gen4 ver 2.3.31.00 Built on ... FPGA version is 45230
Used Gen4 is /p2/Gen4Target_Gnueabihf
Gen4 uptime: 20:41:46 / System uptime / load average lines
2025/07/30 - 14:05:19 **** 2317 **** --GEN4 TERMINALL -->
get status
2025/07/30 - 14:05:53  --Server ACK
JC status 0xf1101
inline--inline--bypass--bypass              ← THE status line: one mode per sector, '--' joined
SFPs: Temperature VCC TX bias TX power RX power ... table with BBUn/RRUn row pairs per sector
```

Parser (`statuscheck.js` `_parseSectors`) regex-matches that whole-line sector pattern and
splits on `--`. Aggregate (`_aggregate`): unanimous → that mode, else `mixed`; reachable but
no sector line → `transparent` (unknown).

**Still UNVERIFIED:** the on/off command syntax; whether `transparent` actually appears as a
token in the sector line (never captured); whether the plink stdin-feed answers the
`--->` prompts cleanly on the OSP. Standard fleet credentials: `idfuser` / `6ehdZgg4`
(pre-filled in the Add Unit modal); port is always **10001**.

### server.ps1 endpoints
- `GET  /ubiplus/*` — static files
- `POST /ubi/status` — body `{ip, port, user, pass}` → runs plink telnet, returns `{ok, output}` or `{error}`. Timeout 30s. Single-threaded: blocks the server while running.
- `POST /ubi/power` — body `{ip, port, user, pass, cmd}` → same transport, sends `set link N mode {bypass|inline}`. Command syntax still UNVERIFIED against a real unit.

---

## File structure

```
ubiplus/
  index.html        — single-page app, all modals + press overlay (loading page)
  css/main.css      — all styles, CSS custom properties, parchment (Slite) default + html.dark
  fonts/            — self-hosted Manrope + Jersey 10 + Fraunces (headings, via henry.css;
                      Inter/Antonio woff2 are unused leftovers)
  assets/
    icon.png        — app icon (user-supplied, source of truth)
    icon.ico        — generated from icon.png for Electron builds (committed; see Electron section)
    icon.svg        — original SVG design concept (hexagon + U + plus); superseded by icon.png
  js/
    data.js         — UDATA: unit inventory CRUD, persisted in localStorage
    seed.js         — one-time site list import (129 sites from DATA_MEGIC.xlsx, col A;
                      placeholder random IPs, real ones entered on the OSP. Flag: 'ubiplus_seeded')
    ui.js           — dashboard grid rendering, header stats, toasts, CSV export, filter/search
    unitmodal.js    — Add/Edit Unit modal
    statuscheck.js  — single + check-all status flow, telnet output parser
    powercontrol.js — SET modal: sector mode control (set link N mode bypass|inline)
    history.js      — HISTORY (snapshot store) + HISTMODAL (Fleet History modal with comparison
                      tabs and Search tab)
    autopoll.js     — AUTOPOLL: configurable auto check-all timer with countdown display
    ipimport.js     — IPIMPORT: bulk IP update from a CSV file (name + ip columns);
                      "+" button at right end of filter bar; updates ip/port/user/pass on
                      every matched unit; case-insensitive + underscore/space normalised matching
    lobby.js        — LOBBY + CAT (replaced knight.js 2026-06, user's pick): a pixel living
                      room drawn into the free header stretch between stats and actions —
                      wall/floor, windows (day in parchment / moon + stars in dark, swaps
                      live via MutationObserver on html.class), TV (static plays only while
                      the cat watches), terracotta sofa, rug, plant, lamp, bookshelf with
                      Slite-palette book spines, food bowl, picture. Furniture packs
                      right-to-left and drops off as the header narrows (ResizeObserver).
                      The orange tabby CAT wanders between stations when idle (rug nap,
                      sofa, windowsill, TV, floor sits, grooming); during checks it keeps
                      the knight's public API — visit/endWork/celebrate/park — walks to the
                      card being checked and paws a tiny console while the telnet runs.
                      Toggle: TOOLS > Hide Cat (localStorage 'ubiplus_cat'; legacy
                      'ubiplus_knight' read as fallback). The loading page (press overlay)
                      animates the same sit/groom sprite frames
server.ps1          — PowerShell HTTP server + plink telnet proxy
.gitignore          — excludes Electron build artefacts: main.js, package.json,
                      package-lock.json, node_modules/, dist/
```

Script load order in index.html:
`data.js` → `seed.js` → `history.js` → `statuscheck.js` → `powercontrol.js` → `unitmodal.js`
→ `ui.js` → `autopoll.js` → `ipimport.js` → `lobby.js`

Boot sequence: `UDATA.load()` → `SEED.run()` → `UI.renderAll()` → `AUTOPOLL.init()` → `CAT.init()`

---

## Data model

Inventory is **manual** (no Excel import): engineer adds each unit once in the app.
Persisted in `localStorage` key `ubiplus_units`.

```js
{
  id:    'u_1718000000000',  // generated
  name:  'Maof',             // site name (free text)
  ip:    '10.20.30.40',
  port:  23,
  user:  '',                 // telnet login, optional until verified on OSP
  pass:  '',
  note:  '',                 // free text (e.g. "north mast, sector 2")
  status:    'unchecked',    // aggregate: 'unchecked'|'inline'|'mixed'|'bypass'|'transparent'|'offline'
  sectors:   [],             // per-sector modes from last check, e.g. ['inline','inline','bypass']
  lastCheck: null,           // ISO timestamp of last status check
  lastRaw:   null,           // raw telnet output of last check (shown in detail modal)
  // one-deep history for the Δ CHANGES feature — every completed check rotates
  // current → prev (first-ever check sets no baseline). UDATA.changed(u) compares.
  prevStatus:  undefined,    // aggregate of the check before the latest
  prevSectors: undefined,    // sector array of the check before the latest
  prevCheck:   undefined,    // ISO timestamp of that previous check
}
```

**History snapshot model** (`ubiplus_history`): compact — no raw output stored.
```js
{ ts: ISO, snap: [{ id, name, status, sectors }] }  // one entry per check-all
```

**localStorage keys:**
- `ubiplus_units` — unit inventory array
- `ubiplus_history` — array of snapshots `[{ts, snap}]`; pruned by retention setting; hard cap 500 entries
- `ubiplus_autopoll` — `{interval, retention}` — interval in seconds (0=off), retention in days
- `ubiplus_theme2` — `'dark'` = dark mode; absent/other = parchment default (old key `ubiplus_theme` ignored)
- `ubiplus_seeded` — `'1'` = seed.js already ran in this browser
- `ubiplus_cat` — `'0'` = cat hidden (legacy key `ubiplus_knight` read as fallback)

Seed inventory came from `C:\Users\user\Desktop\data_for_interfex\DATA_MEGIC.xlsx`
(sheet DATAFINAL, col A NodeId, 804 rows → 308 unique sites). Excluded families per the
engineer: `MMSL_*` (Takti/1xxx/Pakar), `Halif*`, `Petel*`, `Relay_*`, `MiniSite*`,
`OutDoor*`, `BB_Test`, `APC_Live`, and `*_SL` slave variants → **129 fixed sites**.
KD* sites are real and kept. Seeded IPs are random placeholders (172.18.x.y) — the real
per-unit IPs are only known/enterable on the OSP.

---

## Features (added 2026-06)

### Status filter + search bar (filter-bar, ui.js)
A sticky bar sits below the header (`top: 72px`). Left side: pill buttons (ALL / INLINE / BYPASS /
MIXED / TRANSPARENT / OFFLINE / UNCHECKED) with live counts that update after every check.
Right side: a text search input. Both filters combine — selecting BYPASS and typing "Ma" shows
only bypass units whose name contains "Ma". `UI.setFilter(st)` and `UI.setSearch(q)` drive this.
`renderCard()` calls `renderGrid()` instead of patching in-place when any filter is active, so
cards appear/disappear from the filtered view correctly during check-all.

### Power control — SET modal (powercontrol.js)
Each card has a **SET** button (`.btn-set`). Opens the power modal (`#powerModal`):
- Shows sector chips with their current mode; engineer clicks one to select it
- INLINE / BYPASS mode buttons below
- Live command preview: `set link N mode {bypass|inline}` in a terminal block
- APPLY is disabled until both sector and mode are selected; also disabled if `u.sectors` is
  empty (unit never checked) to prevent sending a bad link number
- On apply: POSTs `{ip, port, user, pass, cmd}` to `/ubi/power`, then re-runs `CHECK.unit()` to
  confirm the change
- **Command syntax still UNVERIFIED** — `/ubi/power` is wired but hidden from UI until confirmed on OSP

### Auto-poll (autopoll.js)
`AUTOPOLL` lives in `autopoll.js`. Configurable interval (Off / 30m / 1h / 3h / 6h / 12h / 24h)
shown in the filter bar as a `<select>`. A countdown label (`#pollCountdown`) ticks every second.
On fire: calls `CHECK.all()`, which saves a history snapshot on completion, then re-arms.
Settings persisted in `localStorage` key `ubiplus_autopoll` (`{interval, retention, nextAt}`).
`_nextAt` (the exact due timestamp) is saved to localStorage in `_arm()` and on every `_save()`.
On `init()`: if `nextAt` is in the future → resume countdown from remaining time; if it is in the
past → fire immediately (check was overdue while the app was closed); if absent → start fresh.

### Fleet History (history.js — HISTORY + HISTMODAL)
Every completed (non-aborted) Check All calls `HISTORY.snapshot()` which saves a compact snap.
Pruned by `AUTOPOLL.retention` (days) with a hard cap of 500 entries.

`HISTMODAL` — opened from TOOLS > History:
- **Since last check / Last 24h / Last 7d / Last 14d tabs**: side-by-side status count comparison
  (before → now → Δ grid) plus list of changed units with per-sector diffs
- **Search tab**: three modes depending on inputs:
  - *Site name only* → full status timeline for that unit (first recorded state + every change,
    skip unchanged snapshots). If multiple sites match the typed text, shows clickable name pills.
  - *Date + time only* → nearest snapshot to that moment: status breakdown counts + units that
    changed from the previous snapshot
  - *Both* → that unit's exact status at the chosen point in time (from the nearest snapshot) +
    previous snapshot state for context
- Retention selector in modal header persists to `ubiplus_autopoll`
- EXPORT CSV: before/after comparison CSV with UTF-8-BOM (for Excel). Disabled on Search tab.
- Storage estimate: ~10 KB per 129-unit snapshot; 3h interval × 7-day retention ≈ 560 KB

---

## Design system

**Slite parchment editorial look (default since 2026-06-12, applied at the user's explicit
request from a styles.refero.design "Slite" style reference — the full reference md is
checked in as `DESIGN.md`).** Warm cream ground, chalk cards, graphite pill CTAs, muted
category-badge status chips. The original dark status wall survives intact as `html.dark`
(TOOLS > Dark Mode) — same geometry, dark palette.

Parchment palette (theme vars in `html {}`, dark overrides in `html.dark {}`):
- Ground `#f9efe4` (parchment), cards/modals `#fdfdfd` (chalk), hovers/nested `#fdf9f4`
  (vellum), input fills `#f0e4d6` (linen), borders `#d9dde6` (silver mist)
- Text: ink `#3f434a`, slate `#656565`, ash `#9da3af`
- CTA fill: graphite `#2d2f34` (one filled pill per screen — CHECK ALL; per-card CHECK is an
  outlined pill that fills graphite on hover; OUTPUT is a borderless ghost)
- Interactive accent (focus, toast bar, selection ring): blueprint `#2e77e5`
  (`--accent`; in dark theme `--accent` stays Ubiqam green `#19b563`)

- Fonts: Manrope for UI (`--ui`), **Fraunces** for headings/card names/stat numbers
  (`--display`, the style ref's named Garnett substitute, loaded from fonts/henry.css),
  Jersey 10 for the wordmark + press title only (`--logo`, ink-colored, glow removed),
  Consolas for IP:port + raw telnet output (`--mono`)
- Status chips/pills are **Slite category badges**: `border-radius 50px`, muted tinted bg +
  deep-tone text via `--st-*-bg`/`--st-*-fg` pairs (bypass = mauve on blossom, transparent =
  ochre on buttercup, CHG flag = terracotta pair). In dark theme the pairs collapse to the
  original solid chip + white text. ui.js emits `class="schip st-{status}"` — badge colors
  live ONLY in CSS, never inline styles
- Header stats are typographic "rating chips": no boxes, Fraunces 700 number + ash label + status dot
- All buttons are pills (radius 50px). Bouncy CTA pattern kept on filled pills:
  `transition: all .3s cubic-bezier(0.68,-0.55,0.265,1.55)`, expanding shadow + padding on hover
- Cards: radius 12px, 1px silver-mist border, three-layer whisper shadow (`--shadow-md`);
  modals radius 24px; input lift on focus kept (2px translateY, blueprint border)
- Raw telnet output renders in a graphite terminal block (`--term-bg`) even in light theme
- Header uses the Interfex TOOLS dropdown pattern (`.tools-menu`/`.tools-item`): Add Unit /
  Compare / Export CSV / History / theme live inside it; CHECK ALL stays standalone.
  Tools-item hover uses translateX nudge, NOT padding-grow (padding-grow caused hover rattle)
- **Press overlay** (`.press`, `#press` in index.html): loading page shown on boot — the
  pixel cat sitting/grooming (inline SVG rects), Jersey 10 "UBIPLUS", animated progress bar;
  theme-var driven (parchment by default); dismissed 1.4s after window load, then removed from DOM
- Cat sprite palette (lobby.js `CAT.C`): terracotta `#f67748` tabby with blueprint collar,
  graphite eyes, blossom inner ears — mascot/illustration colors, exempt from the
  blueprint-accent-only rule. Lobby furniture uses the same Slite spot colors per theme
- History: the 2026-06 "Henry" broadside restyle was applied and rolled back same day (user
  preferred dark then); on 2026-06-12 the user explicitly requested this Slite parchment
  restyle, which now ships as the default with dark kept one toggle away. Inter/Antonio
  woff2 remain unused-but-kept (offline-safe).

---

## Demo mode (removed 2026-06-13 — recipe for restoration)

Demo mode was removed because the app is used on the OSP where real telnet works. If you need
to add it back for development at home, restore these four pieces:

### 1. statuscheck.js — add to CHECK object

Add `demo: false` to the CHECK object properties, then add these two methods:

```js
initDemo() {
  this.demo = localStorage.getItem('ubiplus_demo') === '1';
  document.getElementById('chkDemo').checked = this.demo;
},

setDemo(on) {
  this.demo = on;
  localStorage.setItem('ubiplus_demo', on ? '1' : '0');
  UI.toast(on ? 'Demo mode ON — telnet output is fabricated' : 'Demo mode OFF');
},
```

In `unit()`, wrap the fetch in a demo branch:
```js
let result;
if (this.demo) {
  result = await this._demoFetch(u);
} else {
  try { ... } catch (e) { ... }
}
```

Add `_demoFetch(u)` — fabricates a plausible Gen4 telnet transcript:
```js
_demoFetch(u) {
  const roll = Math.random();
  if (roll < 0.08) {
    return new Promise(r => setTimeout(() =>
      r({ error: 'Timeout after 30s — unit unreachable' }), 900 + Math.random() * 800));
  }
  const nSec = 1 + Math.floor(Math.random() * 4);
  const r = Math.random();
  const base = r < 0.72 ? 'inline' : (r < 0.92 ? 'bypass' : 'transparent');
  const sectors = Array.from({ length: nSec }, () => base);
  if (nSec > 1 && Math.random() < 0.18) {
    sectors[Math.floor(Math.random() * nSec)] = base === 'inline' ? 'bypass' : 'inline';
  }
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())} - ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  const load = () => (Math.random() * 0.5).toFixed(2);
  const rnd = (min, max, dec = 2) => (min + Math.random() * (max - min)).toFixed(dec);
  const sfpRows = [];
  for (let i = 0; i < nSec; i++) {
    for (const kind of ['BBU', 'RRU']) {
      sfpRows.push(
        `${kind}${i}:   ${rnd(35,40)}°C    ${rnd(3.20,3.28)}V   ${rnd(18,46)}mA   ` +
        `${rnd(0.29,0.76)}mW/${rnd(-5.3,-1.2)}dBm   ${rnd(0.06,0.11,3)}mW/${rnd(-11.8,-9.6)}dBm   0.00°C   -0.09m`,
        `  A   0     0     0     0     0     7 (7)     0`);
    }
  }
  const body = [
    `Enter your user name--->${u.user || 'idfuser'}`, `${ts}  --Server ACK`,
    `Enter your pasword--->${u.pass || '********'}`, `${ts}  --Server ACK`, '',
    'Welcome to Gen4 ver 2.3.31.00 Built on 18:10:58 Nov  6 2024. FPGA version is  45230',
    'Used Gen4 is /p2/Gen4Target_Gnueabihf',
    `Gen4 uptime: ${Math.floor(Math.random()*200)}:${p(Math.floor(Math.random()*60))}:${p(Math.floor(Math.random()*60))}`,
    `System uptime:  ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`, '',
    `up 20:42,  2 users,  load average: ${load()}, ${load()}, ${load()}`, '',
    `${ts} **** ${1000+Math.floor(Math.random()*9000)} **** --GEN4 TERMINALL -->`,
    'get status', '', `${ts}  --Server ACK`,
    `JC status 0xf${Math.floor(Math.random()*0xffff).toString(16).padStart(4,'0')}`, '',
    sectors.join('--'), '',
    'SFPs: Temperature    VCC     TX bias     TX power           RX power            Laser temp   TEC',
    '  LOS   LOF   TX Dis   TX Fault   RX LOS   CPRI Status   8/10 Errors',
    '====================================================================================',
    ...sfpRows,
  ].join('\n');
  return new Promise(r => setTimeout(() => r({ ok: true, output: body }), 500 + Math.random() * 900));
},
```

### 2. powercontrol.js — add to POWER.execute() and add _demoFetch

In `execute()`, wrap the fetch:
```js
if (CHECK.demo) {
  result = await this._demoFetch(link, mode);
} else { try { ... } catch { ... } }
```

Add `_demoFetch` method:
```js
_demoFetch(link, mode) {
  return new Promise(r => setTimeout(() => {
    r(Math.random() < 0.05
      ? { error: 'Timeout after 30s — unit unreachable' }
      : { ok: true, output: `set link ${link} mode ${mode}\r\nACK\r\n` });
  }, 500 + Math.random() * 700));
},
```

### 3. index.html — add toggle in header actions

Inside `<div class="hdr-actions">`, before the tools menu:
```html
<label class="demo-toggle" title="Demo mode — fabricates telnet output for UI work off the OSP">
  <input type="checkbox" id="chkDemo" onchange="CHECK.setDemo(this.checked)">
  <span class="demo-track"><span class="demo-thumb"></span></span>
  <span class="demo-label">DEMO</span>
</label>
```

Add to boot sequence: `CHECK.initDemo();` (between `SEED.run()` and `UI.renderAll()`).

### 4. css/main.css — toggle styles

Add in the button section:
```css
/* ============ DEMO TOGGLE ============ */
.demo-toggle { display: flex; align-items: center; gap: 7px; cursor: pointer; user-select: none; }
.demo-toggle input { display: none; }
.demo-track {
  width: 34px; height: 18px; background: var(--line);
  border-radius: 10px; position: relative; transition: background .2s;
}
.demo-thumb {
  position: absolute; top: 2px; left: 2px;
  width: 14px; height: 14px; background: var(--txt-faint);
  border-radius: 50%; transition: left .2s, background .2s;
}
.demo-toggle input:checked + .demo-track { background: var(--tgl-on-track); }
.demo-toggle input:checked + .demo-track .demo-thumb { left: 18px; background: var(--tgl-on-thumb); }
.demo-label { font-size: 10px; font-weight: 800; letter-spacing: 1.5px; color: var(--txt-dim); }
```

Also add `ubiplus_demo` to localStorage: `'1'` = demo on.

---

## Electron packaging (added 2026-06-13)

The app is packaged as a standalone Windows exe so the team can run it on the OSP without
accidentally closing a browser tab while autopoll is running.

Electron files (`main.js`, `package.json`, `package-lock.json`, `node_modules/`, `dist/`) are
**not committed** — all excluded by `.gitignore`. Regenerate when needed.

### Build recipe

```powershell
cd d:\projects\ubiplus
powershell -ExecutionPolicy Bypass -Command "npm install"
powershell -ExecutionPolicy Bypass -Command "npm run build"
# npm run build exits with code 1 due to a winCodeSign symlink error (macOS dylibs can't be
# extracted without Developer Mode). This is harmless — the exe IS created in dist\win-unpacked.
# The icon must be embedded separately because electron-builder skips it when signing fails:
& node_modules\rcedit\bin\rcedit-x64.exe dist\win-unpacked\UbiPlus.exe --set-icon ubiplus\assets\icon.ico
Compress-Archive -Path 'dist\win-unpacked\*' -DestinationPath 'dist\UbiPlus.zip' -Force
```

Copy `dist\UbiPlus.zip` (~103 MB) to the OSP. Unzip anywhere, run `UbiPlus.exe`.

### package.json key settings
```json
{ "main": "main.js", "build": { "asar": false, "win": { "target": "dir",
  "icon": "ubiplus/assets/icon.ico" },
  "files": ["main.js","package.json","server.ps1","ubiplus/**"] } }
```

### main.js behaviour
- Spawns `server.ps1 -NoLaunch` in the background (no PowerShell window)
- Polls `http://localhost:8090/ubiplus/` up to 40×400ms until the server is ready
- Opens a 1440×900 BrowserWindow with the UbiPlus icon; menu bar hidden
- Kills the server process on window close

**Critical — `res.resume()` + `serverReady` guard** (same bug as Interfex):
Not draining the HTTP poll response leaves the socket open; when the server closes it, the
error handler fires, the poller retries, finds the server up, and opens a second window.
Fix: call `res.resume()` inside the poll callback, and guard with a `serverReady` boolean so
only the first successful poll triggers `win.loadURL()`.

### Icon
`ubiplus/assets/icon.ico` is generated from `icon.png` by writing a minimal ICO binary that
embeds the PNG directly (Windows supports PNG-in-ICO for 256×256). It is committed so future
builds don't need to re-generate it. To regenerate if icon.png changes:
```powershell
$png = [IO.File]::ReadAllBytes('ubiplus\assets\icon.png'); $sz = $png.Length; $off = 22
$hdr = [byte[]](0,0,1,0,1,0)
$ent = [byte[]](0,0,0,0,1,0,32,0,($sz-band 0xFF),(($sz-shr 8)-band 0xFF),(($sz-shr 16)-band 0xFF),(($sz-shr 24)-band 0xFF),($off-band 0xFF),0,0,0)
[IO.File]::WriteAllBytes('ubiplus\assets\icon.ico', ($hdr + $ent + $png))
```

---

## Known issues / pending work
- Login sequence + `get status` output format now verified from a real PuTTY capture (see
  Telnet section) — but the plink stdin-feed flow itself is still untested against a real unit
- `POST /ubi/power` (on/off) wired in server and UI but command syntax not yet confirmed on OSP;
  the SET button is visible but the actual `set link N mode` command may differ from what the
  firmware expects
- Check-all is sequential (server is single-threaded). Healthy unit ≈ a few seconds; dead units
  fail fast via a 4s TCP probe in `Invoke-UbiTelnet` (added so 80-site mission sweeps don't stall
  30s per dead site). ~80 sites ≈ 5–10 min unattended vs ~80+ min clicking through UbiView.
- `UI.exportCSV()` (TOOLS > Export CSV) downloads the fleet table — one row per site, a column
  per sector, plus Changed (YES) + Changes ("S3 BYPASS -> INLINE") columns vs the previous
  check — as UTF-8-BOM CSV for Excel mission reports. No xlsx lib (OSP has no internet, no CDN).
- Electron exe exists — see Electron packaging section above for the build recipe
