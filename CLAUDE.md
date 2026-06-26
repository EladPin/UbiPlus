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
| `half-inline` | Partial inline — one RF path cancelling, the other not (observed 2026-06-24) | — | teal `#3a857d` / cyan `#4dd4c1` |
| `bypass` | Unit not working — RF passes through untouched | dark purple | purple — mauve `#9d4d77` / `#8b3df5` |
| `half-bypass` | Speculative twin of `half-inline` (not yet observed; styled anyway) | — | rose `#a8526a` / pink `#d678a8` |
| `transparent` | **Unknown** — control artery down, unit may be on or off | — | ochre `#7f6c1f` / steel blue `#7eb8d4` |
| (unreachable) | TCP connect failed / timeout | — | red — `#c0394b` / `#ff3b5c` |

All of these live only in the CSS vars `--st-*` (per theme, with `--st-*-bg`/`--st-*-fg`
badge pairs) — JS never hardcodes a status color. `UI._meta(s)` is the only lookup point;
any sector token the parser sees that isn't in `STATUS_META` renders as a generic chip
using its own uppercased name + the unchecked palette (so future firmware modes parse
without a code change — they just need CSS to look pretty).

`transparent` is the painful one: the control channel is dead so the real RF state cannot be
determined remotely. UbiPlus surfaces it honestly as UNKNOWN instead of hiding it.

**A unit is per SITE but reports per SECTOR.** One session returns one mode per sector
on a single `--`-joined line, e.g. a 4-sector site: `inline--inline--bypass--bypass` or
`inline--bypass--half-inline--inline`. UbiPlus stores the array (`u.sectors`), renders a
chip per sector on the card (S1, S2…), and aggregates for the card border / header counts:
all sectors agree → that mode; they disagree → `mixed` (blue, `--st-mixed`).

