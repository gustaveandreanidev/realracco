/* ==========================================================================
   Joueurs : contrôle local, interpolation des distants, pose procédurale du
   stickman, ragdoll Verlet, dégâts arbitrés par la victime, mannequins.
   ========================================================================== */
import {
  G, S, MAX_HP, RESPAWN_DELAY, INVULN_TIME, ASSIST_WINDOW, INTERP_DELAY, HEAL_AMOUNT,
  COLORS, COLORS_DARK, WIN_KILLS, TAU, clamp, angDiff, pickKillText, headScale, livesLeft,
} from './state.js';
import { outfitParts, HATS, JACKETS, PANTS, SHOES } from './outfit.js';
import { PHYS, moveBody, steer, solidAt, platCrossed, boxHitsSolid } from './physics.js';
import { WEAPONS, spawnShot, removeProjectile } from './weapons.js';
import * as FX from './particles.js';
import { send } from './net.js';

/* ------------------------------ Réglages ------------------------------ */
const SWITCH_TIME    = 0.25;   // délai de changement d'arme (s)
const FIRE_BUFFER    = 0.15;   // un clic un peu trop tôt est quand même tiré (s)
const JUMP_CUT       = 0.45;   // relâcher le saut tôt coupe la montée (saut court)
const SHOULDER_Y     = -60;    // hauteur de l'épaule par rapport aux pieds
const SLIDE_SHOULDER = -30;    // … pendant une glissade
const shoulderY = (p) => (p.sliding ? SLIDE_SHOULDER : SHOULDER_Y);
const RAGDOLL_LIFE   = 5;      // durée d'un ragdoll avant disparition (s)
const RAGDOLL_FADE   = 1.2;    // fondu final (s)
const MAX_RAGDOLLS   = 10;
const DUMMY_REGEN    = 2.5;    // le mannequin se régénère après 2,5 s sans dégâts
const BURN_TIME      = 2.2;    // durée de la brûlure du lance-flammes (s)
const BURN_TICK      = 0.3;    // une brûlure toutes les 0,3 s…
const BURN_DMG       = 2;      // … de 2 PV

/* Commandes du joueur local, remplies par main.js. */
export const input = {
  left: false, right: false, down: false, jumpHeld: false,
  jumpQueued: 0, dashQueued: 0, slideQueued: 0, fire: false, fireQueued: 0, reloadQueued: false, switchTo: -1,
  sx: 0, sy: 0,          // souris, coordonnées écran (px CSS)
  wx: 0, wy: 0,          // souris, coordonnées monde
};

/* Branchements vers main.js */
export const events = {
  requestKit: null,      // (index du kit)
  afterKill: null,       // (tueur, victime) : vérifie la fin de partie
};

let shotSeq = 0;
const countedHits = new Set();

/* ------------------------------ Création ------------------------------ */
function newPose() {
  const pt = () => ({ x: 0, y: 0 });
  return {
    head: pt(), neck: pt(), hip: pt(), sh: pt(),
    elbB: pt(), handB: pt(), elbF: pt(), handF: pt(),
    kneeL: pt(), footL: pt(), kneeR: pt(), footR: pt(),
    oneHand: false,
  };
}

export function makePlayer(i, weapons, outfit) {
  const w = weapons && weapons.length === 2 ? weapons.slice() : ['smg', 'sniper'];
  return {
    i: i, color: COLORS[i], dark: COLORS_DARK[i], weapons: w, active: 0,
    outfit: outfitParts(outfit),
    x: 0, y: 0, vx: 0, vy: 0, px: 0, py: 0, aim: 0, facing: 1,
    onGround: false, ground: null, alive: false, hp: MAX_HP, invuln: 0,
    respawnT: 0.4, sq: 0, jc: 0,
    /* animation */
    run: 0, landT: 0, recoil: 0, wasGround: true, fallV: 0, stepPh: 0,
    /* local */
    ammo: [WEAPONS[w[0]].mag, WEAPONS[w[1]].mag], cds: [0, 0], reloadT: 0, switchT: 0,
    bloom: 0, spread: 0, jumps: 0, coyote: 0, dropT: 0, kbT: 0, jumpCut: false,
    dashT: 0, dashCd: 0, dashDir: 0, airDash: true, dc: 0,
    slideT: 0, slideCd: 0, slideDir: 1, sliding: false, diving: false, h: 0,
    charge: 0, burnT: 0, burnBy: -1, burnAcc: 0,
    lastHitBy: -1, lastHitT: -99,
    /* distant */
    buf: [], reloading: false, lastSeen: 0,
    pose: newPose(),
  };
}

