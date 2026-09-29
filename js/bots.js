/* ==========================================================================
   Mode Survie (solo) : vagues de bots sans fin.

   La vague n fait apparaître min(n, 10) bots en même temps ; la suivante
   commence quand tous sont tombés. Au-delà, les bots deviennent plus
   résistants, visent mieux, tirent plus vite et sortent de meilleures armes.
   Les bots réutilisent les mannequins (physique, dégâts, ragdoll) : ils y
   ajoutent une IA de déplacement et de tir. Tout est local, rien ne passe
   par le réseau.
   ========================================================================== */
import { G, S, MAX_HP, SURV_LIVES, TAU, clamp, rand, hash2, livesLeft } from './state.js';
import { PHYS, moveBody, steer, segmentBlocked, solidAt } from './physics.js';
import { WEAPONS, spawnShot } from './weapons.js';
import { makePlayer, killDummy } from './player.js';
import { HATS, JACKETS, PANTS, SHOES } from './outfit.js';
import * as FX from './particles.js';

/* ------------------------------ Réglages ------------------------------ */
export const SURV = {
  MAX_BOTS:     10,     // bots simultanés au maximum (atteint à la vague 10)
  FIRST_DELAY:  2.5,    // avant la première vague (s)
  BREAK:        4,      // pause entre deux vagues (s)
  SPAWN_GAP:    0.35,   // les bots d'une vague arrivent l'un après l'autre (s)
  HP_BASE:      60,     // PV d'un bot à la vague 1…
  HP_WAVE:      6,      // … + 6 par vague
  HP_MAX:       180,
  AIM_ERR:      14,     // erreur de visée à la vague 1 (degrés)…
  AIM_ERR_MIN:  2.5,    // … qui descend jusqu'à ça
  FIRE_SLOW:    2.2,    // cadence divisée par ça à la vague 1…
  REACTION:     0.35,   // temps pour réagir quand le joueur entre en vue (s)
  SIGHT:        1500,   // distance de vue
  FALL_CREDIT:  5,      // un bot qui tombe dans les 5 s après avoir été touché : kill pour toi
  LOST_TIME:    25,     // un bot qui ne t'a pas vu depuis 25 s réapparaît plus près (la vague ne bloque jamais)
};

/* Armes disponibles selon la vague (le boomerang, qui revient à son lanceur,
   est réservé aux joueurs). Distance de combat préférée pour chacune. */
const POOLS = [
  { from: 1, list: ['smg', 'shotgun', 'knives'] },
  { from: 3, list: ['grenade', 'flame', 'katana'] },
  { from: 6, list: ['sniper', 'bazooka', 'railgun'] },
];
const PREF = {
  smg: 380, shotgun: 170, knives: 280, grenade: 380, flame: 230, katana: 140,
  sniper: 850, bazooka: 520, railgun: 750,
};
const BOT_SLOTS = [1, 2, 3];      // couleurs des bots (rouge, vert, jaune)

let seq = 0;

/* ------------------------------- Vagues ------------------------------- */
export function startSurvival() {
  buildNav(G.map);
  G.wave = 0;
  G.waveT = SURV.FIRST_DELAY;
  G.waveQueue = 0;
  G.waveSpawnT = 0;
  S.dummies = [];
}

export const botsAlive = () => S.dummies.filter((d) => d.bot && d.alive).length;
export const waveSize = (w) => Math.min(SURV.MAX_BOTS, Math.max(1, w));

export function updateSurvival(dt) {
  /* retire les bots morts dont le ragdoll a eu le temps de partir */
  S.dummies = S.dummies.filter((d) => !d.bot || d.alive || (d.goneT = (d.goneT || 0) + dt) < 0.1);

  /* apparitions échelonnées de la vague en cours */
  if (G.waveQueue > 0) {
    G.waveSpawnT -= dt;
    if (G.waveSpawnT <= 0) { spawnBot(); G.waveQueue--; G.waveSpawnT = SURV.SPAWN_GAP; }
    return;
  }
  if (botsAlive() > 0) return;
  /* vague terminée : courte pause, puis la suivante, plus grosse */
  G.waveT -= dt;
  if (G.waveT <= 0) {
    G.wave++;
    G.waveQueue = waveSize(G.wave);
    G.waveSpawnT = 0;
    G.waveT = SURV.BREAK;
    G.waveBanner = 2.2;
  }
}

