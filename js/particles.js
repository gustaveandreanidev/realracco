/* ==========================================================================
   Particules — un seul système, pool préalloué (aucune allocation par image).

   Le pool est un anneau : quand il est plein, la particule la plus ancienne
   est recyclée. Rien ici n'est synchronisé : chaque machine produit ses
   effets à partir des événements qu'elle reçoit déjà (tirs, impacts, morts).
   ========================================================================== */
import { G, TAU, rand, clamp } from './state.js';
import { solidAt } from './physics.js';

/* ------------------------------ Réglages ------------------------------ */
export const MAX_PARTICLES = 4000;   // plafond global
const LOW_QUALITY_MULT     = 0.35;   // part des particules gardées en qualité Basse
const MAX_DECALS           = 160;    // traces d'impact persistantes
const MAX_STUCK            = 40;     // couteaux plantés dans les murs

/* Types de rendu */
export const T = {
  SPARK: 0, SMOKE: 1, GLOW: 2, CASING: 3, DEBRIS: 4, RING: 5, TEXT: 6, RAIN: 7,
  LEAF: 8, FIREFLY: 9, MOTE: 10, FIRE: 11, SPLASH: 12, EMBER: 13,
};
const ADDITIVE = [true, false, true, false, false, true, false, false, false, true, false, true, false, true];

/* --------------------------------- Pool ------------------------------- */
const pool = new Array(MAX_PARTICLES);
for (let i = 0; i < MAX_PARTICLES; i++) {
  pool[i] = {
    on: false, t: 0, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 1, grow: 0,
    color: '#fff', g: 0, drag: 0, rot: 0, vr: 0, bounce: 0, collide: false, txt: '', a: 1, seed: 0, bold: false,
  };
}
let cursor = 0;
export let liveCount = 0;

/* Multiplicateur de quantité selon la qualité choisie. */
export function qn(n) {
  const k = G.quality === 'low' ? LOW_QUALITY_MULT : 1;
  const v = n * k;
  return Math.floor(v) + (Math.random() < v - Math.floor(v) ? 1 : 0);
}

export function spawn(type, x, y, vx, vy, life, size, color) {
  cursor = (cursor + 1) % MAX_PARTICLES;
  const p = pool[cursor];
  p.on = true; p.t = type; p.x = x; p.y = y; p.vx = vx; p.vy = vy;
  p.life = life; p.max = life; p.size = size; p.grow = 0; p.color = color;
  p.g = 0; p.drag = 0; p.rot = 0; p.vr = 0; p.bounce = 0; p.collide = false; p.a = 1; p.bold = false;
  p.seed = Math.random() * 1000;
  return p;
}

/* Débogage : textes flottants actuellement affichés. */
export function activeTexts() {
  return pool.filter((p) => p.on && p.t === T.TEXT).map((p) => p.txt);
}

export function clearParticles() {
  for (const p of pool) p.on = false;
  decals.length = 0; stuck.length = 0;
}

/* ------------------------------- Décalques ---------------------------- */
export const decals = [];   // { x, y, r, a, c }
export const stuck = [];    // couteaux plantés { x, y, rot, t }
export function addDecal(x, y, r, c) {
  if (decals.length >= MAX_DECALS) decals.shift();
  decals.push({ x: x, y: y, r: r, a: Math.random() * TAU, c: c });
}
export function addStuck(x, y, rot) {
  if (stuck.length >= MAX_STUCK) stuck.shift();
  stuck.push({ x: x, y: y, rot: rot, t: 0 });
}