/* ======================== JOUEUR LOCAL (pas fixe) ====================== */
export function updateLocal(dt) {
  const P = S.P;
  if (!P) return;
  P.px = P.x; P.py = P.y;
  P.invuln = Math.max(0, P.invuln - dt);

  if (!P.alive) {
    /* Dernier debout : plus de vie, plus de réapparition (spectateur). */
    if (G.phase === 'play' && !((G.gameType === 'lms' || G.gameType === 'surv') && livesLeft(P.i) <= 0)) {
      P.respawnT -= dt;
      if (P.respawnT <= 0) respawnLocal();
    }
    return;
  }

  /* Visée : la souris, en 360°, depuis l'épaule. */
  P.aim = Math.atan2(input.wy - (P.y + shoulderY(P)), input.wx - P.x);
  P.facing = Math.cos(P.aim) >= 0 ? 1 : -1;

  /* Déplacement */
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  P.kbT = Math.max(0, P.kbT - dt);
  P.dropT = Math.max(0, P.dropT - dt);
  if (input.down && P.onGround && P.ground && P.ground.h === undefined) P.dropT = PHYS.DROP_T;

  /* Dash latéral : double appui rapide sur Q / D. Un seul dash par saut,
     puis recharge ; la gravité est suspendue pendant la poussée. */
  P.dashCd = Math.max(0, P.dashCd - dt);
  if (input.dashQueued && P.dashCd <= 0 && P.dashT <= 0 && (P.onGround || P.airDash)) {
    P.dashDir = input.dashQueued;
    P.dashT = PHYS.DASH_TIME;
    P.dashCd = PHYS.DASH_CD;
    if (!P.onGround) P.airDash = false;
    P.dc++;
    FX.dashFx(P.x, P.y, P.dashDir, P.color);
  }
  input.dashQueued = 0;

  /* Glissade (clic droit au sol) : grosse vitesse, corps couché, les balles
     passent au-dessus. En l'air : plongeon, qui se change en glissade à
     l'atterrissage. Sauter pendant une glissade garde tout l'élan. */
  P.slideCd = Math.max(0, P.slideCd - dt);
  input.slideQueued = Math.max(0, input.slideQueued - dt);
  if (input.slideQueued > 0 && P.dashT <= 0 && P.slideT <= 0) {
    if (P.onGround && P.slideCd <= 0) { startSlide(P, dir); input.slideQueued = 0; }
    else if (!P.onGround && !P.diving) {
      P.diving = true;
      P.vy = Math.max(P.vy, PHYS.DIVE_V);
      input.slideQueued = 0;
      FX.jumpPuff(P.x, P.y - 40);
    }
  }
  if (P.dashT > 0) {
    P.dashT -= dt;
    P.vx = P.dashDir * PHYS.DASH_SPEED;
    P.vy = 0;
    if (P.dashT <= 0) P.vx = P.dashDir * PHYS.RUN;   // sortie de dash à vitesse de course
  } else if (P.slideT > 0) {
    if (P.onGround) P.vx = P.vx > 0 ? Math.max(0, P.vx - PHYS.SLIDE_FRIC * dt) : Math.min(0, P.vx + PHYS.SLIDE_FRIC * dt);
    P.slideT -= dt;
    if (P.slideT <= 0 || Math.abs(P.vx) < 160) endSlide(P);
  } else steer(P, dir, dt);

  /* Saut, double saut, coyote time, buffer de saut */
  input.jumpQueued = Math.max(0, input.jumpQueued - dt);
  if (input.jumpQueued > 0 && P.slideT > 0 && !canStand(P)) input.jumpQueued = 0;   // plafond trop bas
  if (input.jumpQueued > 0) {
    if (P.slideT > 0) { endSlide(P, true); P.vx *= 1.08; }   // saut glissé : on garde l'élan
    if (P.onGround || P.coyote > 0) {
      P.vy = -PHYS.JUMP_V; P.jumps = 1; P.coyote = 0; input.jumpQueued = 0; P.jumpCut = true;
      P.onGround = false;
      FX.landDust(P.x, P.y, 0.1);
    } else if (P.jumps < 2 || G.modes.flies) {       // mode Flies : sauts illimités
      P.vy = Math.min(P.vy, 0) - PHYS.DJUMP_V * (P.vy < -200 ? 0.6 : 1);
      P.vy = Math.max(P.vy, -PHYS.JUMP_V * 1.1);
      P.jumps = 2; P.jc++; input.jumpQueued = 0; P.jumpCut = true;
      FX.jumpPuff(P.x, P.y);
    }
  }
  if (P.jumpCut && !input.jumpHeld && P.vy < 0 && P.kbT <= 0) { P.vy *= JUMP_CUT; P.jumpCut = false; }
  if (P.vy >= 0) P.jumpCut = false;

  if (P.dashT <= 0) P.vy = Math.min(P.vy + PHYS.GRAVITY * dt, PHYS.MAX_FALL);
  const wasGround = P.onGround;
  moveBody(P, dt);
  if (P.onGround) {
    P.jumps = 0; P.coyote = PHYS.COYOTE; P.airDash = true;
    if (P.diving) {                                  // plongeon : l'impact se change en glissade
      P.diving = false;
      FX.landDust(P.x, P.y, 1);
      G.shake = Math.min(1, G.shake + 0.15);
      startSlide(P, dir, true);
    }
  } else {
    P.coyote = Math.max(0, P.coyote - dt);
    if (wasGround && P.jumps === 0) P.jumps = 1;   // tombé d'un bord : il reste le double saut
  }
  if (P.hitWall) { P.dashT = 0; P.hitWall = false; }
  P.sliding = P.slideT > 0;

  /* Chute dans le vide, dans l'eau ou hors carte */
  const map = G.map;
  if (map.water && P.y > map.water + 30) {
    FX.waterSplash(P.x, map.water, true);
    dieLocal(-1, 'fall', false, 0, 0);
    return;
  }
  if (P.y > map.killY || P.x < -400 || P.x > map.w + 400) { dieLocal(-1, 'fall', false, 0, 0); return; }

  updateWeapon(P, dt);
  checkKits(P);

  /* Brûlure du lance-flammes : c'est encore la victime qui décompte. */
  if (P.burnT > 0) {
    P.burnT -= dt;
    P.burnAcc += dt;
    if (map.water && P.y > map.water - 40) P.burnT = 0;             // l'eau éteint le feu
    if (P.burnAcc >= BURN_TICK) {
      P.burnAcc = 0;
      hitLocal(BURN_DMG, P.burnBy, 'flame', false, '', 0, 0, P.x, P.y - 45, true);
    }
  }
}

