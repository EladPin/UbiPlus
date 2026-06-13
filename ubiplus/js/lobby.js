// LOBBY + CAT — the header pixel living room and its resident mascot.
// Replaces the knight (user picked the cat, 2026-06). Everything is inline
// SVG rects, no assets — the OSP is offline.
//
// The lobby fills the free header stretch between the stats and the actions:
// wall + plank floor, windows (sunny day in parchment, moon + stars in dark),
// a TV that plays static only while the cat watches it, a terracotta sofa,
// a rug, plant, lamp, bookshelf with Slite-palette spines, food bowl and a
// picture frame. Furniture is packed right-to-left and items drop off when
// the header gets narrow.
//
// The cat wanders between stations while idle (naps on the rug, watches TV,
// takes the sofa, perches on the windowsill, grooms). During checks it keeps
// the knight's old public API — visit / endWork / celebrate / park — walking
// down to the card being checked and pawing at a tiny console while the
// telnet runs. Toggle: TOOLS > Hide Cat (hides the whole room).

const LOBBY = {
  S: 3, ROWS: 24, FLOOR: 21, // 24 rows x 3px = 72px band; feet land on row 21
  el: null, svg: null,
  stations: {},              // name -> {xr: cells from right edge (sprite center), row: feet row, pose, dir}
  tvOn: false,
  _screen: null, _screenBox: null, _stars: null, _P: null, _floorRange: null,

  init() {
    if (this.el) return;
    this.el = document.createElement('div');
    this.el.id = 'ubiLobby';
    const hdr = document.querySelector('.hdr');
    hdr.insertBefore(this.el, document.querySelector('.hdr-actions'));
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.el.appendChild(this.svg);
    this._render();
    new ResizeObserver(() => this._render()).observe(this.el);
    // windows flip day/night with the theme
    new MutationObserver(() => this._render())
      .observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  },

  dark() { return document.documentElement.classList.contains('dark'); },

  pal() {
    return this.dark() ? {
      wall: '#232120', base: '#1c1a19',
      floor: '#3d342a', seam: '#332b22',
      wood: '#5c4733', woodDk: '#48382a',
      tvFrame: '#101113', screen: '#1a1c20', led: '#2bd47f',
      sky: '#1a2238', orb: '#e8e4d4', orbHi: '#fdfbf2', cloud: null, spark: '#cdd6e8',
      sofa: '#b95430', sofaDk: '#8f3d20', cushion: '#d9a07e',
      rug: '#6e4a5c', rugAlt: '#9d4d77',
      leaf: '#41604a', leafHi: '#54775c', pot: '#8f4a28', potDk: '#73381d',
      lampPole: '#101113', lampShade: '#f0c75e',
      bowl: '#446aa7', kibble: '#b85c35',
      art: '#1a2238', artHi: '#54775c',
      books: ['#7f6c1f', '#9d4d77', '#446aa7', '#547358', '#c0394b', '#b85c35'],
      partnerFur: '#8a8694', partnerDk: '#5a5666', partnerLight: '#c8c4cc', partnerCollar: '#ff3b5c',
      kittenFur: '#f67748', kittenDk: '#c2552e', kittenLight: '#fdf6ec',
      mugBody: '#6b5c47', mugFill: '#3d2010', steam: '#4a4540',
    } : {
      wall: '#f4e6d2', base: '#e7d4ba',
      floor: '#dcb98c', seam: '#cba36f',
      wood: '#8a6b4a', woodDk: '#6f5439',
      tvFrame: '#2d2f34', screen: '#23252b', led: '#2bd47f',
      sky: '#bfdcf5', orb: '#f5cf5e', orbHi: '#fbe7a0', cloud: '#fdfdfd', spark: null,
      sofa: '#f67748', sofaDk: '#d05a2e', cushion: '#fbd9c4',
      rug: '#eebacb', rugAlt: '#9d4d77',
      leaf: '#547358', leafHi: '#6e9173', pot: '#b85c35', potDk: '#94431f',
      lampPole: '#2d2f34', lampShade: '#f0c75e',
      bowl: '#446aa7', kibble: '#b85c35',
      art: '#bfdcf5', artHi: '#547358',
      books: ['#7f6c1f', '#9d4d77', '#446aa7', '#547358', '#c0394b', '#b85c35'],
      partnerFur: '#8a8694', partnerDk: '#5a5666', partnerLight: '#d4d0d8', partnerCollar: '#c0394b',
      kittenFur: '#f67748', kittenDk: '#c2552e', kittenLight: '#fdf6ec',
      mugBody: '#f5eedc', mugFill: '#6b3e26', steam: '#ddd9d4',
    };
  },

  _window(out, r, P, x) { // 14 wide, rows 3-13, sill 1 wider each side
    out.push(r(x, 3, 14, 11, P.wood));
    out.push(r(x + 1, 4, 12, 9, P.sky));
    if (P.cloud) { // day
      out.push(r(x + 3, 5, 2, 2, P.orb), r(x + 4, 5, 1, 1, P.orbHi));
      out.push(r(x + 7, 7, 4, 1, P.cloud), r(x + 8, 6, 2, 1, P.cloud));
      out.push(r(x + 3, 10, 3, 1, P.cloud));
    } else {       // night
      out.push(r(x + 9, 5, 2, 2, P.orb), r(x + 10, 5, 1, 1, P.orbHi));
      out.push(`<g class="lob-stars">${r(x + 3, 6, 1, 1, P.spark)}${r(x + 6, 11, 1, 1, P.spark)}${r(x + 11, 9, 1, 1, P.spark)}</g>`);
    }
    out.push(r(x + 7, 4, 1, 9, P.wood), r(x + 1, 8, 12, 1, P.wood)); // mullions
    out.push(r(x - 1, 13, 16, 1, P.woodDk));                         // sill
  },

  _render() {
    const wpx = this.el.clientWidth;
    const cells = Math.floor(wpx / this.S);
    this.stations = {};
    this._screen = this._screenBox = this._stars = null;
    this._P = this.pal();
    const P = this._P, R = this.ROWS;
    if (cells < 46) { // not enough room for even TV + rug — hide the scene
      this.svg.setAttribute('width', 0);
      this.svg.innerHTML = '';
      if (typeof CAT !== 'undefined' && CAT.el) CAT._resettle();
      return;
    }
    const r = (x, y, w, h, f) => f ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}"/>` : '';
    const out = [];

    // room shell
    out.push(r(0, 0, cells, 20, P.wall));
    out.push(r(0, 20, cells, 1, P.base));
    out.push(r(0, 21, cells, 3, P.floor));
    for (let x = 2; x < cells - 1; x += 7) {
      out.push(r(x, 22, 1, 1, P.seam));
      out.push(r(Math.min(x + 4, cells - 1), 23, 1, 1, P.seam));
    }

    let xr = 3; // layout cursor: cells from the right edge
    const fits = w => cells - (xr + w) >= 2;

    // TV on a cabinet (rightmost, faces the room)
    if (fits(16)) {
      const x = cells - xr - 16;
      out.push(r(x, 17, 16, 1, P.woodDk), r(x, 18, 16, 3, P.wood));
      out.push(r(x + 2, 19, 4, 1, P.woodDk), r(x + 10, 19, 4, 1, P.woodDk)); // doors
      out.push(r(x + 1, 8, 14, 9, P.tvFrame));
      this._screenBox = { x: x + 2, y: 9, w: 11, h: 7 };
      out.push(`<g class="lob-screen">${r(x + 2, 9, 11, 7, P.screen)}</g>`);
      out.push(r(x + 13, 14, 1, 1, P.led)); // standby LED
      xr += 16 + 2;
    }
    // rug (nap + TV-watching spots) with a window above it
    if (fits(20)) {
      const x = cells - xr - 20;
      out.push(r(x, 21, 20, 2, P.rug));
      out.push(r(x, 21, 2, 2, P.rugAlt), r(x + 18, 21, 2, 2, P.rugAlt), r(x + 5, 22, 10, 1, P.rugAlt));
      this.stations.tvWatch = { xr: xr + 4, row: 21, pose: 'sit', dir: 1 };
      this.stations.nap = { xr: xr + 11, row: 21, pose: 'nap', dir: 1 };
      this._window(out, r, P, x + 3);
      this.stations.sill = { xr: cells - (x + 10), row: 13, pose: 'sit', dir: -1 };
      xr += 20 + 2;
    }
    // sofa (faces the TV)
    if (fits(17)) {
      const x = cells - xr - 17;
      out.push(r(x, 12, 3, 9, P.sofa), r(x, 12, 3, 1, P.sofaDk));       // back
      out.push(r(x + 3, 15, 11, 3, P.sofa));                            // seat
      out.push(r(x + 8, 15, 1, 3, P.sofaDk));                           // cushion split
      out.push(r(x + 3, 18, 11, 3, P.sofaDk));                          // base
      out.push(r(x + 14, 14, 3, 7, P.sofa), r(x + 14, 14, 3, 1, P.sofaDk)); // arm
      out.push(r(x + 3, 13, 3, 2, P.cushion));                          // throw pillow
      this.stations.sofa = { xr: cells - (x + 9), row: 15, pose: 'sit', dir: 1 };
      xr += 17 + 2;
    }
    // coffee table with two mugs (between sofa and lamp); cat family gathers here
    let ctX = -1;
    if (fits(9)) {
      const x = cells - xr - 9;
      ctX = x;
      // table surface
      out.push(r(x, 15, 9, 1, P.woodDk));         // lip
      out.push(r(x, 16, 9, 1, P.wood));            // top
      // legs
      out.push(r(x + 1, 17, 1, 4, P.woodDk));
      out.push(r(x + 7, 17, 1, 4, P.woodDk));
      // left mug (steaming)
      out.push(r(x + 1, 11, 2, 4, P.mugBody));    // body
      out.push(r(x + 3, 12, 1, 2, P.mugBody));    // handle
      out.push(r(x + 1, 11, 2, 1, P.mugFill));    // coffee surface
      out.push(r(x + 2, 10, 1, 1, P.steam));      // steam
      out.push(r(x + 1, 9, 1, 1, P.steam));       // steam wisp
      // right mug
      out.push(r(x + 5, 12, 2, 3, P.mugBody));    // body (shorter — already drunk some)
      out.push(r(x + 7, 13, 1, 1, P.mugBody));    // handle
      out.push(r(x + 5, 12, 2, 1, P.mugFill));    // coffee surface
      out.push(r(x + 6, 11, 1, 1, P.steam));      // faint steam
      this.stations.coffeeTable = { xr: cells - (x + 5), row: 16, pose: 'sit', dir: -1 };
      xr += 9 + 2;
    }
    // floor lamp
    if (fits(6)) {
      const x = cells - xr - 6;
      out.push(r(x + 1, 8, 4, 2, P.lampShade), r(x, 10, 6, 1, P.lampShade));
      out.push(r(x + 2, 11, 2, 8, P.lampPole), r(x + 1, 19, 4, 2, P.lampPole));
      xr += 6 + 2;
    }
    // plant
    if (fits(6)) {
      const x = cells - xr - 6;
      out.push(r(x + 2, 11, 2, 2, P.leaf), r(x + 1, 12, 4, 2, P.leaf), r(x, 13, 6, 2, P.leaf), r(x + 1, 15, 4, 2, P.leaf));
      out.push(r(x + 2, 12, 1, 1, P.leafHi), r(x + 4, 14, 1, 1, P.leafHi), r(x + 1, 16, 1, 1, P.leafHi));
      out.push(r(x, 17, 6, 1, P.potDk), r(x + 1, 18, 4, 2, P.pot), r(x + 2, 20, 2, 1, P.potDk));
      xr += 6 + 2;
    }
    // second window
    if (fits(14)) {
      const x = cells - xr - 14;
      this._window(out, r, P, x);
      xr += 14 + 2;
    }
    // bookshelf — book spines in the Slite badge palette
    if (fits(12)) {
      const x = cells - xr - 12;
      out.push(r(x, 9, 12, 12, P.wood));
      let bi = 0;
      for (const [sy, sh] of [[10, 3], [14, 3], [18, 2]]) {
        out.push(r(x + 1, sy, 10, sh, P.wall));
        for (let bx = 1; bx <= 10; bx++) {
          if ((bx + sy) % 5 === 0) { bi++; continue; } // leaning gaps
          const tall = (bx + sy) % 3 !== 0 ? sh : sh - 1;
          out.push(r(x + bx, sy + (sh - tall), 1, tall, P.books[bi++ % P.books.length]));
        }
      }
      xr += 12 + 2;
    }
    // food bowl + picture frame on the wall above it
    if (fits(6)) {
      const x = cells - xr - 6;
      out.push(r(x, 19, 6, 2, P.bowl), r(x + 2, 18, 2, 1, P.kibble));
      out.push(r(x, 5, 6, 5, P.wood), r(x + 1, 6, 4, 3, P.art), r(x + 1, 8, 4, 1, P.artHi), r(x + 3, 6, 1, 1, P.orb));
      xr += 6 + 2;
    }

    this._floorRange = [6, Math.max(12, xr - 8)]; // span for random floor sits

    this.svg.setAttribute('viewBox', `0 0 ${cells} ${R}`);
    this.svg.setAttribute('width', cells * this.S);
    this.svg.setAttribute('height', R * this.S);
    this.svg.innerHTML = out.join('');
    this._screen = this.svg.querySelector('.lob-screen');
    this._stars = this.svg.querySelector('.lob-stars');
    if (typeof CAT !== 'undefined' && CAT.el) CAT._resettle();
  },

  setTv(on) {
    if (this.tvOn === on) return;
    this.tvOn = on;
    if (!on && this._screen && this._screenBox && this._P) {
      const b = this._screenBox;
      this._screen.innerHTML = `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${this._P.screen}"/>`;
    }
  },

  tick(t) {
    if (this.tvOn && this._screen && this._screenBox) { // static while the cat watches
      const b = this._screenBox;
      const cols = ['#4a90d9', '#7fb3e8', '#2e77e5', '#9fc3ef'];
      let s = `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="#2c3e54"/>`;
      for (let i = 0; i < 3; i++) {
        s += `<rect x="${b.x + (Math.random() * (b.w - 1) | 0)}" y="${b.y + (Math.random() * b.h | 0)}" width="2" height="1" fill="${cols[Math.random() * cols.length | 0]}"/>`;
      }
      this._screen.innerHTML = s;
    }
    if (this._stars && t % 6 === 0) { // slow twinkle
      const kids = this._stars.children;
      for (let i = 0; i < kids.length; i++) kids[i].setAttribute('opacity', (t / 6 + i) % 3 ? '1' : '.3');
    }
  },
};

