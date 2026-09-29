/* ==========================================================================
   Tenues des stickmen : chapeaux, vestes, pantalons, chaussures.
   Une tenue voyage sur le réseau sous forme de 4 indices [chapeau, veste,
   pantalon, chaussures] dans le message de salon : tout le monde voit la
   tenue de tout le monde. Tout est dessiné en code.
   ========================================================================== */

/* ------------------------------ Catalogue ----------------------------- */
/* c = couleur principale (null = couleur sombre du joueur), c2 = détail. */
export const HATS = [
  { id: 'none',   name: 'Aucun' },
  { id: 'cap',    name: 'Casquette',       c: '#e03a3a', c2: '#b02525' },
  { id: 'top',    name: 'Haut-de-forme',   c: '#1b1b22', c2: '#c0263a' },
  { id: 'crown',  name: 'Couronne',        c: '#ffcf3d', c2: '#e0413a' },
  { id: 'cowboy', name: 'Cowboy',          c: '#8a5a2e', c2: '#5e3a1a' },
  { id: 'beanie', name: 'Bonnet',          c: '#3a7bd5', c2: '#f2f2f2' },
  { id: 'viking', name: 'Viking',          c: '#8d949e', c2: '#efe4c8' },
  { id: 'party',  name: 'Chapeau de fête', c: '#ff4fa8', c2: '#ffe14d' },
  { id: 'pan',    name: 'Casserole',       c: '#6f7680', c2: '#2b2b2b' },
];
export const JACKETS = [
  { id: 'none',    name: 'Aucune' },
  { id: 'leather', name: 'Blouson en cuir',   c: '#26262c', c2: '#55555f', sleeves: true },
  { id: 'hoodie',  name: 'Sweat à capuche',   c: null,      c2: null,      sleeves: true },
  { id: 'suit',    name: 'Costume',           c: '#1d2233', c2: '#f2f2f2', sleeves: true },
  { id: 'vest',    name: 'Gilet tactique',    c: '#4b5a3a', c2: '#39452c', sleeves: false },
  { id: 'hawaii',  name: 'Chemise hawaïenne', c: '#ff8a3d', c2: '#ffe14d', sleeves: false },
  { id: 'lab',     name: 'Blouse de labo',    c: '#e8eef2', c2: '#b9c4cc', sleeves: true },
];
export const PANTS = [
  { id: 'none',    name: 'Aucun' },
  { id: 'jeans',   name: 'Jean',           c: '#3b5b92' },
  { id: 'camo',    name: 'Treillis',       c: '#56613f' },
  { id: 'suit',    name: 'Pantalon habillé', c: '#1d2233' },
  { id: 'shorts',  name: 'Short',          c: '#c9b48a', short: true },
  { id: 'jogging', name: 'Jogging',        c: '#8a8f99' },
  { id: 'disco',   name: 'Pantalon disco', c: '#ff4fa8' },
];
export const SHOES = [
  { id: 'none',    name: 'Aucune' },
  { id: 'sneaker', name: 'Baskets',     c: '#f2f2f2', c2: '#e03a3a' },
  { id: 'boots',   name: 'Bottes',      c: '#5a3a22', c2: '#3c2616' },
  { id: 'rangers', name: 'Rangers',     c: '#1a1a1e', c2: '#3a3a40' },
  { id: 'flipper', name: 'Palmes',      c: '#ffcc00', c2: '#e0a800' },
  { id: 'clown',   name: 'Clown',       c: '#e0302a', c2: '#ffffff' },
];
export const SLOTS = [
  { key: 'hat',    label: 'Chapeau',     list: HATS },
  { key: 'jacket', label: 'Veste',       list: JACKETS },
  { key: 'pants',  label: 'Pantalon',    list: PANTS },
  { key: 'shoes',  label: 'Chaussures',  list: SHOES },
];

export const DEFAULT_OUTFIT = [1, 0, 1, 1];

/* Valide une tenue reçue du réseau ou du stockage local. */
export function cleanOutfit(o) {
  if (!Array.isArray(o) || o.length !== 4) return DEFAULT_OUTFIT.slice();
  return o.map((v, i) => {
    const n = v | 0;
    return n >= 0 && n < SLOTS[i].list.length ? n : 0;
  });
}
/* Objet lisible { hat, jacket, pants, shoes } à partir des indices. */
export function outfitParts(o) {
  const c = cleanOutfit(o);
  return { hat: HATS[c[0]], jacket: JACKETS[c[1]], pants: PANTS[c[2]], shoes: SHOES[c[3]] };
}

/* ------------------------------- Dessin ------------------------------- */
/* Chapeau posé sur une tête de centre (hx, hy) et de rayon r.
   f = orientation (1 droite, -1 gauche), rot = inclinaison (ragdoll). */
