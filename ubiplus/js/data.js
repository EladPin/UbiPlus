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
    // Migration: ensure every unit has an `order` field for drag-reorder.
    // Existing inventories saved before this field was added get sequential
    // orders matching their current array position, then persisted once.
    let dirty = false;
    this.units.forEach((u, i) => {
      if (typeof u.order !== 'number') { u.order = i; dirty = true; }
    });
    if (dirty) this.save();
  },

  save() {
    localStorage.setItem(this._KEY, JSON.stringify(this.units));
  },

  get(id) {
    return this.units.find(u => u.id === id) || null;
  },

  add({ name, ip, port, user, pass, note }) {
    const maxOrder = this.units.reduce((m, u) => Math.max(m, u.order ?? -1), -1);
    const u = {
      id: 'u_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      name, ip, port, user, pass, note,
      order: maxOrder + 1,
      status: 'unchecked',
      sectors: [],          // per-sector modes from last check, e.g. ['inline','bypass']
      reason: null,         // short failure tag for offline/transparent (e.g. 'no TCP')
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

  // Move `draggedId` to the slot occupied by `targetId`, then renumber every
  // unit's `order` sequentially so values stay tidy. `before=true` drops the
  // dragged card immediately before the target; false drops it after.
  reorder(draggedId, targetId, before = true) {
    if (!draggedId || !targetId || draggedId === targetId) return false;
    const sorted = [...this.units].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const dragged = sorted.find(u => u.id === draggedId);
    const target  = sorted.find(u => u.id === targetId);
    if (!dragged || !target) return false;
    const without = sorted.filter(u => u.id !== draggedId);
    let idx = without.findIndex(u => u.id === targetId);
    if (idx < 0) return false;
    if (!before) idx += 1;
    without.splice(idx, 0, dragged);
    without.forEach((u, i) => { u.order = i; });
    this.units = without;
    this.save();
    return true;
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