/* ------------------------------ Glissade ------------------------------ */
function startSlide(P, dir, fromDive) {
  const d = dir || Math.sign(P.vx) || P.facing;
  const along = Math.sign(P.vx) === d ? Math.abs(P.vx) : 0;
  P.slideDir = d;
  P.vx = d * Math.max(along + PHYS.SLIDE_BOOST, PHYS.SLIDE_SPEED * (fromDive ? 1.15 : 1));
  P.slideT = PHYS.SLIDE_TIME;
  P.slideCd = PHYS.SLIDE_CD;
  P.h = PHYS.SLIDE_H;
  P.sliding = true;
  P.dashT = 0;
  P.sc = (P.sc || 0) + 1;
  FX.slideFx(P.x, P.y, d);
}
/* Se relever n'est possible que s'il y a la place au-dessus. */
function canStand(P) {
  return !boxHitsSolid(P.x - PHYS.W / 2 + 1, P.y - PHYS.H, P.x + PHYS.W / 2 - 1, P.y - 1);
}
function endSlide(P, force) {
  if (!force && !canStand(P)) { P.slideT = 0.05; return; }   // coincé sous un plafond : on reste couché
  P.slideT = 0;
  P.h = 0;
  P.sliding = false;
}

/* ------------------------------ Armes --------------------------------- */
function updateWeapon(P, dt) {
  /* Changement d'arme (&, é, molette) : annule le rechargement en cours. */
  if (input.switchTo >= 0 && input.switchTo !== P.active) {
    P.active = input.switchTo;
    P.charge = 0;
    P.switchT = SWITCH_TIME;
    P.reloadT = 0;
    P.bloom = 0;
  }
  input.switchTo = -1;

  const def = WEAPONS[P.weapons[P.active]];
  /* Chaque arme garde sa propre cadence ; le temps restant est reporté d'un
     tir à l'autre (cadence exacte en rafale). */
  for (let n = 0; n < 2; n++) P.cds[n] = Math.max(n === P.active ? -dt : 0, P.cds[n] - dt);
  const cd = P.cds[P.active];
  P.switchT = Math.max(0, P.switchT - dt);
  P.bloom = Math.max(0, P.bloom - dt * 2.5);
  if (P.reloadT > 0) {
    P.reloadT -= dt;
    if (P.reloadT <= 0) { P.reloadT = 0; P.ammo[P.active] = def.mag; }
  }

  /* Dispersion courante : de base, s'ouvre en rafale, en course et en l'air. */
  let sp = def.spread * (1 + P.bloom);
  if (!P.onGround) sp += def.airSpread !== undefined ? def.airSpread : def.spread * 0.6;
  else if (Math.abs(P.vx) > 60) sp += def.spread * 0.3;
  P.spread = Math.round(sp * 100) / 100;

  if (input.reloadQueued) {
    input.reloadQueued = false;
    if (P.reloadT <= 0 && P.ammo[P.active] < def.mag) P.reloadT = def.reload;
  }

  input.fireQueued = Math.max(0, input.fireQueued - dt);
  const ready = cd <= 0 && P.switchT <= 0 && P.reloadT <= 0;
  /* Boomerang : tant qu'il vole, on ne peut ni relancer ni recharger. */
  const boomOut = def.kind === 'boomerang' && S.proj.some((b) => b.owner === P.i && b.kind === 'boomerang' && !b.dead);
  if (def.charge) {
    /* Railgun : on maintient pour charger, on relâche pour tirer. */
    if (input.fire && ready && P.ammo[P.active] > 0) P.charge = Math.min(def.charge, P.charge + dt);
    else if (!input.fire) {
      if (P.charge >= def.charge && ready) fire(P, def);
      P.charge = 0;
    }
    input.fireQueued = 0;
  } else {
    P.charge = 0;
    const want = (def.auto && input.fire) || input.fireQueued > 0;
    if (want && ready && !boomOut) {
      if (def.infinite || P.ammo[P.active] > 0) { fire(P, def); input.fireQueued = 0; }
      else P.reloadT = def.reload;
    }
  }
  /* Rechargement automatique quand le chargeur est vide. */
  if (!def.infinite && !boomOut && P.ammo[P.active] <= 0 && P.reloadT <= 0 && P.cds[P.active] <= 0 && P.switchT <= 0) P.reloadT = def.reload;
}

function fire(P, def) {
  const a = P.aim;
  const ca = Math.cos(a), sa = Math.sin(a);
  const sx = P.x, sy = P.y + shoulderY(P);
  const reach = 13 + def.len;
  const ev = {
    t: 'f', w: def.id, id: P.i + '-' + (shotSeq++) + '-' + Math.floor(Math.random() * 1e4),
    x: sx + ca * reach, y: sy + sa * reach, a: a, sp: P.spread,
    vx: Math.round(P.vx), vy: Math.round(P.vy),
  };
  spawnShot(ev, P.i);
  send(ev);

  if (!def.infinite) P.ammo[P.active]--;
  P.cds[P.active] = Math.max(0, P.cds[P.active]) + def.cd;
  P.recoil = def.recoil;
  if (def.bloom) P.bloom = Math.min(def.bloomMax, P.bloom + def.bloom);
  if (def.push) {                       // recul physique (léger)
    P.vx -= ca * def.push;
    if (!P.onGround) P.vy -= sa * def.push * 0.8;
  }
  if (def.casing) FX.casingFx(sx + ca * 18, sy + sa * 18 - 3, P.facing, !!def.bigCasing);
  if (def.id === 'sniper' || def.id === 'shotgun' || def.id === 'bazooka') G.shake = Math.min(1, G.shake + 0.18);
  if (def.id === 'railgun') G.shake = Math.min(1, G.shake + 0.35);
}

/* Mon boomerang revient dans ma main. */
export function boomerangCaught() {
  const P = S.P;
  if (!P) return;
  const idx = P.weapons.indexOf('boomerang');
  if (idx >= 0) { P.ammo[idx] = WEAPONS.boomerang.mag; if (P.active === idx) P.reloadT = 0; }
}