export function drawHat(ctx, hat, hx, hy, r, f, rot) {
  if (!hat || hat.id === 'none') return;
  const s = r / 10.5;
  ctx.save();
  ctx.translate(hx, hy);
  if (rot) ctx.rotate(rot);
  ctx.scale(f < 0 ? -s : s, s);
  ctx.lineJoin = 'round';
  const top = -10.5;
  switch (hat.id) {
    case 'cap':
      ctx.fillStyle = hat.c;
      ctx.beginPath(); ctx.arc(0, -2, 11, Math.PI, 0); ctx.fill();
      ctx.fillStyle = hat.c2;
      ctx.fillRect(2, -3.5, 15, 3.5);                       // visière
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, -13, 1.6, 0, Math.PI * 2); ctx.fill();
      break;
    case 'top':
      ctx.fillStyle = hat.c;
      ctx.fillRect(-15, top + 3, 30, 3.5);                  // bord
      ctx.fillRect(-9, top - 17, 18, 21);
      ctx.fillStyle = hat.c2;
      ctx.fillRect(-9, top - 1, 18, 3.5);                   // ruban
      ctx.fillStyle = 'rgba(255,255,255,.15)';
      ctx.fillRect(-7, top - 16, 3, 14);
      break;
    case 'crown':
      ctx.fillStyle = hat.c;
      ctx.beginPath();
      ctx.moveTo(-10, top + 4); ctx.lineTo(-11, top - 8); ctx.lineTo(-5, top - 2); ctx.lineTo(0, top - 11);
      ctx.lineTo(5, top - 2); ctx.lineTo(11, top - 8); ctx.lineTo(10, top + 4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = hat.c2;
      ctx.beginPath(); ctx.arc(0, top - 1, 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4da3ff';
      ctx.beginPath(); ctx.arc(-6, top + 1, 1.5, 0, Math.PI * 2); ctx.arc(6, top + 1, 1.5, 0, Math.PI * 2); ctx.fill();
      break;
    case 'cowboy':
      ctx.fillStyle = hat.c;
      ctx.beginPath(); ctx.ellipse(0, top + 4, 21, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-10, top + 4); ctx.lineTo(-8, top - 9); ctx.quadraticCurveTo(0, top - 5, 8, top - 9); ctx.lineTo(10, top + 4);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = hat.c2;
      ctx.fillRect(-10, top, 20, 3);
      break;
    case 'beanie':
      ctx.fillStyle = hat.c;
      ctx.beginPath(); ctx.arc(0, -1, 11.5, Math.PI, 0); ctx.fill();
      ctx.fillStyle = hat.c2;
      ctx.fillRect(-12, -4, 24, 4.5);
      ctx.beginPath(); ctx.arc(0, -14, 3.5, 0, Math.PI * 2); ctx.fill();
      break;
    case 'viking':
      ctx.fillStyle = hat.c2;
      ctx.beginPath();                                       // cornes
      ctx.moveTo(-9, -5); ctx.quadraticCurveTo(-20, -8, -18, -22); ctx.quadraticCurveTo(-14, -12, -6, -9); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(9, -5); ctx.quadraticCurveTo(20, -8, 18, -22); ctx.quadraticCurveTo(14, -12, 6, -9); ctx.fill();
      ctx.fillStyle = hat.c;
      ctx.beginPath(); ctx.arc(0, -1, 11.5, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#6a7079';
      ctx.fillRect(-12, -3, 24, 3);
      ctx.fillRect(-1.5, -12, 3, 10);
      break;
    case 'party':
      ctx.fillStyle = hat.c;
      ctx.beginPath(); ctx.moveTo(-8, top + 3); ctx.lineTo(2, top - 20); ctx.lineTo(9, top + 3); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = hat.c2; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(-5, top - 3); ctx.lineTo(7, top - 1); ctx.moveTo(-1, top - 11); ctx.lineTo(5, top - 10); ctx.stroke();
      ctx.fillStyle = hat.c2;
      ctx.beginPath(); ctx.arc(2, top - 21, 3, 0, Math.PI * 2); ctx.fill();
      break;
    case 'pan':
      ctx.fillStyle = hat.c;
      ctx.beginPath(); ctx.arc(0, -2, 12, Math.PI, 0); ctx.fill();
      ctx.fillRect(-13, -3, 26, 3);
      ctx.fillStyle = hat.c2;
      ctx.fillRect(-30, -6, 18, 4);                          // manche, vers l'arrière
      ctx.fillStyle = 'rgba(255,255,255,.25)';
      ctx.fillRect(-6, -12, 8, 2);
      break;
  }
  ctx.restore();
}

/* Chaussure au pied (fx, fy), pointe dans la direction f. */
export function drawShoe(ctx, shoe, fx, fy, f, dark) {
  if (!shoe || shoe.id === 'none') return;
  ctx.save();
  ctx.translate(fx, fy);
  ctx.scale(f < 0 ? -1 : 1, 1);
  if (dark) ctx.globalAlpha *= 0.75;
  switch (shoe.id) {
    case 'sneaker':
      ctx.fillStyle = shoe.c;  ctx.fillRect(-5, -5, 13, 5);
      ctx.fillStyle = shoe.c2; ctx.fillRect(-2, -4, 6, 1.6);
      ctx.fillStyle = '#9aa0a8'; ctx.fillRect(-5, -1.2, 13, 1.6);
      break;
    case 'boots':
      ctx.fillStyle = shoe.c;  ctx.fillRect(-5, -13, 8, 13); ctx.fillRect(-5, -5, 13, 5);
      ctx.fillStyle = shoe.c2; ctx.fillRect(-5, -1.5, 13, 1.5); ctx.fillRect(-5, -13, 8, 2);
      break;
    case 'rangers':
      ctx.fillStyle = shoe.c;  ctx.fillRect(-5, -9, 8, 9); ctx.fillRect(-5, -5, 13, 5);
      ctx.fillStyle = shoe.c2;
      for (let y = -8; y < -2; y += 2.5) ctx.fillRect(-2, y, 4, 1);
      break;
    case 'flipper':
      ctx.fillStyle = shoe.c;
      ctx.beginPath(); ctx.moveTo(-4, -4); ctx.lineTo(22, -3); ctx.lineTo(24, 1); ctx.lineTo(-4, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = shoe.c2; ctx.fillRect(-4, -5, 8, 4);
      break;
    case 'clown':
      ctx.fillStyle = shoe.c;
      ctx.beginPath(); ctx.ellipse(5, -3.5, 11, 4.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = shoe.c2;
      ctx.beginPath(); ctx.arc(-1, -6, 2, 0, Math.PI * 2); ctx.fill();
      break;
  }
  ctx.restore();
}
