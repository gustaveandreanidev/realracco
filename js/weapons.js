/* ==========================================================================
   Armes, projectiles et explosions.

   Un tir voyage sur le réseau comme un ÉVÉNEMENT : position de la bouche,
   angle, arme, identifiant. Chaque machine reconstruit exactement la même
   volée : la dispersion vient d'un générateur pseudo-aléatoire seedé par
   l'identifiant du tir, et tous les projectiles avancent au même pas fixe.

   Les dégâts ne sont PAS décidés ici : chaque machine ne teste que les
   projectiles et explosions adverses contre son propre joueur, puis appelle
   hooks.hitLocal (la victime arbitre, voir player.js).
   ========================================================================== */
import { G, S, TAU, seededRng, clamp, OP_COPIES, OP_SPREAD } from './state.js';
import { solidAt, platCrossed, hitTest, distToBody, segmentBlocked } from './physics.js';
import * as FX from './particles.js';
import { damageDest, blastDest } from './destruct.js';
import { shing } from './sfx.js';

const DEG = Math.PI / 180;

/* ------------------------------ Réglages ------------------------------ */
/* cd = délai entre deux tirs (s), speed/grav en px/s et px/s², spread en
   degrés, hs = multiplicateur de headshot, len = longueur de l'arme (bouche).
   Les barres (bars) ne servent qu'à la fiche du salon (0..1).
   pierce : traverse les joueurs (chacun n'est touché qu'une fois) ;
   pierceWalls : traverse aussi les murs ; drag : freinage du projectile. */
export const WEAPONS = {
  smg: {
    id: 'smg', name: 'Mitraillette', key: 'SMG',
    dmg: 9, cd: 1 / 12, speed: 1300, grav: 300, mag: 30, reload: 1.6,
    spread: 3, bloom: 0.18, bloomMax: 1.2, auto: true, hs: 1.5,
    kind: 'bullet', r: 3, life: 1.6, push: 25, recoil: 0.35, len: 36, casing: true,
    bars: { dmg: 0.2, rate: 1, range: 0.6 }, range: 'Moyenne',
  },
  sniper: {
    id: 'sniper', name: 'Sniper', key: 'SNP',
    dmg: 85, cd: 1.4, speed: 3200, grav: 60, mag: 5, reload: 2.2,
    spread: 0, airSpread: 1.5, auto: false, hs: 1.5, hsKill: true,
    kind: 'bullet', r: 2.5, life: 1.5, push: 160, recoil: 1, len: 62, casing: true, bigCasing: true, laser: true,
    bars: { dmg: 0.95, rate: 0.12, range: 1 }, range: 'Très longue',
  },
  bazooka: {
    id: 'bazooka', name: 'Bazooka', key: 'BZK',
    dmg: 70, cd: 1.1, speed: 750, grav: 900, mag: 1, reload: 1.5,
    spread: 0, auto: false, hs: 1,
    kind: 'rocket', r: 7, life: 5, push: 140, recoil: 1, len: 50,
    expl: { r: 130, dmg: 70, kb: 1150, self: 0.5 },
    bars: { dmg: 0.85, rate: 0.15, range: 0.55 }, range: 'Moyenne (cloche)',
  },
  knives: {
    id: 'knives', name: 'Couteaux', key: 'CTX',
    dmg: 45, cd: 0.45, speed: 1000, grav: 1400, mag: 6, reload: 1.8,
    spread: 0, auto: false, hs: 2,
    kind: 'knife', r: 6, life: 3, push: 0, recoil: 0.7, len: 22, spin: 22,
    bars: { dmg: 0.55, rate: 0.45, range: 0.3 }, range: 'Courte (cloche)',
  },
  shotgun: {
    id: 'shotgun', name: 'Fusil à pompe', key: 'PMP',
    dmg: 12, pellets: 8, fan: 7, cd: 0.9, speed: 1400, grav: 500, mag: 4, reload: 2,
    spread: 7, auto: false, hs: 1.5,
    kind: 'pellet', r: 3, rangePx: 450, push: 220, recoil: 1, len: 44, casing: true, bigCasing: true,
    bars: { dmg: 1, rate: 0.2, range: 0.2 }, range: 'Courte (~450 px)',
  },
  grenade: {
    id: 'grenade', name: 'Grenades', key: 'GRN',
    dmg: 80, cd: 0.8, speed: 850, grav: 1300, mag: 2, reload: 2.5,
    spread: 0, auto: false, hs: 1,
    kind: 'grenade', r: 7, fuse: 2, bounce: 0.45, push: 0, recoil: 0.6, len: 18,
    expl: { r: 140, dmg: 80, kb: 1000, self: 0.5 },
    bars: { dmg: 0.9, rate: 0.25, range: 0.45 }, range: 'Lancer + rebonds',
  },
  flame: {
    id: 'flame', name: 'Lance-flammes', key: 'LFL',
    dmg: 4, cd: 0.05, speed: 1100, grav: -140, drag: 1.6, mag: 80, reload: 2.2,
    spread: 5, auto: true, hs: 1, pierce: true, burn: true,
    kind: 'flame', r: 12, life: 0.6, push: 0, recoil: 0.15, len: 40,
    bars: { dmg: 0.7, rate: 1, range: 0.4 }, range: 'Moyenne (~420 px)',
  },
  railgun: {
    id: 'railgun', name: 'Railgun', key: 'RLG',
    dmg: 95, cd: 0.35, charge: 0.9, speed: 9000, grav: 0, mag: 3, reload: 2.5,
    spread: 0, auto: false, hs: 1.5, hsKill: true, pierce: true, pierceWalls: true,
    kind: 'rail', r: 4, life: 0.4, push: 380, recoil: 1, len: 58,
    bars: { dmg: 1, rate: 0.1, range: 1 }, range: 'Traverse tout',
  },
  boomerang: {
    id: 'boomerang', name: 'Boomerang', key: 'BMR',
    dmg: 35, cd: 0.3, speed: 1150, grav: 0, mag: 1, reload: 1, outTime: 0.42, homing: 3200,
    spread: 0, auto: false, hs: 1.5, pierce: true,
    kind: 'boomerang', r: 13, life: 4, push: 0, recoil: 0.8, len: 16,
    bars: { dmg: 0.5, rate: 0.35, range: 0.55 }, range: 'Aller-retour',
  },
  katana: {
    id: 'katana', name: 'Katana', key: 'KTN',
    dmg: 55, cd: 0.55, speed: 1150, grav: 0, mag: 1, reload: 0, infinite: true,
    spread: 0, auto: false, hs: 1.2, pierce: true, kb: 520,
    kind: 'wave', r: 26, life: 0.26, push: 180, recoil: 1, len: 60,
    bars: { dmg: 0.75, rate: 0.35, range: 0.15 }, range: 'Onde courte (~300 px)',
  },
};
/* Pas une arme qu'on choisit : l'explosion d'un baril du décor. */
WEAPONS.barrel = {
  id: 'barrel', name: 'Baril', dmg: 0, hs: 1, kind: 'none',
  expl: { r: 150, dmg: 75, kb: 1250, self: 0.7 },
};
export const WEAPON_IDS = ['smg', 'sniper', 'bazooka', 'knives', 'shotgun', 'grenade', 'flame', 'railgun', 'boomerang', 'katana'];
const DEST_BLAST_MULT = 1.4;   // les explosions abîment le décor un peu plus que les joueurs

