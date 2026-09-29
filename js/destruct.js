/* ==========================================================================
   Décor destructible : caisses, barils explosifs, climatiseurs, vitres,
   rochers, jarres, ponts de planches.

   Synchronisation (même esprit que « la victime arbitre ») :
     · seule la machine du TIREUR décide des dégâts de ses propres tirs et
       explosions sur le décor, et les diffuse (message `dh`) ;
     · toutes les machines appliquent les mêmes messages, dans le même ordre
       de relais : les PV convergent, et chacune casse l'objet au même moment
       (effondrement des caisses empilées et explosion des barils compris) ;
     · l'hôte seul décide de la reconstruction (message `dr`), et attend
       qu'aucun joueur ne se trouve à l'emplacement.
   ========================================================================== */
import { G, S, DEST_RESPAWN, TAU, rand } from './state.js';
import { PHYS } from './physics.js';
import * as FX from './particles.js';
import { send } from './net.js';
import { explode } from './weapons.js';

/* Remise à neuf de tout le décor (début de manche). */
export function resetDest(map) {
  for (const o of map.dest) {
    o.hp = o.hp0; o.dead = false; o.gen = 0; o.respawnAt = 0; o.hitT = 0; o.lastBy = -1;
  }
}

/* Dégâts décidés ici (mon tir ou mon explosion) : appliqués puis diffusés. */
export function damageDest(o, dmg, x, y) {
  if (!o || o.dead || dmg <= 0) return;
  dmg = Math.max(1, Math.round(dmg));
  if (G.role !== 'solo') send({ t: 'dh', i: o.di, d: dmg, g: o.gen, x: Math.round(x), y: Math.round(y) });
  applyDestDamage(o.di, dmg, G.slot, o.gen, x, y);
}

/* Application d'un dégât (le mien ou reçu du réseau). */
export function applyDestDamage(i, dmg, by, gen, x, y) {
  const o = G.map && G.map.dest[i];
  if (!o || o.dead || gen !== o.gen) return;       // message d'une version déjà détruite
  o.hp -= dmg;
  o.hitT = 0.14;
  o.lastBy = by;
  if (o.hp <= 0) breakDest(o, by, x, y);
}

function breakDest(o, by, hx, hy) {
  o.dead = true;
  o.hp = 0;
  o.respawnAt = G.time + DEST_RESPAWN;
  const cx = o.x + o.w / 2, cy = o.y + (o.h || 10) / 2;
  breakFx(o, cx, cy, hx === undefined ? cx : hx, hy === undefined ? cy : hy);
  /* ce qui était planté ou collé dessus disparaît avec lui */
  const h = o.h || 12;
  for (let k = FX.stuck.length - 1; k >= 0; k--) {
    const s = FX.stuck[k];
    if (s.x > o.x - 20 && s.x < o.x + o.w + 20 && s.y > o.y - 20 && s.y < o.y + h + 20) FX.stuck.splice(k, 1);
  }
  for (let k = FX.decals.length - 1; k >= 0; k--) {
    const d = FX.decals[k];
    if (d.x > o.x - 4 && d.x < o.x + o.w + 4 && d.y > o.y - 4 && d.y < o.y + h + 4) FX.decals.splice(k, 1);
  }
  /* baril : il explose (le kill revient à celui qui l'a fait sauter) */
  if (o.k === 'barrel') explode(cx, cy, by, 'barrel', 'brl' + o.di + '.' + o.gen);
  /* caisses empilées : celles posées dessus s'effondrent aussi */
  if (o.k === 'crate') {
    for (const q of G.map.dest) {
      if (q.dead || q === o || q.k !== 'crate') continue;
      if (Math.abs(q.y + q.h - o.y) < 2 && q.x < o.x + o.w && q.x + q.w > o.x) breakDest(q, by);
    }
  }
}

