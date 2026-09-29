/* ==========================================================================
   Physique plateformer : pas fixe à 60 Hz, collisions AABB contre les blocs
   pleins, plateformes traversables par le dessous, hitbox tête + corps.
   ========================================================================== */
import { G, clamp, approach, headScale } from './state.js';
import { CELL } from './maps.js';

/* ------------------------------ Réglages ------------------------------ */
export const PHYS = {
  GRAVITY:     2300,   // px/s²
  MAX_FALL:    1400,   // vitesse de chute max (px/s)
  RUN:         380,    // vitesse de course (px/s)
  ACC_GROUND:  3600,   // accélération au sol
  FRIC_GROUND: 3000,   // freinage au sol sans commande
  ACC_AIR:     1900,   // contrôle en l'air
  FRIC_AIR:    320,    // freinage en l'air (faible : le rocket jump porte loin)
  OVERSPEED:   1100,   // freinage au-delà de la vitesse de course (après un knockback)
  JUMP_V:      920,    // impulsion du saut (~185 px de haut)
  DJUMP_V:     830,    // impulsion du double saut (~150 px de plus)
  COYOTE:      0.1,    // on peut encore sauter 0,1 s après avoir quitté le bord
  JUMP_BUF:    0.1,    // un saut pressé 0,1 s trop tôt est quand même pris
  DROP_T:      0.22,   // durée pendant laquelle on traverse les plateformes (S)
  MAX_SPEED:   1800,   // plafond absolu (évite de traverser les murs)
  DASH_SPEED:  1150,   // vitesse du dash latéral (double appui sur Q / D)
  DASH_TIME:   0.16,   // durée du dash (s) : trajet d'environ 185 px
  DASH_CD:     0.9,    // recharge du dash (s)
  DASH_TAP:    0.25,   // délai max entre les deux appuis (s)
  SLIDE_SPEED: 780,    // vitesse minimale d'entrée en glissade (clic droit au sol)
  SLIDE_BOOST: 240,    // élan ajouté à la vitesse actuelle
  SLIDE_TIME:  0.6,    // durée max de la glissade (s)
  SLIDE_FRIC:  700,    // freinage pendant la glissade (px/s²)
  SLIDE_CD:    0.45,   // délai avant une nouvelle glissade (s)
  SLIDE_H:     46,     // hauteur de la boîte pendant la glissade (les balles passent au-dessus)
  DIVE_V:      1300,   // plongeon (clic droit en l'air) : chute rapide puis glissade
  W: 26,               // largeur de la boîte de collision
  H: 84,               // hauteur (pieds -> sommet du crâne)
};

/* Hitbox de dégâts : tête (cercle) + corps (rectangle), relatives aux pieds. */
export const HITBOX = {
  HEAD_Y: -72, HEAD_R: 12,
  BODY_TOP: -61, BODY_HW: 12,
  /* en glissade : tout le corps est bas */
  SLIDE_HEAD_Y: -34, SLIDE_BODY_TOP: -24,
};

/* ----------------------------- Requêtes ------------------------------- */
export function solidAt(x, y) {
  const m = G.map;
  const gx = Math.floor((x + m.gOff) / CELL), gy = Math.floor((y + m.gOff) / CELL);
  if (gx < 0 || gy < 0 || gx >= m.gw || gy >= m.gh) return null;
  const cell = m.grid[gy * m.gw + gx];
  for (let i = 0; i < cell.length; i++) {
    const s = cell[i];
    if (!s.dead && x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) return s;
  }
  return null;
}

/* Blocs susceptibles de toucher le rectangle donné. */
const _near = [];
function solidsNear(l, t, r, b) {
  const m = G.map;
  _near.length = 0;
  const x0 = Math.max(0, Math.floor((l + m.gOff) / CELL)), x1 = Math.min(m.gw - 1, Math.floor((r + m.gOff) / CELL));
  const y0 = Math.max(0, Math.floor((t + m.gOff) / CELL)), y1 = Math.min(m.gh - 1, Math.floor((b + m.gOff) / CELL));
  for (let gy = y0; gy <= y1; gy++) {
    for (let gx = x0; gx <= x1; gx++) {
      const cell = m.grid[gy * m.gw + gx];
      for (let i = 0; i < cell.length; i++) if (!cell[i].dead && _near.indexOf(cell[i]) < 0) _near.push(cell[i]);
    }
  }
  return _near;
}

export function boxHitsSolid(l, t, r, b) {
  const list = solidsNear(l, t, r, b);
  for (const s of list) if (r > s.x && l < s.x + s.w && b > s.y && t < s.y + s.h) return true;
  return false;
}

/* Ligne de vue : un segment traverse-t-il un bloc plein ? (pas de 10 px) */
export function segmentBlocked(x0, y0, x1, y1) {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.ceil(d / 10));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (solidAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return true;
  }
  return false;
}

/* Plateforme traversable franchie en descendant entre y0 et y1. */
export function platCrossed(x, y0, y1) {
  for (const p of G.map.plats) {
    if (!p.dead && x >= p.x && x <= p.x + p.w && y0 <= p.y && y1 >= p.y) return p;
  }
  return null;
}