/* Branchements fournis par player.js (dégâts arbitrés par la victime). */
export const hooks = {
  hitLocal: null,      // (dmg, owner, weaponId, headshot, shotId, ix, iy, x, y)
  hitDummy: null,      // (dummy, dmg, weaponId, headshot, shotId, ix, iy, x, y)
  blastRagdolls: null, // (x, y, r, kb)
  rocketContact: null, // (projectileId, x, y) : un joueur a arrêté ma roquette
  boomerangCaught: null, // () : mon boomerang est revenu dans ma main
};

const exploded = new Set();
export function resetProjectiles() {
  S.proj.length = 0;
  exploded.clear();
}

/* ------------------------------- Tirs --------------------------------- */
/* ev = { id, w, x, y, a, sp, vx, vy } — x, y = bouche du canon. */
export function spawnShot(ev, owner) {
  const def = WEAPONS[ev.w];
  if (!def) return;
  const rng = seededRng(ev.id);
  const color = ownerColor(owner);
  const n = def.pellets || 1;
  /* Mode OP : la volée entière est tirée plusieurs fois, les copies étant
     plus dispersées. Toujours seedé par l'identifiant : identique partout. */
  const copies = G.modes.op ? OP_COPIES : 1;
  for (let k = 0; k < n * copies; k++) {
    const kk = k % n;
    let a = ev.a;
    if (k >= n) a += (rng() * 2 - 1) * OP_SPREAD * DEG;
    if (n > 1) {
      /* Gerbe : éventail régulier + petite variation seedée, identique partout. */
      const fan = def.fan * DEG;
      a += ((kk + 0.5) / n - 0.5) * 2 * fan + (rng() - 0.5) * fan * 0.35;
    } else if (ev.sp) {
      a += (rng() * 2 - 1) * ev.sp * DEG;
    }
    let vx = Math.cos(a) * def.speed, vy = Math.sin(a) * def.speed;
    if (def.kind === 'grenade') { vx += (ev.vx || 0); vy += (ev.vy || 0) * 0.6; }
    S.proj.push({
      id: n * copies > 1 ? ev.id + '/' + k : ev.id, base: ev.id, owner: owner, w: def.id, def: def, kind: def.kind,
      x: ev.x, y: ev.y, px: ev.x, py: ev.y, ox: ev.x, oy: ev.y, vx: vx, vy: vy,
      age: 0, life: def.kind === 'pellet' ? def.rangePx / def.speed : (def.life || def.fuse || 3),
      rot: a, color: color, dead: false, rest: false,
      hitMe: false, hitSet: null, back: false, lastSol: null,
    });
  }
  /* Effets de tir (jamais synchronisés) */
  const big = def.id === 'shotgun' || def.id === 'sniper' ? 1.7 : def.id === 'bazooka' ? 1.4 : 1;
  if (def.kind === 'bullet' || def.kind === 'pellet') FX.muzzleFx(ev.x, ev.y, ev.a, big, color);
  if (def.kind === 'rail') FX.railFx(ev.x, ev.y, ev.a, color);
  if (def.kind === 'wave') {
    /* SHHHINNG : texte vu par tous, son dont le volume dépend de la distance */
    FX.shingFx(ev.x, ev.y, ev.a, color);
    const P = S.P;
    const d = P ? Math.hypot(P.x - ev.x, P.y - 40 - ev.y) : 0;
    shing(clamp(1 - d / 1600, 0, 1));
  }
  if (def.kind === 'rocket') {
    FX.muzzleFx(ev.x, ev.y, ev.a, 1.2, '#ffb040');
    /* souffle arrière du bazooka */
    const bx = ev.x - Math.cos(ev.a) * 60, by = ev.y - Math.sin(ev.a) * 60;
    for (let i = FX.qn(10); i > 0; i--) {
      const p = FX.spawn(FX.T.SMOKE, bx, by, -Math.cos(ev.a) * (100 + Math.random() * 200) + (Math.random() - 0.5) * 80,
        -Math.sin(ev.a) * (100 + Math.random() * 200) + (Math.random() - 0.5) * 80, 1 + Math.random(), 8, '#8d8780');
      p.grow = 22; p.drag = 2.5; p.a = 0.4;
    }
  }
  S.score[owner] && S.score[owner].shots++;
}

