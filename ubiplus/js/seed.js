// SEED — real Ubiqam fleet, captured from the OSP UbiView tree (2026-06-24).
// Replaces the old random-IP placeholder seed: 41 units across North + South.
// On first boot in a browser the v2 migration aligns the existing inventory
// with this list — removes units that aren't in the screenshots, updates IPs
// on matches (name normalised: case + _/-/space collapsed), and adds missing.
const SEED = {
  _FLAG: 'ubiplus_seeded',
  _FLAG_V2: 'ubiplus_seed_v2_real_ips',

  SITES: [
    // North
    { name: 'Mizpe-Zur',    ip: '172.18.17.137' },
    { name: 'Astra',        ip: '172.18.17.41'  },
    { name: 'Avital',       ip: '172.18.17.97'  },
    { name: 'Fares',        ip: '172.18.17.89'  },
    { name: 'Har Adir',     ip: '172.18.17.145' },
    { name: 'Har Dov',      ip: '172.18.17.81'  },
    { name: 'Hermon_IL',    ip: '172.18.17.113' },
    { name: 'Liman',        ip: '172.18.17.201' },
    { name: 'Manara',       ip: '172.18.17.57'  },
    { name: 'Mazpash',      ip: '172.18.18.233' },
    { name: 'Meiron',       ip: '172.18.17.217' },
    { name: 'Zarit',        ip: '172.18.17.129' },
    { name: 'Ziporen',      ip: '172.18.17.169' },
    // South
    { name: 'Paga',         ip: '172.18.17.105' },
    { name: 'T_Matmon',     ip: '172.18.18.49'  },
    { name: 'Amitay',       ip: '172.18.18.89'  },
    { name: 'Asaf',         ip: '172.18.18.185' },
    { name: 'Garor 4',      ip: '172.18.18.1'   },
    { name: 'Garor 5',      ip: '172.18.18.9'   },
    { name: 'Hardon',       ip: '172.18.17.209' },
    { name: 'Iftah',        ip: '172.18.17.177' },
    { name: 'KD 100',       ip: '172.18.18.65'  },
    { name: 'KD 125',       ip: '172.18.17.153' },
    { name: 'KD 134',       ip: '172.18.17.233' },
    { name: 'KD 167',       ip: '172.18.17.225' },
    { name: 'KD185',        ip: '172.18.18.105' },
    { name: 'KD27',         ip: '172.18.18.81'  },
    { name: 'Kisufim',      ip: '172.18.17.33'  },
    { name: 'Kisufim Aman', ip: '172.18.17.241' },
    { name: 'Masha Erez',   ip: '172.18.18.25'  },
    { name: 'Mefalsim',     ip: '172.18.18.33'  },
    { name: 'Mehola_1',     ip: '172.18.18.73'  },
    { name: 'Nahal Oz',     ip: '172.18.17.9'   },
    { name: 'Nativ Asara',  ip: '172.18.18.57'  },
    { name: 'Nir_Am',       ip: '172.18.17.17'  },
    { name: 'Nir_Oz',       ip: '172.18.17.65'  },
    { name: 'OutDoor_2',    ip: '172.18.17.161' },
    { name: 'Rafah_M5',     ip: '172.18.17.193' },
    { name: 'Reiim',        ip: '172.18.17.49'  },
    { name: 'Roei_2',       ip: '172.18.18.241' },
    { name: 'Sufa_208',     ip: '172.18.18.41'  },
  ],

  _norm(s) { return String(s).toLowerCase().replace(/[\s_-]+/g, ' ').trim(); },

  run() {
    if (localStorage.getItem(this._FLAG_V2) === '1') return;

    const wanted = new Map(this.SITES.map(s => [this._norm(s.name), s]));
    const kept = [];
    let removed = 0, updated = 0;

    for (const u of UDATA.units) {
      const key = this._norm(u.name);
      const match = wanted.get(key);
      if (match) {
        u.name = match.name;
        u.ip = match.ip;
        u.port = 10001;
        u.user = 'idfuser';
        u.pass = '6ehdZgg4';
        wanted.delete(key);
        kept.push(u);
        updated++;
      } else {
        removed++;
      }
    }
    UDATA.units = kept;

    let added = 0;
    for (const s of wanted.values()) {
      UDATA.add({ name: s.name, ip: s.ip, port: 10001, user: 'idfuser', pass: '6ehdZgg4', note: '' });
      added++;
    }
    UDATA.save();

    localStorage.setItem(this._FLAG_V2, '1');
    localStorage.setItem(this._FLAG, '1'); // suppress any legacy v1 seed

    const parts = [];
    if (added)    parts.push(`+${added} added`);
    if (updated)  parts.push(`${updated} IPs aligned`);
    if (removed)  parts.push(`−${removed} removed`);
    parts.push(`${UDATA.units.length} total`);
    setTimeout(() => UI.toast('Fleet synced to OSP: ' + parts.join(' · ')), 400);
  },
};