/* ------------------------------ Mise à jour --------------------------- */
export function updateParticles(dt) {
  let n = 0;
  const plats = G.map ? G.map.plats : null;
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const p = pool[i];
    if (!p.on) continue;
    p.life -= dt;
    if (p.life <= 0) { p.on = false; continue; }
    n++;
    const ox = p.x, oy = p.y;
    p.vy += p.g * dt;
    if (p.drag) { const k = Math.max(0, 1 - p.drag * dt); p.vx *= k; p.vy *= k; }
    if (p.t === T.LEAF) p.vx += Math.sin(p.life * 3 + p.seed) * 60 * dt;
    if (p.t === T.FIREFLY) {
      p.vx += Math.sin(p.life * 1.7 + p.seed) * 40 * dt;
      p.vy += Math.cos(p.life * 1.3 + p.seed * 2) * 40 * dt;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    p.size += p.grow * dt;
    if (p.size < 0) p.size = 0;

    /* Collisions simples pour douilles, débris, pluie et feuilles. */
    if (p.collide && G.map) {
      if (solidAt(p.x, p.y)) {
        if (p.t === T.RAIN) { rainSplash(ox, oy); p.on = false; continue; }
        if (!solidAt(ox, p.y)) { p.x = ox; p.vx = -p.vx * p.bounce; }
        else { p.y = oy; p.vy = -p.vy * p.bounce; p.vx *= 0.6; }
        p.vr *= 0.5;
        if (p.t === T.LEAF) { p.vx = 0; p.vy = 0; p.g = 0; p.vr = 0; }
      } else if (p.vy > 0 && plats) {
        for (let j = 0; j < plats.length; j++) {
          const q = plats[j];
          if (q.dead) continue;
          if (p.x >= q.x && p.x <= q.x + q.w && oy <= q.y && p.y >= q.y) {
            if (p.t === T.RAIN) { rainSplash(p.x, q.y - 1); p.on = false; break; }
            p.y = q.y - 0.5; p.vy = -p.vy * p.bounce; p.vx *= 0.6; p.vr *= 0.5;
            if (p.t === T.LEAF) { p.vx = 0; p.vy = 0; p.g = 0; p.vr = 0; }
            break;
          }
        }
        if (!p.on) continue;
      }
      if (G.map.water && p.y > G.map.water && oy <= G.map.water) {
        if (p.t === T.RAIN || p.t === T.LEAF) { rainSplash(p.x, G.map.water); p.on = false; continue; }
      }
    }
  }
  liveCount = n;
  for (const k of stuck) k.t += dt;
}

/* ---------------------------------- Rendu ----------------------------- */
/* Halo lumineux précalculé par couleur (bien plus rapide qu'un dégradé
   par particule ou que shadowBlur). */
const glowCache = new Map();
export function glowSprite(color) {
  let c = glowCache.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, color);
  gr.addColorStop(0.25, color);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.globalAlpha = 1;
  g.fillRect(0, 0, 64, 64);
  /* cœur blanc */
  const gw = g.createRadialGradient(32, 32, 0, 32, 32, 12);
  gw.addColorStop(0, 'rgba(255,255,255,0.9)');
  gw.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gw;
  g.fillRect(0, 0, 64, 64);
  glowCache.set(color, c);
  return c;
}
/* Disque doux sans cœur blanc, pour la fumée et la poussière. */
const softCache = new Map();
function softSprite(color) {
  let c = softCache.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 48;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(24, 24, 0, 24, 24, 24);
  gr.addColorStop(0, color);
  gr.addColorStop(0.55, color);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 48, 48);
  softCache.set(color, c);
  return c;
}
const FIRE_COLORS = ['#fff3b0', '#ffd24a', '#ff9a2a', '#ff5a1f', '#b8321a', '#5a2a22'];

