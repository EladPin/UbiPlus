// SEED — one-time site inventory from the commander's Excel (DATA_MEGIC.xlsx,
// column A NodeId, deduped; excluded per engineer: MMSL_*, Halif*, Petel*,
// Relay_*, MiniSite*, OutDoor*, BB_Test, APC_Live, *_SL variants).
// IPs are RANDOM PLACEHOLDERS — real ones get fixed unit-by-unit on the OSP.
// Runs once per browser (flag 'ubiplus_seeded'); never duplicates an existing
// site name and never resurrects sites the engineer deleted.
const SEED = {
  _FLAG: 'ubiplus_seeded',

  SITES: [
    'Ogen', 'Har_Adir', 'Keren_Naftaly', 'T_003', 'T_011', 'T_006', 'T_004',
    'T_005', 'Liman', 'Yaara', 'Padam', 'Patzan_R', 'Gadi', 'Girit_M14',
    'Nir_Am', 'Avital', 'T_013', 'T_001', 'Ifat', 'Havat_Hashomer',
    'Mefalsim', 'KD111', 'Cliff', 'KD117', 'Beeri_31', 'KD116', 'Hermon_IL',
    'Ronit', 'Kisufim_Aman', 'KD100', 'G_006_T', 'Beit_Lid', 'Shahar',
    'KD208', 'Roei_2', 'Yaba_509', 'Armon_2', 'Tapuzina', 'Fares',
    'Misgav_Am', 'Lord', 'Ifyun', 'Karish', 'Shikmim', 'Kisufim', 'Rafah_M5',
    'G_004', 'G_003', 'G_002', 'G_001', 'Reiim', 'G_006', 'G_005', 'Arar',
    'T_010', 'Kirya_2', 'T_012', 'Biranit', 'Asaf_M4', 'K_Hadracha', 'KD147',
    'Nahal_Sion', 'Livne', 'T_014_BB', 'Tel_Aviv_CD', 'KD131', 'Vered',
    'T_007', 'T_008', 'KD134', 'Masha_Erez', 'Maof', 'G_001_T', 'Shraga',
    'Saviyon', 'Yoav', 'Netafim', 'Zariit', 'Ein_Zeitim', 'Nir_Oz', 'Zrifin',
    'Orot_Rabin', 'Mehola_1', 'Mehola_2', 'Mehola_7', 'KD185', 'KD214_Michal',
    'Cabri', 'Zeelim', 'Sde_Teiman', 'Har_Dov', 'Bilu', 'Yarkon_Aman',
    'Nafach', 'M_Idan', 'Hardon_M3', 'Meteor_3', 'Ziporen', 'Meteor_8',
    'Iftach', 'Mizpe_Zor', 'KD125', 'Astra', 'Narkis', 'Gaaton', 'NahalOz',
    'Mazpash', 'Kela_NM', 'Amitay', 'Nafach_2', 'T_951B', 'KD27', 'T_951A',
    'G_004_T', 'Kirya', 'M_Yarden', 'T_Matmon', 'Nativ_Asara', 'KD167',
    'Horasha', 'Nisa_1', 'Filon', 'Osaka', 'Manara', 'Meiron', 'Yakinton',
    'Paga2', 'Dugit', 'Nevatim',
  ],

  run() {
    if (localStorage.getItem(this._FLAG) === '1') return;

    const existing = new Set(UDATA.units.map(u => u.name.toLowerCase()));
    const usedIp = new Set(UDATA.units.map(u => u.ip));
    let added = 0;

    for (const name of this.SITES) {
      if (existing.has(name.toLowerCase())) continue;
      let ip;
      do {
        ip = `172.18.${1 + Math.floor(Math.random() * 254)}.${1 + Math.floor(Math.random() * 254)}`;
      } while (usedIp.has(ip));
      usedIp.add(ip);
      UDATA.add({ name, ip, port: 10001, user: 'idfuser', pass: '6ehdZgg4', note: '' });
      added++;
    }

    localStorage.setItem(this._FLAG, '1');
    if (added) UI.toast(`Seeded ${added} sites from Excel — IPs are random placeholders`);
  },
};