/* Réaction d'un tireur distant (animation de recul). */
export function remoteFired(slot, w) {
  const p = S.others.get(slot);
  if (!p) return;
  const def = WEAPONS[w];
  p.recoil = def.recoil;
  const idx = p.weapons.indexOf(w);
  if (idx >= 0) p.active = idx;
  if (def.casing) {
    const sx = p.x, sy = p.y + shoulderY(p);
    FX.casingFx(sx + Math.cos(p.aim) * 18, sy + Math.sin(p.aim) * 18 - 3, p.facing, !!def.bigCasing);
  }
}

/* ---------------------------- Kits de soin ---------------------------- */
function checkKits(P) {
  if (P.hp >= MAX_HP) return;
  for (let i = 0; i < S.kits.length; i++) {
    const k = S.kits[i];
    if (!k.on || (k.reqT || 0) > G.time) continue;
    if (Math.abs(P.x - k.x) < 34 && P.y > k.y - 80 && P.y < k.y + 12) {
      k.reqT = G.time + 0.5;           // une demande à la fois : c'est l'hôte qui tranche
      events.requestKit && events.requestKit(i);
    }
  }
}
export function healLocal() {
  const P = S.P;
  P.hp = Math.min(MAX_HP, P.hp + HEAL_AMOUNT);
  sendState();
}

/* -------------------------- Mort / réapparition ----------------------- */
function respawnLocal() { spawnLocalAt(pickSpawn()); }

/* Apparition du joueur local sur un point donné (début de manche ou réapparition). */
export function spawnLocalAt(s) {
  const P = S.P;
  P.x = P.px = s.x; P.y = P.py = s.y;
  P.vx = P.vy = 0;
  P.hp = MAX_HP; P.alive = true; P.invuln = INVULN_TIME;
  P.sq++;
  P.ammo = [WEAPONS[P.weapons[0]].mag, WEAPONS[P.weapons[1]].mag];
  P.reloadT = 0; P.cds = [0, 0]; P.switchT = 0; P.bloom = 0;
  P.lastHitBy = -1; P.jumps = 0; P.onGround = false; P.dashT = 0; P.dashCd = 0;
  P.slideT = 0; P.sliding = false; P.diving = false; P.h = 0;
  P.burnT = 0; P.charge = 0;
  FX.spawnFx(P.x, P.y, P.color);
  sendState();
}

/* Point de spawn le plus loin possible des adversaires en vie. */
function pickSpawn() {
  const spawns = G.map.spawns;
  const foes = [];
  for (const o of S.others.values()) if (o.alive) foes.push(o);
  for (const d of S.dummies) if (d.alive) foes.push(d);
  if (!foes.length) return spawns[Math.floor(Math.random() * spawns.length)];
  let best = spawns[0], bestD = -1;
  for (const s of spawns) {
    let dmin = Infinity;
    for (const f of foes) dmin = Math.min(dmin, Math.hypot(f.x - s.x, f.y - s.y));
    dmin += Math.random() * 60;       // un peu de variété entre points équivalents
    if (dmin > bestD) { bestD = dmin; best = s; }
  }
  return best;
}
export function initialSpawn(slot) {
  const spawns = G.map.spawns;
  /* Départs répartis : un point sur deux, décalé selon le slot. */
  return spawns[(slot * 3 + 1) % spawns.length];
}

/* =================== DÉGÂTS : LA VICTIME ARBITRE ===================== */
/* Appelé par weapons.js quand un projectile ou une explosion me touche. */
export function hitLocal(dmg, owner, w, hs, id, ix, iy, x, y, blast) {
  const P = S.P;
  if (!P || !P.alive || P.invuln > 0 || G.phase !== 'play') return;
  dmg = Math.max(1, Math.round(dmg));
  P.hp -= dmg;
  if (owner !== P.i) { P.lastHitBy = owner; P.lastHitT = G.time; }
  if (w === 'flame' && id) { P.burnT = BURN_TIME; P.burnBy = owner; }   // touché par une flamme : on prend feu
  G.hurt = Math.min(1, G.hurt + dmg / 70);
  G.shake = Math.min(1, G.shake + dmg / 160);
  if (!blast) { P.vx += ix * 0.05; if (!P.onGround) P.vy += iy * 0.03; }

  const m = { t: 'h', id: id || '', o: owner, d: dmg, hs: hs ? 1 : 0, x: Math.round(x), y: Math.round(y) };
  send(m);
  onHit(m, P.i);
  if (P.hp <= 0) {
    const k = blast ? 1.3 : (w === 'sniper' ? 0.35 : 0.3);
    dieLocal(owner, w, hs, ix * k, iy * k);
  } else sendState();
}

/* Traitement d'un impact confirmé (localement ou reçu du réseau). */
export function onHit(m, victim) {
  if (m.id) removeProjectile(m.id, false);
  const col = COLORS[victim] || '#fff';
  FX.hitFx(m.x, m.y, col, m.d, !!m.hs);
  if (m.o >= 0 && m.o !== victim && S.score[m.o]) {
    const key = String(m.id).split('/')[0];
    if (!countedHits.has(key)) {
      countedHits.add(key);
      if (countedHits.size > 2000) countedHits.clear();
      S.score[m.o].hits++;
    }
  }
  if (m.o === G.slot && victim !== G.slot) { G.hitMarker = 0.22; G.hitMarkerHs = !!m.hs; }
  const p = S.others.get(victim);
  if (p) p.hp = Math.max(0, p.hp - m.d);
}