/* Un bot apparaît sur un point de spawn éloigné du joueur. */
function spawnBot() {
  const P = S.P;
  const spawns = G.map.spawns.slice().sort((a, b) => dist(b, P) - dist(a, P));
  const pick = spawns[Math.floor(Math.random() * Math.min(4, spawns.length))];
  const pool = POOLS.filter((p) => G.wave >= p.from).flatMap((p) => p.list);
  const w = pool[Math.floor(Math.random() * pool.length)];
  const slot = BOT_SLOTS[seq % BOT_SLOTS.length];
  const rnd = (list) => Math.floor(Math.random() * list.length);
  const b = makePlayer(slot, [w, 'smg'], [rnd(HATS), rnd(JACKETS), rnd(PANTS), rnd(SHOES)]);
  b.bot = true;
  b.dummy = true;
  b.id = seq++;
  b.x = b.px = pick.x + rand(-20, 20); b.y = b.py = pick.y;
  b.maxHp = Math.min(SURV.HP_MAX, SURV.HP_BASE + SURV.HP_WAVE * G.wave);
  b.hp = b.maxHp;
  b.alive = true;
  b.invuln = 0.6;
  b.lastHurt = -99;
  b.ai = {
    cd: rand(0.4, 1.2), seen: 0, dir: 0, jumpCd: 0, stuckT: 0, lastX: b.x, reverseT: 0,
    strafe: rand(-1, 1), strafeT: 0, ammo: WEAPONS[w].mag, reload: 0,
    pref: PREF[w] * rand(0.85, 1.15),
  };
  S.dummies.push(b);
  FX.spawnFx(b.x, b.y, b.color);
}
function dist(a, b) { return b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; }