function ownerColor(owner) {
  const COL = ['#4da3ff', '#ff5a5a', '#5ce68a', '#ffd35c'];
  return COL[owner] || '#ffffff';
}

export function removeProjectile(id, fx) {
  for (const p of S.proj) {
    if (p.id !== id || p.dead || p.def.pierce) continue;   // un projectile perçant continue sa route
    if (fx) FX.hitFx(p.x, p.y, p.color, 0, false);
    if (p.w === 'sniper') FX.sniperTracer(p.ox, p.oy, p.x, p.y, p.color);
    p.dead = true;
  }
}

/* ---------------------------- Projectiles ----------------------------- */
export function updateProjectiles(dt) {
  const map = G.map;
  const P = S.P;
  /* Les retraits se font par drapeau (dead) puis compactage en fin de pas :
     une explosion ou un message peut retirer un projectile à tout moment. */
  for (let i = 0; i < S.proj.length; i++) {
    const b = S.proj[i];
    if (b.dead) continue;
    b.px = b.x; b.py = b.y;
    b.age += dt;
    const def = b.def;

    if (b.kind === 'grenade') {
      updateGrenade(b, dt);
      if (!b.dead && b.age >= def.fuse) { explode(b.x, b.y, b.owner, b.w, b.id); b.dead = true; }
      continue;
    }
    if (b.age >= b.life) {
      if (b.kind === 'rocket') explode(b.x, b.y, b.owner, b.w, b.id);
      if (b.w === 'sniper') FX.sniperTracer(b.ox, b.oy, b.x, b.y, b.color);
      b.dead = true;
      continue;
    }

    /* Avance par petits pas : pas de traversée de mur ni de joueur. */
    const steps = Math.max(1, Math.ceil(Math.hypot(b.vx, b.vy) * dt / 8));
    const h = dt / steps;
    for (let s = 0; s < steps && !b.dead; s++) {
      const lx = b.x, ly = b.y;
      if (b.kind === 'boomerang') steerBoomerang(b, h);
      b.vy += def.grav * h;
      if (def.drag) { const k = Math.max(0, 1 - def.drag * h); b.vx *= k; b.vy *= k; }
      b.x += b.vx * h;
      b.y += b.vy * h;
      if (b.kind === 'knife') b.rot += def.spin * h * (b.vx >= 0 ? 1 : -1);
      else if (b.kind === 'boomerang') b.rot += 26 * h;
      else b.rot = Math.atan2(b.vy, b.vx);
      if (b.dead) break;

      /* Hors carte */
      if (b.x < -600 || b.x > map.w + 600 || b.y > map.h + 500 || b.y < -2500) { b.dead = true; break; }
      if (map.water && b.y > map.water && ly <= map.water) {
        FX.waterSplash(b.x, map.water, false);
        if (b.kind === 'flame') { FX.steamFx(b.x, map.water); b.dead = true; break; }   // l'eau éteint les flammes
      }

      /* Décor */
      const sol = solidAt(b.x, b.y);
      if (sol && def.pierceWalls) {
        /* railgun : traverse les murs, abîme le décor au passage (une fois par bloc) */
        if (b.lastSol !== sol) {
          b.lastSol = sol;
          FX.impactFx(b.x, b.y, sol.m, true);
          if (sol.hp0 && b.owner === G.slot) damageDest(sol, def.dmg, b.x, b.y);
          else if (sol.hp0) sol.hitT = 0.14;
        }
      } else if (sol) {
        b.lastSol = null;
        /* décor destructible : c'est le tireur qui compte ses dégâts */
        if (sol.hp0 && b.owner === G.slot && b.kind !== 'rocket') {
          damageDest(sol, def.dmg * (b.kind === 'knife' ? 1.5 : b.kind === 'flame' ? 2 : 1), lx, ly);
        } else if (sol.hp0) sol.hitT = 0.14;
        if (b.kind === 'boomerang') {
          /* le boomerang rebondit sur le mur et revient aussitôt */
          b.x = lx; b.y = ly;
          if (!solidAt(lx + b.vx * h, ly)) b.vy = -b.vy; else b.vx = -b.vx;
          startReturn(b);
          FX.impactFx(lx, ly, sol.m, false);
          continue;
        }
        if (b.kind === 'rocket') explode(lx, ly, b.owner, b.w, b.id);
        else if (b.kind === 'knife') {
          FX.addStuck(lx, ly, b.rot);
          FX.knifeStickFx(lx, ly);
          FX.impactFx(lx, ly, sol.m, false);
        } else if (b.kind === 'flame') FX.flameLick(lx, ly);
        else if (b.kind === 'wave') FX.waveHitFx(lx, ly, b.color);
        else {
          FX.impactFx(lx, ly, sol.m, b.w === 'sniper');
          if (b.w === 'sniper') FX.sniperTracer(b.ox, b.oy, lx, ly, b.color);
        }
        b.dead = true;
        break;
      } else b.lastSol = null;

      /* Joueurs */
      if (P && b.owner !== P.i && !b.hitMe) {
        /* Projectile adverse : c'est MOI qui arbitre l'impact sur MOI. */
        if (P.alive && P.invuln <= 0) {
          const part = hitTest(b.x, b.y, def.r, P.x, P.y, P.sliding);
          if (part) {
            localHit(b, part === 2);
            if (def.pierce) b.hitMe = true;
            else { b.dead = true; break; }
          }
        }
      }
      /* Contact avec un joueur distant : effet local seulement (sa machine
         décide des dégâts). Un projectile perçant continue sa route. */
      for (const o of S.others.values()) {
        if (!o.alive || o.i === b.owner || o.invuln) continue;
        if (def.pierce && b.hitSet && b.hitSet.has(o.i)) continue;
        if (hitTest(b.x, b.y, def.r, o.x, o.y, o.sliding)) {
          if (b.kind === 'rocket') explode(b.x, b.y, b.owner, b.w, b.id);
          else FX.hitFx(b.x, b.y, o.color, 0, false);
          if (b.w === 'sniper') FX.sniperTracer(b.ox, b.oy, b.x, b.y, b.color);
          if (def.pierce) { (b.hitSet || (b.hitSet = new Set())).add(o.i); continue; }
          b.dead = true;
          break;
        }
      }
      if (b.dead) break;
      if (P && b.owner === P.i) {
        for (let di = 0; di < S.dummies.length; di++) {
          const d = S.dummies[di];
          if (!d.alive) continue;
          if (def.pierce && b.hitSet && b.hitSet.has('d' + di)) continue;
          const part = hitTest(b.x, b.y, def.r, d.x, d.y);
          if (!part) continue;
          if (b.kind === 'rocket') explode(b.x, b.y, b.owner, b.w, b.id);
          else {
            const hs = part === 2;
            let dmg = def.dmg * (hs ? def.hs : 1);
            if (hs && def.hsKill) dmg = 999;
            if (def.kb) {                                              // l'onde du katana repousse
              const sx = Math.sign(b.vx) || 1;
              hooks.hitDummy && hooks.hitDummy(d, dmg, b.w, hs, b.id, sx * def.kb, -def.kb * 0.55, b.x, b.y, true);
            } else hooks.hitDummy && hooks.hitDummy(d, dmg, b.w, hs, b.id, b.vx, b.vy, b.x, b.y);
          }
          if (b.w === 'sniper') FX.sniperTracer(b.ox, b.oy, b.x, b.y, b.color);
          if (def.pierce) { (b.hitSet || (b.hitSet = new Set())).add('d' + di); continue; }
          b.dead = true;
          break;
        }
      }
    }

    /* Traînées */
    if (!b.dead) {
      if (b.kind === 'rocket') FX.rocketTrail(b.x, b.y, b.vx, b.vy);
      else if (b.kind === 'knife' && Math.random() < 0.7) FX.knifeTrail(b.x, b.y, b.color);
      else if (b.kind === 'flame') FX.flameTrail(b.x, b.y, b.age / b.life);
      else if (b.kind === 'boomerang' && Math.random() < 0.6) FX.knifeTrail(b.x, b.y, b.color);
      else if (b.kind === 'wave') FX.waveTrail(b.x, b.y, b.vx, b.vy, b.color);
    }
  }
  let n = 0;
  for (let i = 0; i < S.proj.length; i++) if (!S.proj[i].dead) S.proj[n++] = S.proj[i];
  S.proj.length = n;
}

