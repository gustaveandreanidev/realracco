/* ==========================================================================
   Rendu Canvas 2D : caméra, parallaxe, décor par carte, stickmen, ragdolls,
   éclairage et ambiance. Tout est dessiné en code, rien n'est chargé.
   Seul ce qui est dans le champ de la caméra est dessiné.
   ========================================================================== */
import { G, S, VIEW_W, VIEW_H, TAU, MAX_HP, COLORS, clamp, hash2, rand, playerName, headScale, livesLeft } from './state.js';
import { outfitParts, drawHat, drawShoe } from './outfit.js';
import { PHYS, solidAt } from './physics.js';
import { WEAPONS, drawWeapon, drawProjectiles } from './weapons.js';
import * as FX from './particles.js';
import { computePose, ragdollAlpha, input } from './player.js';
import { drawHud } from './hud.js';

/* ------------------------------ Réglages ------------------------------ */
const CAM_LERP       = 7;      // réactivité de la caméra
const CAM_LOOK       = 0.28;   // décalage vers la souris (part de la distance)
const CAM_LOOK_SNIPE = 0.45;   // … plus fort au sniper
const SHAKE_PX       = 24;     // amplitude max des secousses (unités monde)
const SHAKE_DECAY    = 1.8;    // décroissance des secousses (/s)
const LIMB_W         = 5.5;    // épaisseur des membres du stickman
const HEAD_R         = 10.5;

/* ------------------------------ Canvas -------------------------------- */
export const cv = document.getElementById('cv');
let ctx = cv.getContext('2d');   // remplacé le temps de dessiner un aperçu du salon
export const cam = { x: 0, y: 0, vw: VIEW_W, vh: VIEW_H, s: 1, dpr: 1, l: 0, t: 0 };
const view = { l: 0, t: 0, r: 0, b: 0 };
let vignette = null;

export function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);   // plafonné à 2
  cam.dpr = dpr;
  cv.width = Math.max(1, Math.round(innerWidth * dpr));
  cv.height = Math.max(1, Math.round(innerHeight * dpr));
  /* Surface visible constante (~1600 x 900 unités), quel que soit l'écran. */
  cam.s = Math.sqrt((cv.width * cv.height) / (VIEW_W * VIEW_H));
  cam.vw = cv.width / cam.s;
  cam.vh = cv.height / cam.s;
  vignette = null;
}

export function screenToWorld(sx, sy) {
  return {
    x: cam.l + (sx * cam.dpr) / cam.s,
    y: cam.t + (sy * cam.dpr) / cam.s,
  };
}

/* ------------------------------ Caméra -------------------------------- */
export function snapCamera() {
  const P = S.P;
  if (!P || !G.map) return;
  cam.x = P.x; cam.y = P.y - 50;
  clampCam();
}
function clampCam() {
  const m = G.map;
  cam.x = m.w <= cam.vw ? m.w / 2 : clamp(cam.x, cam.vw / 2, m.w - cam.vw / 2);
  cam.y = m.h <= cam.vh ? m.h / 2 : clamp(cam.y, cam.vh / 2, m.h - cam.vh / 2);
}
function updateCamera(dt, px, py) {
  const P = S.P;
  let tx = px, ty = py - 50;
  if (P && !P.alive && S.ragdolls.length) {
    const rd = S.ragdolls[S.ragdolls.length - 1];
    if (rd.color === P.color) { tx = rd.pts[2].x; ty = rd.pts[2].y; }
  }
  /* Dernier debout, éliminé : la caméra suit un survivant. */
  if (P && !P.alive && G.gameType === 'lms' && livesLeft(P.i) <= 0) {
    const s = spectated();
    if (s) { tx = s.x; ty = s.y - 50; }
  }
  if (P && P.alive) {
    /* On voit plus loin là où on vise. */
    const k = P.weapons[P.active] === 'sniper' ? CAM_LOOK_SNIPE : CAM_LOOK;
    const mx = (input.sx * cam.dpr - cv.width / 2) / cam.s;
    const my = (input.sy * cam.dpr - cv.height / 2) / cam.s;
    tx += clamp(mx * k * 2, -cam.vw * 0.32, cam.vw * 0.32);
    ty += clamp(my * k * 2, -cam.vh * 0.3, cam.vh * 0.3);
  }
  const a = 1 - Math.exp(-CAM_LERP * dt);
  cam.x += (tx - cam.x) * a;
  cam.y += (ty - cam.y) * a;
  clampCam();
}

export function spectated() {
  for (const o of S.others.values()) if (o.alive && o.seen) return o;
  return null;
}

/* ============================ PARALLAXE =============================== */
/* Chaque couche est prérendue une fois dans un canvas hors écran, puis
   répétée horizontalement : quelques drawImage par image, pas plus. */
let layers = [];
function layerCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function buildBackground(map) {
  layers = [];
  if (map.theme === 'city') {
    layers.push(skylineLayer(1800, 760, 0.12, '#131a3c', 0.05, 11, 60, 190, 420, 0));
    layers.push(skylineLayer(2200, 980, 0.3, '#0c1030', 0.16, 23, 90, 260, 640, 1));
  } else if (map.theme === 'factory') {
    layers.push(factoryWall());
    layers.push(factoryRacks());
  } else {
    layers.push(mountainLayer());
    layers.push(treeLayer(2000, 1300, 0.24, '#1b3a31', 0, 7));
    layers.push(treeLayer(2400, 1800, 0.45, '#10251e', 1, 5));
  }
}

function skylineLayer(W, H, f, color, winRate, seed, minW, maxW, maxH, near) {
  const c = layerCanvas(W, H), g = c.getContext('2d');
  let x = 0, n = 0;
  while (x < W) {
    const bw = minW + hash2(n, seed) * (maxW - minW);
    const bh = 160 + hash2(n, seed + 1) * maxH;
    const top = H - bh;
    g.fillStyle = color;
    g.fillRect(x, top, bw, bh);
    if (hash2(n, seed + 2) > 0.6) g.fillRect(x + bw * 0.3, top - 30, bw * 0.4, 30);          // étage en retrait
    if (hash2(n, seed + 3) > 0.7) {                                                            // antenne
      g.fillRect(x + bw * 0.5, top - 90, 3, 90);
      g.fillStyle = '#ff3040'; g.fillRect(x + bw * 0.5 - 1, top - 92, 5, 5);
    }
    /* fenêtres */
    for (let wy = top + 14; wy < H - 10; wy += near ? 22 : 16) {
      for (let wx = x + 8; wx < x + bw - 8; wx += near ? 18 : 13) {
        const r = hash2(wx | 0, wy | 0 + seed);
        if (r < winRate) continue;
        if (r > 1 - winRate * 1.4) {
          g.fillStyle = r > 0.97 ? '#8fd8ff' : near ? '#ffd88a' : '#d9b36a';
          g.globalAlpha = near ? 0.75 : 0.45;
          g.fillRect(wx, wy, near ? 7 : 4, near ? 10 : 6);
          g.globalAlpha = 1;
        }
      }
    }
    if (near && hash2(n, seed + 4) > 0.75) {                                                   // enseigne lointaine
      const cols = ['#ff3df2', '#35e0ff', '#3dffb0', '#ffb13d'];
      g.fillStyle = cols[Math.floor(hash2(n, seed + 5) * 4)];
      g.globalAlpha = 0.6;
      g.fillRect(x + 10, top + 30, Math.min(80, bw - 20), 14);
      g.globalAlpha = 1;
    }
    x += bw + (near ? 6 : 2);
    n++;
  }
  return { cv: c, w: W, h: H, f: f, extra: 60 };
}

function factoryWall() {
  const W = 1200, H = 1700;
  const c = layerCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#2b2a26';
  g.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x += 24) {                  // tôle ondulée
    g.fillStyle = (x / 24) % 2 ? '#2f2e29' : '#262521';
    g.fillRect(x, 0, 12, H);
  }
  /* rangée de hautes fenêtres, clair de lune bleuté */
  for (let x = 60; x < W; x += 300) {
    g.fillStyle = '#16202c';
    g.fillRect(x, 260, 180, 240);
    g.fillStyle = 'rgba(120,160,210,.22)';
    g.fillRect(x + 6, 266, 168, 228);
    g.strokeStyle = '#141412'; g.lineWidth = 6;
    for (let k = 1; k < 3; k++) { g.beginPath(); g.moveTo(x + k * 60, 260); g.lineTo(x + k * 60, 500); g.stroke(); }
    g.beginPath(); g.moveTo(x, 380); g.lineTo(x + 180, 380); g.stroke();
    if (hash2(x, 3) > 0.5) { g.fillStyle = '#16202c'; g.fillRect(x + 66, 390, 50, 60); }   // carreau cassé
  }
  g.fillStyle = 'rgba(255,200,60,.08)';
  g.font = '900 220px Segoe UI, sans-serif';
  g.fillText('B7', 120, 1100);
  g.fillStyle = '#1a1917';
  g.fillRect(0, 1500, W, 200);
  return { cv: c, w: W, h: H, f: 0.3, extra: 140 };
}
function factoryRacks() {
  const W = 1500, H = 1000;
  const c = layerCanvas(W, H), g = c.getContext('2d');
  for (let x = 40; x < W; x += 500) {
    g.fillStyle = '#171614';
    g.fillRect(x, 200, 12, 800); g.fillRect(x + 320, 200, 12, 800);
    for (let y = 300; y < 1000; y += 180) {
      g.fillStyle = '#1b1a17';
      g.fillRect(x, y, 332, 10);
      for (let b = x + 20; b < x + 310; b += 60) {                    // cartons
        if (hash2(b, y) < 0.3) continue;
        const bh = 50 + hash2(b, y + 1) * 60;
        g.fillStyle = hash2(b, y + 2) > 0.5 ? '#2a2620' : '#25221c';
        g.fillRect(b, y - bh, 50, bh);
      }
    }
  }
  return { cv: c, w: W, h: H, f: 0.55, extra: 80 };
}

