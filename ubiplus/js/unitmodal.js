// UNITMODAL — Add / Edit unit modal
const UNITMODAL = {
  _editId: null, // null = add mode

  open(id = null) {
    this._editId = id;
    const u = id ? UDATA.get(id) : null;

    document.getElementById('umTitle').textContent = u ? 'EDIT UNIT' : 'ADD UNIT';
    document.getElementById('umSave').textContent = u ? 'SAVE CHANGES' : 'SAVE UNIT';
    document.getElementById('umDelete').style.display = u ? '' : 'none';
    document.getElementById('umErr').textContent = '';

    document.getElementById('umName').value = u ? u.name : '';
    document.getElementById('umIp').value = u ? u.ip : '';
    document.getElementById('umPort').value = u ? u.port : 10001;
    document.getElementById('umUser').value = u ? (u.user || '') : 'idfuser';
    document.getElementById('umPass').value = u ? (u.pass || '') : '6ehdZgg4';
    document.getElementById('umNote').value = u ? (u.note || '') : '';

    document.getElementById('unitModal').classList.add('open');
    setTimeout(() => document.getElementById('umName').focus(), 60);
  },

  close() {
    document.getElementById('unitModal').classList.remove('open');
    this._editId = null;
  },

  save() {
    const name = document.getElementById('umName').value.trim();
    const ip = document.getElementById('umIp').value.trim();
    const port = parseInt(document.getElementById('umPort').value, 10) || 23;
    const user = document.getElementById('umUser').value.trim();
    const pass = document.getElementById('umPass').value;
    const note = document.getElementById('umNote').value.trim();
    const err = document.getElementById('umErr');

    if (!name) { err.textContent = 'Site name is required'; return; }
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) { err.textContent = 'Enter a valid IPv4 address'; return; }

    const dup = UDATA.units.find(u =>
      u.ip === ip && u.port === port && u.id !== this._editId);
    if (dup) { err.textContent = `${dup.name} already uses ${ip}:${port}`; return; }

    if (this._editId) {
      UDATA.update(this._editId, { name, ip, port, user, pass, note });
      UI.toast(`Updated ${name}`);
    } else {
      UDATA.add({ name, ip, port, user, pass, note });
      UI.toast(`Added ${name}`);
    }

    this.close();
    UI.renderAll();
  },

  del() {
    const u = UDATA.get(this._editId);
    if (!u) return;
    if (!confirm(`Delete unit "${u.name}" (${u.ip}:${u.port})?`)) return;
    UDATA.remove(this._editId);
    UI.toast(`Deleted ${u.name}`);
    this.close();
    UI.renderAll();
  },
};

// Escape closes whichever modal is open
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (document.getElementById('toolsMenu').classList.contains('open')) TOOLSMENU.close();
  else if (document.getElementById('unitModal').classList.contains('open')) UNITMODAL.close();
  else if (document.getElementById('rawModal').classList.contains('open')) UI.closeRaw();
  else if (document.getElementById('diffModal').classList.contains('open')) UI.closeDiff();
  else if (document.getElementById('statsModal')?.classList.contains('open')) STATSMODAL.close();
  else if (document.getElementById('uvSettingsModal')?.classList.contains('open')) UVSETTINGS.close();
  else if (document.getElementById('aboutModal')?.classList.contains('open')) ABOUT.close();
});
