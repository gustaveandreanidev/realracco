/* ==========================================================================
   Cartes — entièrement décrites par des données.

   On ne décrit que la MOITIÉ GAUCHE de chaque carte : `side()` la duplique
   en miroir, `mid()` sert aux éléments centrés. Les cartes sont donc
   parfaitement symétriques gauche / droite.

   Types d'éléments :
     solids : blocs pleins  { x, y, w, h, m: matériau, k: aspect }
              matériaux (effets d'impact) : concrete, brick, metal, wood, stone
     plats  : plateformes traversables par le dessous { x, y, w }
     spawns : points de réapparition (x = centre, y = pieds)
     kits   : kits de soin (x = centre, y = sol)
     deco   : décor sans collision, dessiné par render.js
     hills  : zones de la colline (mode Roi de la colline), visitées tour à tour

   Décor destructible : un bloc ou une plateforme avec `hp` se casse sous les
   tirs et les explosions (crate, barrel explosif, ac, glass, rock, urn,
   planches). Il se reconstruit plus tard (voir destruct.js).
   ========================================================================== */

/* Construit une carte symétrique à partir de sa moitié gauche. */
function build(def) {
  const W = def.w;
  const mirrorX = (o) => W - o.x - (o.w || 0);
  const out = {
    id: def.id, name: def.name, sub: def.sub, theme: def.theme,
    w: def.w, h: def.h, killY: def.killY, water: def.water || null,
    solids: [], plats: [], spawns: [], kits: [], deco: [], hills: [],
  };
  for (const key of ['solids', 'plats', 'spawns', 'kits', 'deco', 'hills']) {
    if (!def[key]) continue;
    /* les éléments centrés d'abord : la première colline est au milieu */
    for (const o of def[key].mid || []) out[key].push(Object.assign({}, o));
    for (const o of def[key].side || []) {
      out[key].push(Object.assign({}, o));
      const m = Object.assign({}, o, { x: mirrorX(o), mir: true });
      out[key].push(m);
    }
  }
  return out;
}