function mountainLayer() {
  const W = 2000, H = 1000;
  const c = layerCanvas(W, H), g = c.getContext('2d');
  const ridge = (base, amp, col, seed) => {
    g.fillStyle = col;
    g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x <= W; x += 20) {
      const y = base - amp * (0.5 + 0.5 * Math.sin((x / W) * TAU * 2 + seed)) * (0.6 + 0.4 * Math.sin((x / W) * TAU * 5 + seed * 3));
      g.lineTo(x, y);
    }
    g.lineTo(W, H); g.closePath(); g.fill();
  };
  ridge(520, 380, '#3d6457', 1);
  ridge(700, 300, '#2f5247', 2.5);
  const gr = g.createLinearGradient(0, 400, 0, H);
  gr.addColorStop(0, 'rgba(160,210,190,0)');
  gr.addColorStop(1, 'rgba(160,210,190,.25)');                       // brume
  g.fillStyle = gr; g.fillRect(0, 400, W, H - 400);
  return { cv: c, w: W, h: H, f: 0.1, extra: 50 };
}
function treeLayer(W, H, f, col, near, seed) {
  const c = layerCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = col;
  for (let i = 0, x = 0; x < W; i++) {
    const tw = near ? 40 + hash2(i, seed) * 40 : 20 + hash2(i, seed) * 20;
    const th = H * (0.45 + hash2(i, seed + 1) * 0.5);
    g.fillRect(x, H - th, tw, th);                                     // tronc
    const cr = near ? 150 + hash2(i, seed + 2) * 120 : 90 + hash2(i, seed + 2) * 80;
    for (let k = 0; k < 6; k++) {                                      // feuillage
      g.beginPath();
      g.arc(x + tw / 2 + (hash2(i, k + seed) - 0.5) * cr * 1.6, H - th + (hash2(k, i + seed) - 0.3) * cr,
        cr * (0.5 + hash2(i + k, seed) * 0.5), 0, TAU);
      g.fill();
    }
    x += tw + (near ? 260 : 120) + hash2(i, seed + 3) * 200;
  }
  if (!near) {                                                          // ruines lointaines
    g.fillRect(W * 0.55, H - 420, 260, 420);
    g.fillRect(W * 0.55 + 40, H - 500, 180, 80);
    g.fillRect(W * 0.55 + 90, H - 560, 80, 60);
  } else {                                                              // lianes pendantes
    g.strokeStyle = col; g.lineWidth = 4;
    for (let x = 80; x < W; x += 170) {
      g.beginPath(); g.moveTo(x, 0);
      g.quadraticCurveTo(x + 30, 200 + hash2(x, 1) * 200, x - 10, 300 + hash2(x, 2) * 400);
      g.stroke();
    }
  }
  return { cv: c, w: W, h: H, f: f, extra: near ? 200 : 100 };
}

function drawParallax() {
  ctx.setTransform(cam.s, 0, 0, cam.s, 0, 0);
  const maxT = G.map.h - cam.vh;
  for (const L of layers) {
    const y = cam.vh + L.extra - L.h + (maxT - cam.t) * L.f;
    if (y > cam.vh) continue;
    let x = -(((cam.l * L.f) % L.w) + L.w) % L.w;
    for (; x < cam.vw; x += L.w) ctx.drawImage(L.cv, x, y, L.w, L.h);
    if (G.map.theme === 'factory' && y > 0 && L === layers[0]) {
      ctx.fillStyle = '#23221f'; ctx.fillRect(0, 0, cam.vw, y);
    }
  }
}

