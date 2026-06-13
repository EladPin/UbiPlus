// IPIMPORT — bulk IP update from a CSV file
// Reads a CSV with "name" and "ip" columns, matches units by site name,
// updates ip + sets port 10001 / user idfuser / pass 6ehdZgg4 on every match.
// Matching is case-insensitive and normalises underscores/hyphens/spaces.
const IPIMPORT = {

  open() {
    document.getElementById('ipImportFile').click();
  },

  onFile(input) {
    const file = input.files[0];
    if (!file) return;
    input.value = ''; // reset so the same file can be re-picked

    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'xlsx' || ext === 'xls') {
      UI.toast('Excel format not supported offline — save as "CSV UTF-8" (File > Save As) and re-import', true);
      return;
    }

    const reader = new FileReader();
    reader.onload = e => {
      try { this._process(e.target.result); }
      catch (err) { UI.toast('Parse error: ' + err.message, true); }
    };
    reader.readAsText(file, 'utf-8');
  },

  _process(text) {
    // strip BOM
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    // detect delimiter: tab > semicolon > comma
    const firstLine = text.split(/\r?\n/)[0] || '';
    const delim = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';

    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) { UI.toast('File has no data rows', true); return; }

    const parseLine = l => l.split(delim).map(c => c.replace(/^"|"$/g, '').trim());
    const headers = parseLine(lines[0]).map(h => h.toLowerCase());

    const NAME_HEADERS = ['name', 'site', 'site name', 'sitename', 'nodeid', 'node id', 'node'];
    const IP_HEADERS   = ['ip', 'ip address', 'ipaddress', 'address', 'ip_address'];

    const nameCol = headers.findIndex(h => NAME_HEADERS.includes(h));
    const ipCol   = headers.findIndex(h => IP_HEADERS.includes(h));

    if (nameCol === -1 || ipCol === -1) {
      UI.toast(
        `Need columns "name" and "ip" — found: ${headers.map(h => `"${h}"`).join(', ')}`,
        true
      );
      return;
    }

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = parseLine(lines[i]);
      const name = cells[nameCol];
      const ip   = cells[ipCol];
      if (!name || !ip) continue;
      if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) continue;
      rows.push({ name, ip });
    }

    if (!rows.length) { UI.toast('No valid name + IP rows found in file', true); return; }

    let updated = 0, already = 0;
    const notFound = [];

    for (const row of rows) {
      const unit = UDATA.units.find(u => this._match(u.name, row.name));
      if (!unit) { notFound.push(row.name); continue; }
      const same = unit.ip === row.ip && unit.port === 10001 &&
                   unit.user === 'idfuser' && unit.pass === '6ehdZgg4';
      UDATA.update(unit.id, { ip: row.ip, port: 10001, user: 'idfuser', pass: '6ehdZgg4' });
      if (same) already++; else updated++;
    }

    UI.renderAll();

    const parts = [];
    if (updated) parts.push(`${updated} updated`);
    if (already) parts.push(`${already} already correct`);
    if (notFound.length) parts.push(`${notFound.length} not found`);
    UI.toast('Import: ' + parts.join(', '), notFound.length > 0 && updated === 0);

    // show up to 5 unmatched names as a follow-up toast
    if (notFound.length && notFound.length <= 10) {
      setTimeout(() => UI.toast(`Not matched: ${notFound.join(', ')}`, true), 300);
    }
  },

  // case-insensitive, underscore / hyphen / space normalised
  _match(a, b) {
    const n = s => String(s).toLowerCase().replace(/[\s_-]+/g, ' ').trim();
    return n(a) === n(b);
  },
};