/* ------------------------ 1. Toits de ville la nuit ------------------- */
const ROOFTOPS = build({
  id: 0, name: 'Toits de ville', sub: 'Nuit pluvieuse · vides mortels', theme: 'city',
  w: 4400, h: 2000, killY: 2080,
  solids: {
    side: [
      /* Immeubles : ils descendent bien sous la carte, le vide est entre eux. */
      { x: 100,  y: 1180, w: 560, h: 1400, m: 'brick',    k: 'bld', c: '#3a2a33' },
      { x: 820,  y: 980,  w: 520, h: 1600, m: 'concrete', k: 'bld', c: '#2c3346' },
      { x: 1500, y: 1220, w: 460, h: 1300, m: 'brick',    k: 'bld', c: '#34283a' },
      /* Mobilier de toit : climatiseurs, cheminées, cage d'escalier, château d'eau */
      { x: 290,  y: 1130, w: 90,  h: 50,  m: 'metal',    k: 'ac', hp: 90 },
      { x: 530,  y: 1090, w: 44,  h: 90,  m: 'brick',    k: 'chimney' },
      { x: 850,  y: 900,  w: 110, h: 80,  m: 'concrete', k: 'hut' },
      { x: 1110, y: 940,  w: 80,  h: 40,  m: 'metal',    k: 'ac', hp: 90 },
      /* décor destructible */
      { x: 420,  y: 1130, w: 50,  h: 50,  m: 'wood',  k: 'crate',  hp: 60 },
      { x: 990,  y: 930,  w: 34,  h: 50,  m: 'metal', k: 'barrel', hp: 35 },
      { x: 1590, y: 1165, w: 55,  h: 55,  m: 'wood',  k: 'crate',  hp: 60 },
      { x: 1600, y: 1110, w: 40,  h: 55,  m: 'wood',  k: 'crate',  hp: 45 },
      { x: 1660, y: 1170, w: 34,  h: 50,  m: 'metal', k: 'barrel', hp: 35 },
      { x: 2070, y: 1030, w: 12,  h: 70,  m: 'glass', k: 'glass',  hp: 12 },
      { x: 1000, y: 590,  w: 160, h: 120, m: 'wood',     k: 'tank' },
      { x: 1860, y: 1160, w: 40,  h: 60,  m: 'brick',    k: 'chimney' },
    ],
    mid: [
      { x: 2040, y: 1100, w: 320, h: 1500, m: 'concrete', k: 'bld', c: '#27303f' },
      { x: 2160, y: 1060, w: 80,  h: 40,  m: 'metal',    k: 'ac', hp: 90 },
    ],
  },
  plats: {
    side: [
      { x: 160,  y: 930,  w: 300, k: 'walk' },   // passerelle du panneau lumineux
      { x: 960,  y: 850,  w: 240, k: 'walk' },   // coursive du château d'eau
      { x: 1360, y: 760,  w: 140, k: 'walk' },   // enseigne suspendue au-dessus du vide
      { x: 1510, y: 1050, w: 210, k: 'scaf' },   // échafaudage
      { x: 640,  y: 1420, w: 70,  k: 'fire' },   // escaliers de secours : on s'y rattrape
      { x: 1440, y: 1500, w: 60,  k: 'fire' },
      { x: 1960, y: 1560, w: 60,  k: 'fire' },
    ],
    mid: [
      { x: 2080, y: 880, w: 240, k: 'walk' },
    ],
  },
  spawns: {
    side: [
      { x: 220, y: 1180 }, { x: 1270, y: 980 }, { x: 1760, y: 1220 }, { x: 310, y: 930 },
    ],
  },
  kits: {
    side: [{ x: 1080, y: 850 }],
    mid: [{ x: 2200, y: 880 }],
  },
  hills: {
    mid: [{ x: 2040, y: 990, w: 320, h: 110 }, { x: 2070, y: 770, w: 260, h: 110 }],
    side: [{ x: 1140, y: 870, w: 200, h: 110 }],
  },
  deco: {
    side: [
      { k: 'neon', x: 175, y: 790, w: 270, h: 110, c: '#ff3df2', txt: 'RACCO' },
      { k: 'legs', x: 200, y: 930, w: 220, h: 250 },
      { k: 'towerlegs', x: 1010, y: 850, w: 140, h: 130 },
      { k: 'towerlegs', x: 1010, y: 710, w: 140, h: 140 },
      { k: 'roofcone', x: 990, y: 530, w: 180, h: 60 },
      { k: 'antenna', x: 1800, y: 1220, h: 380 },
      { k: 'antenna', x: 700 + 260, y: 980, h: 220 },
      { k: 'sign', x: 1370, y: 640, w: 120, h: 110, c: '#ffb13d', txt: 'BAR' },
      { k: 'wire', x: 1340, y: 760, w: 170 },
      { k: 'neonv', x: 1325, y: 1020, w: 26, h: 200, c: '#3dffb0', txt: 'NUIT' },
    ],
    mid: [
      { k: 'neon', x: 2090, y: 745, w: 220, h: 110, c: '#35e0ff', txt: 'HÔTEL' },
      { k: 'legs', x: 2110, y: 880, w: 180, h: 180 },
    ],
  },
});