/* Ma mort : c'est moi qui annonce le kill et qui m'a tué. */
function dieLocal(owner, w, hs, ix, iy) {
  const P = S.P;
  let killer;
  if (owner >= 0 && owner !== P.i) killer = owner;
  else killer = (P.lastHitBy >= 0 && G.time - P.lastHitT <= ASSIST_WINDOW) ? P.lastHitBy : -1;
  P.alive = false;
  P.hp = 0;
  P.respawnT = RESPAWN_DELAY;
  P.slideT = 0; P.sliding = false; P.diving = false; P.h = 0;
  P.burnT = 0; P.charge = 0;
  const m = {
    t: 'k', k: killer, w: w, hs: hs ? 1 : 0,
    ix: Math.round(ix + P.vx * 0.5), iy: Math.round(iy + P.vy * 0.5), x: Math.round(P.x), y: Math.round(P.y),
    /* La victime tire le texte de kill au sort et l'annonce : tout le monde voit le même. */
    tx: killer >= 0 ? pickKillText() : '',
  };
  send(m);
  onKill(m, P.i);
  sendState();
}

/* Traitement d'un kill (le mien ou annoncé par la victime). */
export function onKill(m, victim) {
  const sc = S.score;
  if (sc[victim]) sc[victim].d++;
  if (m.k >= 0 && m.k !== victim && sc[m.k]) sc[m.k].k++;
  else if (sc[victim]) sc[victim].k--;       // suicide : aucun point, -1 pour soi
  S.feed.push({ k: m.k, v: victim, w: m.w, hs: !!m.hs, t: performance.now() });
  if (S.feed.length > 6) S.feed.shift();

  const body = victim === G.slot ? S.P : S.others.get(victim);
  if (body) {
    if (victim !== G.slot) { body.x = m.x; body.y = m.y; }
    computePose(body, body.x, body.y, performance.now() / 1000);
    makeRagdoll(body, m.ix || 0, m.iy || 0);
    FX.deathFx(body.x, body.y - 42, body.color);
    body.alive = false;
    body.buf.length = 0;
  }
  if (victim === G.slot) G.shake = Math.min(1, G.shake + 0.5);
  if (m.tx && body) FX.killTextFx(body.x, body.y - 110, String(m.tx).slice(0, 20));
  /* la condition de victoire dépend du type de partie : main.js tranche */
  events.afterKill && events.afterKill(m.k, victim);
}

/* ------------------------------ État réseau --------------------------- */
export function sendState() {
  const P = S.P;
  if (!P || G.role === 'solo') return;
  send({
    t: 's',
    x: Math.round(P.x * 10) / 10, y: Math.round(P.y * 10) / 10,
    vx: Math.round(P.vx), vy: Math.round(P.vy),
    a: Math.round(P.aim * 1000) / 1000,
    g: P.onGround ? 1 : 0, w: P.active, hp: P.hp, al: P.alive ? 1 : 0,
    iv: P.invuln > 0 ? 1 : 0, sq: P.sq, jc: P.jc, dc: P.dc, rl: P.reloadT > 0 ? 1 : 0,
    sl: P.sliding ? 1 : 0, sd: P.slideDir,
    bu: P.burnT > 0 ? 1 : 0, ch: Math.round(P.charge * 10) / 10,
  });
}

/* ============================ JOUEURS DISTANTS ======================== */
export function receiveState(p, m) {
  const now = performance.now();
  if (m.sq !== p.sq) {
    /* Nouvelle vie : pas d'interpolation depuis l'ancienne position. */
    p.sq = m.sq;
    p.buf.length = 0;
    p.x = m.x; p.y = m.y; p.vx = 0; p.vy = 0;
    if (m.al && G.phase === 'play') FX.spawnFx(m.x, m.y, p.color);
  }
  if (m.jc !== undefined && p.jc !== undefined && m.jc !== p.jc && m.al) FX.jumpPuff(m.x, m.y);
  p.jc = m.jc;
  if (m.dc !== undefined && p.dc !== undefined && m.dc !== p.dc && m.al) {
    p.dashing = 0.2;
    FX.dashFx(m.x, m.y, m.vx >= 0 ? 1 : -1, p.color);
  }
  p.dc = m.dc;
  p.buf.push({ t: now, x: m.x, y: m.y, vx: m.vx, vy: m.vy, a: m.a, g: m.g });
  if (p.buf.length > 24) p.buf.shift();
  p.hp = m.hp;
  p.alive = !!m.al;
  p.invuln = m.iv ? 1 : 0;
  p.active = m.w;
  p.reloading = !!m.rl;
  if (m.sl && !p.sliding && m.al) FX.slideFx(m.x, m.y, m.sd || 1);
  p.sliding = !!m.sl;
  p.burning = !!m.bu;
  p.charge = m.ch || 0;
  p.slideDir = m.sd || 1;
  p.lastSeen = now;
  if (!p.seen) { p.seen = true; p.x = m.x; p.y = m.y; p.aim = m.a; }
}

/* Interpolation avec un léger retard : on affiche le passé récent, entre
   deux paquets connus, ce qui reste fluide malgré la gigue du réseau. */
export function interpolateRemote(p, now) {
  const buf = p.buf;
  if (!buf.length) return;
  const rt = now - INTERP_DELAY;
  let a = null, b = null;
  for (let i = buf.length - 1; i >= 0; i--) {
    if (buf[i].t <= rt) { a = buf[i]; b = buf[i + 1] || null; break; }
  }
  if (!a) { a = buf[0]; b = null; }
  let x, y, vx, vy, ang, g;
  if (b) {
    const k = (rt - a.t) / Math.max(1, b.t - a.t);
    x = a.x + (b.x - a.x) * k; y = a.y + (b.y - a.y) * k;
    vx = a.vx + (b.vx - a.vx) * k; vy = a.vy + (b.vy - a.vy) * k;
    ang = a.a + angDiff(a.a, b.a) * k;
    g = k < 0.5 ? a.g : b.g;
  } else {
    /* Plus de paquet récent : courte extrapolation, puis on s'arrête. */
    const e = clamp((rt - a.t) / 1000, 0, 0.12);
    x = a.x + a.vx * e; y = a.y + a.vy * e;
    vx = a.vx; vy = a.vy; ang = a.a; g = a.g;
  }
  p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.aim = ang; p.onGround = !!g;
  p.facing = Math.cos(ang) >= 0 ? 1 : -1;
  while (buf.length > 2 && buf[1].t < rt - 200) buf.shift();
}