/* ================================ IA ================================== */
export function updateBots(dt) {
  const P = S.P;
  const target = P && P.alive ? P : null;
  for (const b of S.dummies) {
    if (!b.bot || !b.alive) continue;
    b.px = b.x; b.py = b.y;
    b.invuln = Math.max(0, b.invuln - dt);
    const ai = b.ai;
    ai.jumpCd = Math.max(0, ai.jumpCd - dt);
    ai.cd -= dt;

    /* ---- décision de déplacement ---- */
    let dir = 0;
    /* Le joueur est sur une autre surface et hors de portée : on suit le
       chemin calculé sur le graphe de navigation (sauts, chutes, montées). */
    const route = target ? navRoute(b, target, dt) : null;
    const engage = target && ai.seen > 0.2 && Math.hypot(target.x - b.x, target.y - b.y) < ai.pref * 1.25;
    if (route && !engage) {
      dir = navSteer(b, route.cur, route.next, target);
    } else if (target) {
      const dx = target.x - b.x, dy = target.y - b.y;
      const d = Math.abs(dx);
      const side = Math.sign(dx) || 1;
      /* hors de vue depuis un moment : on va le chercher, sans garder ses distances */
      if (ai.hidden > 1.2) {
        dir = d > 40 ? side : 0;
        if (b.onGround && ai.jumpCd <= 0 && Math.random() < dt * 1.5 && safeAhead(b, dir)) jump(b);
      } else if (d > ai.pref + 70) dir = side;          // trop loin : on approche
      else if (d < ai.pref - 90) dir = -side;           // trop près : on recule
      else {                                            // à bonne distance : on bouge un peu
        ai.strafeT -= dt;
        if (ai.strafeT <= 0) { ai.strafe = Math.random() < 0.35 ? 0 : (Math.random() < 0.5 ? -1 : 1); ai.strafeT = rand(0.5, 1.4); }
        dir = ai.strafe;
      }
      /* joueur plus haut : on saute pour grimper aux plateformes */
      if (dy < -130 && b.onGround && ai.jumpCd <= 0 && Math.random() < dt * 3 && safeAhead(b, dir)) jump(b);
      /* joueur plus bas et nous sur une plateforme traversable : on se laisse
         tomber, mais seulement s'il y a un sol en dessous (pas le vide) */
      if (dy > 150 && b.onGround && b.ground && b.ground.h === undefined && d < 400
          && surfaceAt(b.x, b.y + 4, G.map.killY) !== null) b.dropT = PHYS.DROP_T;
    } else {
      ai.strafeT -= dt;
      if (ai.strafeT <= 0) { ai.strafe = Math.random() < 0.5 ? 0 : (Math.random() < 0.5 ? -1 : 1); ai.strafeT = rand(0.8, 2); }
      dir = ai.strafe;
    }
    if (ai.reverseT > 0) { ai.reverseT -= dt; dir = -ai.dir || dir; }

    /* ---- bord : si un sol existe plus bas, on s'y laisse tomber ; si c'est le
       vide, on s'arrête, ou on saute si la cible est de l'autre côté ---- */
    if (dir !== 0 && b.onGround && surfaceAt(b.x + dir * 34, b.y - 2, G.map.killY) === null) {
      const across = target && (route ? true : Math.sign(target.x - b.x) === dir);
      if (across && landingAhead(b.x, b.y, dir)) { jump(b); ai.gapJump = true; }
      else dir = 0;
    }
    /* en l'air au-dessus du vide : on se rabat vers le sol le plus proche,
       double saut compris (instinct de survie) */
    if (!b.onGround && b.vy > -150 && surfaceAt(b.x, b.y - 2, G.map.killY) === null
        && (!route || b.y > route.next.y + 5)) {
      const back = nearestGround(b.x, b.y - (b.jumps < 2 ? 150 : 0));
      if (back) dir = back;
      /* double saut vers le sommet du saut : c'est là qu'il porte le plus haut */
      if (b.jumps < 2) { b.vy = -PHYS.DJUMP_V; b.jumps = 2; FX.jumpPuff(b.x, b.y); }
    }
    /* en l'air sans avoir prévu de franchir un vide (saut d'obstacle, recul…) :
       on ne se laisse pas emporter au-dessus du vide, on retombe sur place */
    if (b.onGround) ai.gapJump = false;
    else if (!ai.gapJump) {
      const mv = dir || Math.sign(b.vx);
      if (mv !== 0 && surfaceAt(b.x + mv * 40, b.y - 2, G.map.killY) === null) dir = Math.abs(b.vx) > 40 ? -Math.sign(b.vx) : 0;   // on freine
    }

    /* mur devant : saut */
    const blocked = b.hitWall;
    b.hitWall = false;
    if (dir !== 0 && blocked && b.onGround && ai.jumpCd <= 0) jump(b);

    /* ---- coincé : saut puis demi-tour ---- */
    if (dir !== 0) {
      if (Math.abs(b.x - ai.lastX) < 1) ai.stuckT += dt; else ai.stuckT = 0;
      if (ai.stuckT > 0.6 && b.onGround && ai.jumpCd <= 0) jump(b);
      if (ai.stuckT > 1.5) { ai.reverseT = 1; ai.stuckT = 0; }
    }
    ai.lastX = b.x;
    ai.dir = dir;

    steer(b, dir, dt);
    b.dropT = Math.max(0, (b.dropT || 0) - dt);
    b.vy = Math.min(b.vy + PHYS.GRAVITY * dt, PHYS.MAX_FALL);
    const wasGround = b.onGround;
    moveBody(b, dt);
    if (b.onGround) b.jumps = 0; else if (wasGround && b.jumps === 0) b.jumps = 1;
    /* toujours contre le mur en l'air, au sommet du saut : double saut pour passer */
    if (!b.onGround && b.hitWall && dir !== 0 && b.jumps < 2 && b.vy > -250) {
      b.vy = -PHYS.DJUMP_V; b.jumps = 2; FX.jumpPuff(b.x, b.y);
    }

    /* ---- chute mortelle (le kill te revient si tu l'avais touché juste avant) ---- */
    const map = G.map;
    if (b.y > map.killY || (map.water && b.y > map.water + 30) || b.x < -400 || b.x > map.w + 400) {
      if (map.water && b.y > map.water) FX.waterSplash(b.x, map.water, true);
      killDummy(b, 0, 0, G.time - b.lastHurt <= SURV.FALL_CREDIT ? 'fall' : null, false);
      continue;
    }

    /* ---- visée et tir ---- */
    aimAndFire(b, target, dt);

    /* ---- filet de sécurité : bot égaré trop longtemps, il réapparaît plus près ---- */
    if (target && ai.hidden > SURV.LOST_TIME) {
      const near = G.map.spawns.slice().sort((p, q) => dist(p, target) - dist(q, target))
        .find((p) => dist(p, target) > 350);
      if (near) {
        FX.spawnFx(b.x, b.y, b.color);
        b.x = b.px = near.x; b.y = b.py = near.y; b.vx = b.vy = 0;
        b.invuln = 0.6; ai.hidden = 0; ai.path = null; ai.node = undefined;
        FX.spawnFx(b.x, b.y, b.color);
      }
    }
  }
}