/* Boomerang : il part, ralentit, puis revient vers la main de son lanceur.
   Il peut toucher chaque joueur une fois à l'aller et une fois au retour. */
function startReturn(b) {
  if (b.back) return;
  b.back = true;
  b.hitMe = false;
  if (b.hitSet) b.hitSet.clear();
}
function steerBoomerang(b, h) {
  const def = b.def;
  if (!b.back) {
    const k = Math.max(0, 1 - 1.3 * h);                 // ralentit en fin d'aller
    b.vx *= k; b.vy *= k;
    if (b.age > def.outTime) startReturn(b);
    return;
  }
  const owner = b.owner === G.slot ? S.P : S.others.get(b.owner);
  if (!owner || !owner.alive) return;                   // lanceur mort : il file tout droit
  const tx = owner.x, ty = owner.y - 50;
  const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy) || 1;
  if (d < 34) {                                         // rattrapé !
    b.dead = true;
    if (b.owner === G.slot && hooks.boomerangCaught) hooks.boomerangCaught();
    FX.catchFx(b.x, b.y, b.color);
    return;
  }
  b.vx += dx / d * def.homing * h;
  b.vy += dy / d * def.homing * h;
  const sp = Math.hypot(b.vx, b.vy), max = def.speed * 1.15;
  if (sp > max) { b.vx *= max / sp; b.vy *= max / sp; }
}