/* ============================== CIEL ================================== */
let lightning = 0, lightningNext = 12;
function drawSky(time) {
  const W = cv.width, H = cv.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const th = G.map.theme;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  if (th === 'city') {
    g.addColorStop(0, '#060818'); g.addColorStop(0.6, '#1a1436'); g.addColorStop(1, '#3a2240');
  } else if (th === 'factory') {
    g.addColorStop(0, '#1d1c1a'); g.addColorStop(1, '#141311');
  } else {
    g.addColorStop(0, '#10283a'); g.addColorStop(0.55, '#3f6f63'); g.addColorStop(1, '#9cc59a');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  if (th === 'city') {
    /* étoiles (légère parallaxe) et lune */
    const s = cam.s;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 90; i++) {
      const x = ((hash2(i, 1) * 3000 - cam.l * 0.02) % 3000 + 3000) % 3000 * s;
      const y = hash2(i, 2) * 700 * s - cam.t * 0.02 * s;
      if (x > W || y > H * 0.7) continue;
      ctx.globalAlpha = 0.25 + 0.6 * hash2(i, 3) * (0.7 + 0.3 * Math.sin(time * 2 + i));
      ctx.fillRect(x, y, 1.5 * s, 1.5 * s);
    }
    const mx = (cam.vw * 0.78 - cam.l * 0.03) * s, my = (160 - (cam.t - (G.map.h - cam.vh)) * 0.04) * s;
    ctx.globalAlpha = 0.5;
    ctx.drawImage(FX.glowSprite('#b8c4ff'), mx - 180 * s, my - 180 * s, 360 * s, 360 * s);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#f4efd8';
    ctx.beginPath(); ctx.arc(mx, my, 46 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(180,170,140,.35)';
    ctx.beginPath(); ctx.arc(mx - 14 * s, my - 8 * s, 10 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(mx + 12 * s, my + 14 * s, 7 * s, 0, TAU); ctx.fill();
    if (lightning > 0) {
      ctx.fillStyle = 'rgba(200,210,255,' + (lightning * 0.35) + ')';
      ctx.fillRect(0, 0, W, H);
    }
  } else if (th === 'jungle') {
    /* soleil voilé et rayons */
    const sx = (cam.vw * 0.3 - cam.l * 0.03) * cam.s, sy = (220 - (cam.t - (G.map.h - cam.vh)) * 0.05) * cam.s;
    ctx.globalAlpha = 0.55;
    ctx.drawImage(FX.glowSprite('#fff2c0'), sx - 260 * cam.s, sy - 260 * cam.s, 520 * cam.s, 520 * cam.s);
    ctx.globalAlpha = 1;
  }
}

/* =========================== DÉCOR / MONDE ============================ */
function visible(x, y, w, h) {
  return x + w > view.l && x < view.r && y + h > view.t && y < view.b;
}

/* Décor destructible : tremble quand il est touché, se fissure avec les dégâts. */
let frameDt = 0;
function drawSolid(s, time) {
  if (s.dead) return;
  if (!s.hp0) { drawSolidBody(s, time); return; }
  if (!visible(s.x - 10, s.y - 10, s.w + 20, s.h + 20)) return;
  s.hitT = Math.max(0, (s.hitT || 0) - frameDt);
  const j = s.hitT > 0 ? s.hitT / 0.14 * 2.5 : 0;
  ctx.save();
  if (j) ctx.translate((Math.random() * 2 - 1) * j, (Math.random() * 2 - 1) * j * 0.5);
  drawSolidBody(s, time);
  drawCracks(s.x, s.y, s.w, s.h, 1 - s.hp / s.hp0, s.di);
  ctx.restore();
}
function drawCracks(x, y, w, h, dmg, seed) {
  if (dmg < 0.15) return;
  const n = Math.ceil(dmg * 4);
  ctx.strokeStyle = 'rgba(10,8,6,' + (0.35 + dmg * 0.4) + ')';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let k = 0; k < n; k++) {
    let px = x + w * (0.25 + 0.5 * hash2(seed, k)), py = y + h * (0.2 + 0.6 * hash2(k, seed + 3));
    ctx.moveTo(px, py);
    for (let s = 0; s < 3; s++) {
      px += (hash2(seed + s, k * 7) - 0.5) * w * 0.5;
      py += (hash2(k + s, seed * 3) - 0.5) * h * 0.5;
      ctx.lineTo(Math.max(x, Math.min(x + w, px)), Math.max(y, Math.min(y + h, py)));
    }
  }
  ctx.stroke();
}

function drawSolidBody(s, time) {
  const vis = visible(s.x, s.y, s.w, s.h);
  if (!vis) return;
  /* On ne dessine que la partie visible des très grands blocs. */
  const x0 = Math.max(s.x, view.l - 10), x1 = Math.min(s.x + s.w, view.r + 10);
  const y0 = Math.max(s.y, view.t - 10), y1 = Math.min(s.y + s.h, view.b + 10);
  switch (s.k) {
    case 'bld': drawBuilding(s, x0, x1, y0, y1); break;
    case 'ac': {
      box(s, '#6b7384', '#3d4350');
      ctx.fillStyle = '#2a2e38';
      ctx.fillRect(s.x + 8, s.y + 8, s.w - 16, s.h - 14);
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2 + 2, r = Math.min(s.w, s.h) / 2 - 8;
      ctx.strokeStyle = '#8a93a6'; ctx.lineWidth = 2;
      for (let k = 0; k < 3; k++) {
        const a = time * 9 + k * TAU / 3;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(160,200,255,.5)'; ctx.fillRect(s.x + 2, s.y, s.w - 4, 2);
      break;
    }
    case 'barrel': {                              // baril explosif
      ctx.fillStyle = '#b32a22';
      ctx.fillRect(s.x, s.y + 3, s.w, s.h - 3);
      ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(s.x + 5, s.y + 4, 5, s.h - 6);
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(s.x + s.w - 7, s.y + 4, 7, s.h - 6);
      ctx.fillStyle = '#3a3a40';
      ctx.fillRect(s.x - 1, s.y + 10, s.w + 2, 3); ctx.fillRect(s.x - 1, s.y + s.h - 12, s.w + 2, 3);
      ctx.fillStyle = '#6a2018';
      ctx.beginPath(); ctx.ellipse(s.x + s.w / 2, s.y + 3, s.w / 2, 3.5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffd35c';                   // pictogramme « inflammable »
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2 + 2;
      ctx.beginPath(); ctx.moveTo(cx, cy - 8); ctx.lineTo(cx + 8, cy + 6); ctx.lineTo(cx - 8, cy + 6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#2a1a10'; ctx.fillRect(cx - 1, cy - 3, 2, 5); ctx.fillRect(cx - 1, cy + 3, 2, 2);
      break;
    }
    case 'glass': {                               // vitre
      ctx.fillStyle = 'rgba(150,210,255,.22)';
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.strokeStyle = '#5a6278'; ctx.lineWidth = 2;
      ctx.strokeRect(s.x + 1, s.y + 1, s.w - 2, s.h - 2);
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(s.x + 3, s.y + s.h * 0.6); ctx.lineTo(s.x + s.w - 3, s.y + s.h * 0.35); ctx.stroke();
      break;
    }
    case 'rock': {                                // rocher de ruine
      ctx.fillStyle = '#6f6f60';
      ctx.beginPath();
      ctx.moveTo(s.x + 4, s.y + s.h); ctx.lineTo(s.x, s.y + s.h * 0.45); ctx.lineTo(s.x + s.w * 0.25, s.y + 4);
      ctx.lineTo(s.x + s.w * 0.7, s.y); ctx.lineTo(s.x + s.w, s.y + s.h * 0.35); ctx.lineTo(s.x + s.w - 2, s.y + s.h);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.beginPath(); ctx.moveTo(s.x + s.w * 0.7, s.y); ctx.lineTo(s.x + s.w, s.y + s.h * 0.35); ctx.lineTo(s.x + s.w - 2, s.y + s.h); ctx.lineTo(s.x + s.w * 0.6, s.y + s.h); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#4f8a3a'; ctx.fillRect(s.x + s.w * 0.25, s.y + 2, s.w * 0.45, 4);
      break;
    }
    case 'urn': {                                 // jarre en terre cuite
      const cx = s.x + s.w / 2;
      ctx.fillStyle = '#b0613a';
      ctx.beginPath();
      ctx.moveTo(cx - 6, s.y); ctx.lineTo(cx + 6, s.y);
      ctx.quadraticCurveTo(cx + s.w * 0.75, s.y + s.h * 0.45, cx + 7, s.y + s.h);
      ctx.lineTo(cx - 7, s.y + s.h);
      ctx.quadraticCurveTo(cx - s.w * 0.75, s.y + s.h * 0.45, cx - 6, s.y);
      ctx.fill();
      ctx.fillStyle = '#8a4526'; ctx.fillRect(cx - 7, s.y, 14, 4); ctx.fillRect(cx - 11, s.y + s.h * 0.45, 22, 3);
      ctx.fillStyle = 'rgba(255,220,180,.25)'; ctx.fillRect(cx - 6, s.y + 7, 3, s.h - 14);
      break;
    }
    case 'chimney':
      box(s, '#6b3b33', '#3e211d');
      ctx.fillStyle = '#4a2823';
      for (let y = s.y + 10; y < s.y + s.h; y += 12) ctx.fillRect(s.x, y, s.w, 2);
      ctx.fillStyle = '#2a2a2a'; ctx.fillRect(s.x - 4, s.y - 2, s.w + 8, 8);
      break;
    case 'hut':
      box(s, '#3c4256', '#262a38');
      ctx.fillStyle = '#1b1e28'; ctx.fillRect(s.x + 36, s.y + 26, 34, s.h - 26);
      ctx.fillStyle = '#ffd88a'; ctx.fillRect(s.x + 48, s.y + 12, 10, 6);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5;
      ctx.drawImage(FX.glowSprite('#ffb040'), s.x + 23, s.y - 10, 60, 50);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      break;
    case 'tank':
      box(s, '#6e4b2e', '#3f2a19');
      ctx.fillStyle = '#5a3c24';
      for (let x = s.x + 10; x < s.x + s.w; x += 14) ctx.fillRect(x, s.y, 3, s.h);
      ctx.fillStyle = '#2e3138';
      ctx.fillRect(s.x - 2, s.y + 30, s.w + 4, 6); ctx.fillRect(s.x - 2, s.y + s.h - 40, s.w + 4, 6);
      ctx.fillStyle = 'rgba(160,200,255,.35)'; ctx.fillRect(s.x, s.y, s.w, 2);
      break;
    case 'crate':
      box(s, '#8a6038', '#4e3419');
      ctx.strokeStyle = '#5e3f20'; ctx.lineWidth = 5;
      ctx.strokeRect(s.x + 5, s.y + 5, s.w - 10, s.h - 10);
      ctx.beginPath(); ctx.moveTo(s.x + 7, s.y + 7); ctx.lineTo(s.x + s.w - 7, s.y + s.h - 7);
      ctx.moveTo(s.x + s.w - 7, s.y + 7); ctx.lineTo(s.x + 7, s.y + s.h - 7); ctx.stroke();
      break;
    case 'container': {
      box(s, s.c, 'rgba(0,0,0,.4)');
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      for (let x = s.x + 8; x < s.x + s.w - 4; x += 14) ctx.fillRect(x, s.y + 8, 5, s.h - 16);
      ctx.fillStyle = 'rgba(255,255,255,.12)';
      ctx.fillRect(s.x, s.y, s.w, 5);
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fillRect(s.x, s.y + s.h - 8, s.w, 8);
      ctx.fillStyle = 'rgba(255,255,255,.3)';
      ctx.font = '800 26px Segoe UI, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('RACCO LOGISTICS', s.x + s.w / 2, s.y + s.h / 2 + 8);
      break;
    }
    case 'girder': case 'beam':
      box(s, '#4a525e', '#2a2f37');
      ctx.fillStyle = '#353b45';
      if (s.k === 'girder') ctx.fillRect(s.x, s.y + 9, s.w, s.h - 18);
      else ctx.fillRect(s.x + 9, y0, s.w - 18, y1 - y0);
      ctx.fillStyle = '#7d8796';
      if (s.k === 'girder') for (let x = s.x + 10; x < s.x + s.w; x += 24) ctx.fillRect(x, s.y + 3, 3, 3);
      else for (let y = Math.max(s.y, y0 - (y0 - s.y) % 24) + 10; y < y1; y += 24) ctx.fillRect(s.x + 3, y, 3, 3);
      break;
    case 'wall': case 'floor': case 'ceiling':
      ctx.fillStyle = s.k === 'ceiling' ? '#2a2c30' : '#34322d';
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      if (s.k === 'floor') {
        for (let x = Math.floor(x0 / 160) * 160; x < x1; x += 160) ctx.fillRect(x, s.y, 3, s.h);
        ctx.fillStyle = '#4a4740'; ctx.fillRect(x0, s.y, x1 - x0, 6);
      } else if (s.k === 'wall') {
        for (let y = Math.floor(y0 / 120) * 120; y < y1; y += 120) ctx.fillRect(s.x, y, s.w, 3);
      } else {
        for (let x = Math.floor(x0 / 80) * 80; x < x1; x += 80) ctx.fillRect(x, s.y, 4, s.h);
      }
      break;
    case 'cliff': {
      ctx.fillStyle = '#28342d';
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.fillStyle = '#1e2822';
      for (let y = Math.floor(y0 / 70) * 70; y < y1; y += 70) {
        const o = hash2(s.x, y) * 30;
        ctx.fillRect(s.x + o, y, 30 + hash2(y, s.x) * 30, 20);
      }
      ctx.fillStyle = '#35553a';
      ctx.fillRect(s.mir ? s.x : s.x + s.w - 6, y0, 6, y1 - y0);
      break;
    }
    case 'stone': case 'step': {
      ctx.fillStyle = s.k === 'step' ? '#7a725c' : '#66675a';
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      const bh = s.k === 'step' ? 40 : 25;
      for (let y = s.y + bh; y < s.y + s.h; y += bh) ctx.fillRect(s.x, y, s.w, 2);
      for (let y = s.y, r = 0; y < s.y + s.h; y += bh, r++) {
        for (let x = s.x + (r % 2 ? 30 : 60); x < s.x + s.w; x += 60) ctx.fillRect(x, y, 2, bh);
      }
      if (s.k === 'step') {                     // glyphes gravés
        ctx.strokeStyle = 'rgba(40,30,20,.35)'; ctx.lineWidth = 2;
        for (let x = s.x + 40; x < s.x + s.w - 30; x += 90) {
          ctx.strokeRect(x, s.y + 60, 22, 22);
          ctx.beginPath(); ctx.arc(x + 11, s.y + 71, 5, 0, TAU); ctx.stroke();
        }
      }
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(s.x, s.y + s.h - 5, s.w, 5);
      /* mousse sur le dessus, avec quelques coulures */
      ctx.fillStyle = '#4f8a3a';
      ctx.fillRect(s.x, s.y - 2, s.w, 6);
      for (let x = s.x + 8; x < s.x + s.w - 8; x += 17) {
        const d = hash2(x, s.y) * 14;
        if (d > 4) ctx.fillRect(x, s.y + 2, 4, d);
      }
      break;
    }
    default:
      box(s, '#555', '#333');
  }
}
function box(s, fill, edge) {
  ctx.fillStyle = fill;
  ctx.fillRect(s.x, s.y, s.w, s.h);
  ctx.strokeStyle = edge; ctx.lineWidth = 3;
  ctx.strokeRect(s.x + 1.5, s.y + 1.5, s.w - 3, s.h - 3);
}

/* Immeuble : façade, fenêtres (allumées au hasard mais stables), toit mouillé. */
function drawBuilding(s, x0, x1, y0, y1) {
  const g = ctx.createLinearGradient(s.x, 0, s.x + s.w, 0);
  g.addColorStop(0, shade(s.c, -0.25)); g.addColorStop(0.5, s.c); g.addColorStop(1, shade(s.c, -0.4));
  ctx.fillStyle = g;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  const CW = 46, CH = 64;
  const c0 = Math.max(0, Math.floor((x0 - s.x - 20) / CW)), c1 = Math.floor((x1 - s.x - 20) / CW);
  const r0 = Math.max(0, Math.floor((y0 - s.y - 50) / CH)), r1 = Math.floor((y1 - s.y - 50) / CH);
  const cols = Math.floor((s.w - 40) / CW);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= Math.min(c1, cols - 1); c++) {
      const wx = s.x + 26 + c * CW, wy = s.y + 50 + r * CH;
      const h = hash2(c + s.x, r + s.y);
      ctx.fillStyle = h > 0.72 ? (h > 0.95 ? '#9fd0ff' : '#ffcf7a') : '#151824';
      ctx.fillRect(wx, wy, 24, 34);
      if (h > 0.72) { ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(wx, wy + 16, 24, 2); }
    }
  }
  /* toit : rebord + reflet humide */
  if (s.y >= y0 - 20) {
    ctx.fillStyle = shade(s.c, 0.35);
    ctx.fillRect(s.x - 6, s.y, s.w + 12, 12);
    ctx.fillStyle = 'rgba(170,200,255,.35)';
    ctx.fillRect(s.x - 6, s.y, s.w + 12, 2);
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillRect(s.x - 6, s.y + 12, s.w + 12, 5);
    /* flaques qui renvoient la lumière */
    for (let k = 0; k < 3; k++) {
      const px = s.x + 30 + hash2(s.x, k) * (s.w - 100);
      ctx.fillStyle = 'rgba(150,180,255,.12)';
      ctx.fillRect(px, s.y + 3, 40 + hash2(k, s.x) * 50, 3);
    }
  }
}
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if (k > 0) { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; }
  else { r *= 1 + k; g *= 1 + k; b *= 1 + k; }
  return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
}

function drawPlat(p) {
  if (p.dead) return;
  if (!visible(p.x - 10, p.y - 40, p.w + 20, 200)) return;
  if (p.hp0) {
    p.hitT = Math.max(0, (p.hitT || 0) - frameDt);
    ctx.save();
    if (p.hitT) ctx.translate(0, (Math.random() * 2 - 1) * 2);
    drawPlatBody(p);
    drawCracks(p.x, p.y, p.w, 10, 1 - p.hp / p.hp0, p.di);
    ctx.restore();
    return;
  }
  drawPlatBody(p);
}
function drawPlatBody(p) {
  switch (p.k) {
    case 'walk': case 'fire':
      ctx.fillStyle = p.k === 'fire' ? '#3a3f4e' : '#565e74';
      ctx.fillRect(p.x, p.y, p.w, 8);
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      for (let x = p.x + 4; x < p.x + p.w; x += 8) ctx.fillRect(x, p.y + 2, 3, 5);
      ctx.strokeStyle = 'rgba(140,150,175,.55)'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 26); ctx.lineTo(p.x + p.w, p.y - 26);
      for (let x = p.x; x <= p.x + p.w; x += 35) { ctx.moveTo(x, p.y); ctx.lineTo(x, p.y - 26); }
      if (p.k === 'fire') {                   // échelle d'évacuation
        ctx.moveTo(p.x + p.w / 2 - 8, p.y + 8); ctx.lineTo(p.x + p.w / 2 - 8, p.y + 140);
        ctx.moveTo(p.x + p.w / 2 + 8, p.y + 8); ctx.lineTo(p.x + p.w / 2 + 8, p.y + 140);
        for (let y = p.y + 20; y < p.y + 140; y += 14) { ctx.moveTo(p.x + p.w / 2 - 8, y); ctx.lineTo(p.x + p.w / 2 + 8, y); }
      }
      ctx.stroke();
      ctx.fillStyle = 'rgba(170,200,255,.4)'; ctx.fillRect(p.x, p.y, p.w, 1.5);
      break;
    case 'scaf':
      ctx.strokeStyle = '#6d7686'; ctx.lineWidth = 4;
      ctx.beginPath();
      for (let x = p.x + 10; x < p.x + p.w; x += 90) {
        ctx.moveTo(x, p.y); ctx.lineTo(x, p.y + 180);
        ctx.moveTo(x, p.y); ctx.lineTo(Math.min(x + 90, p.x + p.w - 10), p.y + 180);
      }
      ctx.stroke();
      ctx.fillStyle = '#7a5a3a'; ctx.fillRect(p.x, p.y, p.w, 10);
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      for (let x = p.x + 40; x < p.x + p.w; x += 40) ctx.fillRect(x, p.y, 2, 10);
      break;
    case 'catwalk':
      ctx.strokeStyle = 'rgba(90,90,85,.6)'; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = p.x + 30; x < p.x + p.w; x += 200) { ctx.moveTo(x, p.y); ctx.lineTo(x, 60); }
      ctx.stroke();
      ctx.fillStyle = '#34342f'; ctx.fillRect(p.x, p.y, p.w, 10);
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      for (let x = p.x + 3; x < p.x + p.w; x += 7) ctx.fillRect(x, p.y + 3, 3, 5);
      ctx.fillStyle = '#c9a13a'; ctx.fillRect(p.x, p.y, p.w, 3);
      ctx.strokeStyle = '#b08c30'; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 30); ctx.lineTo(p.x + p.w, p.y - 30);
      for (let x = p.x + 2; x <= p.x + p.w; x += 50) { ctx.moveTo(x, p.y); ctx.lineTo(x, p.y - 30); }
      ctx.stroke();
      break;
    case 'plank': case 'roof':
      if (p.k === 'plank') {
        ctx.strokeStyle = '#8a7a50'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.x + 6, p.y); ctx.lineTo(p.x + 16, p.y - 80);
        ctx.moveTo(p.x + p.w - 6, p.y); ctx.lineTo(p.x + p.w - 16, p.y - 80);
        ctx.stroke();
      }
      ctx.fillStyle = p.k === 'roof' ? '#6e6a58' : '#7b5433';
      ctx.fillRect(p.x, p.y, p.w, p.k === 'roof' ? 16 : 10);
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      for (let x = p.x + 26; x < p.x + p.w; x += 26) ctx.fillRect(x, p.y, 2, 10);
      ctx.fillStyle = 'rgba(255,230,180,.2)'; ctx.fillRect(p.x, p.y, p.w, 2);
      break;
  }
}