/* ============================ NAVIGATION ============================= */
/* Graphe des surfaces (dessus des blocs, plateformes) reliées par les sauts
   et les chutes possibles. Construit une fois par carte. */
let nav = null;
const JUMP_UP   = 265;      // hauteur atteignable avec saut + double saut
const JUMP_GAP  = 300;      // écart horizontal franchissable à hauteur égale
const FALL_GAP  = 430;      // écart franchissable en tombant

export function buildNav(map) {
  if (map.nav) { nav = map.nav; return; }
  const nodes = [];
  const add = (x0, x1, y, obj, solid) => {
    if (x1 - x0 < 24 || (map.water && y > map.water) || y < 40) return;
    nodes.push({ x0: x0, x1: x1, y: y, obj: obj, solid: solid, cx: (x0 + x1) / 2 });
  };
  /* le décor destructible (caisses, barils…) peut disparaître : on l'ignore */
  for (const o of map.solids) if (!o.hp0) add(o.x, o.x + o.w, o.y, o, true);
  for (const p of map.plats) add(p.x, p.x + p.w, p.y, p, false);
  const adj = nodes.map(() => []);
  nodes.forEach((a, i) => nodes.forEach((b, j) => {
    if (i === j) return;
    const gap = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1));
    const up = a.y - b.y;                      // > 0 : b est plus haut
    if (up > 20) {
      if (up <= JUMP_UP && gap <= JUMP_GAP - up * 0.45) adj[i].push(j);
    } else if (up < -20) {
      /* descendre d'un bloc plein : il faut que la surface du dessous dépasse */
      const overlapOnly = gap === 0 && a.solid && b.x0 >= a.x0 - 8 && b.x1 <= a.x1 + 8;
      if (gap <= FALL_GAP && !overlapOnly) adj[i].push(j);
    } else if (gap <= JUMP_GAP) adj[i].push(j);
  }));
  const byObj = new Map();
  nodes.forEach((n, i) => byObj.set(n.obj, i));
  nav = map.nav = { nodes: nodes, adj: adj, byObj: byObj };
}