/* Dessine les particules visibles. view = { l, t, r, b } en coordonnées monde. */
export function drawParticles(ctx, view, pass) {
  const additive = pass === 'add';
  if (additive) ctx.globalCompositeOperation = 'lighter';
  const l = view.l - 60, t = view.t - 60, r = view.r + 60, b = view.b + 60;
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const p = pool[i];
    if (!p.on || ADDITIVE[p.t] !== additive) continue;
    if (p.x < l || p.x > r || p.y < t || p.y > b) continue;
    const k = p.life / p.max;
    switch (p.t) {
      case T.SPARK: {
        ctx.globalAlpha = k;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.025, p.y - p.vy * 0.025);
        ctx.stroke();
        break;
      }
      case T.SMOKE: {
        /* sprite doux précalculé : bien moins coûteux qu'un arc par bouffée */
        ctx.globalAlpha = k * p.a;
        const s = p.size * 1.35;
        ctx.drawImage(softSprite(p.color), p.x - s, p.y - s, s * 2, s * 2);
        break;
      }
      case T.GLOW: case T.EMBER: {
        ctx.globalAlpha = (p.t === T.EMBER ? Math.min(1, k * 2) : k) * p.a;
        const s = p.size * (p.t === T.EMBER ? 1 : (0.4 + 0.6 * k));
        ctx.drawImage(glowSprite(p.color), p.x - s, p.y - s, s * 2, s * 2);
        break;
      }
      case T.FIRE: {
        const ci = clamp(Math.floor((1 - k) * FIRE_COLORS.length), 0, FIRE_COLORS.length - 1);
        ctx.globalAlpha = Math.min(1, k * 1.6) * p.a;
        const s = p.size * (0.5 + (1 - k) * 0.9);
        ctx.drawImage(glowSprite(FIRE_COLORS[ci]), p.x - s, p.y - s, s * 2, s * 2);
        break;
      }
      case T.FIREFLY: {
        const blink = 0.5 + 0.5 * Math.sin(p.life * 5 + p.seed);
        ctx.globalAlpha = Math.min(1, k * 3) * blink;
        const s = p.size;
        ctx.drawImage(glowSprite(p.color), p.x - s, p.y - s, s * 2, s * 2);
        break;
      }
      case T.DEBRIS: {
        /* éclat : largeur qui oscille avec la rotation, sans save/restore */
        ctx.globalAlpha = Math.min(1, k * 3);
        ctx.fillStyle = p.color;
        const w = p.size * (0.4 + 0.6 * Math.abs(Math.cos(p.rot)));
        ctx.fillRect(p.x - w / 2, p.y - p.size * 0.35, w, p.size * 0.7);
        break;
      }
      case T.CASING: {
        ctx.globalAlpha = Math.min(1, k * 3);
        ctx.fillStyle = p.color;
        const c = Math.cos(p.rot), s = Math.sin(p.rot), L = p.size, Wd = p.size * 0.45;
        ctx.beginPath();
        ctx.moveTo(p.x - c * L + s * Wd, p.y - s * L - c * Wd);
        ctx.lineTo(p.x + c * L + s * Wd, p.y + s * L - c * Wd);
        ctx.lineTo(p.x + c * L - s * Wd, p.y + s * L + c * Wd);
        ctx.lineTo(p.x - c * L - s * Wd, p.y - s * L + c * Wd);
        ctx.fill();
        break;
      }
      case T.RING: {
        ctx.globalAlpha = k * k * p.a;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3 + 10 * k;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.stroke();
        break;
      }
      case T.TEXT: {
        ctx.globalAlpha = Math.min(1, k * 2.5);
        const pop = 1 + Math.max(0, (k - 0.8) * 2.5);
        ctx.font = (p.bold ? '900 ' : '800 ') + Math.round(p.size * pop) + 'px Segoe UI, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = p.bold ? 5 : 4;
        ctx.strokeStyle = 'rgba(0,0,0,.75)';
        ctx.strokeText(p.txt, p.x, p.y);
        ctx.fillStyle = p.color;
        ctx.fillText(p.txt, p.x, p.y);
        break;
      }
      case T.RAIN: {
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.022, p.y - p.vy * 0.022);
        ctx.stroke();
        break;
      }
      case T.LEAF: {
        ctx.globalAlpha = Math.min(1, k * 4) * 0.9;
        ctx.fillStyle = p.color;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.abs(Math.sin(p.rot * 0.7)) * 0.7 + 0.3);
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * 0.45, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
        break;
      }
      case T.MOTE: {
        ctx.globalAlpha = Math.min(1, k * 3, (1 - k) * 3) * p.a;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size, p.size);
        break;
      }
      case T.SPLASH: {
        ctx.globalAlpha = k * 0.8;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        break;
      }
    }
  }
  ctx.globalAlpha = 1;
  if (additive) ctx.globalCompositeOperation = 'source-over';
}

/* =============================== ÉMETTEURS ============================= */