**Parser permissiveness (`statuscheck.js _parseSectors`):** the regex used to be a strict
alternation `inline|bypass|transparent`, which broke the moment `half-inline` showed up
on a real unit (Amitay, 2026-06-24 — card silently went TRANSPARENT with "no sector
line"). The regex now matches any lowercase token with an optional hyphen (`[a-z]+(?:-[a-z]+)?`)
separated by `--`, alone on a line. Whole-line anchor + `--` separator make false matches
extremely unlikely in the rest of a Gen4 session transcript.

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

- `server.ps1` talks to units via direct TCP (PowerShell `TcpClient`); no plink/PuTTY/SSH
  dependency. PuTTY can still be useful on the OSP for manual interactive sessions.
- Fonts are self-hosted in `ubiplus/fonts/` (copied from Interfex) — never use a CDN

---

## UBiFiX session transport

**Direct TCP from PowerShell — no plink, no telnet, no SSH.** The UBiFiX listener on port
10001 is a plain byte stream. `Invoke-UbiSession` in `server.ps1` opens a `TcpClient`,
reads/writes the socket directly, and walks the prompt sequence interactively.

History (in case it shifts again):
1. First attempt: `plink -telnet`. Hung — the unit doesn't speak telnet protocol, so plink
   waited forever on IAC option replies the unit never sent.
2. Second attempt: `plink -raw`. The unit replied (raw is just a TCP byte stream), but plink
   closed the socket the instant our stdin EOF'd. Symptom: we saw the username ACK and the
   password prompt, then nothing — plink was already gone before the unit (which takes
   ~30–50s per command to ACK) could process the password.
3. Current: direct TCP via `[System.Net.Sockets.TcpClient]`. Lets us wait for each prompt
   before sending the next line and bail as soon as the sector line arrives. Strictly
   better than plink for an interactive protocol, and removes the plink dependency entirely
   (one less binary to drop on the OSP).

Session pattern (`Invoke-UbiSession`):
1. TCP connect with a 4s probe; on timeout return `No TCP answer ... unreachable`.
2. Read until `Enter your user name--->` → write `{user}\n`. **Unix `\n` line endings only.**
   (`\r\n` was a hazard in the old plink-on-telnet days; in raw TCP `\n` is what the unit
   wants — verified.)
3. Read until `Enter your pasword--->` (firmware typo is real) → write `{pass}\n`.
4. Read until `--GEN4 TERMINALL -->` → write `{cmd}\n`.
5. For `get status`: read until the sector line regex matches; for other commands: read
   until `--Server ACK`. Bail at that point — we already have what we need.
6. Best-effort `exit\n` then close the socket.

All reads pass through ANSI-escape and control-char strippers before regex matching, then
again on the final captured log before returning to the browser:
```powershell
$clean = $log.ToString() -replace '\x1b\[[0-9;]*[A-Za-z]', '' `
                         -replace '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', ''
```

Returns `{ok, output}` on a clean session, `{error, output}` on any stage failure (with
whatever partial transcript we managed to capture — useful for OUTPUT-button debugging).

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

**Still UNVERIFIED:** the on/off command syntax; whether `transparent` actually appears as
a token in the sector line (never captured). **Verified 2026-06-24 on OSP:** the unit
answers raw TCP on port 10001, ACKs `idfuser` immediately, prints the password prompt — and
ACKs every subsequent command if you wait for each prompt before sending the next (the
plink-based version closed the socket too early; direct TCP solved it). Standard fleet
credentials: `idfuser` / `6ehdZgg4` (pre-filled in the Add Unit modal); port is always
**10001**.

### server.ps1 endpoints
- `GET  /ubiplus/*` — static files
- `POST /ubi/status` — body `{ip, port, user, pass}` → `Invoke-UbiSession`, returns `{ok, output}` or `{error, output}`. Per-stage timeout 75s, total ceiling 300s. Single-threaded: blocks the server while running.
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
    elad.jpg        — builder portrait (copied from Interfex), shown in the About modal
  js/
    data.js         — UDATA: unit inventory CRUD, persisted in localStorage
    seed.js         — fleet sync (2026-06-24): 41 real units captured from the OSP UbiView
                      tree (North + South). On first boot it migrates the existing inventory:
                      removes units not in the screenshots, aligns IPs/port/user/pass on
                      matches (name normalised: case + _/-/space collapsed), adds the rest.
                      Flag: 'ubiplus_seed_v2_real_ips' (legacy 'ubiplus_seeded' also set)
    ui.js           — dashboard grid rendering, header stats, toasts, CSV export, filter/search
    unitmodal.js    — Add/Edit Unit modal
    statuscheck.js  — single + check-all status flow, raw-stream output parser
    powercontrol.js — SET modal: sector mode control (set link N mode bypass|inline)
    history.js      — HISTORY (snapshot store) + HISTMODAL (Fleet History modal with comparison
                      tabs and Search tab)
    autopoll.js     — AUTOPOLL: configurable auto check-all timer with countdown display
    ipimport.js     — IPIMPORT: bulk IP update from a CSV file (name + ip columns);
                      "+" button at right end of filter bar; updates ip/port/user/pass on
                      every matched unit; case-insensitive + underscore/space normalised matching
    ubiview.js      — UVCLIENT: vendor NMS HTTP client (cfg storage, tree cache, IP→ucu
                      mapping, rrd/inout/optix/devinfo fetches). See "UbiView NMS integration"
    statsmodal.js   — UVSETTINGS (cred-config modal) + STATSMODAL (per-card live data
                      modal: LIVE chart + SPECTROGRAM heatmaps + OPTiX + Device tabs)
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
server.ps1          — PowerShell HTTP server + direct-TCP session driver
                      (Invoke-UbiSession: prompt-driven login + command via TcpClient)
.gitignore          — excludes Electron build artefacts: main.js, package.json,
                      package-lock.json, node_modules/, dist/
```

Script load order in index.html:
`data.js` → `seed.js` → `history.js` → `statuscheck.js` → `powercontrol.js` → `unitmodal.js`
→ `ui.js` → `autopoll.js` → `ipimport.js` → `ubiview.js` → `statsmodal.js` → `lobby.js`

Boot sequence: `UDATA.load()` → `SEED.run()` → `UVCLIENT.loadCfg()` → `UI.renderAll()` → `AUTOPOLL.init()` → `CAT.init()`

---

## Data model

Inventory is seeded from the OSP UbiView screenshots (see `seed.js`) and then editable
in the app. Persisted in `localStorage` key `ubiplus_units`.

```js
{
  id:    'u_1718000000000',  // generated
  name:  'Maof',             // site name (free text)
  ip:    '172.18.17.137',
  port:  10001,
  user:  'idfuser',          // pre-filled standard fleet creds
  pass:  '6ehdZgg4',
  note:  '',                 // free text (e.g. "north mast, sector 2")
  order: 0,                  // manual sort position (drag-and-drop on cards)
  status:    'unchecked',    // aggregate: 'unchecked'|'inline'|'mixed'|'bypass'|'transparent'|'offline'
  sectors:   [],             // per-sector modes from last check, e.g. ['inline','inline','bypass']
  reason:    null,           // short failure tag for offline/transparent cards (e.g. 'no TCP', 'auth failed', 'no sector line')
  lastCheck: null,           // ISO timestamp of last status check
  lastRaw:   null,           // raw stream output of last check (shown in detail modal)
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
- `ubiplus_seeded` — `'1'` = legacy v1 seed flag, kept set to suppress re-seed
- `ubiplus_seed_v2_real_ips` — `'1'` = v2 (real-fleet) sync has run in this browser
- `ubiplus_cat` — `'0'` = cat hidden (legacy key `ubiplus_knight` read as fallback)
- `ubiplus_uv_cfg` — UbiView NMS credentials: `{baseUrl, outerUser, outerPass, innerUser, innerPass}`
- `ubiplus_uv_tree_cache_v2` — cached `getTreeData` result with `ts` for 6h TTL
  (key bumped from `ubiplus_uv_tree_cache` after the silent-empty-tree fix; legacy
  v1 key is auto-removed on boot)

Seed inventory was originally derived from `DATA_MEGIC.xlsx` (129 placeholder sites with
random IPs). Replaced 2026-06-24 with the 41-unit real fleet captured from OSP UbiView
screenshots — `seed.js` v2 migrates older browsers in place (removes unmatched units,
aligns IPs/port/user/pass on matches, adds the rest).

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

### Per-card sparklines (added 2026-06-24)
Each card draws a tiny per-sector trend strip from the latest 40 HISTORY snapshots:
one row per sector (`S1`, `S2`, …) with one bar per snapshot, coloured by the sector's
status at that point in time. Aggregate fallback (one row, labelled `·`) when the unit
has never reported sectors. Skipped entirely when there are fewer than 2 snapshots.
Driven by `HISTORY.unitTimeline(unitId, limit)` + `UI._sparklineHTML(u)`.

### Failure-reason tags (added 2026-06-24)
Cards in `offline` or `transparent` status show a small mono-font pill under the IP
with a short tag (`no TCP`, `auth failed`, `no sector line`, …) — set by
`CHECK._reasonFor(err)` from the server's structured error message. Full transcript is
still in the OUTPUT modal; the pill is just so you don't have to open it for every dead
unit during a mission sweep.

### Drag-to-reorder cards (added 2026-06-24)
Each card is `draggable="true"`. `UI.dragStart` cancels the drag if the user grabbed
a button/input (so the action buttons still click cleanly). Drop calls
`UDATA.reorder(draggedId, targetId, before=true)` which moves the dragged unit into the
target's slot and renumbers every unit's `order` sequentially. `renderGrid()` sorts by
`order` before filtering, so the manual layout survives filter toggles. Migration on
`UDATA.load()` assigns sequential `order` to any unit missing the field.

### UbiView NMS integration — Stats modal (added 2026-06-26)
**The vendor's telnet ACL gives `idfuser` only `get status` and `set link N mode`.**
But the same fleet's data — RSSI, spectrograms, OPTiX mode, device info — is fully
exposed to the engineer through the vendor's web NMS at `172.19.15.51/NMS`
(UbiView). UbiPlus now replicates the HTTP calls UbiView's own frontend makes,
authenticating as the same `idfuser1` web user. Different door, broader permissions,
no unit-level ACL involved.

**Reverse-engineered from OSP HAR captures 2026-06-25.** See `ubiview.js` + the
`Invoke-UvLogin / Invoke-UvCall / Ensure-UvSession` helpers + the `/ubi/uv/*`
endpoints in `server.ps1`.

#### Two-stage auth (plus one critical client-side cookie)
1. **Outer gate**: `POST /NMS/` with `access_login=<u>&access_password=<p>&Submit=Submit`
   (form-urlencoded). UbiView's PHP wrapper sets `verify=<32-char hex>` + `PHPSESSID=<id>`
   cookies. Returns the SPA HTML — we only care about the cookies.
2. **UbiView app**: `POST /NMS/adminservice.php` with `method=user_login&username=<u>&password=<p>`.
   Server marks the PHPSESSID as authenticated. Returns
   `{isAuth, uid, hash, userData:{role: 'NewGraphs,Spectrograms,Remote,DeviceInfo,OptixMode,...'}}`.
3. **(client-side, load-bearing)** UbiView's frontend JS reads the `user_login` response
   and writes a *third* cookie itself via `document.cookie`: `uid=<uid>|<hash>`. **Without
   this cookie every subsequent data call returns an empty body** — the server treats the
   PHPSESSID as half-authenticated. Server-side reproduces this manually by adding the
   cookie to the `WebRequestSession`'s `CookieContainer` right after parsing the JSON.
   This was the gotcha that made `getTreeData` return null the first time we wired it up
   (discovered by HAR-diffing cookie sets between the unauthenticated `user_login` request
   and every authenticated request after it).

Server-side `Ensure-UvSession` runs both stages once and keeps the cookie jar in
`$script:UvState.Session` (a `WebRequestSession`). Auto re-logs after 120 min or
if a call returns HTML instead of JSON (the PHP redirect = session-expired tell).

#### Discovered methods on `/NMS/adminservice.php`
All POST form-urlencoded with a `method=...&...` body. Server proxies them through
`/ubi/uv/<short>`:

| Short path | Method | Returns |
|---|---|---|
| `/ubi/uv/login`   | `user_login` | Force-test login |
| `/ubi/uv/tree`    | `getTreeData` | 186KB fleet hierarchy (cached browser-side 6h) |
| `/ubi/uv/rrd`     | `getUbifixRRDData` | TD Graph time-series: `wb_power_a/b`, `input_power_aN/bN`, `output_power_aN/bN`, `alarm_reg` per `msec_epoch` |
| `/ubi/uv/inout`   | `getUbifixInoutData` | Spectrogram: `a_in/b_in/a_out/b_out` arrays (~120 freq bins each) per `msec_epoch` |
| `/ubi/uv/optix`   | `getUbifixOptixModeData` | OPTiX mode timeline per sector (modeNumber + linkStatus + start/end epochs) |
| `/ubi/uv/devinfo` | `getDeviceInfo` | Static device metadata (part/serial #, FW versions, frequencies) |

Browser sends credentials with every call; server only re-logs in when the session
is missing/expired.

#### Response protocol — `Send-Raw` (not `Send-Json`) for big data endpoints
**Tree / RRD / Inout responses are 100–250 KB of UbiView's own JSON.** The original
implementation wrapped them in `@{ok=$true; raw=<huge string>}` and ran the whole thing
through `ConvertTo-Json` — that was producing output the browser couldn't parse (the
silent-empty-tree symptom). Fixed by adding a `Send-Raw $res $body` helper that writes
the upstream JSON body verbatim with the right MIME type. HTTP status code carries the
ok/error signal:
- **200**: body IS the parsed UbiView JSON (no wrapper, no double-encoding).
- **4xx/5xx**: body is `{error: '...'}` via `Send-Json` (errors are small, wrapping is fine).

Browser `_post` reads `await res.text()` then `JSON.parse`s on success, or parses the
error envelope on failure. Login/test-connection still uses `Send-Json` since those
responses are tiny.

#### IP → ucu mapping (browser-side, `UVCLIENT._parseTree`)
Each UbiPlus unit needs to be matched to UbiView's identifiers before any data
call. From `getTreeData.treeNodesData`:
- `node_name`: `"Iftah 172.18.17.177"` → extract IP + siteName
- `act_name`: `"ucu2314"` → the UbiView unit ID
- `id`: `"D_un_102"` → base treeId = 102

`treeDataH` (per-parent children) is **sparse and unreliable** — only populated for
branches that were expanded in the UbiView UI when the tree was fetched. So we
**synthesize** the 4 sectors per unit from the documented treeId convention:
```
sector A: nodeName=ucuXXXX-A, treeId=base+0, customTreeId=un_<base+0>
sector B: nodeName=ucuXXXX-B, treeId=base+1, customTreeId=un_<base+1>
sector C: nodeName=ucuXXXX-C, treeId=base+2, customTreeId=un_<base+2>
sector D: nodeName=ucuXXXX-D, treeId=base+3, customTreeId=un_<base+3>
(slot base+4 = the UCU controller, not exposed in UbiPlus)
```
Verified against the real `getUbifixRRDData` calls in the HAR — exact match.
40 of our 41 sites map cleanly; the 41st (Asaf) has a 1-digit IP discrepancy
between our seed and UbiView's tree (`.18.185` vs `.17.185`) which the user can
fix by editing the IP in UbiPlus or accepting the missing-stats state.

3-sector units (where the 4th doesn't exist) just return empty data for sector D;
the UI surfaces "No RSSI data returned for sector D" gracefully.

#### Browser UI
- **TOOLS > UbiView Stats** opens the settings modal (`UVSETTINGS`):
  4 fields (NMS URL + outer-gate user/pass + inner UbiView user/pass), TEST button
  that does a live login round-trip and reports the role string, SAVE/CLEAR.
  Stored in `localStorage` key `ubiplus_uv_cfg`.
- **STATS icon in the card top** (small chart-glyph SVG button next to the ✎ edit
  pencil; intentionally NOT in the action row so CHECK/OUTPUT/SET aren't crowded into
  4 buttons). Disabled until UV creds are saved. Opens `STATSMODAL` with four tabs
  and a sector-selector pill row (S1..S4 from the unit's synthesized sectors):
  - **LIVE** — current scalar values from `getUbifixRRDData` + canvas line chart of
    the last hour for channel-0 In/Out per antenna A/B (matches UbiView's TD Graph
    layout). Sentinel values (`-99` / `-136` / `0` = "no signal") are filtered from
    the Y-range computation so they don't compress the visible range, AND channels
    that contain only sentinels render at 35% opacity (`.st-chan-empty`,
    `.st-wb-empty`) so the eye lands on the channel that actually carries signal.
    Most units only use Ch 0 in practice.
  - **SPECTROGRAM** — 2×2 canvas heatmap grid (A In, B In, A Out, B Out) from
    `getUbifixInoutData`. Rows = time, columns = freq bins; custom 5-stop turbo-ish
    gradient (deep indigo → cyan → green → yellow → magenta-red). **"No signal"
    cells are coloured by sampling the live `--surface-hi` CSS var** so they fade
    into the modal panel in both themes (the original hard-coded parchment cream
    looked harsh against dark mode).
  - **OPTiX** — table of mode timeline entries per sector.
  - **DEVICE** — `getDeviceInfo` key/value table.
- Tree is cached browser-side in `localStorage` key `ubiplus_uv_tree_cache_v2`
  (TTL 6h, key bumped from v1 after the silent-empty-tree fix to invalidate any
  bad cache from the broken protocol). Refreshed on demand via
  `UVCLIENT.getTree(true)`. `saveCfg` drops the tree cache automatically so a
  credential change always re-fetches against the new NMS. Stats data is cached
  per-(unit, sector, tab) for the lifetime of the modal session; REFRESH button
  clears the current cell and re-fetches.

#### Files
- `server.ps1` — `Invoke-UvLogin` (with the manual `uid` cookie set), `Ensure-UvSession`, `Invoke-UvCall`, `_UvFormBody`, `Send-Raw` helpers + `elseif POST $path -like 'ubi/uv/*'` handler block (top of the request loop after the existing `/ubi/status` / `/ubi/power` branches)
- `ubiplus/js/ubiview.js` — `UVCLIENT` module: cfg storage, low-level `_post` (status-based protocol), `getTree` (with localStorage cache + diagnostic console logging), `_parseTree` (IP→ucu mapping by synthesis), `getRRD/getInout/getOptix/getDeviceInfo`, `latestRrdPoint/rrdSeries`, `describeTree` (for the diagnostic in error messages)
- `ubiplus/js/statsmodal.js` — `UVSETTINGS` + `STATSMODAL` controllers + canvas line chart + canvas heatmap renderer + turbo color helper + `_cssRgb` theme-var sampler
- `ubiplus/css/main.css` — `.card-icon-btn` (the new card-top STATS icon), `.uv-settings-modal *`, `.stats-modal *`, `.st-chan-empty` / `.st-wb-empty` dim states (~280 lines total)
- `ubiplus/index.html` — TOOLS > UbiView Stats menu item, both modal `<div>`s, `<script>` tags for ubiview.js + statsmodal.js, boot-time `UVCLIENT.loadCfg()`

#### localStorage keys (added)
- `ubiplus_uv_cfg` — `{baseUrl, outerUser, outerPass, innerUser, innerPass}`
- `ubiplus_uv_tree_cache_v2` — `{ts, units: [{ip, siteName, ucuName, treeId, sectors:[...]}], rawTopKeys, rawNodeCount}`, 6h TTL
- `ubiplus_uv_tree_cache` (legacy v1) — auto-removed on boot

#### Security notes
The two passwords stored in localStorage are the user's real OSP credentials.
They never leave the user's machine — they only travel between browser and the
local server (`localhost:8093`), then from server to the OSP NMS (`172.19.15.51`).
The Electron app runs entirely on the OSP. CLEAR button in UV Settings wipes
both cfg and tree cache.

### About modal — "Built by Elad Pinhasov" (added 2026-06-24)
Mirrors the Interfex pattern. Three entry points: a fixed `#credit` pill bottom-right of
the dashboard, a TOOLS > About menu item, and Escape closes alongside the other modals.
The photo is at `ubiplus/assets/elad.jpg` (copied from `interfex_8/img/elad.jpg`); falls
back to an "EP" mono-initial tile if the JPG ever fails to load.

The `ABOUT` controller lives inline in `index.html` (small enough not to deserve its own
file). On `open()` it shows a brief skeleton for 900ms (matching Interfex's pacing), then
swaps in the real content: name in Fraunces, blueprint-accent role line, eight
UbiPlus-tailored facts ("Says `pasword` with a straight face. Multiple times a day.
Refuses to file a firmware bug about it."), and a pull-quote.

**June 2024 easter egg**: a pill button at the bottom of the modal. Each click stacks
one more mood line in order: *Totally exhausted → Running on empty → Running on fumes
→ Fatigued → Counting down the days*. After the fifth, the button morphs to
"— all of the above —" with a ↺ icon; the next click resets the stack. Each line fades
in with a tiny slide. Sole purpose: comic relief.

Also: `server.ps1` MIME map now serves `.jpg` / `.jpeg` so the photo loads under the
Electron build's local server.

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

## Electron packaging (added 2026-06-13, switched to electron-packager 2026-06-24)

The app is packaged as a standalone Windows exe so the team can run it on the OSP without
accidentally closing a browser tab while autopoll is running.

**None of the electron files are committed.** `.gitignore` excludes: `main.js`,
`package.json`, `package-lock.json`, `node_modules/`, `dist/`, `UbiPlus.zip`. Regenerate
every time before building — the recipe below is the source of truth.

### Build recipe (regen from scratch on a fresh checkout)

**1. Create `package.json`** in the project root:
```json
{
  "name": "ubiplus",
  "version": "1.0.0",
  "description": "Ubiqam Fleet Monitor",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "build": "electron-packager . UbiPlus --platform=win32 --arch=x64 --out=dist --electron-version=28.3.3 --overwrite --no-asar --icon=ubiplus/assets/icon.ico --ignore=node_modules --ignore=dist --ignore=.git --ignore=\"^/UbiPlus\\.zip$\" --ignore=\"\\.md$\""
  },
  "devDependencies": {
    "electron": "^28.0.0",
    "@electron/packager": "^18.0.0"
  }
}
```

Why these flags:
- `--no-asar` is **load-bearing**: `main.js` spawns `server.ps1` via PowerShell, which
  can't read inside an asar archive.
- `--icon=...` embeds the UbiPlus icon directly (electron-packager does this in one pass —
  no separate rcedit step needed).
- `--ignore=^/UbiPlus\.zip$` keeps the previous build's zip out of the new one (it sits in
  the project root after a successful build; without this it gets bundled and the zip
  nearly doubles in size).
- `--ignore=\.md$` drops `CLAUDE.md` / `DESIGN.md` from the shipped bundle (saves a few
  KB, but mainly: they're internal docs, not for the OSP user).

**2. Create `main.js`** in the project root (88 lines). Key bits:
- `const port = 8093` — must match `server.ps1`'s `$port`.
- Spawns `powershell.exe -ExecutionPolicy Bypass -File server.ps1 -NoLaunch` with stdio
  ignored (no shell window).
- Polls `http://localhost:8093/ubiplus/` up to 40×400ms until ready.
- **Critical `res.resume()` + `serverReady` guard** (same bug as Interfex): without
  draining the HTTP poll response, the socket stays open; when the server closes it the
  error handler fires, the poller retries, finds the server up, and **opens a second
  window**. Drain via `res.resume()` and guard with `serverReady` so only the first
  successful poll triggers `win.loadURL()`.
- On close, uses `taskkill /F /T /PID` to kill the entire PowerShell process tree —
  Node's `.kill()` on Windows only hits the direct process; plink/etc. linger and hold
  the port.

**3. Build:**
```powershell
cd c:\projects\UbiPlus
powershell -ExecutionPolicy Bypass -Command "npm install"
powershell -ExecutionPolicy Bypass -Command "npm run build"
# Output: dist\UbiPlus-win32-x64\UbiPlus.exe (~168 MB) with the icon embedded.
Compress-Archive -Path 'dist\UbiPlus-win32-x64\*' -DestinationPath 'dist\UbiPlus.zip' -CompressionLevel Optimal -Force
Copy-Item dist\UbiPlus.zip UbiPlus.zip
```

Final `UbiPlus.zip` ≈ 103 MB. Copy to the OSP, unzip anywhere, run `UbiPlus.exe`.

(Historic note: the original recipe used `electron-builder` + a separate `rcedit` icon
step. It exited with code 1 on every build because `winCodeSign` couldn't extract macOS
dylibs without Developer Mode. Switched to `electron-packager` 2026-06-24 — cleaner, no
spurious failures, icon embedded in one pass.)

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
- Login sequence + `get status` output format verified from a real PuTTY capture and from
  the live OSP run on 2026-06-24 (see Session transport section). **Scripted checks complete
  in ~4–6 seconds per unit** (live OSP measurement) — the ~30–50s "ACK lag" inferred from
  the PuTTY photo was almost certainly the user reading prompts + typing; the unit itself
  responds in milliseconds. 41-site sweep ≈ ~3–5 min, not the ~hour the earlier extrapolation
  suggested.
- `POST /ubi/power` (on/off) wired in server and UI but command syntax not yet confirmed on OSP;
  the SET button is visible but the actual `set link N mode` command may differ from what the
  firmware expects
- Check-all is sequential (server is single-threaded). Dead units still fail fast via the
  4s TCP probe in `Invoke-UbiSession` before the per-stage timeout (75s) can apply.
- `UI.exportCSV()` (TOOLS > Export CSV) downloads the fleet table — one row per site, a column
  per sector, plus Changed (YES) + Changes ("S3 BYPASS -> INLINE") columns vs the previous
  check — as UTF-8-BOM CSV for Excel mission reports. No xlsx lib (OSP has no internet, no CDN).
- Electron exe exists — see Electron packaging section above for the build recipe