function nodeOf(body) {
  if (!nav || !body.onGround || !body.ground) return -1;
  const i = nav.byObj.get(body.ground);
  return i === undefined ? -1 : i;
}
/* Plus court chemin (en nombre de sauts) d'une surface à une autre. */
function bfs(from, to) {
  if (from < 0 || to < 0) return null;
  const prev = new Array(nav.nodes.length).fill(-1);
  prev[from] = from;
  const q = [from];
  while (q.length) {
    const i = q.shift();
    if (i === to) break;
    for (const j of nav.adj[i]) if (prev[j] < 0) { prev[j] = i; q.push(j); }
  }
  if (prev[to] < 0) return null;
  const path = [to];
  while (path[0] !== from) path.unshift(prev[path[0]]);
  return path;
}
/* Prochaine étape du chemin vers la cible, recalculée régulièrement. */
function navRoute(b, target, dt) {
  const ai = b.ai;
  const mine = nodeOf(b);
  if (mine >= 0) ai.node = mine;
  const theirs = nodeOf(target);
  if (theirs >= 0) ai.goal = theirs;
  if (ai.node === undefined || ai.goal === undefined || ai.node === ai.goal) { ai.path = null; return null; }
  ai.pathT = (ai.pathT || 0) - dt;
  if (!ai.path || ai.pathT <= 0 || ai.path[0] !== ai.node) {
    ai.path = bfs(ai.node, ai.goal);
    ai.pathT = 0.5;
  }
  if (!ai.path || ai.path.length < 2) return null;
  return { cur: nav.nodes[ai.path[0]], next: nav.nodes[ai.path[1]] };
}
/* Pilotage vers la surface suivante : se placer, sauter, se diriger en l'air. */
function navSteer(b, cur, next, target) {
  const nx0 = next.x0 + 14, nx1 = next.x1 - 14;
  const aimX = clamp(b.x, nx0, Math.max(nx0, nx1));
  if (next.y < cur.y - 20) {
    /* surface plus haute */
    if (!b.onGround) {
      if (b.ai.gapJump && b.jumps < 2 && b.vy > -120 && b.y > next.y - 8 && clearAbove(b)) { b.vy = -PHYS.DJUMP_V; b.jumps = 2; FX.jumpPuff(b.x, b.y); }
      return Math.abs(aimX - b.x) < 8 ? 0 : Math.sign(aimX - b.x);
    }
    const overlap = next.x0 < cur.x1 && next.x1 > cur.x0;
    let tx;
    if (overlap && !next.solid) {
      /* plateforme traversable au-dessus : on saute à travers depuis dessous */
      tx = clamp(b.x, Math.max(nx0, cur.x0 + 14), Math.min(nx1, cur.x1 - 14));
    } else if (overlap) {
      /* bloc posé sur notre surface : on se met à côté puis on saute dessus */
      const left = next.x0 - 34, right = next.x1 + 34;
      const okL = left > cur.x0 + 4, okR = right < cur.x1 - 4;
      tx = okL && (!okR || Math.abs(b.x - left) < Math.abs(b.x - right)) ? left : right;
    } else tx = next.x0 > cur.x1 ? cur.x1 - 18 : cur.x0 + 18;   // bord du côté de l'écart
    if (Math.abs(b.x - tx) < 16 && b.ai.jumpCd <= 0) { jump(b); b.ai.gapJump = true; return Math.sign(next.cx - b.x); }
    return Math.sign(tx - b.x);
  }
  const gap = Math.max(0, Math.max(cur.x0, next.x0) - Math.min(cur.x1, next.x1));
  if (next.y > cur.y + 20 && gap < 60) {
    /* surface plus basse et juste à côté : se laisser tomber (à travers une plateforme, ou depuis un bord) */
    if (b.onGround && !cur.solid && b.x >= next.x0 && b.x <= next.x1) { b.dropT = PHYS.DROP_T; return 0; }
    let tx = aimX;
    const hw = PHYS.W / 2 + 2;                      // le corps déborde du centre
    if (tx >= cur.x0 - hw && tx <= cur.x1 + hw) {
      /* la surface du dessous est sous nous : on sort par un bord où elle continue,
         de préférence du côté du joueur */
      const exitL = cur.x0 - hw - 10, exitR = cur.x1 + hw + 10;
      const okL = exitL >= next.x0, okR = exitR <= next.x1;
      const wantL = target ? target.x < b.x : Math.abs(b.x - exitL) < Math.abs(b.x - exitR);
      tx = okL && (!okR || wantL) ? exitL : exitR;
    }
    return Math.abs(tx - b.x) < 8 ? 0 : Math.sign(tx - b.x);
  }
  /* de l'autre côté d'un écart (même hauteur ou plus bas) : on court et on saute au bord */
  if (b.onGround) {
    const edge = next.x0 > cur.x1 ? cur.x1 - 18 : next.x1 < cur.x0 ? cur.x0 + 18 : null;
    if (edge !== null && Math.abs(b.x - edge) < 16 && b.ai.jumpCd <= 0) { jump(b); b.ai.gapJump = true; return Math.sign(next.cx - b.x); }
    if (edge !== null) return Math.sign(edge - b.x) || Math.sign(next.cx - b.x);
  } else if (b.jumps < 2 && b.vy > -120 && surfaceAt(b.x, b.y - 2, G.map.killY) === null) {
    b.vy = -PHYS.DJUMP_V; b.jumps = 2; FX.jumpPuff(b.x, b.y);
  }
  return Math.abs(aimX - b.x) < 8 ? 0 : Math.sign(aimX - b.x);
}