/* Projectile adverse qui me touche : calcul des dégâts, puis la victime
   (moi) décompte et diffuse. */
function localHit(b, head) {
  const def = b.def;
  if (b.kind === 'rocket') {
    /* Impact direct : l'explosion a lieu sur moi, et je préviens les autres
       pour qu'elle éclate au même endroit chez eux. */
    hooks.rocketContact && hooks.rocketContact(b.id, b.x, b.y, b.owner);
    explode(b.x, b.y, b.owner, b.w, b.id);
    return;
  }
  let dmg = def.dmg * (head ? def.hs : 1);
  if (head && def.hsKill) dmg = 999;            // headshot au sniper / railgun = mort
  if (def.kb && S.P) {                          // l'onde du katana projette la victime
    S.P.vx += Math.sign(b.vx || 1) * def.kb;
    S.P.vy = Math.min(S.P.vy, -def.kb * 0.55);
    S.P.onGround = false;
    S.P.kbT = 0.2;
  }
  hooks.hitLocal && hooks.hitLocal(dmg, b.owner, b.w, head, b.id, b.vx, b.vy, b.x, b.y);
}

/* Grenade : rebonds sur les blocs et les plateformes, roulement. */
function updateGrenade(b, dt) {
  const def = b.def;
  if (!b.rest) {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.vx, b.vy) * dt / 6));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      b.vy += def.grav * h;
      const ox = b.x, oy = b.y;
      b.x += b.vx * h;
      if (solidAt(b.x, b.y)) { b.x = ox; b.vx = -b.vx * def.bounce; b.vy *= 0.9; }
      b.y += b.vy * h;
      const sol = solidAt(b.x, b.y);
      let landed = false;
      if (sol) { b.y = oy; landed = b.vy > 0; b.vy = -b.vy * def.bounce; b.vx *= 0.8; }
      else if (b.vy > 0) {
        const pl = platCrossed(b.x, oy, b.y);
        if (pl) { b.y = pl.y - 0.5; landed = true; b.vy = -b.vy * def.bounce; b.vx *= 0.8; }
      }
      if (landed && Math.abs(b.vy) < 60) { b.vy = 0; b.vx *= 0.9; }
      if (G.map.water && b.y > G.map.water && oy <= G.map.water) FX.waterSplash(b.x, G.map.water, false);
      if (b.y > G.map.h + 400) { b.dead = true; return; }
    }
    b.rot += b.vx * dt * 0.05;
  }
  FX.grenadeTrail(b.x, b.y);
  /* Mèche qui clignote de plus en plus vite avant l'explosion. */
  const left = def.fuse - b.age;
  const period = clamp(left * 0.18, 0.05, 0.3);
  if (Math.floor(b.age / period) !== Math.floor((b.age - dt) / period)) FX.fuseSpark(b.x, b.y - 6);
}

