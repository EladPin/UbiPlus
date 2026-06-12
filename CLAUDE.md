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
and ENM. The developer's home computer **cannot reach any Ubiqam unit** — all telnet
features must therefore have a **DEMO MODE** that fabricates plausible output for UI work
at home, and real connectivity is only testable on the OSP.

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
- `POST /ubi/status` — body `{ip, port, user, pass, cmd}` → runs plink telnet, returns `{ok, output}` or `{error}`. Timeout 30s. Single-threaded: blocks the server while running.
- `POST /ubi/power` — same transport, sends the on/off command (command string TBD — not yet known)

---

## File structure

```
ubiplus/
  index.html        — single-page app, all modals + press overlay (loading page)
  css/main.css      — all styles, CSS custom properties, parchment (Slite) default + html.dark
  fonts/            — self-hosted Manrope + Jersey 10 + Fraunces (headings, via henry.css;
                      Inter/Antonio woff2 are unused leftovers)
  js/
    data.js         — UDATA: unit inventory CRUD, persisted in localStorage
    seed.js         — one-time site list import (129 sites from DATA_MEGIC.xlsx, col A;
                      placeholder random IPs, real ones entered on the OSP. Flag: 'ubiplus_seeded')
    ui.js           — dashboard grid rendering, header stats, toasts, CSV export
    unitmodal.js    — Add/Edit Unit modal
    statuscheck.js  — single + check-all status flow, telnet output parser, demo mode
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
```

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

Other localStorage keys: `ubiplus_demo` ('1' = demo mode), `ubiplus_theme2` ('dark' = dark
wall, anything else/absent = parchment default; the old `ubiplus_theme` key is retired and
ignored), `ubiplus_seeded` ('1' = seed.js already imported the Excel site list in this browser).

Seed inventory came from `C:\Users\user\Desktop\data_for_interfex\DATA_MEGIC.xlsx`
(sheet DATAFINAL, col A NodeId, 804 rows → 308 unique sites). Excluded families per the
engineer: `MMSL_*` (Takti/1xxx/Pakar), `Halif*`, `Petel*`, `Relay_*`, `MiniSite*`,
`OutDoor*`, `BB_Test`, `APC_Live`, and `*_SL` slave variants → **129 fixed sites**.
KD* sites are real and kept. Seeded IPs are random placeholders (172.18.x.y) — the real
per-unit IPs are only known/enterable on the OSP.

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
- Interactive accent (focus, demo toggle, toast bar, selection ring): blueprint `#2e77e5`
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
  Compare / Export CSV / theme live inside it; only DEMO + CHECK ALL stay standalone.
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

## Known issues / pending work
- Login sequence + `get status` output format now verified from a real PuTTY capture (see
  Telnet section) — but the plink stdin-feed flow itself is still untested against a real unit
- `POST /ubi/power` (on/off) wired in server but hidden in UI until command syntax confirmed
- Check-all is sequential (server is single-threaded). Healthy unit ≈ a few seconds; dead units
  fail fast via a 4s TCP probe in `Invoke-UbiTelnet` (added so 80-site mission sweeps don't stall
  30s per dead site). ~80 sites ≈ 5–10 min unattended vs ~80+ min clicking through UbiView.
- `UI.exportCSV()` (TOOLS > Export CSV) downloads the fleet table — one row per site, a column
  per sector, plus Changed (YES) + Changes ("S3 BYPASS -> INLINE") columns vs the previous
  check — as UTF-8-BOM CSV for Excel mission reports. No xlsx lib (OSP has no internet, no CDN).
- No Electron package yet — when needed, copy the Interfex recipe (see d:\projects\interfex\CLAUDE.md,
  including the `res.resume()` / `serverReady` fix in main.js)