/* Tir : éclair de bouche, étincelles, fumée qui s'échappe du canon. */
export function muzzleFx(x, y, a, size, color) {
  const ca = Math.cos(a), sa = Math.sin(a);
  let p = spawn(T.GLOW, x + ca * 6, y + sa * 6, 0, 0, 0.07, 26 * size, '#ffd27a');
  p = spawn(T.GLOW, x + ca * 4, y + sa * 4, 0, 0, 0.05, 14 * size, color);
  for (let i = qn(5 * size); i > 0; i--) {
    const aa = a + rand(-0.35, 0.35), sp = rand(300, 800);
    p = spawn(T.SPARK, x, y, Math.cos(aa) * sp, Math.sin(aa) * sp, rand(0.05, 0.14), 1.6, '#ffe7a0');
  }
  for (let i = qn(3 * size); i > 0; i--) {
    p = spawn(T.SMOKE, x + ca * 8, y + sa * 8, ca * rand(30, 90) + rand(-15, 15), sa * rand(30, 90) - rand(10, 40),
      rand(0.5, 1.1), rand(4, 8) * size, '#9a9aa4');
    p.grow = 14; p.drag = 2.2; p.a = 0.28; p.g = -40;
  }
}

/* Douille éjectée : rebondit sur le sol et reste un moment. */
export function casingFx(x, y, facing, big) {
  if (G.quality === 'low' && Math.random() < 0.5) return;
  const p = spawn(T.CASING, x, y, -facing * rand(80, 200), rand(-380, -220), rand(3, 5), big ? 3.2 : 2.3,
    big ? '#c95c2a' : '#e2b04a');
  p.g = 1800; p.collide = true; p.bounce = 0.42; p.vr = rand(-30, 30); p.drag = 0.3;
}

/* Impact sur le décor, selon le matériau. */
export function impactFx(x, y, mat, strong) {
  const s = strong ? 1.8 : 1;
  if (mat === 'metal') {
    for (let i = qn(8 * s); i > 0; i--) {
      const a = rand(0, TAU), sp = rand(200, 650);
      const p = spawn(T.SPARK, x, y, Math.cos(a) * sp, Math.sin(a) * sp - 100, rand(0.15, 0.4), 1.6, '#ffd66b');
      p.g = 1200;
    }
    spawn(T.GLOW, x, y, 0, 0, 0.1, 16, '#ffb040');
    addDecal(x, y, 2.5, 'rgba(20,20,24,.7)');
  } else {
    const col = mat === 'wood' ? '#8a6038' : mat === 'brick' ? '#8d4a3c' : mat === 'stone' ? '#8f8a78' : '#9a9aa2';
    for (let i = qn(6 * s); i > 0; i--) {
      const a = rand(0, TAU), sp = rand(80, 360);
      const p = spawn(T.DEBRIS, x, y, Math.cos(a) * sp, Math.sin(a) * sp - 150, rand(0.5, 1.2), rand(2, 4), col);
      p.g = 1500; p.vr = rand(-20, 20); p.collide = true; p.bounce = 0.3;
    }
    for (let i = qn(3 * s); i > 0; i--) {
      const p = spawn(T.SMOKE, x, y, rand(-40, 40), rand(-60, -10), rand(0.4, 0.9), rand(3, 6), '#b8b2a4');
      p.grow = 16; p.drag = 3; p.a = 0.3;
    }
    for (let i = qn(2); i > 0; i--) {
      const p = spawn(T.SPARK, x, y, rand(-200, 200), rand(-300, -50), 0.12, 1.2, '#ffe0a0');
      p.g = 900;
    }
    addDecal(x, y, 3.2, 'rgba(15,12,10,.6)');
  }
}

/* Touche sur un joueur : éclats de sa couleur + chiffre de dégâts. */
export function hitFx(x, y, color, dmg, hs) {
  for (let i = qn(hs ? 16 : 9); i > 0; i--) {
    const a = rand(0, TAU), sp = rand(100, 420);
    const p = spawn(T.DEBRIS, x, y, Math.cos(a) * sp, Math.sin(a) * sp - 120, rand(0.4, 0.9), rand(2, 4), color);
    p.g = 1400; p.vr = rand(-20, 20);
  }
  spawn(T.GLOW, x, y, 0, 0, 0.12, hs ? 30 : 18, color);
  if (dmg > 0) damageNumber(x, y - 20, dmg, hs);
}
export function damageNumber(x, y, dmg, hs) {
  const p = spawn(T.TEXT, x + rand(-10, 10), y, rand(-40, 40), hs ? -260 : -200, hs ? 1.1 : 0.85, hs ? 34 : 22,
    hs ? '#ffcf3d' : '#ffffff');
  p.txt = hs ? Math.round(dmg) + '!' : String(Math.round(dmg));
  p.drag = 2.4;
}