/* ============================== ANIMATION ============================= */
/* Mise à jour commune (local et distants), à la fréquence d'affichage. */
export function animate(p, dt) {
  const spd = Math.abs(p.vx);
  if (p.onGround && spd > 30) {
    const before = Math.floor(p.run / Math.PI);
    p.run += dt * spd * 0.042;
    if (Math.floor(p.run / Math.PI) !== before && spd > 150 && p.alive) FX.footPuff(p.x - Math.sign(p.vx) * 6, p.y);
  }
  if (!p.onGround) p.fallV = Math.max(p.fallV, p.vy);
  if (p.onGround && !p.wasGround && p.alive) {
    const s = clamp((p.fallV - 250) / 1100, 0, 1);
    if (p.fallV > 250) { p.landT = 0.3 + 0.7 * s; FX.landDust(p.x, p.y, s); }
    p.fallV = 0;
  }
  if (p.onGround) p.fallV = 0;
  p.wasGround = p.onGround;
  p.landT = Math.max(0, p.landT - dt * 4);
  /* traînée pendant un dash (local : dashT, distant : fenêtre après l'annonce) */
  if (p.dashing > 0) p.dashing -= dt;
  if (p.alive && (p.dashT > 0 || p.dashing > 0)) FX.dashTrail(p.x, p.y, p.color);
  if (p.alive && p.sliding && p.onGround && Math.abs(p.vx) > 180) FX.slideTrail(p.x - Math.sign(p.vx) * 10, p.y);
  if (p.alive && (p.burnT > 0 || p.burning) && Math.random() < dt * 40) FX.burnFx(p.x, p.y);
  p.recoil = Math.max(0, p.recoil - dt * 7);
}

/* Cinématique inverse à deux os : renvoie l'articulation (genou, coude). */
function ik(ax, ay, bx, by, l1, l2, bend, out) {
  let dx = bx - ax, dy = by - ay;
  let d = Math.hypot(dx, dy);
  const maxd = l1 + l2 - 0.01;
  if (d > maxd) { dx *= maxd / d; dy *= maxd / d; d = maxd; }
  if (d < 0.01) { out.x = ax; out.y = ay + l1; return; }
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  out.x = ax + dx * a / d - (dy / d) * h * bend;
  out.y = ay + dy * a / d + (dx / d) * h * bend;
}
function set(pt, x, y) { pt.x = x; pt.y = y; }

/* Pose procédurale du stickman : tête, tronc, bras qui tiennent l'arme et
   suivent la visée, jambes (course, saut, chute, atterrissage). */
export function computePose(p, x, y, t) {
  const o = p.pose;
  const f = p.facing;
  const spd = clamp(Math.abs(p.vx) / PHYS.RUN, 0, 1.3);
  const md = p.vx > 25 ? 1 : p.vx < -25 ? -1 : f;
  const grounded = p.onGround;
  let bob = 0;
  if (grounded) bob = spd > 0.1 ? -Math.abs(Math.sin(p.run)) * 4 * spd : Math.sin(t * 2.4 + p.i) * 1.1;
  bob += p.landT * 9;

  if (p.sliding) return slidePose(p, x, y, t);
  const hipY = y - 40 + bob;
  const lean = clamp(p.vx / PHYS.RUN, -1.3, 1.3) * 0.12 - Math.sin(p.aim) * 0.04 * f;
  set(o.hip, x, hipY);
  set(o.neck, x + Math.sin(lean) * 24, hipY - Math.cos(lean) * 24);
  const hk = headScale();
  set(o.head, o.neck.x + Math.cos(p.aim) * 2.5 * hk, o.neck.y - 11.5 * hk + Math.sin(p.aim) * 1.5);
  set(o.sh, o.neck.x, o.neck.y + 4);

  /* Jambes */
  const legs = [o.footL, o.footR], knees = [o.kneeL, o.kneeR];
  for (let j = 0; j < 2; j++) {
    const foot = legs[j];
    if (grounded) {
      if (spd > 0.1) {
        const ph = p.run + j * Math.PI, k = Math.min(1, spd);
        set(foot, x + md * Math.cos(ph) * 17 * k, y - Math.max(0, -Math.sin(ph)) * 11 * k);
      } else set(foot, x + (j ? 7 : -7), y);
    } else if (p.vy < 0) {                         // montée : jambes repliées
      set(foot, x + md * (j ? 9 : -5), hipY + (j ? 26 : 32));
    } else {                                       // chute : jambes écartées, prêtes à l'impact
      const sw = Math.sin(t * 9 + j * 2) * 2;
      set(foot, x + (j ? 11 : -9) * md + sw, hipY + 38);
    }
    ik(o.hip.x, o.hip.y, foot.x, foot.y, 21, 21, -md, knees[j]);
  }

  /* Bras : l'arme suit la souris, recul visuel à chaque tir. */
  const a = p.aim, ca = Math.cos(a), sa = Math.sin(a);
  const r = p.recoil * 7;
  const wId = p.weapons[p.active];
  o.oneHand = wId === 'knives' || wId === 'grenade';
  set(o.handB, o.sh.x + ca * (13 - r), o.sh.y + sa * (13 - r));
  if (o.oneHand) set(o.handF, o.sh.x - f * 5 + Math.sin(t * 2 + p.i) * 1.5, o.sh.y + 23);
  else set(o.handF, o.sh.x + ca * (25 - r) + sa * f * 1.5, o.sh.y + sa * (25 - r) + 1.5);
  elbow(o.sh, o.handB, o.elbB);
  elbow(o.sh, o.handF, o.elbF);
  return o;
}
/* Pose couchée de la glissade : dos en arrière, jambes tendues devant. */
function slidePose(p, x, y, t) {
  const o = p.pose;
  const d = p.slideDir || p.facing;
  const hk = headScale();
  set(o.hip, x + d * 4, y - 12);
  set(o.neck, x - d * 10, y - 32);
  set(o.head, o.neck.x - d * 2 + Math.cos(p.aim) * 2 * hk, o.neck.y - 11.5 * hk);
  set(o.sh, o.neck.x + d * 1, o.neck.y + 4);
  set(o.footR, x + d * 34, y - 3);
  set(o.footL, x + d * 28, y - 1);
  ik(o.hip.x, o.hip.y, o.footR.x, o.footR.y, 21, 21, d, o.kneeR);
  ik(o.hip.x, o.hip.y, o.footL.x, o.footL.y, 21, 21, d, o.kneeL);
  const a = p.aim, ca = Math.cos(a), sa = Math.sin(a), r = p.recoil * 7;
  const wId = p.weapons[p.active];
  o.oneHand = wId === 'knives' || wId === 'grenade';
  set(o.handB, o.sh.x + ca * (13 - r), o.sh.y + sa * (13 - r));
  if (o.oneHand) set(o.handF, o.sh.x - d * 10, y - 4);            // main en appui au sol
  else set(o.handF, o.sh.x + ca * (25 - r), o.sh.y + sa * (25 - r) + 1.5);
  elbow(o.sh, o.handB, o.elbB);
  elbow(o.sh, o.handF, o.elbF);
  return o;
}