/* --------------------------- 2. Entrepôt / usine ---------------------- */
const WAREHOUSE = build({
  id: 1, name: 'Entrepôt', sub: 'Carte fermée · combat serré', theme: 'factory',
  w: 3800, h: 2200, killY: 2400,
  solids: {
    side: [
      { x: 0,    y: 0,    w: 60,  h: 2200, m: 'concrete', k: 'wall' },
      /* Caisses et conteneur au sol */
      { x: 240,  y: 2020, w: 80,  h: 80,  m: 'wood',  k: 'crate', hp: 60 },
      { x: 320,  y: 2020, w: 80,  h: 80,  m: 'wood',  k: 'crate', hp: 60 },
      { x: 280,  y: 1940, w: 80,  h: 80,  m: 'wood',  k: 'crate', hp: 60 },
      { x: 640,  y: 1870, w: 360, h: 230, m: 'metal', k: 'container', c: '#a8432f' },
      { x: 1280, y: 2030, w: 70,  h: 70,  m: 'wood',  k: 'crate', hp: 60 },
      { x: 1420, y: 2038, w: 34,  h: 62,  m: 'metal', k: 'barrel', hp: 35 },
      { x: 1458, y: 2038, w: 34,  h: 62,  m: 'metal', k: 'barrel', hp: 35 },
      { x: 900,  y: 1360, w: 34,  h: 50,  m: 'metal', k: 'barrel', hp: 35 },
      /* Poutres et caisses sur les passerelles : de quoi se couvrir */
      { x: 1440, y: 1580, w: 60,  h: 60,  m: 'wood',  k: 'crate', hp: 60 },
      { x: 420,  y: 1100, w: 200, h: 30,  m: 'metal', k: 'girder' },
      { x: 860,  y: 890,  w: 60,  h: 60,  m: 'wood',  k: 'crate', hp: 60 },
      { x: 1040, y: 60,   w: 40,  h: 560, m: 'metal', k: 'beam' },
    ],
    mid: [
      { x: 0,    y: 2100, w: 3800, h: 100, m: 'concrete', k: 'floor' },
      { x: 0,    y: 0,    w: 3800, h: 60,  m: 'metal',    k: 'ceiling' },
      { x: 1700, y: 1870, w: 400, h: 230, m: 'metal', k: 'container', c: '#2f6aa8' },
      { x: 1860, y: 1800, w: 80,  h: 70,  m: 'wood',  k: 'crate', hp: 60 },
    ],
  },
  plats: {
    side: [
      { x: 60,   y: 1640, w: 460, k: 'catwalk' },
      { x: 1100, y: 1640, w: 420, k: 'catwalk' },
      { x: 560,  y: 1410, w: 440, k: 'catwalk' },
      { x: 60,   y: 1180, w: 360, k: 'catwalk' },
      { x: 1100, y: 1180, w: 350, k: 'catwalk' },
      { x: 500,  y: 950,  w: 420, k: 'catwalk' },
      { x: 60,   y: 720,  w: 320, k: 'catwalk' },
      { x: 1100, y: 720,  w: 420, k: 'catwalk' },
    ],
    mid: [
      { x: 1550, y: 950, w: 700, k: 'catwalk' },
      { x: 1650, y: 520, w: 500, k: 'catwalk' },
    ],
  },
  spawns: {
    side: [{ x: 160, y: 2100 }, { x: 820, y: 1870 }, { x: 180, y: 1640 }, { x: 760, y: 1410 }],
  },
  kits: {
    side: [{ x: 420, y: 1640 }],
    mid: [{ x: 1900, y: 950 }, { x: 1900, y: 520 }],
  },
  hills: {
    mid: [{ x: 1650, y: 840, w: 500, h: 110 }, { x: 1700, y: 1760, w: 400, h: 110 }],
    side: [{ x: 560, y: 1300, w: 440, h: 110 }],
  },
  deco: {
    side: [
      { k: 'lamp', x: 300,  y: 60, len: 520 },
      { k: 'lamp', x: 760,  y: 60, len: 1150 },
      { k: 'lamp', x: 1280, y: 60, len: 880 },
      { k: 'lamp', x: 1580, y: 60, len: 300 },
      { k: 'pipe', x: 60, y: 300, w: 1540 },
      { k: 'sparker', x: 1100, y: 1100 },
      { k: 'stripe', x: 60, y: 2100, w: 580 },
    ],
    mid: [
      { k: 'hook', x: 1900, y: 60, len: 330 },
    ],
  },
});