/* Décor d'arrière-plan (sans collision). */
function drawDeco(d, time) {
  const w = d.w || 0, h = d.h || d.len || 0;
  switch (d.k) {
    case 'neon': case 'neonv': case 'sign': {
      if (!visible(d.x - 150, d.y - 150, w + 300, h + 500)) return;
      /* néon qui grésille : bruit stable par tranches de temps */
      const tick = Math.floor(time * 14);
      const flick = hash2(tick, d.x | 0) > 0.94 ? 0.15 : hash2(tick >> 3, (d.x | 0) + 7) > 0.97 ? 0.4 : 1;
      ctx.fillStyle = '#12121a';
      ctx.fillRect(d.x, d.y, w, h);
      ctx.strokeStyle = '#2a2a36'; ctx.lineWidth = 4; ctx.strokeRect(d.x, d.y, w, h);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35 * flick;
      ctx.drawImage(FX.glowSprite(d.c), d.x - 60, d.y - 60, w + 120, h + 120);
      /* reflet sur le toit mouillé en dessous */
      if (d.ry === undefined) d.ry = surfaceBelow(d.x + w / 2, d.y + h);
      if (d.ry < Infinity) {
        ctx.globalAlpha = 0.28 * flick;
        ctx.drawImage(FX.glowSprite(d.c), d.x - 20, d.ry - 14, w + 40, 30);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.textAlign = 'center';
      ctx.fillStyle = flick < 0.5 ? shade(d.c, -0.6) : '#ffffff';
      if (G.quality === 'high' && flick > 0.5) { ctx.shadowColor = d.c; ctx.shadowBlur = 18; }
      if (d.k === 'neonv') {
        ctx.font = '800 30px Segoe UI, sans-serif';
        for (let i = 0; i < d.txt.length; i++) ctx.fillText(d.txt[i], d.x + w / 2, d.y + 34 + i * 44);
      } else {
        ctx.font = '900 ' + (d.k === 'sign' ? 40 : 52) + 'px Segoe UI, sans-serif';
        ctx.fillText(d.txt, d.x + w / 2, d.y + h / 2 + 18);
      }
      ctx.shadowBlur = 0;
      ctx.strokeStyle = flick < 0.5 ? shade(d.c, -0.5) : d.c; ctx.lineWidth = 3;
      ctx.strokeRect(d.x + 8, d.y + 8, w - 16, h - 16);
      if (d.k === 'sign') {                  // ampoules autour du panneau
        for (let x = d.x + 8; x < d.x + w; x += 14) {
          const on = (Math.floor(time * 4) + x / 14) % 2 < 1;
          ctx.fillStyle = on ? '#fff0b0' : '#6a5a30';
          ctx.fillRect(x, d.y + 2, 4, 4); ctx.fillRect(x, d.y + h - 6, 4, 4);
        }
      }
      break;
    }
    case 'legs':
      if (!visible(d.x, d.y, w, h)) return;
      ctx.strokeStyle = '#2b2f3a'; ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(d.x + 20, d.y); ctx.lineTo(d.x + 20, d.y + h);
      ctx.moveTo(d.x + w - 20, d.y); ctx.lineTo(d.x + w - 20, d.y + h);
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(d.x + 20, d.y + 20); ctx.lineTo(d.x + w - 20, d.y + h - 20);
      ctx.moveTo(d.x + w - 20, d.y + 20); ctx.lineTo(d.x + 20, d.y + h - 20);
      ctx.stroke();
      break;
    case 'towerlegs':
      if (!visible(d.x, d.y, w, h)) return;
      ctx.strokeStyle = '#3a3026'; ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(d.x + 10, d.y); ctx.lineTo(d.x - 5, d.y + h);
      ctx.moveTo(d.x + w - 10, d.y); ctx.lineTo(d.x + w + 5, d.y + h);
      ctx.moveTo(d.x + w * 0.4, d.y); ctx.lineTo(d.x + w * 0.4, d.y + h);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y + 20); ctx.lineTo(d.x + w, d.y + h - 10);
      ctx.moveTo(d.x + w, d.y + 20); ctx.lineTo(d.x, d.y + h - 10);
      ctx.stroke();
      break;
    case 'roofcone':
      if (!visible(d.x, d.y, w, h)) return;
      ctx.fillStyle = '#3a2c22';
      ctx.beginPath(); ctx.moveTo(d.x, d.y + h); ctx.lineTo(d.x + w / 2, d.y); ctx.lineTo(d.x + w, d.y + h); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(170,200,255,.3)';
      ctx.beginPath(); ctx.moveTo(d.x + w / 2, d.y); ctx.lineTo(d.x + w / 2 + 4, d.y + 4); ctx.lineTo(d.x + w - 6, d.y + h); ctx.lineTo(d.x + w, d.y + h); ctx.closePath(); ctx.fill();
      break;
    case 'antenna': {
      if (!visible(d.x - 40, d.y - h - 20, 80, h + 20)) return;
      ctx.strokeStyle = '#3d4250'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x, d.y - h); ctx.stroke();
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = 1; k < 4; k++) { const y = d.y - h * k / 4; ctx.moveTo(d.x - 24 + k * 4, y); ctx.lineTo(d.x + 24 - k * 4, y); }
      ctx.moveTo(d.x, d.y - h * 0.6); ctx.lineTo(d.x - 40, d.y); ctx.moveTo(d.x, d.y - h * 0.6); ctx.lineTo(d.x + 40, d.y);
      ctx.stroke();
      if (Math.sin(time * 3 + d.x) > 0.2) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(FX.glowSprite('#ff2030'), d.x - 16, d.y - h - 16, 32, 32);
        ctx.globalCompositeOperation = 'source-over';
      }
      break;
    }
    case 'wire': {
      if (!visible(d.x, d.y - 20, w, 80)) return;
      ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(d.x, d.y - 110); ctx.quadraticCurveTo(d.x + w / 2, d.y - 60, d.x + w, d.y - 110); ctx.stroke();
      break;
    }
    case 'lamp': {
      if (!visible(d.x - 60, d.y, 120, h + 40)) return;
      ctx.strokeStyle = '#2c2c2a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x, d.y + h); ctx.stroke();
      ctx.fillStyle = '#3b3d42';
      ctx.beginPath(); ctx.moveTo(d.x - 8, d.y + h); ctx.lineTo(d.x + 8, d.y + h); ctx.lineTo(d.x + 30, d.y + h + 22); ctx.lineTo(d.x - 30, d.y + h + 22); ctx.closePath(); ctx.fill();
      ctx.fillStyle = lampOn(d, time) ? '#fff4d0' : '#6a6040';
      ctx.fillRect(d.x - 10, d.y + h + 20, 20, 5);
      break;
    }
    case 'hook': {
      if (!visible(d.x - 30, d.y, 60, h + 40)) return;
      const sw = Math.sin(time * 0.8) * 10;
      ctx.strokeStyle = '#4a4a46'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + sw, d.y + h); ctx.stroke();
      ctx.strokeStyle = '#c9a13a'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(d.x + sw, d.y + h + 16, 14, -Math.PI / 2, Math.PI * 0.9); ctx.stroke();
      break;
    }
    case 'pipe':
      if (!visible(d.x, d.y - 20, w, 40)) return;
      ctx.fillStyle = '#3e4a4e'; ctx.fillRect(d.x, d.y, w, 22);
      ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(d.x, d.y + 3, w, 4);
      ctx.fillStyle = '#2a3235';
      for (let x = d.x + 60; x < d.x + w; x += 200) ctx.fillRect(x, d.y - 4, 14, 30);
      break;
    case 'sparker':
      if (!visible(d.x - 20, d.y - 40, 40, 80)) return;
      ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(d.x, d.y - 120); ctx.quadraticCurveTo(d.x + 10, d.y - 40, d.x, d.y); ctx.stroke();
      break;
    case 'barrels':
      if (!visible(d.x - 10, d.y - 70, 120, 70)) return;
      for (let k = 0; k < 3; k++) {
        const bx = d.x + k * 36;
        ctx.fillStyle = k === 1 ? '#6a2a22' : '#2d4a5a';
        ctx.fillRect(bx, d.y - 62, 32, 62);
        ctx.fillStyle = 'rgba(0,0,0,.3)';
        ctx.fillRect(bx, d.y - 46, 32, 3); ctx.fillRect(bx, d.y - 20, 32, 3);
      }
      break;
    case 'stripe':
      if (!visible(d.x, d.y, w, 10)) return;
      for (let x = d.x; x < d.x + w; x += 28) {
        ctx.fillStyle = '#d8a82a';
        ctx.beginPath(); ctx.moveTo(x, d.y + 2); ctx.lineTo(x + 14, d.y + 2); ctx.lineTo(x + 8, d.y + 8); ctx.lineTo(x - 6, d.y + 8); ctx.closePath(); ctx.fill();
      }
      break;
    case 'waterfall': {
      if (!visible(d.x, d.y, w, h)) return;
      const y0 = Math.max(d.y, view.t), y1 = Math.min(d.y + h, view.b);
      ctx.fillStyle = 'rgba(140,200,230,.35)';
      ctx.fillRect(d.x, y0, w, y1 - y0);
      ctx.fillStyle = 'rgba(230,250,255,.35)';
      for (let k = 0; k < 6; k++) {
        const sx = d.x + 6 + k * (w - 12) / 6;
        const off = (time * (500 + k * 60) + k * 97) % 160;
        for (let y = y0 - ((y0 - d.y) % 160) + off - 160; y < y1; y += 160) {
          ctx.fillRect(sx, Math.max(y, y0), 4, 60);
        }
      }
      break;
    }
    case 'vine': {
      if (!visible(d.x - 40, d.y, 80, h + 20)) return;
      const sw = Math.sin(time * 1.3 + d.x * 0.01) * 12;
      ctx.strokeStyle = '#2f5a2a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(d.x, d.y);
      ctx.quadraticCurveTo(d.x + sw * 0.5, d.y + h * 0.6, d.x + sw, d.y + h); ctx.stroke();
      ctx.fillStyle = '#3f7a34';
      for (let k = 1; k < 6; k++) {
        const t = k / 6, lx = d.x + sw * t * t, ly = d.y + h * t;
        ctx.beginPath(); ctx.ellipse(lx + (k % 2 ? 6 : -6), ly, 7, 3.5, k % 2 ? 0.5 : -0.5, 0, TAU); ctx.fill();
      }
      break;
    }
    case 'torch': {
      if (!visible(d.x - 50, d.y - 120, 100, 120)) return;
      ctx.fillStyle = '#4a3a28'; ctx.fillRect(d.x - 3, d.y - 60, 6, 60);
      ctx.fillStyle = '#2a2a2a'; ctx.fillRect(d.x - 8, d.y - 66, 16, 8);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5 + 0.15 * Math.sin(time * 13 + d.x);
      ctx.drawImage(FX.glowSprite('#ff9a2a'), d.x - 70, d.y - 140, 140, 140);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      break;
    }
    case 'statue': {
      if (!visible(d.x - 40, d.y - 20, 80, 130)) return;
      ctx.fillStyle = '#5d5a48';
      ctx.fillRect(d.x - 18, d.y + 40, 36, 70);
      ctx.fillRect(d.x - 22, d.y + 10, 44, 34);
      ctx.fillRect(d.x - 14, d.y - 14, 28, 26);
      ctx.fillStyle = '#3c3a2e'; ctx.fillRect(d.x - 8, d.y - 6, 5, 5); ctx.fillRect(d.x + 3, d.y - 6, 5, 5);
      ctx.fillStyle = '#4f8a3a'; ctx.fillRect(d.x - 14, d.y - 16, 28, 4);
      break;
    }
    case 'pillar':
      if (!visible(d.x - 20, d.y, 40, h)) return;
      ctx.fillStyle = '#6a6452'; ctx.fillRect(d.x - 12, d.y + 16, 24, h - 16);
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      for (let y = d.y + 40; y < d.y + h; y += 30) ctx.fillRect(d.x - 12, y, 24, 2);
      break;
    case 'idol': {
      if (!visible(d.x - 80, d.y - 120, 160, 120)) return;
      const pulse = 0.5 + 0.5 * Math.sin(time * 2);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.25 + 0.2 * pulse;
      ctx.drawImage(FX.glowSprite('#ffd24a'), d.x - 70, d.y - 110, 140, 120);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#d6a62a';
      ctx.fillRect(d.x - 12, d.y - 50, 24, 50);
      ctx.beginPath(); ctx.arc(d.x, d.y - 58, 13, 0, TAU); ctx.fill();
      ctx.fillStyle = '#6b4a10'; ctx.fillRect(d.x - 6, d.y - 62, 4, 4); ctx.fillRect(d.x + 2, d.y - 62, 4, 4);
      break;
    }
  }
}
function lampOn(d, time) {
  /* certaines lampes grésillent et s'éteignent par instants */
  if (hash2(d.x | 0, 5) < 0.6) return true;
  return hash2(Math.floor(time * 10), d.x | 0) > 0.08;
}
function surfaceBelow(x, y) {
  let best = Infinity;
  for (const s of G.map.solids) if (x >= s.x && x <= s.x + s.w && s.y >= y && s.y < best) best = s.y;
  for (const p of G.map.plats) if (!p.dead && x >= p.x && x <= p.x + p.w && p.y >= y && p.y < best) best = p.y;
  return best;
}