/* Rien au-dessus de la tête (sinon le double saut se cogne à une poutre) ? */
function clearAbove(b) {
  const top = b.y - PHYS.H;
  for (const dy of [30, 80, 130]) for (const dx of [-12, 12]) if (solidAt(b.x + dx, top - dy)) return false;
  return true;
}

/* Sauter dans cette direction ne mène pas droit au vide ? */
function safeAhead(b, dir) {
  if (!dir) return true;
  for (let dx = 40; dx <= 200; dx += 40) if (surfaceAt(b.x + dir * dx, b.y - 260, G.map.killY) === null) return false;
  return true;
}
/* Côté où se trouve la surface la plus proche sous la hauteur y (−1, 1), ou 0. */
function nearestGround(x, y) {
  for (let dx = 30; dx <= 420; dx += 30) {
    if (surfaceAt(x - dx, y, G.map.killY) !== null) return -1;
    if (surfaceAt(x + dx, y, G.map.killY) !== null) return 1;
  }
  return 0;
}

function jump(b) {
  if (b.onGround) { b.vy = -PHYS.JUMP_V; b.jumps = 1; b.onGround = false; }
  else if (b.jumps < 2) { b.vy = -PHYS.DJUMP_V; b.jumps = 2; FX.jumpPuff(b.x, b.y); }
  b.ai.jumpCd = 0.35;
}

/* Sommet de la plus haute surface (dessus d'un bloc ou plateforme) à
   l'abscisse x, entre yMin et yMax ; null s'il n'y en a pas. Un mur dont le
   sommet est au-dessus de yMin ne compte pas : ce n'est pas un sol. L'eau du
   temple non plus. */
function surfaceAt(x, yMin, yMax) {
  let best = null;
  for (const s of G.map.solids) {
    if (!s.dead && x >= s.x && x <= s.x + s.w && s.y >= yMin && s.y <= yMax && (best === null || s.y < best)) best = s.y;
  }
  for (const p of G.map.plats) {
    if (!p.dead && x >= p.x && x <= p.x + p.w && p.y >= yMin && p.y <= yMax && (best === null || p.y < best)) best = p.y;
  }
  if (best !== null && G.map.water && best > G.map.water) return null;
  return best;
}
/* Un saut + double saut atteint-il une surface de l'autre côté ?
   (≈ 330 px plus loin, jusqu'à 260 px plus haut) */
function landingAhead(x, y, dir) {
  for (let dx = 60; dx <= 330; dx += 30) if (surfaceAt(x + dir * dx, y - 260, y + 420) !== null) return true;
  return false;
}

