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
| Mode | Meaning | UbiView color | UbiPlus color |
|---|---|---|---|
| `inline` | Unit working, actively cancelling interference | dark green | green `#19b563` |
| `bypass` | Unit not working — RF passes through untouched | dark purple | purple `#8b3df5` |
| `transparent` | **Unknown** — control artery down, unit may be on or off | — | amber `#f5a623` |
| (unreachable) | Telnet connect failed / timeout | — | red `#ff3b5c` |

`transparent` is the painful one: the control channel is dead so the real RF state cannot be
determined remotely. UbiPlus surfaces it honestly as UNKNOWN instead of hiding it.

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

**UNVERIFIED (needs OSP testing):** exact login prompt sequence of a Ubiqam unit, whether
credentials are needed per unit, exact `get status` output format. The browser-side parser
in `statuscheck.js` (`_parseStatus`) currently keyword-matches `inline|bypass|transparent`
case-insensitively — refine it once a real session transcript is available.

### server.ps1 endpoints
- `GET  /ubiplus/*` — static files
- `POST /ubi/status` — body `{ip, port, user, pass, cmd}` → runs plink telnet, returns `{ok, output}` or `{error}`. Timeout 30s. Single-threaded: blocks the server while running.
- `POST /ubi/power` — same transport, sends the on/off command (command string TBD — not yet known)

---

## File structure

```
ubiplus/
  index.html        — single-page app, all modals defined here
  css/main.css      — all styles, CSS custom properties, dark theme default
  fonts/            — self-hosted Manrope + Jersey 10 (copied from Interfex)
  js/
    data.js         — UDATA: unit inventory CRUD, persisted in localStorage
    ui.js           — dashboard grid rendering, header stats, toasts
    unitmodal.js    — Add/Edit Unit modal
    statuscheck.js  — single + check-all status flow, telnet output parser, demo mode
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
  status:    'unchecked',    // 'unchecked'|'inline'|'bypass'|'transparent'|'offline'
  lastCheck: null,           // ISO timestamp of last status check
  lastRaw:   null,           // raw telnet output of last check (shown in detail modal)
}
```

Other localStorage keys: `ubiplus_demo` ('1' = demo mode), `ubiplus_theme`.

---

## Design system

Inherits the Interfex/Obscura design language but **dark-first** (it's a status wall) with a
**green accent `#19b563`** echoing the Ubiqam logo (Interfex is orange — keeps the apps visually distinct).

- Fonts: Manrope for all UI (`--ui`), Jersey 10 for the logo only (`--display`)
- Bouncy CTA pattern on solid filled buttons:
  `transition: all .3s cubic-bezier(0.68,-0.55,0.265,1.55)`, expanding shadow + padding on hover
- Ghost buttons: transparent bg, 1px border, simple color transition
- Input lift: 2px translateY on focus with accent border
- Status colors are CSS vars: `--st-inline`, `--st-bypass`, `--st-transparent`, `--st-offline`
- Light theme exists via `html.light`, toggled from header (default dark)

---

## Known issues / pending work
- Real Ubiqam telnet session never captured — login sequence, prompts, `get status` output
  format and the exact on/off command are all assumptions awaiting OSP testing
- `POST /ubi/power` (on/off) wired in server but hidden in UI until command syntax confirmed
- Check-all is sequential (server is single-threaded); ~N×30s worst case for unreachable units
- No Electron package yet — when needed, copy the Interfex recipe (see d:\projects\interfex\CLAUDE.md,
  including the `res.resume()` / `serverReady` fix in main.js)