/* Texte de kill : comme un chiffre de dégâts, en rouge, plus gras et un peu plus grand. */
export function killTextFx(x, y, txt) {
  const p = spawn(T.TEXT, x, y, 0, -170, 1.3, 28, '#ff2a2a');
  p.txt = txt; p.drag = 2; p.bold = true;
}

/* Explosion : flash, boule de feu, onde de choc, débris, fumée, braises. */
export function explosionFx(x, y, r) {
  let p = spawn(T.GLOW, x, y, 0, 0, 0.18, r * 2.4, '#fff1c2');
  p = spawn(T.RING, x, y, 0, 0, 0.45, 10, '#ffd8a0'); p.grow = r * 2.8;
  p = spawn(T.RING, x, y, 0, 0, 0.3, 6, '#ffffff'); p.grow = r * 4; p.a = 0.5;
  for (let i = qn(34); i > 0; i--) {
    const a = rand(0, TAU), sp = rand(40, r * 3.2);
    p = spawn(T.FIRE, x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.35, 0.8), rand(14, 28), '#ffa030');
    p.drag = 4.5; p.g = -220;
  }
  for (let i = qn(22); i > 0; i--) {
    const a = rand(0, TAU), sp = rand(300, 900);
    p = spawn(T.DEBRIS, x, y, Math.cos(a) * sp, Math.sin(a) * sp - 250, rand(0.8, 2), rand(3, 7), i % 3 ? '#3b3530' : '#6a5a4a');
    p.g = 1600; p.vr = rand(-25, 25); p.collide = true; p.bounce = 0.35;
  }
  for (let i = qn(20); i > 0; i--) {
    const a = rand(0, TAU), sp = rand(20, r * 1.4);
    p = spawn(T.SMOKE, x + Math.cos(a) * 20, y + Math.sin(a) * 20, Math.cos(a) * sp, Math.sin(a) * sp - 40,
      rand(1.4, 3), rand(14, 26), i % 2 ? '#3a3634' : '#56514c');
    p.grow = 22; p.drag = 2.2; p.g = -70; p.a = 0.55;
  }
  for (let i = qn(26); i > 0; i--) {
    const a = rand(0, TAU), sp = rand(200, 700);
    p = spawn(T.EMBER, x, y, Math.cos(a) * sp, Math.sin(a) * sp - 200, rand(0.6, 1.6), rand(3, 5), '#ffb040');
    p.g = 700; p.drag = 1.2;
  }
  addDecal(x, y, 26, 'rgba(10,8,8,.55)');
}

/* Traînées */
export function rocketTrail(x, y, vx, vy) {
  let p = spawn(T.FIRE, x + rand(-2, 2), y + rand(-2, 2), -vx * 0.08 + rand(-30, 30), -vy * 0.08 + rand(-30, 30),
    rand(0.15, 0.3), rand(7, 11), '#ff9a2a');
  p.drag = 3;
  if (Math.random() < (G.quality === 'low' ? 0.3 : 0.9)) {
    p = spawn(T.SMOKE, x, y, rand(-20, 20), rand(-30, 0), rand(0.8, 1.6), rand(5, 8), '#77716a');
    p.grow = 20; p.drag = 1.6; p.a = 0.4; p.g = -30;
  }
}
export function grenadeTrail(x, y) {
  if (Math.random() < 0.5) return;
  const p = spawn(T.SMOKE, x, y, rand(-10, 10), rand(-20, 0), 0.4, 2.5, '#8a8a8a');
  p.grow = 8; p.a = 0.3;
}
export function fuseSpark(x, y) {
  spawn(T.GLOW, x, y, 0, 0, 0.08, 10, '#ff4030');
  const p = spawn(T.SPARK, x, y, rand(-120, 120), rand(-200, -40), 0.12, 1.2, '#ffcf60');
  p.g = 800;
}
export function knifeTrail(x, y, color) {
  const p = spawn(T.GLOW, x, y, 0, 0, 0.14, 5, color);
  p.a = 0.6;
}
export function knifeStickFx(x, y) {
  for (let i = qn(7); i > 0; i--) {
    const a = rand(0, TAU), sp = rand(150, 450);
    const p = spawn(T.SPARK, x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.08, 0.2), 1.4, '#fff2c0');
    p.g = 900;
  }
}
export function sniperTracer(x0, y0, x1, y1, color) {
  const n = Math.min(30, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 40));
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const p = spawn(T.GLOW, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 0, 0, 0.12 + t * 0.1, 5, color);
    p.a = 0.5;
  }
}