/* ------------------------------ Explosions ---------------------------- */
export function explode(x, y, owner, wId, id) {
  if (id) {
    if (exploded.has(id)) return;
    exploded.add(id);
    if (exploded.size > 300) exploded.clear();
    removeProjectileSilently(id);
  }
  const def = WEAPONS[wId].expl;
  FX.explosionFx(x, y, def.r);
  if (owner === G.slot) blastDest(x, y, def.r, def.dmg * DEST_BLAST_MULT);
  hooks.blastRagdolls && hooks.blastRagdolls(x, y, def.r * 1.6, def.kb);

  const P = S.P;
  if (P) {
    const dCam = Math.hypot(P.x - x, P.y - 42 - y);
    G.shake = Math.min(1, G.shake + clamp(1 - dCam / 1100, 0, 1) * 0.75);
  }

  /* Dégâts et knockback sur MON joueur (y compris ma propre roquette :
     c'est ce qui permet le rocket jump). Pas de headshot sur les explosions. */
  if (P && P.alive) {
    const hit = blastOn(P.x, P.y, x, y, def, P.sliding);
    if (hit) {
      P.vx += hit.ix; P.vy += hit.iy;
      P.onGround = false;
      P.kbT = 0.25;
      let dmg = hit.dmg;
      if (owner === P.i) dmg *= def.self;
      hooks.hitLocal && hooks.hitLocal(dmg, owner, wId, false, id, hit.ix, hit.iy, P.x, P.y - 42, true);
    }
  }
  /* Mannequins d'entraînement (solo) */
  for (const d of S.dummies) {
    if (!d.alive) continue;
    if (d.bot && owner !== G.slot) continue;      // les bots ne se blessent pas entre eux
    const hit = blastOn(d.x, d.y, x, y, def);
    if (hit) hooks.hitDummy && hooks.hitDummy(d, hit.dmg, wId, false, id, hit.ix, hit.iy, d.x, d.y - 42, true);
  }
}

function removeProjectileSilently(id) {
  for (const p of S.proj) if (p.id === id) p.dead = true;
}

/* Effet d'une explosion sur un corps (pieds en px, py) : dégâts dégressifs
   selon la distance, knockback, et murs qui protègent. */
function blastOn(px, py, x, y, def, sliding) {
  const d = distToBody(x, y, px, py, sliding);
  if (d >= def.r) return null;
  const visible = !segmentBlocked(x, y, px, py - 42) || !segmentBlocked(x, y, px, py - 78) || !segmentBlocked(x, y, px, py - 6);
  if (!visible) return null;
  const f = 1 - d / def.r;
  let dx = px - x, dy = py - 42 - y;
  const len = Math.hypot(dx, dy);
  if (len < 1) { dx = 0; dy = -1; } else { dx /= len; dy /= len; }
  const mag = def.kb * (0.3 + 0.7 * f);
  return {
    dmg: def.dmg * (1 - 0.75 * (d / def.r)),     // 100 % au centre, 25 % au bord
    ix: dx * mag,
    iy: dy * mag - mag * 0.25,                    // léger soulèvement : ça fait voler
  };
}