/* ---------------------------- Kits de soin ---------------------------- */
function drawKits(time) {
  for (const k of S.kits) {
    if (!visible(k.x - 60, k.y - 100, 120, 110)) continue;
    const bob = Math.sin(time * 3 + k.x) * 3;
    if (k.on) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 4 + k.x);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35 + 0.3 * pulse;
      ctx.drawImage(FX.glowSprite('#40ff80'), k.x - 45, k.y - 70 + bob, 90, 90);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#eef2f0';
      ctx.fillRect(k.x - 15, k.y - 40 + bob, 30, 22);
      ctx.fillStyle = '#b8c0bc'; ctx.fillRect(k.x - 15, k.y - 22 + bob, 30, 4);
      ctx.fillStyle = '#20c060';
      ctx.fillRect(k.x - 3, k.y - 37 + bob, 6, 16); ctx.fillRect(k.x - 8, k.y - 32 + bob, 16, 6);
      ctx.fillStyle = '#6a6f6c'; ctx.fillRect(k.x - 5, k.y - 44 + bob, 10, 4);
    } else {
      /* emplacement vide + indicateur de recharge */
      const left = Math.max(0, k.until - G.time);
      const prog = 1 - left / 20;
      ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(k.x, k.y - 30, 14, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(92,255,138,.7)';
      ctx.beginPath(); ctx.arc(k.x, k.y - 30, 14, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(prog, 0, 1)); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.ellipse(k.x, k.y - 1, 18, 3, 0, 0, TAU); ctx.fill();
  }
}