/* Déplacements */
export function landDust(x, y, strength) {
  const n = qn(4 + strength * 14);
  for (let i = 0; i < n; i++) {
    const dir = i % 2 ? 1 : -1;
    const p = spawn(T.SMOKE, x + dir * rand(0, 10), y - 2, dir * rand(60, 200) * (0.5 + strength), rand(-50, -5),
      rand(0.35, 0.7), rand(3, 6), '#a9a39a');
    p.grow = 12; p.drag = 4; p.a = 0.4;
  }
}
export function jumpPuff(x, y) {
  for (let i = qn(8); i > 0; i--) {
    const a = rand(0, TAU);
    const p = spawn(T.SMOKE, x + Math.cos(a) * 8, y + Math.sin(a) * 3, Math.cos(a) * 120, Math.sin(a) * 40 + 40,
      0.4, 4, '#dfe6ff');
    p.grow = 10; p.drag = 5; p.a = 0.45;
  }
  const r = spawn(T.RING, x, y, 0, 0, 0.25, 6, '#dfe6ff'); r.grow = 90; r.a = 0.35;
}
export function footPuff(x, y) {
  const p = spawn(T.SMOKE, x, y - 2, rand(-30, 30), rand(-30, -5), 0.35, 2.5, '#a9a39a');
  p.grow = 8; p.drag = 4; p.a = 0.3;
}

/* Dash : bouffée d'air au départ + traînée de silhouettes lumineuses. */
export function dashFx(x, y, dir, color) {
  for (let i = qn(10); i > 0; i--) {
    const p = spawn(T.SMOKE, x - dir * rand(0, 10), y - rand(5, 70), -dir * rand(80, 260), rand(-40, 40), rand(0.3, 0.5), rand(4, 7), '#dfe6ff');
    p.grow = 14; p.drag = 5; p.a = 0.45;
  }
  const r = spawn(T.RING, x, y - 42, 0, 0, 0.25, 10, color); r.grow = 160; r.a = 0.5;
}
export function dashTrail(x, y, color) {
  for (let k = 0; k < 3; k++) {
    const p = spawn(T.GLOW, x + rand(-6, 6), y - 12 - k * 26, 0, 0, 0.22, 16, color);
    p.a = 0.45;
  }
  if (Math.random() < 0.5) {
    const p = spawn(T.SPARK, x, y - rand(10, 70), rand(-60, 60), rand(-30, 30), 0.15, 1.5, '#ffffff');
    p.a = 0.6;
  }
}

/* Glissade : gerbe de poussière au départ, traînée au ras du sol. */
export function slideFx(x, y, dir) {
  for (let i = qn(12); i > 0; i--) {
    const p = spawn(T.SMOKE, x - dir * rand(0, 16), y - rand(0, 8), -dir * rand(60, 260), rand(-90, -10), rand(0.35, 0.7), rand(4, 7), '#b8b0a4');
    p.grow = 14; p.drag = 4; p.a = 0.45;
  }
  for (let i = qn(6); i > 0; i--) {
    const p = spawn(T.SPARK, x, y - 2, -dir * rand(150, 400), rand(-200, -40), rand(0.1, 0.25), 1.4, '#ffe0a0');
    p.g = 1200;
  }
}
export function slideTrail(x, y) {
  if (Math.random() < 0.4) return;
  const p = spawn(T.SMOKE, x + rand(-4, 4), y - 2, rand(-30, 30), rand(-40, -5), rand(0.3, 0.5), rand(3, 5), '#b8b0a4');
  p.grow = 12; p.drag = 3; p.a = 0.35;
  if (Math.random() < 0.3) {
    const q = spawn(T.SPARK, x, y - 1, rand(-120, 120), rand(-120, -20), 0.15, 1.2, '#ffd680');
    q.g = 1000;
  }
}