/* ------------------------------ Dessin -------------------------------- */
/* Dessine l'arme pointant vers +x, origine = main arrière. */
export function drawWeapon(ctx, id, alpha) {
  ctx.lineJoin = 'round';
  switch (id) {
    case 'smg':
      ctx.fillStyle = '#2b2f36';
      ctx.fillRect(-10, -3, 8, 6);            // crosse courte
      ctx.fillStyle = '#3c424c';
      ctx.fillRect(-3, -5, 28, 9);            // carcasse
      ctx.fillStyle = '#23262c';
      ctx.fillRect(24, -2.5, 12, 4);          // canon
      ctx.fillRect(8, 3, 6, 12);              // chargeur
      ctx.fillStyle = '#6b7380';
      ctx.fillRect(0, -5, 20, 2);
      break;
    case 'sniper':
      ctx.fillStyle = '#4a3a2a';
      ctx.beginPath(); ctx.moveTo(-20, -3); ctx.lineTo(-2, -3); ctx.lineTo(-2, 5); ctx.lineTo(-20, 7); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#2d3238';
      ctx.fillRect(-3, -4, 34, 8);
      ctx.fillStyle = '#1d2024';
      ctx.fillRect(30, -1.8, 32, 3.6);
      ctx.fillRect(58, -3, 5, 6);
      ctx.fillStyle = '#15181c';
      ctx.fillRect(6, -11, 18, 6);            // lunette
      ctx.fillStyle = '#6fd0ff';
      ctx.fillRect(22, -10, 2.5, 4);
      ctx.fillStyle = '#23262c';
      ctx.fillRect(10, 4, 5, 8);
      break;
    case 'bazooka':
      ctx.fillStyle = '#3f5a33';
      ctx.fillRect(-22, -7, 70, 14);          // tube
      ctx.fillStyle = '#2d4224';
      ctx.fillRect(-26, -8, 7, 16);
      ctx.fillRect(44, -8, 8, 16);
      ctx.fillStyle = '#23262c';
      ctx.fillRect(4, 7, 5, 10);              // poignée
      ctx.fillRect(14, -12, 8, 5);            // viseur
      ctx.fillStyle = '#c9a23a';
      ctx.fillRect(-10, -7, 4, 14);
      break;
    case 'knives':
      ctx.fillStyle = '#3b2b20';
      ctx.fillRect(-2, -2.5, 10, 5);
      ctx.fillStyle = '#d8dee8';
      ctx.beginPath(); ctx.moveTo(8, -3); ctx.lineTo(24, 0); ctx.lineTo(8, 3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#8a929e';
      ctx.fillRect(7, -4, 2, 8);
      break;
    case 'shotgun':
      ctx.fillStyle = '#5a3d25';
      ctx.beginPath(); ctx.moveTo(-18, -3); ctx.lineTo(-2, -4); ctx.lineTo(-2, 4); ctx.lineTo(-18, 7); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#34383f';
      ctx.fillRect(-3, -4.5, 22, 8);
      ctx.fillStyle = '#1f2227';
      ctx.fillRect(18, -4, 26, 4);            // canon
      ctx.fillStyle = '#6b4a2e';
      ctx.fillRect(20, 0, 16, 5);             // pompe
      break;
    case 'flame':
      ctx.fillStyle = '#b8402a';
      ctx.beginPath(); ctx.arc(-4, 4, 8, 0, TAU); ctx.fill();            // réservoir
      ctx.fillStyle = '#7a2a1c'; ctx.fillRect(-8, -3, 8, 2);
      ctx.fillStyle = '#4a4f58'; ctx.fillRect(-2, -4, 30, 7);
      ctx.fillStyle = '#2b2f36'; ctx.fillRect(26, -3, 16, 5);            // buse
      ctx.fillStyle = '#ff9a2a'; ctx.fillRect(40, -1.5, 2, 3);          // veilleuse
      ctx.fillStyle = '#23262c'; ctx.fillRect(8, 3, 5, 9);
      break;
    case 'railgun':
      ctx.fillStyle = '#23262c'; ctx.fillRect(-16, -4, 14, 9);
      ctx.fillStyle = '#3a4150'; ctx.fillRect(-3, -6, 40, 12);
      ctx.fillStyle = '#1b1e24'; ctx.fillRect(34, -3, 26, 6);
      ctx.fillStyle = '#4dd2ff';                                          // bobines
      for (let k = 0; k < 4; k++) ctx.fillRect(4 + k * 8, -7, 3, 14);
      ctx.fillStyle = '#23262c'; ctx.fillRect(6, 6, 5, 8);
      break;
    case 'boomerang':
      ctx.strokeStyle = '#a0662e'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(10, -4); ctx.lineTo(20, 6); ctx.stroke();
      ctx.strokeStyle = '#e8c078'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(2, 5); ctx.lineTo(10, -2); ctx.lineTo(18, 5); ctx.stroke();
      break;
    case 'katana':
      ctx.fillStyle = '#1b1b22'; ctx.fillRect(-8, -2.5, 14, 5);         // poignée
      ctx.fillStyle = '#c0263a';
      for (let k = -6; k < 6; k += 4) ctx.fillRect(k, -2.5, 2, 5);
      ctx.fillStyle = '#d6b24a'; ctx.fillRect(6, -5, 3, 10);             // garde
      ctx.fillStyle = '#e8eef4';
      ctx.beginPath(); ctx.moveTo(9, -2); ctx.lineTo(56, -3.5); ctx.quadraticCurveTo(62, -2, 58, 0.5); ctx.lineTo(9, 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillRect(12, -1.8, 40, 0.8);
      break;
    case 'barrel':
      ctx.fillStyle = '#b32a22';
      ctx.fillRect(-8, -11, 16, 22);
      ctx.fillStyle = '#3a3a40';
      ctx.fillRect(-9, -11, 18, 3); ctx.fillRect(-9, 8, 18, 3); ctx.fillRect(-9, -1.5, 18, 3);
      ctx.fillStyle = '#ffd35c';
      ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill();
      break;
    case 'grenade':
      ctx.fillStyle = '#3f5a33';
      ctx.beginPath(); ctx.arc(10, 0, 7, 0, TAU); ctx.fill();
      ctx.fillStyle = '#2d4224';
      ctx.fillRect(6, -2, 8, 1.5); ctx.fillRect(6, 2, 8, 1.5);
      ctx.fillStyle = '#9aa0a8';
      ctx.fillRect(7, -10, 6, 4);
      ctx.strokeStyle = '#c8ccd2'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(16, -9, 3, 0, TAU); ctx.stroke();
      break;
  }
}

/* Étendue horizontale de chaque dessin d'arme (pour centrer les icônes). */
const ICON_BOX = {
  smg: [-10, 36], sniper: [-20, 63], bazooka: [-26, 52], knives: [-2, 24], shotgun: [-18, 44], grenade: [2, 19],
  barrel: [-9, 9], flame: [-12, 42], railgun: [-16, 60], boomerang: [-2, 20], katana: [-8, 62],
};
/* Icône centrée en (cx, cy), tenant dans maxW px, agrandie au plus de maxS. */
export function drawWeaponIcon(ctx, id, cx, cy, maxW, maxS) {
  const b = ICON_BOX[id];
  const s = Math.min(maxS, maxW / (b[1] - b[0]));
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.translate(-(b[0] + b[1]) / 2, 0);
  drawWeapon(ctx, id);
  ctx.restore();
}

/* Dessine les projectiles (entre deux pas de simulation : alpha). */
export function drawProjectiles(ctx, alpha, view) {
  for (const b of S.proj) {
    if (b.dead) continue;
    const x = b.px + (b.x - b.px) * alpha, y = b.py + (b.y - b.py) * alpha;
    if (x < view.l - 200 || x > view.r + 200 || y < view.t - 200 || y > view.b + 200) continue;
    switch (b.kind) {
      case 'bullet': case 'pellet': {
        const sniper = b.w === 'sniper';
        const len = sniper ? 0.09 : b.kind === 'pellet' ? 0.018 : 0.03;
        let tx = x - b.vx * len, ty = y - b.vy * len;
        if (sniper) {                                  // la traçante ne dépasse pas l'origine
          const maxd = Math.hypot(x - b.ox, y - b.oy), d = Math.hypot(x - tx, y - ty);
          if (d > maxd) { tx = b.ox; ty = b.oy; }
        }
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = b.color;
        ctx.globalAlpha = sniper ? 0.8 : 0.55;
        ctx.lineWidth = sniper ? 4 : 3;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
        ctx.strokeStyle = '#fffbe8';
        ctx.globalAlpha = 1;
        ctx.lineWidth = sniper ? 1.8 : 1.4;
        ctx.beginPath(); ctx.moveTo((tx + x) / 2, (ty + y) / 2); ctx.lineTo(x, y); ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'rocket': {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(b.rot);
        ctx.fillStyle = '#4b5b3a';
        ctx.fillRect(-12, -4, 18, 8);
        ctx.fillStyle = '#c33';
        ctx.beginPath(); ctx.moveTo(6, -4); ctx.lineTo(14, 0); ctx.lineTo(6, 4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#2d3524';
        ctx.fillRect(-14, -7, 5, 14);
        ctx.restore();
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(FX.glowSprite('#ffa030'), x - Math.cos(b.rot) * 16 - 16, y - Math.sin(b.rot) * 16 - 16, 32, 32);
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'knife': {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(b.rot);
        ctx.translate(-12, 0);
        drawWeapon(ctx, 'knives');
        ctx.restore();
        break;
      }
      case 'flame': {
        /* boule de feu qui grossit et passe du jaune au rouge */
        const k = Math.min(1, b.age / b.life);
        const col = k < 0.25 ? '#fff3b0' : k < 0.55 ? '#ffb03a' : k < 0.8 ? '#ff6a1f' : '#b8321a';
        const r = 16 + k * 46;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1 - k * 0.55;
        ctx.drawImage(FX.glowSprite(col), x - r, y - r, r * 2, r * 2);
        if (k < 0.5) {                                   // cœur blanc-jaune au début du jet
          const r2 = r * 0.45;
          ctx.drawImage(FX.glowSprite('#fff3b0'), x - r2, y - r2, r2 * 2, r2 * 2);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'rail': {
        /* faisceau : de la bouche au front du tir, s'estompe vite */
        const k = 1 - b.age / b.life;
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        ctx.strokeStyle = b.color; ctx.globalAlpha = 0.5 * k; ctx.lineWidth = 14 * k + 2;
        ctx.beginPath(); ctx.moveTo(b.ox, b.oy); ctx.lineTo(x, y); ctx.stroke();
        ctx.strokeStyle = '#e8fbff'; ctx.globalAlpha = k; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(b.ox, b.oy); ctx.lineTo(x, y); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'boomerang': {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(b.rot);
        ctx.scale(1.4, 1.4);
        ctx.translate(-10, -1);
        drawWeapon(ctx, 'boomerang');
        ctx.restore();
        break;
      }
      case 'wave': {
        /* onde du katana : croissant lumineux perpendiculaire au mouvement */
        const k = 1 - b.age / b.life;
        const a = Math.atan2(b.vy, b.vx);
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        for (const [w, col, al] of [[12, b.color, 0.45], [4, '#ffffff', 1]]) {
          ctx.strokeStyle = col; ctx.lineWidth = w * (0.5 + k); ctx.globalAlpha = al * Math.min(1, k * 2);
          ctx.beginPath(); ctx.arc(x - Math.cos(a) * 24, y - Math.sin(a) * 24, 34, a - 1.15, a + 1.15); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'grenade': {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(b.rot);
        ctx.translate(-10, 0);
        drawWeapon(ctx, 'grenade');
        ctx.restore();
        const left = b.def.fuse - b.age;
        const blink = Math.sin(b.age * (40 / Math.max(0.3, left))) > 0;
        if (blink) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.drawImage(FX.glowSprite('#ff3020'), x - 12, y - 18, 24, 24);
          ctx.globalCompositeOperation = 'source-over';
        }
        break;
      }
    }
  }
  ctx.globalAlpha = 1;
}