/* --------------------------- 3. Temple jungle ------------------------- */
const TEMPLE = build({
  id: 2, name: 'Temple jungle', sub: 'Carte verticale · fosse d’eau mortelle', theme: 'jungle',
  w: 3200, h: 3600, killY: 3405, water: 3380,
  solids: {
    side: [
      { x: 0,    y: 0,    w: 90,  h: 3600, m: 'stone', k: 'cliff' },
      { x: 90,   y: 3200, w: 360, h: 80,  m: 'stone', k: 'stone' },
      { x: 720,  y: 3200, w: 260, h: 60,  m: 'stone', k: 'stone' },
      { x: 1150, y: 3010, w: 200, h: 50,  m: 'stone', k: 'stone' },
      { x: 150,  y: 2780, w: 330, h: 50,  m: 'stone', k: 'stone' },
      { x: 1000, y: 2780, w: 260, h: 50,  m: 'stone', k: 'stone' },
      { x: 120,  y: 2340, w: 320, h: 60,  m: 'stone', k: 'stone' },
      { x: 200,  y: 1900, w: 360, h: 60,  m: 'stone', k: 'stone' },
      { x: 900,  y: 1900, w: 280, h: 60,  m: 'stone', k: 'stone' },
      { x: 100,  y: 1480, w: 320, h: 60,  m: 'stone', k: 'stone' },
      { x: 180,  y: 1030, w: 300, h: 50,  m: 'stone', k: 'stone' },
      { x: 250,  y: 600,  w: 270, h: 50,  m: 'stone', k: 'stone' },
      /* ruines destructibles : rochers et jarres */
      { x: 1100, y: 1844, w: 44,  h: 56,  m: 'stone', k: 'rock', hp: 150 },
      { x: 400,  y: 2724, w: 44,  h: 56,  m: 'stone', k: 'rock', hp: 150 },
      { x: 470,  y: 564,  w: 26,  h: 36,  m: 'stone', k: 'urn',  hp: 25 },
      { x: 1450, y: 1184, w: 26,  h: 36,  m: 'stone', k: 'urn',  hp: 25 },
      { x: 330,  y: 1444, w: 26,  h: 36,  m: 'stone', k: 'urn',  hp: 25 },
    ],
    mid: [
      { x: 1450, y: 3230, w: 300, h: 70,  m: 'stone', k: 'stone' },
      { x: 1440, y: 2600, w: 320, h: 60,  m: 'stone', k: 'stone' },
      /* Pyramide à degrés du temple */
      { x: 1200, y: 1460, w: 800, h: 120, m: 'stone', k: 'step' },
      { x: 1310, y: 1340, w: 580, h: 120, m: 'stone', k: 'step' },
      { x: 1420, y: 1220, w: 360, h: 120, m: 'stone', k: 'step' },
    ],
  },
  plats: {
    side: [
      { x: 460,  y: 2990, w: 240, k: 'plank' },
      { x: 560,  y: 2560, w: 260, k: 'plank' },
      { x: 1050, y: 2340, w: 230, k: 'plank', hp: 50 },   // ponts qui cèdent sous les explosions
      { x: 520,  y: 2120, w: 260, k: 'plank', hp: 50 },
      { x: 620,  y: 1680, w: 240, k: 'plank' },
      { x: 1150, y: 1700, w: 200, k: 'plank' },
      { x: 500,  y: 1250, w: 260, k: 'plank' },
      { x: 880,  y: 1060, w: 280, k: 'plank', hp: 50 },
      { x: 560,  y: 820,  w: 280, k: 'plank' },
    ],
    mid: [
      { x: 1450, y: 1000, w: 300, k: 'roof' },
      { x: 1350, y: 780,  w: 500, k: 'plank' },
    ],
  },
  spawns: {
    side: [{ x: 300, y: 2780 }, { x: 380, y: 1900 }, { x: 260, y: 1480 }, { x: 385, y: 600 }],
  },
  kits: {
    side: [{ x: 280, y: 2340 }],
    mid: [{ x: 1600, y: 2600 }, { x: 1600, y: 780 }],
  },
  hills: {
    mid: [{ x: 1420, y: 1110, w: 360, h: 110 }, { x: 1440, y: 2490, w: 320, h: 110 }],
    side: [{ x: 200, y: 1790, w: 360, h: 110 }],
  },
  deco: {
    side: [
      { k: 'waterfall', x: 90, y: 420, w: 70, h: 2960 },
      { k: 'vine', x: 300, y: 1030 + 50, len: 170 },
      { k: 'vine', x: 1080, y: 2780 + 50, len: 140 },
      { k: 'vine', x: 400, y: 1900 + 60, len: 220 },
      { k: 'vine', x: 1000, y: 1900 + 60, len: 120 },
      { k: 'vine', x: 360, y: 600 + 50, len: 260 },
      { k: 'torch', x: 1250, y: 1460 },
      { k: 'torch', x: 1460, y: 1220 },
      { k: 'statue', x: 1215, y: 1460 - 110 },
      { k: 'pillar', x: 1470, y: 1000, h: 220 },
    ],
    mid: [
      { k: 'idol', x: 1600, y: 1220 },
    ],
  },
});