/* ---- Lance-flammes ---- */
export function flameTrail(x, y, k) {
  for (let i = Math.random() < 0.5 ? 2 : 1; i > 0; i--) {
    const q = spawn(T.FIRE, x + rand(-10, 10), y + rand(-10, 10), rand(-40, 40), rand(-110, -30), rand(0.25, 0.45), rand(10, 16) + k * 16, '#ffa030');
    q.drag = 2;
  }
  if (k > 0.6 && Math.random() < 0.25) {
    const p = spawn(T.SMOKE, x, y, rand(-20, 20), rand(-80, -30), rand(0.6, 1.1), rand(6, 10), '#3a3430');
    p.grow = 18; p.a = 0.35; p.drag = 1.5;
  }
}
export function flameLick(x, y) {
  for (let i = qn(3); i > 0; i--) {
    const p = spawn(T.FIRE, x + rand(-8, 8), y + rand(-8, 8), rand(-80, 80), rand(-160, -40), rand(0.25, 0.5), rand(8, 14), '#ff9a2a');
    p.drag = 3;
  }
  addDecal(x, y, 2, 'rgba(20,10,5,.35)');
}
export function steamFx(x, y) {
  const p = spawn(T.SMOKE, x, y - 4, rand(-20, 20), rand(-90, -40), rand(0.6, 1), 7, '#e8f0f4');
  p.grow = 16; p.a = 0.4; p.drag = 1.5;
}
/* Joueur en feu : flammes qui lèchent le corps. */
export function burnFx(x, y) {
  const p = spawn(T.FIRE, x + rand(-12, 12), y - rand(10, 80), rand(-20, 20), rand(-140, -60), rand(0.25, 0.5), rand(8, 13), '#ffa030');
  p.drag = 1.5;
  if (Math.random() < 0.3) {
    const q = spawn(T.SMOKE, x + rand(-8, 8), y - rand(60, 90), rand(-10, 10), rand(-70, -30), 0.9, 6, '#3a3430');
    q.grow = 14; q.a = 0.3;
  }
}

/* ---- Railgun ---- */
export function railFx(x, y, a, color) {
  spawn(T.GLOW, x, y, 0, 0, 0.15, 60, color);
  const r = spawn(T.RING, x, y, 0, 0, 0.3, 8, '#e8fbff'); r.grow = 160; r.a = 0.7;
  for (let i = qn(16); i > 0; i--) {
    const aa = a + rand(-0.6, 0.6), sp = rand(200, 900);
    const p = spawn(T.SPARK, x, y, Math.cos(aa) * sp, Math.sin(aa) * sp, rand(0.1, 0.3), 1.6, i % 2 ? color : '#e8fbff');
    p.g = 300;
  }
}
/* Recharge du railgun : étincelles aspirées vers la bouche. */
export function railCharge(x, y, k, color) {
  if (Math.random() > 0.35 + k * 0.6) return;
  const a = rand(0, TAU), d = rand(20, 50) * (1.2 - k);
  const p = spawn(T.GLOW, x + Math.cos(a) * d, y + Math.sin(a) * d, -Math.cos(a) * d * 5, -Math.sin(a) * d * 5, 0.18, 4 + k * 4, color);
  p.a = 0.8;
}

/* ---- Boomerang ---- */
export function catchFx(x, y, color) {
  const r = spawn(T.RING, x, y, 0, 0, 0.25, 6, color); r.grow = 90; r.a = 0.6;
  spawn(T.GLOW, x, y, 0, 0, 0.15, 24, '#ffffff');
}