/* Effets de destruction, selon la matière. */
function breakFx(o, cx, cy, hx, hy) {
  const h = o.h || 12;
  const dirx = Math.sign(cx - hx) || (Math.random() < 0.5 ? -1 : 1);
  const n = (base) => FX.qn(base * Math.min(2.5, (o.w * h) / 2500 + 0.6));
  switch (o.k) {
    case 'crate': case 'plank': {
      for (let i = n(18); i > 0; i--) {
        const p = FX.spawn(FX.T.DEBRIS, o.x + Math.random() * o.w, o.y + Math.random() * h,
          dirx * rand(40, 320) + rand(-120, 120), rand(-520, -120), rand(1.5, 3), rand(5, 11),
          i % 3 ? '#8a6038' : '#6a4526');
        p.g = 1600; p.vr = rand(-14, 14); p.collide = true; p.bounce = 0.3;
      }
      dust(o, cx, cy, '#b8a07a', 10);
      break;
    }
    case 'barrel':
      for (let i = n(10); i > 0; i--) {
        const p = FX.spawn(FX.T.DEBRIS, cx, cy, rand(-500, 500), rand(-700, -200), rand(1.2, 2.4), rand(5, 9), i % 2 ? '#b32a22' : '#3a3a40');
        p.g = 1600; p.vr = rand(-20, 20); p.collide = true; p.bounce = 0.35;
      }
      break;
    case 'ac':
      for (let i = n(14); i > 0; i--) {
        const p = FX.spawn(FX.T.DEBRIS, o.x + Math.random() * o.w, o.y + Math.random() * h,
          rand(-260, 260), rand(-500, -150), rand(1.2, 2.5), rand(4, 8), i % 2 ? '#6b7384' : '#3d4350');
        p.g = 1600; p.vr = rand(-18, 18); p.collide = true; p.bounce = 0.4;
      }
      for (let i = FX.qn(18); i > 0; i--) {
        const p = FX.spawn(FX.T.SPARK, cx, cy, rand(-500, 500), rand(-600, -100), rand(0.2, 0.6), 1.6, '#ffd66b');
        p.g = 1300;
      }
      dust(o, cx, cy, '#4a4a52', 12);
      break;
    case 'glass':
      for (let i = n(30); i > 0; i--) {
        const p = FX.spawn(FX.T.DEBRIS, o.x + Math.random() * o.w, o.y + Math.random() * h,
          dirx * rand(60, 380) + rand(-60, 60), rand(-300, 50), rand(0.8, 1.8), rand(2, 5), i % 3 ? '#bfe6ff' : '#ffffff');
        p.g = 1500; p.vr = rand(-30, 30); p.collide = true; p.bounce = 0.25;
      }
      FX.spawn(FX.T.GLOW, cx, cy, 0, 0, 0.2, 40, '#bfe6ff');
      break;
    case 'rock': case 'urn': {
      const cols = o.k === 'urn' ? ['#b0613a', '#8a4526', '#d98b5a'] : ['#7a7a6a', '#5d5d50', '#8f8a78'];
      for (let i = n(o.k === 'urn' ? 16 : 22); i > 0; i--) {
        const p = FX.spawn(FX.T.DEBRIS, o.x + Math.random() * o.w, o.y + Math.random() * h,
          rand(-300, 300), rand(-520, -120), rand(1.2, 2.6), rand(4, o.k === 'urn' ? 7 : 11), cols[i % 3]);
        p.g = 1600; p.vr = rand(-16, 16); p.collide = true; p.bounce = 0.3;
      }
      dust(o, cx, cy, o.k === 'urn' ? '#c9a07a' : '#a8a290', 14);
      break;
    }
  }
}
function dust(o, cx, cy, color, count) {
  for (let i = FX.qn(count); i > 0; i--) {
    const a = rand(0, TAU);
    const p = FX.spawn(FX.T.SMOKE, cx + Math.cos(a) * o.w * 0.4, cy + Math.sin(a) * 10, Math.cos(a) * rand(40, 160), rand(-120, -20), rand(0.8, 1.6), rand(8, 14), color);
    p.grow = 16; p.drag = 2.5; p.a = 0.45;
  }
}

/* Les explosions abîment le décor proche : c'est la machine du propriétaire
   de l'explosion qui le décide. */
export function blastDest(x, y, r, dmg) {
  if (!G.map) return;
  for (const o of G.map.dest) {
    if (o.dead) continue;
    const h = o.h || 12;
    const cx = Math.max(o.x, Math.min(x, o.x + o.w)), cy = Math.max(o.y, Math.min(y, o.y + h));
    const d = Math.hypot(x - cx, y - cy);
    if (d >= r) continue;
    damageDest(o, dmg * (1 - 0.7 * d / r), cx, cy);
  }
}

/* Reconstruction (hôte ou solo) : seulement si personne ne se trouve dessus. */
export function hostDestTick() {
  if (!G.map || G.role === 'guest') return;
  for (const o of G.map.dest) {
    if (!o.dead || G.time < o.respawnAt) continue;
    if (occupied(o)) { o.respawnAt = G.time + 1; continue; }
    const m = { t: 'dr', i: o.di };
    applyDestRespawn(m.i);
    if (G.role === 'host') send(m);
  }
}
function occupied(o) {
  const h = o.h || 12, hw = PHYS.W / 2;
  const bodies = [];
  if (S.P && S.P.alive) bodies.push([S.P.x, S.P.y]);
  for (const p of S.others.values()) {
    const last = p.buf.length ? p.buf[p.buf.length - 1] : p;
    if (p.alive) bodies.push([last.x, last.y]);
  }
  for (const d of S.dummies) if (d.alive) bodies.push([d.x, d.y]);
  return bodies.some(([x, y]) => x + hw > o.x - 4 && x - hw < o.x + o.w + 4 && y > o.y - 4 && y - PHYS.H < o.y + h + 4);
}
export function applyDestRespawn(i) {
  const o = G.map && G.map.dest[i];
  if (!o || !o.dead) return;
  o.dead = false;
  o.hp = o.hp0;
  o.gen++;
  o.hitT = 0;
  const cx = o.x + o.w / 2, cy = o.y + (o.h || 12) / 2;
  for (let k = FX.qn(10); k > 0; k--) {
    const p = FX.spawn(FX.T.SMOKE, cx + rand(-o.w / 2, o.w / 2), cy + rand(-10, 10), rand(-40, 40), rand(-60, -10), 0.7, 8, '#dfe6ff');
    p.grow = 10; p.drag = 3; p.a = 0.35;
  }
}