export const MAPS = [ROOFTOPS, WAREHOUSE, TEMPLE];

/* ----------------------- Grille d'accélération ------------------------ */
/* Les blocs sont rangés dans une grille grossière : un test « ce point
   est-il dans un mur ? » ne parcourt que les blocs de sa case. */
export const CELL = 128;
export function prepareMap(map) {
  if (map.grid) return map;
  /* Liste ordonnée des éléments destructibles : leur indice sert d'identifiant
     réseau, identique sur toutes les machines. */
  map.dest = [];
  for (const o of map.solids.concat(map.plats)) {
    if (!o.hp) continue;
    o.hp0 = o.hp;
    o.di = map.dest.length;
    map.dest.push(o);
  }
  map.gw = Math.ceil((map.w + 1200) / CELL);
  map.gh = Math.ceil((map.h + 1200) / CELL);
  map.grid = new Array(map.gw * map.gh);
  for (let i = 0; i < map.grid.length; i++) map.grid[i] = [];
  const OFF = 600;           // marge autour de la carte (les immeubles débordent)
  map.gOff = OFF;
  for (const s of map.solids) {
    const x0 = Math.max(0, Math.floor((s.x + OFF) / CELL));
    const x1 = Math.min(map.gw - 1, Math.floor((s.x + s.w + OFF) / CELL));
    const y0 = Math.max(0, Math.floor((s.y + OFF) / CELL));
    const y1 = Math.min(map.gh - 1, Math.floor((s.y + s.h + OFF) / CELL));
    for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) map.grid[gy * map.gw + gx].push(s);
  }
  return map;
}

/* ----------------------- Aperçu miniature du salon -------------------- */
const PREVIEW_BG = {
  city:    ['#0d1030', '#241a45'],
  factory: ['#1a1a1d', '#2b2a26'],
  jungle:  ['#10302a', '#1f4a30'],
};
const PREVIEW_SOLID = { city: '#5a5f86', factory: '#8a8578', jungle: '#8b9a76' };
const PREVIEW_PLAT  = { city: '#9ec7ff', factory: '#f2c14e', jungle: '#c8955a' };

export function drawMapPreview(cv, map) {
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const s = Math.min(W / map.w, H / map.h);
  const ox = (W - map.w * s) / 2, oy = (H - map.h * s) / 2;
  const bg = PREVIEW_BG[map.theme];
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, bg[0]); g.addColorStop(1, bg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.beginPath(); ctx.rect(ox, oy, map.w * s, map.h * s); ctx.clip();
  if (map.theme === 'city') {           // lune
    ctx.fillStyle = '#fff6d8';
    ctx.beginPath(); ctx.arc(ox + map.w * s * 0.8, oy + 16, 7, 0, Math.PI * 2); ctx.fill();
  }
  if (map.water) {
    ctx.fillStyle = '#2a8fb0';
    ctx.fillRect(ox, oy + map.water * s, map.w * s, (map.h - map.water) * s + 4);
  }
  ctx.fillStyle = PREVIEW_SOLID[map.theme];
  for (const o of map.solids) {
    if (o.k === 'container') ctx.fillStyle = o.c;
    ctx.fillRect(ox + o.x * s, oy + o.y * s, Math.max(1.5, o.w * s), Math.max(1.5, o.h * s));
    if (o.k === 'container') ctx.fillStyle = PREVIEW_SOLID[map.theme];
  }
  ctx.fillStyle = PREVIEW_PLAT[map.theme];
  for (const p of map.plats) ctx.fillRect(ox + p.x * s, oy + p.y * s - 1, p.w * s, 2);
  for (const d of map.deco) {
    if (d.k === 'neon') { ctx.fillStyle = d.c; ctx.fillRect(ox + d.x * s, oy + d.y * s, d.w * s, 3); }
  }
  ctx.fillStyle = '#5ce68a';
  for (const k of map.kits) ctx.fillRect(ox + k.x * s - 2, oy + k.y * s - 5, 4, 4);
  ctx.restore();
}