/* Le coude plie toujours vers le bas (le plus naturel pour tenir une arme). */
const _e1 = { x: 0, y: 0 }, _e2 = { x: 0, y: 0 };
function elbow(sh, hand, out) {
  ik(sh.x, sh.y, hand.x, hand.y, 14, 14, 1, _e1);
  ik(sh.x, sh.y, hand.x, hand.y, 14, 14, -1, _e2);
  const e = _e1.y > _e2.y ? _e1 : _e2;
  out.x = e.x; out.y = e.y;
}

/* =============================== RAGDOLL ============================== */
/* Points : 0 tête, 1 cou, 2 bassin, 3-4 bras arrière, 5-6 bras avant,
   7-8 jambe gauche, 9-10 jambe droite. Purement local. */
const BONES = [
  [0, 1, 11.5], [1, 2, 24], [1, 3, 14], [3, 4, 14], [1, 5, 14], [5, 6, 14],
  [2, 7, 21], [7, 8, 21], [2, 9, 21], [9, 10, 21], [0, 2, 35],
];
/* Longueur d'un os selon la taille de tête (Big Head allonge le cou). */
const boneLen = (bn, hk) => (bn[0] === 0 ? bn[2] + (hk - 1) * 11.5 : bn[2]);
export function makeRagdoll(p, ix, iy) {
  const o = p.pose;
  const src = [o.head, o.neck, o.hip, o.elbB, o.handB, o.elbF, o.handF, o.kneeL, o.footL, o.kneeR, o.footR];
  const dt = 1 / 60;
  const pts = src.map((q, idx) => {
    /* L'impulsion porte surtout sur le haut du corps : le corps tournoie. */
    const w = idx <= 1 ? 1.25 : idx >= 7 ? 0.75 : 1;
    const vx = (p.vx * 0.6 + ix * w + (Math.random() - 0.5) * 60) * dt;
    const vy = (p.vy * 0.6 + iy * w + (Math.random() - 0.5) * 60) * dt;
    return { x: q.x, y: q.y, ox: q.x - vx, oy: q.y - vy };
  });
  /* Le chapeau s'envole à la mort et vit sa propre vie. */
  let hat = null;
  if (p.outfit && p.outfit.hat.id !== 'none') {
    hat = {
      x: o.head.x, y: o.head.y, vx: (ix * 1.3 + p.vx) * 0.8 + (Math.random() - 0.5) * 120,
      vy: iy * 1.2 - 420 - Math.random() * 200, rot: 0, vr: (Math.random() - 0.5) * 18 + ix * 0.01, rest: false,
    };
  }
  S.ragdolls.push({
    pts: pts, color: p.color, dark: p.dark, life: RAGDOLL_LIFE, weapon: p.weapons[p.active],
    outfit: p.outfit, facing: p.facing, hk: headScale(), hat: hat,
  });
  if (S.ragdolls.length > MAX_RAGDOLLS) S.ragdolls.shift();
}

export function updateRagdolls(dt) {
  const g = PHYS.GRAVITY * dt * dt;
  for (let i = S.ragdolls.length - 1; i >= 0; i--) {
    const rd = S.ragdolls[i];
    rd.life -= dt;
    if (rd.life <= 0 || rd.pts[2].y > G.map.h + 800) { S.ragdolls.splice(i, 1); continue; }
    updateHat(rd.hat, dt);
    for (const q of rd.pts) {
      let vx = (q.x - q.ox) * 0.992, vy = (q.y - q.oy) * 0.992 + g;
      const px = q.x, py = q.y;
      q.ox = px; q.oy = py;
      q.x += vx; q.y += vy;
      if (solidAt(q.x, q.y)) {
        if (!solidAt(px, q.y)) { q.x = px; vx = -vx * 0.3; vy *= 0.8; }
        else if (!solidAt(q.x, py)) { q.y = py; vy = -vy * 0.25; vx *= 0.6; }
        else { q.x = px; q.y = py; vx = 0; vy = 0; }
        q.ox = q.x - vx; q.oy = q.y - vy;
      } else if (vy > 0) {
        const pl = platCrossed(q.x, py, q.y);
        if (pl) { q.y = pl.y - 0.5; q.ox = q.x - vx * 0.6; q.oy = q.y + vy * 0.2; }
      }
    }
    for (let it = 0; it < 4; it++) {
      for (const bn of BONES) {
        const a = rd.pts[bn[0]], b = rd.pts[bn[1]];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const diff = (d - boneLen(bn, rd.hk)) / d * (bn[0] === 0 && bn[1] === 2 ? 0.2 : 0.5);
        a.x += dx * diff; a.y += dy * diff;
        b.x -= dx * diff; b.y -= dy * diff;
      }
    }
  }
}
export const ragdollAlpha = (rd) => Math.min(1, rd.life / RAGDOLL_FADE);