/* ------------------------- Colline (Roi de la colline) ---------------- */
/* Couleur : celle du joueur qui la tient seul, rouge vif si contestée. */
export function hillColor() {
  return G.hillOwner >= 0 ? COLORS[G.hillOwner] : G.hillOwner === -2 ? '#ff4040' : '#ffffff';
}
function drawHill(time) {
  const h = G.map.hills[G.hill];
  if (!h || !visible(h.x - 40, h.y - 300, h.w + 80, h.h + 340)) return;
  const col = hillColor();
  const pulse = 0.5 + 0.5 * Math.sin(time * 4);
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createLinearGradient(0, h.y - 260, 0, h.y + h.h);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, col);
  ctx.globalAlpha = 0.16 + 0.08 * pulse;
  ctx.fillStyle = g;
  ctx.fillRect(h.x, h.y - 260, h.w, h.h + 260);             // colonne de lumière
  ctx.globalAlpha = 0.35 + 0.25 * pulse;
  ctx.drawImage(FX.glowSprite(col), h.x - 20, h.y + h.h - 30, h.w + 40, 60);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = col; ctx.lineWidth = 3;
  ctx.setLineDash([14, 10]);
  ctx.lineDashOffset = -time * 30;
  ctx.strokeRect(h.x, h.y, h.w, h.h);
  ctx.setLineDash([]);
  ctx.fillStyle = col;
  ctx.font = '900 18px Segoe UI, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('♛ COLLINE', h.x + h.w / 2, h.y - 12);
}

/* ------------------------------ Décalques ----------------------------- */
function drawDecals() {
  for (const d of FX.decals) {
    if (d.x < view.l - 30 || d.x > view.r + 30 || d.y < view.t - 30 || d.y > view.b + 30) continue;
    ctx.fillStyle = d.c;
    ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, TAU); ctx.fill();
  }
  for (const k of FX.stuck) {
    if (k.x < view.l - 30 || k.x > view.r + 30 || k.y < view.t - 30 || k.y > view.b + 30) continue;
    ctx.save();
    ctx.translate(k.x, k.y);
    ctx.rotate(k.rot + Math.sin(k.t * 40) * Math.max(0, 0.3 - k.t) * 0.6);   // vibre en se plantant
    ctx.translate(-14, 0);
    drawWeapon(ctx, 'knives');
    ctx.restore();
  }
}

/* =============================== STICKMEN ============================= */
function limb(ax, ay, bx, by, cx, cy) {
  ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy);
}

const NO_OUTFIT = outfitParts([0, 0, 0, 0]);
function stroke3(ax, ay, bx, by, cx, cy, color, w) {
  ctx.strokeStyle = color; ctx.lineWidth = w;
  ctx.beginPath(); limb(ax, ay, bx, by, cx, cy); ctx.stroke();
}
function stroke2(ax, ay, bx, by, color, w) {
  ctx.strokeStyle = color; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
}
function dot(x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}
/* Jambe : pantalon (ou short) par-dessus la couleur du joueur. */
function drawLeg(hip, knee, foot, pants, skin, back) {
  if (pants.id === 'none') { stroke3(hip.x, hip.y, knee.x, knee.y, foot.x, foot.y, skin, LIMB_W); return; }
  const pc = back ? shade(pants.c, -0.35) : pants.c;
  if (pants.short) {
    stroke2(knee.x, knee.y, foot.x, foot.y, skin, LIMB_W);
    stroke2(hip.x, hip.y, knee.x, knee.y, pc, LIMB_W + 3);
  } else stroke3(hip.x, hip.y, knee.x, knee.y, foot.x, foot.y, pc, LIMB_W + 2);
}
/* Bras : manches de la veste si elle en a, sinon le bras nu. */
function drawArm(sh, elb, hand, jacket, jc, skin, back) {
  if (jacket.id !== 'none' && jacket.sleeves) {
    stroke3(sh.x, sh.y, elb.x, elb.y, hand.x, hand.y, back ? shade(jc, -0.35) : jc, LIMB_W + 2);
  } else stroke3(sh.x, sh.y, elb.x, elb.y, hand.x, hand.y, skin, LIMB_W);
  dot(hand.x, hand.y, 3, skin);
}
/* Tronc : couleur du joueur, ou veste avec ses détails. */
function drawTorso(o, jacket, jc, skin, f) {
  const hx = o.hip.x, hy = o.hip.y, nx = o.neck.x, ny = o.neck.y;
  if (jacket.id === 'none') {
    stroke2(hx, hy, nx, ny, 'rgba(0,0,0,.55)', LIMB_W + 4);
    stroke2(hx, hy, nx, ny, skin, LIMB_W + 1.5);
    return;
  }
  const len = Math.hypot(hx - nx, hy - ny) || 1;
  const tail = jacket.id === 'lab' ? 16 : 5;          // la blouse descend plus bas
  const bx = hx + (hx - nx) / len * tail, by = hy + (hy - ny) / len * tail;
  stroke2(bx, by, nx, ny + 2, 'rgba(0,0,0,.55)', LIMB_W + 9);
  stroke2(bx, by, nx, ny + 2, jc, LIMB_W + 6);
  const at = (t) => ({ x: hx + (nx - hx) * t, y: hy + (ny - hy) * t });
  switch (jacket.id) {
    case 'suit': {                                     // chemise blanche + cravate rouge
      const a = at(0.95), b = at(0.55);
      stroke2(a.x + f * 2, a.y, b.x + f * 3, b.y, jacket.c2, 3.5);
      stroke2(a.x + f * 2.5, a.y + 1, b.x + f * 3.5, b.y + 3, '#d42a2a', 1.8);
      break;
    }
    case 'leather': {
      const a = at(0.95), b = at(0.1);
      stroke2(a.x + f * 3, a.y, b.x + f * 3, b.y, jacket.c2, 1.2);
      break;
    }
    case 'vest': {
      const p1 = at(0.35), p2 = at(0.65);
      ctx.fillStyle = jacket.c2;
      ctx.fillRect(p1.x - 4, p1.y - 3, 8, 5); ctx.fillRect(p2.x - 4, p2.y - 3, 8, 5);
      break;
    }
    case 'hawaii': {
      const offs = [-2.5, 2, -1, 2.5];
      [0.2, 0.45, 0.7, 0.9].forEach((t, n) => { const q = at(t); dot(q.x + offs[n], q.y, 1.6, jacket.c2); });
      break;
    }
    case 'lab': {
      const q = at(0.7);
      ctx.fillStyle = jacket.c2; ctx.fillRect(q.x + f - 2.5, q.y - 2, 5, 4);
      dot(q.x + f, q.y - 3, 1, '#3a7bd5');
      break;
    }
  }
}

