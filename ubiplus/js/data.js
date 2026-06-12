// UDATA — Ubiqam unit inventory, persisted in localStorage
const UDATA = {
  units: [],
  _KEY: 'ubiplus_units',

  load() {
    try {
      this.units = JSON.parse(localStorage.getItem(this._KEY)) || [];
    } catch (e) {
      this.units = [];
    }
  },

  save() {
    localStorage.setItem(this._KEY, JSON.stringify(this.units));
  },

  get(id) {
    return this.units.find(u => u.id === id) || null;
  },

  add({ name, ip, port, user, pass, note }) {
    const u = {
      id: 'u_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      name, ip, port, user, pass, note,
      status: 'unchecked',
      sectors: [],          // per-sector modes from last check, e.g. ['inline','bypass']
      lastCheck: null,
      lastRaw: null,
    };
    this.units.push(u);
    this.save();
    return u;
  },

  update(id, patch) {
    const u = this.get(id);
    if (!u) return null;
    Object.assign(u, patch);
    this.save();
    return u;
  },

  remove(id) {
    this.units = this.units.filter(u => u.id !== id);
    this.save();
  },

  // true when the latest check differs from the previous one (status or any sector)
  changed(u) {
    if (!u.prevCheck) return false;
    if (u.prevStatus !== u.status) return true;
    const a = u.prevSectors || [], b = u.sectors || [];
    return a.length !== b.length || a.some((s, i) => s !== b[i]);
  },

  // header stat counts by status
  counts() {
    const c = { inline: 0, mixed: 0, bypass: 0, transparent: 0, offline: 0, unchecked: 0 };
    for (const u of this.units) c[u.status] = (c[u.status] || 0) + 1;
    return c;
  },
};