/* Chapeau envolé : chute, rebond, puis repos au sol. */
function updateHat(h, dt) {
  if (!h || h.rest) return;
  const ox = h.x, oy = h.y;
  h.vy += PHYS.GRAVITY * 0.8 * dt;
  h.x += h.vx * dt; h.y += h.vy * dt; h.rot += h.vr * dt;
  if (solidAt(h.x, h.y)) {
    if (!solidAt(ox, h.y)) { h.x = ox; h.vx *= -0.4; }
    else { h.y = oy; h.vy *= -0.3; h.vx *= 0.6; h.vr *= 0.5; }
  } else if (h.vy > 0) {
    const pl = platCrossed(h.x, oy, h.y);
    if (pl) { h.y = pl.y - 1; h.vy *= -0.3; h.vx *= 0.6; h.vr *= 0.5; }
  }
  if (Math.abs(h.vy) < 40 && Math.abs(h.vx) < 20 && (solidAt(h.x, h.y + 3) || platCrossed(h.x, h.y, h.y + 3))) {
    h.rest = true; h.rot = Math.round(h.rot / Math.PI) * Math.PI;   // se pose à l'endroit ou à l'envers
  }
}

/* Les explosions projettent aussi les corps. */
export function blastRagdolls(x, y, r, kb) {
  const dt = 1 / 60;
  for (const rd of S.ragdolls) {
    for (const q of rd.pts) {
      const dx = q.x - x, dy = q.y - y, d = Math.hypot(dx, dy);
      if (d > r || d < 0.01) continue;
      const f = (1 - d / r) * kb * dt;
      q.ox -= dx / d * f; q.oy -= (dy / d) * f + f * 0.3;
    }
  }
}

/* ===================== MANNEQUINS (entraînement solo) ================== */
export function makeDummies() {
  S.dummies = [];
  const sp = G.map.spawns;
  const picks = [sp[1], sp[4], sp[sp.length - 1]];
  picks.forEach((s, n) => {
    /* Les mannequins portent une tenue au hasard. */
    const rnd = (list) => Math.floor(Math.random() * list.length);
    const d = makePlayer(1 + (n % 3), ['smg', 'sniper'], [rnd(HATS), rnd(JACKETS), rnd(PANTS), rnd(SHOES)]);
    d.dummy = true;
    d.home = s;
    d.x = d.px = s.x; d.y = d.py = s.y;
    d.alive = true; d.lastHurt = -99;
    S.dummies.push(d);
  });
}

export function updateDummies(dt) {
  const P = S.P;
  for (const d of S.dummies) {
    if (d.bot) continue;                       // les bots de la Survie ont leur propre IA (bots.js)
    d.px = d.x; d.py = d.y;
    if (!d.alive) {
      d.respawnT -= dt;
      if (d.respawnT <= 0) {
        d.x = d.px = d.home.x; d.y = d.py = d.home.y; d.vx = d.vy = 0;
        d.hp = MAX_HP; d.alive = true; d.invuln = 0;
        FX.spawnFx(d.x, d.y, d.color);
      }
      continue;
    }
    if (P && P.alive) {
      d.aim = Math.atan2(P.y - 50 - (d.y + SHOULDER_Y), P.x - d.x);
      d.facing = Math.cos(d.aim) >= 0 ? 1 : -1;
    }
    steer(d, 0, dt);
    d.vy = Math.min(d.vy + PHYS.GRAVITY * dt, PHYS.MAX_FALL);
    moveBody(d, dt);
    if (G.time - d.lastHurt > DUMMY_REGEN) d.hp = Math.min(MAX_HP, d.hp + 60 * dt);
    const map = G.map;
    if (d.y > map.killY || (map.water && d.y > map.water + 30) || d.x < -400 || d.x > map.w + 400) {
      if (map.water && d.y > map.water) FX.waterSplash(d.x, map.water, true);
      killDummy(d, 0, 0);
    }
  }
}

export function hitDummy(d, dmg, w, hs, id, ix, iy, x, y, blast) {
  if (!d.alive) return;
  dmg = Math.max(1, Math.round(dmg));
  d.hp -= dmg;
  d.lastHurt = G.time;
  FX.hitFx(x, y, d.color, dmg, hs);
  if (id) removeProjectile(id, false);
  G.hitMarker = 0.22; G.hitMarkerHs = hs;
  S.score[G.slot].hits++;
  if (blast || Math.abs(ix) > 900) { d.vx += ix; d.vy += iy; d.onGround = false; }
  else d.vx += ix * 0.05;
  if (d.hp <= 0) {
    const k = blast ? 1.3 : 0.3;
    killDummy(d, ix * k, iy * k, w, hs);
  }
}
export function killDummy(d, ix, iy, w, hs) {
  if (!d.alive) return;
  d.alive = false;
  d.respawnT = RESPAWN_DELAY;
  computePose(d, d.x, d.y, performance.now() / 1000);
  makeRagdoll(d, ix, iy);
  FX.deathFx(d.x, d.y - 42, d.color);
  if (w) {
    FX.killTextFx(d.x, d.y - 110, pickKillText());
    S.score[G.slot].k++;
    S.feed.push({ k: G.slot, v: d.bot ? -3 : -2, w: w, hs: !!hs, t: performance.now() });
    if (S.feed.length > 6) S.feed.shift();
  }
}