function aimAndFire(b, target, dt) {
  const ai = b.ai;
  const wId = b.weapons[0], def = WEAPONS[wId];
  const sx = b.x, sy = b.y - 60;
  if (ai.reload > 0) { ai.reload -= dt; if (ai.reload <= 0) ai.ammo = def.mag; }
  if (!target) { ai.seen = 0; ai.hidden = 0; b.charge = 0; return; }
  const tx = target.x, ty = target.y - (target.sliding ? 22 : 45);
  const d = Math.hypot(tx - sx, ty - sy);
  const visible = d < SURV.SIGHT && !segmentBlocked(sx, sy, tx, ty);
  ai.seen = visible ? ai.seen + dt : 0;
  ai.hidden = visible ? 0 : (ai.hidden || 0) + dt;

  /* compensation de la chute du projectile : on vise plus haut au loin */
  const t = d / def.speed;
  const lift = def.grav > 0 ? 0.5 * def.grav * t * t : 0;
  const ideal = Math.atan2(ty - lift - sy, tx - sx);
  b.aim += ((ideal - b.aim + Math.PI * 3) % TAU - Math.PI) * Math.min(1, dt * 10);
  b.facing = Math.cos(b.aim) >= 0 ? 1 : -1;

  const range = wId === 'flame' ? 420 : wId === 'katana' ? 300 : wId === 'shotgun' ? 460 : SURV.SIGHT;
  const canShoot = visible && ai.seen > SURV.REACTION && d < range && b.invuln <= 0;
  /* railgun : il charge d'abord (lueur visible), c'est le signal pour esquiver */
  if (def.charge) {
    if (canShoot && ai.cd <= 0 && ai.ammo > 0) b.charge = Math.min(def.charge, (b.charge || 0) + dt);
    else b.charge = Math.max(0, (b.charge || 0) - dt * 2);
    if (b.charge >= def.charge) { fireBot(b, def); b.charge = 0; }
    return;
  }
  if (canShoot && ai.cd <= 0 && ai.ammo > 0) fireBot(b, def);
}

function fireBot(b, def) {
  const ai = b.ai;
  const lvl = G.wave;
  const err = Math.max(SURV.AIM_ERR_MIN, SURV.AIM_ERR - lvl * 1.2) * Math.PI / 180;
  const a = b.aim + (Math.random() * 2 - 1) * err;
  const reach = 13 + def.len;
  const sx = b.x, sy = b.y - 60;
  spawnShot({
    w: def.id, id: 'bot' + b.id + '-' + (seq++), x: sx + Math.cos(a) * reach, y: sy + Math.sin(a) * reach,
    a: a, sp: def.spread, vx: Math.round(b.vx), vy: Math.round(b.vy),
  }, b.i);
  b.recoil = def.recoil;
  const slow = Math.max(1, SURV.FIRE_SLOW - lvl * 0.12);
  ai.cd = def.cd * slow * (def.auto ? 1 : rand(1, 1.4));
  if (!def.infinite) {
    ai.ammo--;
    if (ai.ammo <= 0) { ai.reload = def.reload * slow; ai.cd = Math.max(ai.cd, ai.reload); }
  }
  /* rafales courtes à la mitraillette et au lance-flammes : ça laisse respirer */
  if (def.auto && Math.random() < 0.08) ai.cd = rand(0.5, 1.1);
  if (def.casing) FX.casingFx(sx + Math.cos(a) * 18, sy + Math.sin(a) * 18 - 3, b.facing, !!def.bigCasing);
}

/* Fin de partie quand toutes les vies sont perdues. */
export const survivalOver = () => G.gameType === 'surv' && livesLeft(G.slot) <= 0;
export function survivalBest() {
  try { return Number(localStorage.getItem('rr-surv-best')) || 0; } catch (e) { return 0; }
}
export function saveSurvivalBest(w) {
  try { if (w > survivalBest()) localStorage.setItem('rr-surv-best', String(w)); } catch (e) {}
}