function drawStickman(p, x, y, time, isLocal, noCull) {
  const hk = headScale();
  if (!noCull && !visible(x - 90, y - 150 - hk * 25, 180, 190 + hk * 25)) return;
  const o = computePose(p, x, y, time);
  const of = p.outfit || NO_OUTFIT;
  const J = of.jacket, jc = J.id !== 'none' ? (J.c || p.dark) : null;
  const f = p.facing;
  const hr = HEAD_R * hk;
  let alpha = 1;
  if (p.invuln > 0) alpha = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(time * 30));   // clignote
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  /* ombre de contact */
  if (p.onGround) {
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath(); ctx.ellipse(x, y, 20, 4, 0, 0, TAU); ctx.fill();
  }

  /* membres arrière (plus sombres) */
  drawLeg(o.hip, o.kneeL, o.footL, of.pants, p.dark, true);
  drawShoe(ctx, of.shoes, o.footL.x, o.footL.y, f, true);
  drawArm(o.sh, o.elbF, o.handF, J, jc, p.dark, true);

  /* capuche derrière la tête */
  if (J.id === 'hoodie') dot(o.head.x - f * 3 * hk, o.head.y + 2 * hk, hr + 3.5, shade(jc, -0.15));

  /* tronc, puis jambe avant (contour sombre : lisible sur tous les fonds) */
  drawTorso(o, J, jc, p.color, f);
  const longPants = of.pants.id !== 'none' && !of.pants.short;
  stroke3(o.hip.x, o.hip.y, o.kneeR.x, o.kneeR.y, o.footR.x, o.footR.y, 'rgba(0,0,0,.55)', LIMB_W + (longPants ? 5 : 3));
  drawLeg(o.hip, o.kneeR, o.footR, of.pants, p.color, false);
  drawShoe(ctx, of.shoes, o.footR.x, o.footR.y, f, false);

  /* tête */
  ctx.fillStyle = p.color;
  ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(o.head.x, o.head.y, hr, 0, TAU); ctx.fill(); ctx.stroke();
  /* visière orientée vers la visée */
  const ca = Math.cos(p.aim), sa = Math.sin(p.aim);
  ctx.fillStyle = 'rgba(10,14,30,.85)';
  ctx.beginPath();
  ctx.ellipse(o.head.x + ca * 5 * hk, o.head.y + (sa * 4 - 1) * hk, 5.5 * hk, 3.2 * hk, p.aim, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.8)';
  ctx.fillRect(o.head.x + ca * 6.5 * hk - hk, o.head.y + (sa * 4 - 2.5) * hk, 2 * hk, 2 * hk);
  drawHat(ctx, of.hat, o.head.x, o.head.y, hr, f, 0);

  /* arme dans les mains */
  const wId = p.weapons[p.active];
  /* boomerang lancé : les mains sont vides jusqu'à son retour */
  const empty = wId === 'boomerang' && S.proj.some((b) => b.owner === p.i && b.kind === 'boomerang' && !b.dead);
  if (!empty) {
    ctx.save();
    ctx.translate(o.handB.x, o.handB.y);
    let rot = p.aim;
    /* katana : grand coup de lame qui balaie un arc à chaque entaille */
    if (wId === 'katana' && p.recoil > 0.02) rot += f * (-1.4 + 2.8 * (1 - p.recoil));
    ctx.rotate(rot);
    if (f < 0) ctx.scale(1, -1);
    drawWeapon(ctx, wId);
    ctx.restore();
    if (wId === 'katana' && p.recoil > 0.3) {                    // traînée lumineuse de l'entaille
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = '#e8fbff'; ctx.lineWidth = 3; ctx.globalAlpha = (p.recoil - 0.3) * 1.2;
      ctx.beginPath();
      ctx.arc(o.handB.x, o.handB.y, 52, p.aim - 1.4, p.aim - 1.4 + 2.8 * (1 - p.recoil) + 0.01, f < 0);
      ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  /* railgun en charge : énergie qui se concentre au bout du canon */
  if (wId === 'railgun' && p.charge > 0) {
    const k = Math.min(1, p.charge / WEAPONS.railgun.charge);
    const mx = o.handB.x + Math.cos(p.aim) * 58, my = o.handB.y + Math.sin(p.aim) * 58;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.4 + 0.6 * k;
    const r = 8 + k * 22 + (k >= 1 ? Math.sin(time * 40) * 4 : 0);
    ctx.drawImage(FX.glowSprite(p.color), mx - r, my - r, r * 2, r * 2);
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'source-over';
    FX.railCharge(mx, my, k, p.color);
  }

  /* bras avant par-dessus l'arme */
  drawArm(o.sh, o.elbB, o.handB, J, jc, p.color, false);
  ctx.globalAlpha = 1;

  /* laser de visée du sniper (fin, semi-transparent) */
  if (WEAPONS[wId].laser && p.alive && G.map) drawLaser(p, o, time);
}

/* Aperçu du personnage dans le salon (canvas séparé, sans décor). */
export function drawCharacterPreview(canvas, p, time, scale) {
  const c = canvas.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, canvas.width, canvas.height);
  const saved = ctx;
  ctx = c;
  const k = scale || 1;
  ctx.setTransform(k, 0, 0, k, canvas.width / 2, canvas.height - 10 * k);
  ctx.fillStyle = 'rgba(255,255,255,.08)';
  ctx.fillRect(-60, 0, 120, 3);
  drawStickman(p, 0, 0, time, true, true);
  ctx = saved;
}

function drawLaser(p, o, time) {
  const ca = Math.cos(p.aim), sa = Math.sin(p.aim);
  const x0 = o.handB.x + ca * WEAPONS.sniper.len, y0 = o.handB.y + sa * WEAPONS.sniper.len;
  let d = 0;
  const MAX = 2600;
  while (d < MAX) {
    d += 14;
    if (solidAt(x0 + ca * d, y0 + sa * d)) break;
  }
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = p.color;
  ctx.globalAlpha = 0.28 + 0.06 * Math.sin(time * 20);
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + ca * d, y0 + sa * d); ctx.stroke();
  ctx.globalAlpha = 0.8;
  ctx.drawImage(FX.glowSprite(p.color), x0 + ca * d - 7, y0 + sa * d - 7, 14, 14);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function drawTag(p, x, y, isLocal, isDummy) {
  if (!visible(x - 80, y - 140, 160, 60)) return;
  const ty = y - 112 - (headScale() - 1) * 24;
  ctx.textAlign = 'center';
  ctx.font = '700 15px Segoe UI, system-ui, sans-serif';
  const name = p.bot ? 'Bot' : isDummy ? 'Mannequin' : playerName(p.i);
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.65)';
  ctx.strokeText(name, x, ty);
  ctx.fillStyle = p.color;
  ctx.fillText(name, x, ty);
  if (!isLocal) {                              // petite barre de vie des adversaires
    const w = 50, k = clamp(p.hp / (p.maxHp || MAX_HP), 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x - w / 2 - 1, ty + 6, w + 2, 7);
    ctx.fillStyle = k > 0.5 ? '#5ce68a' : k > 0.25 ? '#ffd35c' : '#ff5a5a';
    ctx.fillRect(x - w / 2, ty + 7, w * k, 5);
  }
  if (!isLocal && !isDummy && p.reloading) {
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.font = '600 11px Segoe UI, sans-serif';
    ctx.fillText('recharge…', x, ty + 26);
  }
}

function drawRagdolls() {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const rd of S.ragdolls) {
    const q = rd.pts;
    const of = rd.outfit || NO_OUTFIT;
    const J = of.jacket, jc = J.id !== 'none' ? (J.c || rd.dark) : null;
    const f = q[8].x >= q[7].x ? 1 : -1;
    const a = ragdollAlpha(rd);
    if (rd.hat) {                                       // le chapeau envolé, même loin du corps
      ctx.globalAlpha = a;
      drawHat(ctx, of.hat, rd.hat.x, rd.hat.y + 10 * rd.hk, HEAD_R * rd.hk, rd.facing, rd.hat.rot);
    }
    if (!visible(q[2].x - 120, q[2].y - 120, 240, 240)) continue;
    ctx.globalAlpha = a;
    drawLeg(q[2], q[7], q[8], of.pants, rd.dark, true);
    drawShoe(ctx, of.shoes, q[8].x, q[8].y, f, true);
    drawArm(q[1], q[5], q[6], J, jc, rd.dark, true);
    drawTorso({ hip: q[2], neck: q[1] }, J, jc, rd.color, f);
    drawLeg(q[2], q[9], q[10], of.pants, rd.color, false);
    drawShoe(ctx, of.shoes, q[10].x, q[10].y, f, false);
    drawArm(q[1], q[3], q[4], J, jc, rd.color, false);
    const hr = HEAD_R * rd.hk;
    ctx.fillStyle = rd.color;
    ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(q[0].x, q[0].y, hr, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(10,14,30,.8)';                           // yeux en croix
    ctx.font = '700 ' + Math.round(9 * rd.hk) + 'px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('x x', q[0].x, q[0].y + 3 * rd.hk);
  }
  ctx.globalAlpha = 1;
}