/* ------------------------- Déplacement du corps ----------------------- */
/* Déplace un corps (x = centre, y = pieds) de vx, vy pendant dt.
   Renvoie des infos de contact dans body.onGround / body.hitCeil. */
export function moveBody(b, dt) {
  const hw = PHYS.W / 2, H = b.h || PHYS.H;           // plus bas en glissade
  b.vx = clamp(b.vx, -PHYS.MAX_SPEED, PHYS.MAX_SPEED);
  b.vy = clamp(b.vy, -PHYS.MAX_SPEED, PHYS.MAX_SPEED);

  /* Axe X */
  const ox = b.x;
  b.x += b.vx * dt;
  let list = solidsNear(b.x - hw - 2, b.y - H, b.x + hw + 2, b.y);
  for (const s of list) {
    if (b.x + hw > s.x && b.x - hw < s.x + s.w && b.y > s.y && b.y - H < s.y + s.h) {
      if (ox + hw <= s.x + 0.5) b.x = s.x - hw;
      else if (ox - hw >= s.x + s.w - 0.5) b.x = s.x + s.w + hw;
      else b.x = (b.x < s.x + s.w / 2) ? s.x - hw : s.x + s.w + hw;
      b.vx = 0;
      b.hitWall = true;
    }
  }

  /* Axe Y */
  const oy = b.y;
  b.y += b.vy * dt;
  b.onGround = false;
  b.hitCeil = false;
  list = solidsNear(b.x - hw, b.y - H - 2, b.x + hw, b.y + 2);
  for (const s of list) {
    if (b.x + hw > s.x && b.x - hw < s.x + s.w && b.y > s.y && b.y - H < s.y + s.h) {
      if (oy <= s.y + 0.5) {                 // on arrive par le dessus
        b.y = s.y; b.onGround = true; b.ground = s;
        if (b.vy > 0) b.vy = 0;
      } else if (oy - H >= s.y + s.h - 0.5) { // on se cogne au plafond
        b.y = s.y + s.h + H; b.hitCeil = true;
        if (b.vy < 0) b.vy = 0;
      } else {                                 // coincé : on sort par le haut
        b.y = s.y; b.onGround = true; b.ground = s;
        if (b.vy > 0) b.vy = 0;
      }
    }
  }
  /* Plateformes traversables : seulement en descendant, et si on était
     au-dessus au pas précédent. S (descendre) les ignore un court instant. */
  if (b.vy >= 0 && !(b.dropT > 0) && !b.onGround) {
    for (const p of G.map.plats) {
      if (!p.dead && b.x + hw > p.x && b.x - hw < p.x + p.w && oy <= p.y + 0.5 && b.y >= p.y) {
        b.y = p.y; b.vy = 0; b.onGround = true; b.ground = p;
        break;
      }
    }
  }
}

/* Commande horizontale d'un joueur (dir = -1, 0, 1). */
export function steer(b, dir, dt) {
  const acc = b.onGround ? PHYS.ACC_GROUND : PHYS.ACC_AIR;
  const fric = b.onGround ? PHYS.FRIC_GROUND : PHYS.FRIC_AIR;
  const over = Math.abs(b.vx) > PHYS.RUN;
  if (dir !== 0 && (!over || Math.sign(b.vx) !== dir)) {
    b.vx += dir * acc * dt;
    if (!over) b.vx = clamp(b.vx, -PHYS.RUN, PHYS.RUN);
  } else if (over) {
    b.vx = approach(b.vx, Math.sign(b.vx) * PHYS.RUN, (b.onGround ? PHYS.FRIC_GROUND : PHYS.OVERSPEED * 0.3) * dt);
    if (dir === 0 && b.onGround) b.vx = approach(b.vx, 0, fric * dt);
  } else {
    b.vx = approach(b.vx, 0, fric * dt);
  }
}

/* --------------------------- Hitbox de dégâts ------------------------- */
/* Teste un point (projectile de rayon r) contre la tête puis le corps.
   Renvoie 2 = tête, 1 = corps, 0 = raté. */
export function hitTest(px, py, r, x, y, sliding) {
  /* Big Head : la tête grossit vers le haut depuis le cou. */
  const k = headScale();
  const hx = x, hy = y + (sliding ? HITBOX.SLIDE_HEAD_Y : HITBOX.HEAD_Y) - (k - 1) * 11.5;
  const hr = HITBOX.HEAD_R * k + r;
  if ((px - hx) * (px - hx) + (py - hy) * (py - hy) < hr * hr) return 2;
  if (px > x - HITBOX.BODY_HW - r && px < x + HITBOX.BODY_HW + r &&
      py > y + (sliding ? HITBOX.SLIDE_BODY_TOP : HITBOX.BODY_TOP) - r && py < y + r) return 1;
  return 0;
}

/* Distance d'un point au corps entier (pour les explosions). */
export function distToBody(px, py, x, y, sliding) {
  const cx = clamp(px, x - HITBOX.BODY_HW, x + HITBOX.BODY_HW);
  const cy = clamp(py, y - (sliding ? PHYS.SLIDE_H : PHYS.H), y);
  return Math.hypot(px - cx, py - cy);
}