/* ---- Katana ---- */
/* « SHHHINNG! » : texte flottant vu par tous + éclair de la lame. */
export function shingFx(x, y, a, color) {
  const t = spawn(T.TEXT, x + rand(-6, 6), y - 50, rand(-20, 20), -150, 0.9, 24, '#dff8ff');
  t.txt = 'SHHHINNG!'; t.bold = true; t.drag = 2.6;
  spawn(T.GLOW, x, y, 0, 0, 0.12, 50, '#ffffff');
  for (let i = qn(12); i > 0; i--) {
    const aa = a + rand(-1, 1), sp = rand(300, 900);
    const p = spawn(T.SPARK, x, y, Math.cos(aa) * sp, Math.sin(aa) * sp, rand(0.08, 0.2), 1.5, i % 3 ? '#ffffff' : color);
    p.drag = 3;
  }
}
export function waveTrail(x, y, vx, vy, color) {
  if (Math.random() < 0.4) return;
  const a = Math.atan2(vy, vx) + rand(-1, 1);
  const p = spawn(T.SPARK, x - Math.cos(a) * 20, y - Math.sin(a) * 20, -vx * 0.15 + rand(-60, 60), -vy * 0.15 + rand(-60, 60), 0.15, 1.3, color);
  p.a = 0.7;
}
export function waveHitFx(x, y, color) {
  for (let i = qn(10); i > 0; i--) {
    const a = rand(0, TAU), sp = rand(150, 500);
    const p = spawn(T.SPARK, x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.1, 0.25), 1.5, i % 2 ? '#ffffff' : color);
    p.g = 600;
  }
  addDecal(x, y, 2.5, 'rgba(10,10,15,.5)');
}

/* Mort : explosion de particules de la couleur du joueur. */
export function deathFx(x, y, color) {
  for (let i = qn(40); i > 0; i--) {
    const a = rand(0, TAU), sp = rand(120, 700);
    const p = spawn(i % 3 ? T.DEBRIS : T.SPARK, x, y, Math.cos(a) * sp, Math.sin(a) * sp - 200, rand(0.6, 1.4),
      rand(2, 5), color);
    p.g = 1300; p.vr = rand(-20, 20); p.collide = i % 3 !== 0; p.bounce = 0.4;
  }
  let p = spawn(T.GLOW, x, y, 0, 0, 0.35, 90, color);
  p = spawn(T.RING, x, y, 0, 0, 0.4, 10, color); p.grow = 260;
}

/* Réapparition : colonne de lumière + anneau qui se forme. */
export function spawnFx(x, y, color) {
  for (let i = qn(30); i > 0; i--) {
    const p = spawn(T.GLOW, x + rand(-14, 14), y - rand(0, 20), 0, -rand(200, 700), rand(0.3, 0.7), rand(6, 12), color);
    p.drag = 1;
  }
  let p = spawn(T.RING, x, y - 42, 0, 0, 0.5, 120, color); p.grow = -220;
  p = spawn(T.GLOW, x, y - 42, 0, 0, 0.5, 80, color);
}

/* Soin : particules vertes qui montent. */
export function healFx(x, y) {
  for (let i = qn(26); i > 0; i--) {
    const p = spawn(T.GLOW, x + rand(-22, 22), y - rand(0, 80), rand(-10, 10), -rand(60, 160), rand(0.6, 1.2), rand(4, 8), '#5cff8a');
    p.drag = 0.8;
  }
  const r = spawn(T.RING, x, y - 42, 0, 0, 0.5, 20, '#5cff8a'); r.grow = 120;
}

export function rainSplash(x, y) {
  for (let i = G.quality === 'low' ? 1 : 2; i > 0; i--) {
    const p = spawn(T.SPLASH, x, y - 1, rand(-80, 80), rand(-160, -60), 0.25, 1.6, '#9fc2ff');
    p.g = 900;
  }
}
export function waterSplash(x, y, big) {
  for (let i = qn(big ? 40 : 12); i > 0; i--) {
    const p = spawn(T.SPLASH, x + rand(-10, 10), y, rand(-200, 200), rand(-600, -150) * (big ? 1 : 0.6), rand(0.5, 1), rand(2, 4), '#bfe8ff');
    p.g = 1500;
  }
  const r = spawn(T.RING, x, y, 0, 0, 0.6, 10, '#bfe8ff'); r.grow = 160; r.a = 0.5;
}