/* ============================ ÉCLAIRAGE =============================== */
function drawLighting(time) {
  const th = G.map.theme;
  if (th === 'factory') {
    ctx.globalCompositeOperation = 'lighter';
    for (const d of G.map.deco) {
      if (d.k !== 'lamp') continue;
      const bx = d.x, by = d.y + d.len + 22;
      if (!visible(bx - 400, by, 800, 1400)) continue;
      if (!lampOn(d, time)) continue;
      const H = 1000, W = 330;
      const g = ctx.createLinearGradient(0, by, 0, by + H);
      g.addColorStop(0, 'rgba(255,225,160,.34)');
      g.addColorStop(0.45, 'rgba(255,215,140,.13)');
      g.addColorStop(1, 'rgba(255,210,130,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(bx - 26, by); ctx.lineTo(bx + 26, by);
      ctx.lineTo(bx + W, by + H); ctx.lineTo(bx - W, by + H);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.7;
      ctx.drawImage(FX.glowSprite('#ffd890'), bx - 60, by - 50, 120, 100);
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

function drawWater(time) {
  const m = G.map;
  if (!m.water || m.water > view.b) return;
  const y = m.water;
  const g = ctx.createLinearGradient(0, y, 0, y + 260);
  g.addColorStop(0, 'rgba(40,140,170,.8)');
  g.addColorStop(1, 'rgba(10,40,60,.95)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(view.l, view.b + 20);
  for (let x = Math.floor(view.l / 20) * 20; x <= view.r + 20; x += 20) {
    ctx.lineTo(x, y + Math.sin(x * 0.02 + time * 2) * 4 + Math.sin(x * 0.051 - time * 3) * 2);
  }
  ctx.lineTo(view.r + 20, view.b + 20);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(200,240,255,.5)'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = Math.floor(view.l / 20) * 20; x <= view.r + 20; x += 20) {
    const yy = y + Math.sin(x * 0.02 + time * 2) * 4 + Math.sin(x * 0.051 - time * 3) * 2;
    if (x === Math.floor(view.l / 20) * 20) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
  }
  ctx.stroke();
}

/* ============================= AMBIANCE =============================== */
/* Particules d'ambiance propres à chaque carte, générées autour de la caméra. */
let ambAcc = 0;
export function ambient(dt, time) {
  const m = G.map;
  if (!m) return;
  const low = G.quality === 'low';
  ambAcc += dt;
  if (m.theme === 'city') {
    /* pluie fine + éclaboussures (gérées par les collisions des particules) */
    const n = FX.qn((low ? 160 : 340) * dt * (cam.vw / 1600));
    for (let i = 0; i < n; i++) {
      const p = FX.spawn(FX.T.RAIN, rand(view.l - 200, view.r + 300), view.t - rand(10, 120), -170, rand(1300, 1600), 1.4, 1, '#a8c4ff');
      p.collide = true;
    }
    /* fumée des cheminées */
    for (const s of m.solids) {
      if (s.k !== 'chimney' || !visible(s.x - 100, s.y - 300, s.w + 200, 400)) continue;
      if (Math.random() < dt * 6) {
        const p = FX.spawn(FX.T.SMOKE, s.x + s.w / 2, s.y - 4, rand(-10, 10) - 30, rand(-70, -40), rand(2, 3.5), 8, '#4a4a58');
        p.grow = 12; p.a = 0.35; p.drag = 0.4;
      }
    }
    /* néons qui crachent une étincelle en grésillant */
    for (const d of m.deco) {
      if ((d.k === 'neon' || d.k === 'neonv') && visible(d.x, d.y, d.w, d.h) && Math.random() < dt * 0.5) {
        for (let k = FX.qn(6); k > 0; k--) {
          const p = FX.spawn(FX.T.SPARK, d.x + rand(0, d.w), d.y + d.h, rand(-100, 100), rand(-50, 100), 0.4, 1.4, d.c);
          p.g = 1200;
        }
      }
    }
    lightningNext -= dt;
    if (lightningNext <= 0) { lightning = 1; lightningNext = rand(14, 30); }
    lightning = Math.max(0, lightning - dt * (lightning > 0.6 ? 2 : 4));
  } else if (m.theme === 'factory') {
    /* poussière qui flotte dans les cônes de lumière */
    for (const d of m.deco) {
      if (d.k !== 'lamp') continue;
      const by = d.y + d.len + 30;
      if (!visible(d.x - 400, by, 800, 1200)) continue;
      if (Math.random() < dt * (low ? 6 : 16)) {
        const yy = by + rand(0, 1000), spread = 26 + (yy - by) * 0.27;
        const p = FX.spawn(FX.T.MOTE, d.x + rand(-spread, spread), yy, rand(-8, 8), rand(-6, 6), rand(4, 7), rand(1.5, 2.5), '#ffe6b0');
        p.a = 0.6;
      }
    }
    /* étincelles d'un câble arraché */
    for (const d of m.deco) {
      if (d.k !== 'sparker' || !visible(d.x - 200, d.y - 200, 400, 600)) continue;
      if (Math.random() < dt * 0.7) {
        for (let k = FX.qn(14); k > 0; k--) {
          const p = FX.spawn(FX.T.SPARK, d.x, d.y, rand(-250, 250), rand(-200, 50), rand(0.3, 0.8), 1.5, '#ffd66b');
          p.g = 1400; p.collide = true; p.bounce = 0.4;
        }
        FX.spawn(FX.T.GLOW, d.x, d.y, 0, 0, 0.15, 40, '#9fd0ff');
      }
    }
    if (Math.random() < dt * (low ? 2 : 5)) {
      const p = FX.spawn(FX.T.MOTE, rand(view.l, view.r), rand(view.t, view.b), rand(-5, 5), rand(-4, 4), 6, 1.5, '#8a8270');
      p.a = 0.5;
    }
  } else {
    /* feuilles qui tombent */
    if (Math.random() < dt * (low ? 2 : 6)) {
      const cols = ['#4f8a3a', '#6aa845', '#8fae3a', '#a8782e'];
      const p = FX.spawn(FX.T.LEAF, rand(view.l - 100, view.r + 100), view.t - 20, rand(-30, 30), rand(40, 80), 12, rand(5, 8), cols[Math.floor(Math.random() * 4)]);
      p.vr = rand(-3, 3); p.collide = true; p.g = 10;
    }
    /* lucioles */
    if (Math.random() < dt * (low ? 1.5 : 4)) {
      const p = FX.spawn(FX.T.FIREFLY, rand(view.l, view.r), rand(view.t, view.b), rand(-20, 20), rand(-20, 20), rand(4, 8), rand(6, 10), '#d8ff70');
      p.drag = 0.5;
    }
    for (const d of m.deco) {
      /* bruine au pied des cascades */
      if (d.k === 'waterfall' && visible(d.x - 100, m.water - 300, d.w + 200, 400) && Math.random() < dt * (low ? 8 : 25)) {
        const p = FX.spawn(FX.T.SMOKE, d.x + rand(0, d.w), m.water - rand(0, 10), rand(-60, 60), rand(-120, -40), rand(1, 2), rand(6, 12), '#dff4ff');
        p.grow = 16; p.a = 0.25; p.drag = 1.2;
      }
      /* flammes des torches */
      if (d.k === 'torch' && visible(d.x - 60, d.y - 160, 120, 160)) {
        if (Math.random() < dt * (low ? 10 : 30)) {
          const p = FX.spawn(FX.T.FIRE, d.x + rand(-4, 4), d.y - 66, rand(-15, 15), rand(-120, -60), rand(0.3, 0.6), rand(7, 11), '#ffa030');
          p.drag = 1;
        }
        if (Math.random() < dt * 2) {
          const p = FX.spawn(FX.T.EMBER, d.x, d.y - 70, rand(-40, 40), rand(-200, -80), rand(0.8, 1.5), 2.5, '#ffb040');
          p.g = -20;
        }
      }
    }
  }
}

/* ================================ RENDU =============================== */
export function render(alpha, dt, time) {
  frameDt = dt;
  const P = S.P;
  const map = G.map;
  if (!map) return;

  /* position affichée du joueur local, interpolée entre deux pas fixes */
  const lx = P ? P.px + (P.x - P.px) * alpha : map.w / 2;
  const ly = P ? P.py + (P.y - P.py) * alpha : map.h / 2;
  updateCamera(dt, lx, ly);

  /* secousses d'écran */
  G.shake = Math.max(0, G.shake - dt * SHAKE_DECAY);
  const sh = G.shake * G.shake * SHAKE_PX;
  const shx = sh ? (Math.sin(time * 71) + Math.sin(time * 43.3)) * 0.5 * sh : 0;
  const shy = sh ? (Math.sin(time * 67.7) + Math.sin(time * 39.1)) * 0.5 * sh : 0;

  cam.l = cam.x - cam.vw / 2;
  cam.t = cam.y - cam.vh / 2;
  view.l = cam.l + shx; view.t = cam.t + shy; view.r = view.l + cam.vw; view.b = view.t + cam.vh;

  drawSky(time);
  drawParallax();

  const s = cam.s;
  ctx.setTransform(s, 0, 0, s, -view.l * s, -view.t * s);

  /* ambiance « derrière » : brume de fond pour la jungle */
  for (const d of map.deco) drawDeco(d, time);
  for (const so of map.solids) drawSolid(so, time);
  for (const p of map.plats) drawPlat(p);
  drawKits(time);
  if (G.gameType === 'koth') drawHill(time);
  drawDecals();
  drawRagdolls();

  for (const d of S.dummies) if (d.alive) { drawStickman(d, d.px + (d.x - d.px) * alpha, d.py + (d.y - d.py) * alpha, time, false); }
  for (const o of S.others.values()) if (o.alive && o.seen) drawStickman(o, o.x, o.y, time, false);
  if (P && P.alive) drawStickman(P, lx, ly, time, true);

  drawProjectiles(ctx, alpha, view);
  FX.drawParticles(ctx, view, 'normal');
  FX.drawParticles(ctx, view, 'add');
  drawWater(time);
  drawLighting(time);

  for (const d of S.dummies) if (d.alive) drawTag(d, d.x, d.y, false, true);
  for (const o of S.others.values()) if (o.alive && o.seen) drawTag(o, o.x, o.y, false, false);
  if (P && P.alive) drawTag(P, lx, ly, true, false);

  /* ---- espace écran ---- */
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (!vignette) {
    vignette = ctx.createRadialGradient(cv.width / 2, cv.height / 2, Math.min(cv.width, cv.height) * 0.35,
      cv.width / 2, cv.height / 2, Math.max(cv.width, cv.height) * 0.75);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,.55)');
  }
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, cv.width, cv.height);
  if (G.hurt > 0) {
    ctx.fillStyle = 'rgba(255,30,30,' + (G.hurt * 0.3) + ')';
    ctx.fillRect(0, 0, cv.width, cv.height);
    G.hurt = Math.max(0, G.hurt - dt * 2.2);
  }
  drawHud(ctx, cv.width, cv.height, cam, view, time, lx, ly);
}