const CAT = {
  SCALE: 3, H: 12, // sprite rows; height 36px, width varies per frame
  enabled: (localStorage.getItem('ubiplus_cat') || localStorage.getItem('ubiplus_knight') || '1') !== '0',
  el: null, body: null,
  state: 'idle', dir: 1, x: 30, y: 80, docked: false, station: null,
  _q: Promise.resolve(), _t: 0, _cur: '', _curDir: 0, _wt: null, _floorXr: null,

  C: {
    o: '#f67748', // tabby orange (terracotta — Slite spot color)
    d: '#c2552e', // stripes / shading / nose
    c: '#fdf6ec', // cream chest, paw tips, tail tip
    p: '#eebacb', // inner ear pink
    k: '#2d2f34', // eyes (graphite)
    w: '#2e77e5', // collar (blueprint)
    b: '#23211f', // console body
    s: '#2bd47f', // console screen, bright blink
    g: '#1d7a4d', // console screen, dim
    z: '#9da3af', // sleep z's (ash)
  },

  // frames: {w: gridWidth, r: [[x, y, w, h, colorKey], ...]} drawn in order
  F: (() => {
    // --- standing, facing right (w14), feet on rows 10-11 ---
    const head = [
      [9, 2, 1, 2, 'o'], [12, 2, 1, 2, 'o'],            // ears
      [9, 3, 1, 1, 'p'], [12, 3, 1, 1, 'p'],            // inner ear
      [9, 4, 5, 3, 'o'],                                // skull
      [10, 5, 1, 1, 'k'], [12, 5, 1, 1, 'k'],           // eyes
      [13, 6, 1, 1, 'd'],                               // nose
    ];
    const headBlink = [
      ...head.filter(q => q[4] !== 'k'),
      [10, 5, 1, 1, 'd'], [12, 5, 1, 1, 'd'],
    ];
    const torso = [
      [2, 7, 12, 3, 'o'],
      [9, 7, 4, 1, 'w'],                                // collar
      [4, 7, 1, 1, 'd'], [6, 8, 1, 1, 'd'], [8, 7, 1, 1, 'd'], [3, 9, 1, 1, 'd'], // stripes
    ];
    const tailUp = [[1, 6, 1, 1, 'o'], [0, 4, 1, 2, 'o'], [0, 3, 1, 1, 'c']];
    const tailMid = [[1, 7, 1, 1, 'o'], [0, 5, 1, 2, 'o'], [0, 4, 1, 1, 'c']];
    const legsA = [[2, 10, 1, 2, 'o'], [5, 10, 1, 2, 'o'], [9, 10, 1, 2, 'o'], [12, 10, 1, 2, 'o'], [12, 11, 1, 1, 'c']];
    const legsB = [[3, 10, 1, 2, 'o'], [6, 10, 1, 2, 'o'], [8, 10, 1, 2, 'o'], [11, 10, 1, 2, 'o']];

    // --- sitting, facing right (w10), rump and paws on row 11 ---
    const sitHead = [
      [5, 0, 1, 2, 'o'], [8, 0, 1, 2, 'o'],
      [5, 1, 1, 1, 'p'], [8, 1, 1, 1, 'p'],
      [5, 2, 5, 3, 'o'],
      [6, 3, 1, 1, 'k'], [8, 3, 1, 1, 'k'],
      [9, 4, 1, 1, 'd'],
    ];
    const sitBody = [
      [5, 5, 4, 7, 'o'],                                // chest + front legs
      [5, 5, 4, 1, 'w'],                                // collar
      [6, 6, 1, 2, 'c'],                                // chest patch
      [2, 6, 2, 1, 'o'], [1, 7, 4, 4, 'o'],             // haunch
      [1, 11, 4, 1, 'o'],                               // hind foot
      [2, 8, 1, 1, 'd'], [3, 9, 1, 1, 'd'],             // stripes
      [6, 11, 1, 1, 'd'],                               // paw split
      [5, 11, 1, 1, 'c'], [8, 11, 1, 1, 'c'],           // paw tips
    ];
    const tailSitA = [[0, 8, 1, 3, 'o'], [0, 7, 1, 1, 'c']];
    const tailSitB = [[0, 9, 1, 2, 'o'], [1, 8, 1, 1, 'o'], [1, 7, 1, 1, 'c']];

    // --- curled nap (w13), low blob resting on row 11 ---
    const napBase = [
      [2, 8, 10, 4, 'o'],                               // body blob
      [9, 6, 1, 1, 'o'], [11, 6, 1, 1, 'o'],            // ear tips
      [10, 7, 2, 1, 'o'],                               // tucked head
      [10, 8, 1, 1, 'd'],                               // closed eye
      [4, 8, 1, 1, 'd'], [6, 9, 1, 1, 'd'], [8, 10, 1, 1, 'd'], // stripes
      [1, 10, 1, 2, 'o'], [1, 9, 1, 1, 'c'],            // wrapped tail
    ];

    // --- console work: sitting cat pawing a terminal (w15) ---
    const consoleAt = on => [
      [11, 7, 4, 1, 'd'],
      [11, 8, 4, 4, 'b'],
      [12, 9, 2, 1, on ? 's' : 'g'],
    ];

    return {
      stand: { w: 14, r: [...head, ...torso, ...tailUp, ...legsA] },
      blink: { w: 14, r: [...headBlink, ...torso, ...tailUp, ...legsA] },
      walk:  { w: 14, r: [...head, ...torso, ...tailMid, ...legsB] },
      sitA:  { w: 10, r: [...sitHead, ...sitBody, ...tailSitA] },
      sitB:  { w: 10, r: [...sitHead, ...sitBody, ...tailSitB] },
      // grooming — paw raised to the cheek (also the press-overlay flourish)
      sip:   { w: 10, r: [...sitHead, ...sitBody, ...tailSitA, [9, 6, 1, 1, 'o'], [9, 5, 1, 1, 'c']] },
      napA:  { w: 13, r: [...napBase, [3, 7, 8, 1, 'o'], [12, 2, 1, 1, 'z']] },
      napB:  { w: 13, r: [...napBase, [4, 7, 7, 1, 'o'], [12, 4, 1, 1, 'z'], [11, 1, 1, 1, 'z']] },
      workA: { w: 15, r: [...sitHead, ...sitBody, ...tailSitA, ...consoleAt(false), [9, 8, 2, 1, 'o']] },
      workB: { w: 15, r: [...sitHead, ...sitBody, ...tailSitB, ...consoleAt(true), [9, 7, 2, 1, 'o']] },
    };
  })(),

  init() {
    if (this.el) return;
    LOBBY.init();
    this.el = document.createElement('div');
    this.el.id = 'ubiCat';
    this.body = document.createElement('div');
    this.body.className = 'kbody';
    this.el.appendChild(this.body);
    document.body.appendChild(this.el);
    this._applyVis();
    this._syncLabel();
    this._settleNow('nap');
    setInterval(() => this._tickFn(), 240);
  },

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem('ubiplus_cat', this.enabled ? '1' : '0');
    this._applyVis();
    this._syncLabel();
    if (this.enabled) this._settleNow(this.station || 'nap');
    else { clearTimeout(this._wt); LOBBY.setTv(false); }
    UI.toast(this.enabled ? 'Cat is back home' : 'Cat went out');
  },

  _applyVis() {
    const v = this.enabled ? '' : 'none';
    if (this.el) this.el.style.display = v;
    if (LOBBY.el) LOBBY.el.style.display = v;
  },

  _syncLabel() {
    const s = document.getElementById('catLbl');
    if (s) s.textContent = this.enabled ? 'Hide Cat' : 'Show Cat';
  },

  // ---- public choreography (all calls sequence on one promise chain) ----

  // walk to a unit's card and start working; awaited by CHECK.all so the
  // arrival is visible before the result lands
  visit(id) {
    return this._enq(async () => {
      if (!this.enabled) return;
      let card = this._cardEl(id);
      if (!card) return;
      clearTimeout(this._wt);
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
      await this._sleep(320); // let the pawing read before it packs up
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

  // come home from the field and settle somewhere comfy
  park() {
    return this._enq(async () => {
      if (!this.enabled || this.docked) return;
      const prefs = ['nap', 'sofa', 'tvWatch', 'sill'].filter(n => LOBBY.stations[n]);
      const name = prefs.length ? prefs[Math.random() * prefs.length | 0] : 'floor';
      const sp = this._spotFor(name);
      if (!sp) return;
      // walk (page coords) to the floor below the station, then go fixed
      const fy = this._floorY();
      await this._moveTo({ x: sp.cx + scrollX - this.F.stand.w * this.SCALE / 2, y: fy + scrollY });
      this.docked = true;
      this.el.classList.add('docked');
      this.el.style.transition = 'none';
      this._setNow(sp.cx - this.F.stand.w * this.SCALE / 2, fy);
      await this._assume(name, sp);
      this._schedWander();
    });
  },

  // ---- home life ----

  _floorY() {
    const r = LOBBY.el.getBoundingClientRect();
    return r.bottom - LOBBY.ROWS * LOBBY.S + (LOBBY.FLOOR - this.H) * LOBBY.S;
  },

  _spotFor(name) {
    if (!LOBBY.el) return null;
    const r = LOBBY.el.getBoundingClientRect();
    if (r.width < 140) return null;
    const top = r.bottom - LOBBY.ROWS * LOBBY.S;
    if (name === 'floor') {
      const fr = LOBBY._floorRange || [8, 30];
      if (this._floorXr == null) this._floorXr = fr[0] + Math.random() * (fr[1] - fr[0]) | 0;
      return { cx: r.right - this._floorXr * LOBBY.S, y: top + (LOBBY.FLOOR - this.H) * LOBBY.S, row: LOBBY.FLOOR, pose: 'sit', dir: Math.random() < .5 ? 1 : -1 };
    }
    const st = LOBBY.stations[name];
    if (!st) return null;
    return { cx: r.right - st.xr * LOBBY.S, y: top + (st.row - this.H) * LOBBY.S, row: st.row, pose: st.pose, dir: st.dir };
  },

  _poseW(pose) { return this.F[pose === 'nap' ? 'napA' : 'sitA'].w * this.SCALE; },

  _setNow(x, y) {
    this.x = x; this.y = y;
    this.el.style.transform = `translate(${x}px,${y}px)`;
  },

  async _assume(name, sp) { // hop up if elevated, then take the pose
    if (sp.row < LOBBY.FLOOR) await this._hop(sp.cx - this._poseW(sp.pose) / 2, sp.y);
    else { this.el.style.transition = 'none'; this._setNow(sp.cx - this._poseW(sp.pose) / 2, sp.y); }
    this.station = name;
    this.dir = sp.dir;
    this.state = sp.pose;
    LOBBY.setTv(name === 'tvWatch' || name === 'sofa');
  },

  // instant placement (boot, resize, theme change)
  _settleNow(name) {
    if (!this.el) return;
    let sp = this._spotFor(name);
    if (!sp) {
      for (const alt of ['nap', 'tvWatch', 'sofa', 'sill', 'floor']) {
        sp = this._spotFor(alt);
        if (sp) { name = alt; break; }
      }
    }
    if (!sp) { this.el.style.visibility = 'hidden'; return; } // lobby too small
    this.el.style.visibility = '';
    this.docked = true;
    this.el.classList.add('docked');
    this.el.style.transition = 'none';
    this.station = name;
    this.dir = sp.dir;
    this.state = sp.pose;
    this._setNow(sp.cx - this._poseW(sp.pose) / 2, sp.y);
    LOBBY.setTv(name === 'tvWatch' || name === 'sofa');
    this._schedWander();
  },

  _resettle() { // lobby re-rendered under the cat (resize / theme)
    if (this.docked && this.enabled) this._settleNow(this.station || 'nap');
  },

  _schedWander() {
    clearTimeout(this._wt);
    if (!this.enabled) return;
    this._wt = setTimeout(() => this._wander(), 9000 + Math.random() * 16000);
  },

  _wander() {
    if (!this.enabled || !this.docked) return; // out in the field; park() reschedules
    this._enq(async () => {
      if (!this.enabled || !this.docked) return;
      const names = Object.keys(LOBBY.stations).filter(n => n !== this.station);
      names.push('floor');
      const next = names[Math.random() * names.length | 0];
      if (next && next !== this.station) await this._goTo(next);
      this._schedWander();
    });
  },

  async _goTo(name) {
    if (name === 'floor') this._floorXr = null;
    const cur = this._spotFor(this.station);
    const tgt = this._spotFor(name);
    if (!tgt) return;
    LOBBY.setTv(false);
    const fy = this._floorY();
    if (cur && cur.row < LOBBY.FLOOR) await this._hop(this.x, fy); // hop off the perch
    await this._walkFixed(tgt.cx - this.F.stand.w * this.SCALE / 2, fy);
    await this._assume(name, tgt);
  },

  _walkFixed(x, y) { // stroll along the lobby floor (viewport coords)
    const dx = x - this.x;
    if (Math.abs(dx) < 4) { this._setNow(x, y); return Promise.resolve(); }
    this.dir = dx > 0 ? 1 : -1;
    const dur = Math.max(300, Math.min(2400, Math.abs(dx) * 6));
    this.state = 'walk';
    this.el.style.transition = `transform ${dur}ms linear`;
    this._setNow(x, y);
    return this._sleep(dur + 40).then(() => { this.state = 'idle'; });
  },

  _hop(x, y) {
    this.state = 'idle';
    this.el.style.transition = 'transform 240ms cubic-bezier(.3,1.6,.5,1)';
    this._setNow(x, y);
    return this._sleep(290);
  },

  // ---- internals ----
  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); },

  _enq(fn) {
    this._q = this._q.then(fn).catch(() => {});
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
    LOBBY.tick(this._t);
    if (!this.enabled) return;
    if (this.state === 'walk') this._show(this._t % 2 ? 'stand' : 'walk');
    else if (this.state === 'work') this._show(this._t % 2 ? 'workA' : 'workB');
    else if (this.state === 'nap') this._show((this._t >> 2) % 2 ? 'napA' : 'napB');
    else if (this.state === 'sit') {
      const ph = this._t % 22;
      this._show(ph >= 18 ? 'sip' : (ph % 4 < 2 ? 'sitA' : 'sitB'));
    }
    else this._show(this._t % 9 === 0 ? 'blink' : 'stand');
  },

  // step out of the lobby into page coordinates before walking to a card
  _undock() {
    if (!this.docked) return;
    this.el.style.visibility = ''; // may have been hidden by a too-small lobby
    const r = this.el.getBoundingClientRect();
    this.docked = false;
    this.station = null;
    this.el.classList.remove('docked');
    this.el.style.transition = 'none';
    this._setNow(r.left + scrollX, r.top + scrollY);
    this.state = 'idle';
    LOBBY.setTv(false);
  },

  _moveTo(p) { // page-coordinate walk (field trips to cards)
    const dx = p.x - this.x, dist = Math.hypot(dx, p.y - this.y);
    if (dist < 3) return Promise.resolve();
    if (Math.abs(dx) > 6) this.dir = dx > 0 ? 1 : -1;
    const dur = Math.max(280, Math.min(1100, dist * 1.35));
    this.state = 'walk';
    this.el.style.transition = `transform ${dur}ms linear`;
    this._setNow(p.x, p.y);
    return this._sleep(dur + 40).then(() => { this.state = 'idle'; });
  },

  _cardEl(id) { return document.querySelector(`.card[data-id="${id}"]`); },

  // sit at the card's bottom-left, paws on its lower edge
  _cardSpot(card) {
    const r = card.getBoundingClientRect();
    return {
      x: r.left + scrollX + 8,
      y: r.top + scrollY + r.height - this.H * this.SCALE + 4,
    };
  },
};
