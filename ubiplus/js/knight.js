// KNIGHT — pixel mascot that patrols the dashboard.
// Off duty he sits at a little table in the header drinking coffee (docked,
// position:fixed, so he stays put while the page scrolls). During CHECK ALL
// he hops down, walks card to card, types on his console while the telnet
// check runs, then returns to his coffee. Solo checks too.
// Drawn as inline SVG rects (no assets — OSP offline). Toggle: TOOLS > Hide Knight.
const KNIGHT = {
  SCALE: 3, H: 14, // sprite rows; height is 42px, width varies per frame
  enabled: localStorage.getItem('ubiplus_knight') !== '0',
  el: null, body: null,
  state: 'idle', dir: 1, x: 30, y: 80, docked: false,
  _q: Promise.resolve(), _pending: 0, _cur: '', _curDir: 0, _t: 0,

  C: {
    l: '#d6d9de', // armor light / mug
    m: '#9aa0ab', // armor mid / steam
    d: '#565b66', // armor dark / boots / stool
    k: '#16151b', // visor slit
    g: '#19b563', // plume + chest emblem (brand green)
    s: '#2bd47f', // console screen, bright blink
    b: '#23211f', // console body
    w: '#7a5a3a', // coffee table wood
  },

  // frames: {w: gridWidth, r: [[x, y, w, h, colorKey], ...]} drawn in order
  F: (() => {
    const head = [
      [3, 0, 1, 1, 'g'], [2, 1, 2, 1, 'g'],            // plume
      [5, 0, 3, 1, 'l'],
      [4, 1, 5, 1, 'l'],
      [4, 2, 1, 1, 'l'], [5, 2, 4, 1, 'k'],            // visor slit
      [4, 3, 2, 1, 'l'], [6, 3, 1, 1, 'k'], [7, 3, 2, 1, 'l'],
      [4, 4, 5, 1, 'm'],                               // aventail
      [2, 5, 8, 1, 'm'], [2, 5, 1, 1, 'l'], [9, 5, 1, 1, 'l'], // pauldrons
    ];
    const headBlink = [
      ...head.filter(r => !(r[0] === 5 && r[1] === 2)),
      [5, 2, 4, 1, 'l'], [6, 2, 2, 1, 'k'],
    ];
    const torsoArms = [
      [2, 6, 1, 1, 'm'], [3, 6, 6, 1, 'l'], [9, 6, 1, 1, 'm'],
      [2, 7, 1, 1, 'm'], [3, 7, 6, 1, 'l'], [5, 7, 1, 1, 'g'], [9, 7, 1, 1, 'm'],
      [2, 8, 1, 1, 'd'], [3, 8, 6, 1, 'm'], [9, 8, 1, 1, 'd'],
      [3, 9, 6, 1, 'd'],                               // belt
    ];
    // right arm reaching out to the console, hand bobs while typing
    const torsoWork = handY => [
      [2, 6, 1, 1, 'm'], [3, 6, 6, 1, 'l'], [9, 6, 1, 1, 'm'], [10, 6, 1, 1, 'm'],
      [2, 7, 1, 1, 'm'], [3, 7, 6, 1, 'l'], [5, 7, 1, 1, 'g'],
      [2, 8, 1, 1, 'd'], [3, 8, 6, 1, 'm'],
      [3, 9, 6, 1, 'd'],
      [10, handY, 1, 1, 'd'],
    ];
    const legsStand = [[3, 10, 2, 3, 'm'], [7, 10, 2, 3, 'm'], [2, 13, 3, 1, 'd'], [7, 13, 3, 1, 'd']];
    const legsPass  = [[5, 10, 2, 3, 'm'], [4, 13, 4, 1, 'd']];
    const consoleAt = on => [[9, 9, 3, 1, 'd'], [9, 10, 3, 3, 'b'], [10, 11, 1, 1, on ? 's' : 'g']];

    // coffee break: knight on a stool, no table (the nook supplies it)
    const knightSeated = [
      ...head,
      [2, 6, 1, 1, 'm'], [3, 6, 6, 1, 'l'],
      [2, 7, 1, 1, 'm'], [3, 7, 6, 1, 'l'], [5, 7, 1, 1, 'g'],
      [2, 8, 1, 1, 'd'], [3, 8, 6, 1, 'm'],
      [3, 9, 6, 1, 'd'],
      [4, 10, 4, 1, 'm'],                              // thigh out to the knee
      [7, 11, 2, 2, 'm'],                              // shin
      [7, 13, 3, 1, 'd'],                              // foot
      [2, 11, 4, 1, 'd'], [2, 12, 1, 2, 'd'], [5, 12, 1, 2, 'd'], // stool
    ];
    const armLap = [[9, 6, 1, 1, 'm'], [9, 7, 1, 1, 'm'], [9, 8, 1, 1, 'd']];
    const mugOnTable = [[14, 6, 2, 2, 'l'], [16, 7, 1, 1, 'l']];
    const table = [[11, 8, 6, 1, 'w'], [11, 9, 1, 5, 'w'], [16, 9, 1, 5, 'w']];

    return {
      stand: { w: 12, r: [...head, ...torsoArms, ...legsStand] },
      blink: { w: 12, r: [...headBlink, ...torsoArms, ...legsStand] },
      walk:  { w: 12, r: [...head, ...torsoArms, ...legsPass] },
      workA: { w: 12, r: [...head, ...torsoWork(8), ...legsStand, ...consoleAt(false)] },
      workB: { w: 12, r: [...head, ...torsoWork(7), ...legsStand, ...consoleAt(true)] },
      // steam drifts between the two rest frames
      sitA:  { w: 18, r: [...table, ...knightSeated, ...armLap,
        ...mugOnTable, [14, 4, 1, 1, 'm'], [15, 3, 1, 1, 'm']] },
      sitB:  { w: 18, r: [...table, ...knightSeated, ...armLap,
        ...mugOnTable, [15, 4, 1, 1, 'm'], [14, 3, 1, 1, 'm']] },
      // mug raised to the visor
      sip:   { w: 18, r: [...table, ...knightSeated,
        [9, 6, 1, 1, 'm'], [9, 5, 1, 1, 'm'], [9, 4, 1, 1, 'd'],
        [10, 3, 2, 2, 'l'], [10, 1, 1, 1, 'm']] },
    };
  })(),

  init() {
    if (this.el) return;
    this.el = document.createElement('div');
    this.el.id = 'ubiKnight';
    this.body = document.createElement('div');
    this.body.className = 'kbody';
    this.el.appendChild(this.body);
    document.body.appendChild(this.el);
    this.el.style.display = this.enabled ? '' : 'none';
    this._syncLabel();
    this._dock(this._dockSpot());
    setInterval(() => this._tickFn(), 240);
    window.addEventListener('resize', () => {
      if (this.docked) this._dock(this._dockSpot());
    });
  },

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem('ubiplus_knight', this.enabled ? '1' : '0');
    this.el.style.display = this.enabled ? '' : 'none';
    this._syncLabel();
    if (this.enabled) this._dock(this._dockSpot());
    UI.toast(this.enabled ? 'Knight on patrol' : 'Knight dismissed');
  },

  _syncLabel() {
    const s = document.getElementById('knightLbl');
    if (s) s.textContent = this.enabled ? 'Hide Knight' : 'Show Knight';
  },

  // ---- public choreography (all calls sequence on one promise chain) ----

  // walk to a unit's card and start working; awaited by CHECK.all so the
  // arrival is visible before the result lands
  visit(id) {
    return this._enq(async () => {
      if (!this.enabled) return;
      let card = this._cardEl(id);
      if (!card) return;
      this._undock();
      card.scrollIntoView({ block: 'center', behavior: 'smooth' });
      await this._sleep(150);
      card = this._cardEl(id) || card; // renderCard may have replaced the node
      await this._moveTo(this._cardSpot(card));
      this.dir = 1; // face into the card, console out front
      this.state = 'work';
    });
  },

  endWork() {
    return this._enq(async () => {
      if (!this.enabled || this.state !== 'work') return;
      await this._sleep(320); // let the typing read before he packs up
      this.state = 'idle';
    });
  },

  celebrate() {
    return this._enq(async () => {
      if (!this.enabled) return;
      this.el.classList.add('hop');
      await this._sleep(400);
      this.el.classList.remove('hop');
    });
  },

  // walk back to the header table and sit down with the coffee
  park() {
    return this._enq(async () => {
      if (!this.enabled || this.docked) return;
      const v = this._dockSpot();
      await this._moveTo({ x: v.x + scrollX, y: v.y + scrollY });
      this._dock(this._dockSpot()); // recompute in case the walk was scrolled under
    });
  },

  // ---- internals ----
  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); },

  _enq(fn) {
    this._pending++;
    this._q = this._q.then(fn).catch(() => {}).then(() => { this._pending--; });
    return this._q;
  },

  _rects(f) {
    return f.map(([x, y, w, h, c]) =>
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${this.C[c]}"/>`).join('');
  },

  _show(name) {
    if (this._cur === name && this._curDir === this.dir) return;
    this._cur = name; this._curDir = this.dir;
    const f = this.F[name];
    this.el.style.width = (f.w * this.SCALE) + 'px';
    this.body.innerHTML =
      `<svg viewBox="0 0 ${f.w} ${this.H}" style="transform:scaleX(${this.dir})">${this._rects(f.r)}</svg>`;
  },

  _tickFn() {
    this._t++;
    if (!this.enabled) return;
    if (this.state === 'walk') this._show(this._t % 2 ? 'stand' : 'walk');
    else if (this.state === 'work') this._show(this._t % 2 ? 'workA' : 'workB');
    else if (this.state === 'sit') {
      const ph = this._t % 16;
      this._show(ph >= 13 ? 'sip' : (ph % 2 ? 'sitA' : 'sitB'));
    }
    else this._show(this._t % 9 === 0 ? 'blink' : 'stand');
  },

  // sit at the table: fixed positioning so the sticky header keeps him in place
  _dock(v) {
    this.docked = true;
    this.el.classList.add('docked');
    this.el.style.transition = 'none';
    this.x = v.x; this.y = v.y; // viewport coords while docked
    this.el.style.transform = `translate(${v.x}px,${v.y}px)`;
    this.dir = 1;
    this.state = 'sit';
  },

  // step off the table back into page coordinates before walking anywhere
  _undock() {
    if (!this.docked) return;
    const r = this.el.getBoundingClientRect();
    this.docked = false;
    this.el.classList.remove('docked');
    this.el.style.transition = 'none';
    this.x = r.left + scrollX; this.y = r.top + scrollY;
    this.el.style.transform = `translate(${this.x}px,${this.y}px)`;
    this.state = 'idle';
  },

  _moveTo(p) {
    const dx = p.x - this.x, dist = Math.hypot(dx, p.y - this.y);
    if (dist < 3) return Promise.resolve();
    if (Math.abs(dx) > 6) this.dir = dx > 0 ? 1 : -1;
    const dur = Math.max(280, Math.min(1000, dist * 1.35));
    this.state = 'walk';
    this.el.style.transition = `transform ${dur}ms linear`;
    this.el.style.transform = `translate(${p.x}px,${p.y}px)`;
    this.x = p.x; this.y = p.y;
    return this._sleep(dur + 40).then(() => { this.state = 'idle'; });
  },

  _cardEl(id) { return document.querySelector(`.card[data-id="${id}"]`); },

  // stand at the card's bottom-left, feet on its lower edge
  _cardSpot(card) {
    const r = card.getBoundingClientRect();
    return {
      x: r.left + scrollX + 8,
      y: r.top + scrollY + r.height - this.H * this.SCALE + 4,
    };
  },

  // coffee table spot: the empty header stretch left of DEMO/TOOLS (viewport coords)
  _dockSpot() {
    const act = document.querySelector('.hdr-actions');
    const hdr = document.querySelector('.hdr');
    const w = this.F.sitA.w * this.SCALE;
    const a = act.getBoundingClientRect(), h = hdr.getBoundingClientRect();
    return {
      x: Math.max(8, a.left - w - 26),
      y: h.top + (h.height - this.H * this.SCALE) / 2 + 3,
    };
  },
};
