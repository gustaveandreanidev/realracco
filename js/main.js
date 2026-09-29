/* ==========================================================================
   REALISTIC RACCO — point d'entrée : entrées, écrans, salon, déroulement de
   la partie, aiguillage des messages réseau et boucle à pas fixe.
   ========================================================================== */
import {
  G, S, $, STEP, NET_INTERVAL, MAX_PLAYERS, KIT_RESPAWN, COLORS, COLOR_NAMES, MODES,
  GAME_TYPES, WIN_KILLS, KOTH_TARGET, HILL_TIME, resetScores, playerName, clamp, livesLeft,
} from './state.js';
import { resetDest, applyDestDamage, applyDestRespawn, hostDestTick } from './destruct.js';
import { startSurvival, updateSurvival, updateBots, survivalBest, saveSurvivalBest } from './bots.js';
import { SLOTS, DEFAULT_OUTFIT, cleanOutfit } from './outfit.js';
import { MAPS, prepareMap, drawMapPreview } from './maps.js';
import { PHYS } from './physics.js';
import { WEAPONS, WEAPON_IDS, hooks, spawnShot, explode, updateProjectiles, resetProjectiles, drawWeaponIcon } from './weapons.js';
import * as FX from './particles.js';
import {
  input, events, makePlayer, updateLocal, hitLocal, onHit, onKill, sendState, receiveState,
  interpolateRemote, animate, remoteFired, healLocal, initialSpawn, updateRagdolls, blastRagdolls,
  makeDummies, updateDummies, hitDummy, spawnLocalAt, boomerangCaught,
} from './player.js';
import { cv, cam, resize, render, screenToWorld, snapCamera, buildBackground, ambient, drawCharacterPreview } from './render.js';
import { participants } from './hud.js';
import * as NET from './net.js';

/* ------------------------------ Réglages ------------------------------ */
const FIRE_BUFFER = 0.15;     // un clic un peu trop tôt est quand même tiré (s)
const SLIDE_BUFFER = 0.15;    // idem pour la glissade (clic droit)
const KOTH_NET = 0.25;        // l'hôte diffuse l'état de la colline 4 fois par seconde

/* =============================== ENTRÉES ============================== */
/* On mémorise à la fois e.code (position physique) et e.key (caractère) :
   les touches valent en AZERTY (ZQSD) comme en QWERTY (WASD). */
const keys = new Set();
const K_LEFT  = ['KeyA', 'q', 'a', 'ArrowLeft'];
const K_RIGHT = ['KeyD', 'd', 'ArrowRight'];
const K_JUMP  = ['KeyW', 'z', 'w', 'Space', ' ', 'ArrowUp'];
const K_DOWN  = ['KeyS', 's', 'ArrowDown'];
const lastTap = { dir: 0, t: 0 };
const any = (list) => list.some((k) => keys.has(k));
const inGame = () => G.phase === 'play' || G.phase === 'over';
const typing = (e) => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');

addEventListener('keydown', (e) => {
  if (typing(e)) return;
  const key = e.key ? e.key.toLowerCase() : '';
  if (e.code === 'KeyF' && !e.repeat) { toggleFullscreen(); return; }
  if (!inGame()) return;
  if (e.code === 'Escape') { togglePause(); return; }
  if (paused) return;
  keys.add(e.code); if (key) keys.add(key);
  if (e.code.indexOf('Arrow') === 0 || e.code === 'Space') e.preventDefault();
  if (!e.repeat && (K_JUMP.indexOf(e.code) >= 0 || K_JUMP.indexOf(key) >= 0)) input.jumpQueued = PHYS.JUMP_BUF;
  /* Double appui rapide sur gauche / droite : dash dans cette direction. */
  if (!e.repeat) {
    const dir = (K_LEFT.indexOf(e.code) >= 0 || K_LEFT.indexOf(key) >= 0) ? -1
              : (K_RIGHT.indexOf(e.code) >= 0 || K_RIGHT.indexOf(key) >= 0) ? 1 : 0;
    if (dir) {
      const now = performance.now();
      if (lastTap.dir === dir && now - lastTap.t < PHYS.DASH_TAP * 1000) { input.dashQueued = dir; lastTap.t = 0; }
      else { lastTap.dir = dir; lastTap.t = now; }
    }
  }
  /* & / é : Digit1 / Digit2 en AZERTY comme en QWERTY */
  if (e.code === 'Digit1' || e.code === 'Numpad1' || key === '&' || key === '1') input.switchTo = 0;
  if (e.code === 'Digit2' || e.code === 'Numpad2' || key === 'é' || key === '2') input.switchTo = 1;
  if (e.code === 'KeyR' || key === 'r') input.reloadQueued = true;
});
addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.key) keys.delete(e.key.toLowerCase());
});
addEventListener('blur', () => { keys.clear(); input.fire = false; });

addEventListener('mousemove', (e) => { input.sx = e.clientX; input.sy = e.clientY; });
cv.addEventListener('mousedown', (e) => {
  input.sx = e.clientX; input.sy = e.clientY;
  if (paused || G.phase !== 'play') return;
  if (e.button === 0) { input.fire = true; input.fireQueued = FIRE_BUFFER; }
  if (e.button === 2) { e.preventDefault(); input.slideQueued = SLIDE_BUFFER; }   // glissade / plongeon
});
addEventListener('mouseup', (e) => { if (e.button === 0) input.fire = false; });
cv.addEventListener('contextmenu', (e) => e.preventDefault());
cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (!S.P || paused) return;
  if (Math.abs(e.deltaY) > 2) input.switchTo = 1 - S.P.active;
}, { passive: false });

function readKeys() {
  input.left = any(K_LEFT);
  input.right = any(K_RIGHT);
  input.down = any(K_DOWN);
  input.jumpHeld = any(K_JUMP);
  const w = screenToWorld(input.sx, input.sy);
  input.wx = w.x; input.wy = w.y;
}

/* ------------------------------ Plein écran --------------------------- */
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
  } else if (document.exitFullscreen) document.exitFullscreen();
}

/* ================================ ÉCRANS ============================== */
const screens = { menu: $('screen-menu'), lobby: $('screen-lobby'), game: $('screen-game') };
function show(name) {
  for (const k in screens) screens[k].classList.toggle('hidden', k !== name);
  document.body.classList.toggle('ingame', name === 'game');
}
function status(text, cls) {
  const el = $('menu-status');
  el.textContent = text;
  el.className = 'status' + (cls ? ' ' + cls : '');
  const el2 = $('lobby-status');
  el2.textContent = text;
  el2.className = 'status' + (cls ? ' ' + cls : '');
}

/* ------------------------------ Préférences --------------------------- */
function load(key, def) { try { const v = localStorage.getItem(key); return v === null ? def : JSON.parse(v); } catch (e) { return def; } }
function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }

const me = {
  n: load('rr-name', ''),
  w: load('rr-weapons', ['smg', 'bazooka']),
  o: cleanOutfit(load('rr-outfit', DEFAULT_OUTFIT)),
  r: false,
};
if (!Array.isArray(me.w) || me.w.length !== 2 || !WEAPONS[me.w[0]] || !WEAPONS[me.w[1]] || me.w[0] === me.w[1]) me.w = ['smg', 'bazooka'];
G.quality = load('rr-quality', 'high') === 'low' ? 'low' : 'high';
$('input-name').value = me.n;
$('input-name').addEventListener('input', () => {
  me.n = $('input-name').value.trim().slice(0, 12);
  save('rr-name', me.n);
});

function setQuality(q) {
  G.quality = q;
  save('rr-quality', q);
  document.querySelectorAll('[data-quality]').forEach((b) => b.classList.toggle('on', b.dataset.quality === q));
}
document.querySelectorAll('[data-quality]').forEach((b) => b.addEventListener('click', () => setQuality(b.dataset.quality)));
setQuality(G.quality);

/* ================================ SALON =============================== */
function myEntry() { return { n: me.n || COLOR_NAMES[G.slot] || 'Joueur', w: me.w.slice(), o: me.o.slice(), r: me.r }; }
function publishMe() {
  S.lobby.set(G.slot, myEntry());
  /* la tenue part avec le reste : tout le monde voit celle de tout le monde */
  if (G.role !== 'solo') NET.send({ t: 'lob', n: myEntry().n, w: me.w.slice(), o: me.o.slice(), r: me.r });
  paintLobby();
}

/* ---------------------------- Personnage ------------------------------ */
/* Un sélecteur ◀ ▶ par pièce de tenue ; l'aperçu est animé en continu. */
function buildOutfitUI() {
  const box = $('outfit-list');
  box.innerHTML = '';
  SLOTS.forEach((slot, i) => {
    const row = document.createElement('div');
    row.className = 'orow';
    row.innerHTML = '<span class="olabel">' + slot.label + '</span>'
      + '<button class="small oarrow" data-d="-1">◀</button><b class="oval"></b>'
      + '<button class="small oarrow" data-d="1">▶</button>';
    row.querySelectorAll('.oarrow').forEach((b) => b.addEventListener('click', () => {
      const n = slot.list.length;
      me.o[i] = (me.o[i] + Number(b.dataset.d) + n) % n;
      save('rr-outfit', me.o);
      publishMe();
    }));
    box.appendChild(row);
  });
  $('btn-outfit-random').addEventListener('click', () => {
    me.o = SLOTS.map((sl) => Math.floor(Math.random() * sl.list.length));
    save('rr-outfit', me.o);
    publishMe();
  });
}
function paintOutfitUI() {
  document.querySelectorAll('#outfit-list .oval').forEach((el, i) => { el.textContent = SLOTS[i].list[me.o[i]].name; });
}

/* ------------------------------ Modes -------------------------------- */
/* Choisis par l'hôte (ou en solo), cumulables, vus par tout le monde. */
function cleanModes(m) {
  const out = {};
  for (const md of MODES) out[md.key] = !!(m && m[md.key]);
  return out;
}
function buildModesUI() {
  const box = $('mode-list');
  box.innerHTML = '';
  for (const md of MODES) {
    const b = document.createElement('button');
    b.className = 'mode';
    b.dataset.key = md.key;
    b.innerHTML = '<b>' + md.name + '</b><span>' + md.desc + '</span>';
    b.addEventListener('click', () => {
      if (G.role === 'guest') return;
      G.modes[md.key] = !G.modes[md.key];
      if (G.role === 'host') NET.send({ t: 'modes', m: G.modes });
      me.r = false;                          // les règles changent : chacun reconfirme
      publishMe();
    });
    box.appendChild(b);
  }
}
/* ---------------------------- Type de partie ------------------------- */
function buildGameTypeUI() {
  const box = $('gt-list');
  box.innerHTML = '';
  for (const gt of GAME_TYPES) {
    const b = document.createElement('button');
    b.className = 'mode gt';
    b.dataset.key = gt.key;
    b.innerHTML = '<b>' + gt.name + '</b><span>' + gt.desc + '</span>';
    b.addEventListener('click', () => {
      if (G.role === 'guest' || G.gameType === gt.key) return;
      G.gameType = gt.key;
      if (G.role === 'host') NET.send({ t: 'gt', g: gt.key });
      me.r = false;
      publishMe();
    });
    box.appendChild(b);
  }
}
function cleanGameType(g) { return GAME_TYPES.some((t) => t.key === g) ? g : 'dm'; }

function paintModesUI() {
  if (G.role !== 'solo' && G.gameType === 'surv') G.gameType = 'dm';
  document.querySelectorAll('#gt-list .gt').forEach((b) => {
    b.classList.toggle('hidden', b.dataset.key === 'surv' && G.role !== 'solo');   // Survie : solo seulement
    b.classList.toggle('on', b.dataset.key === G.gameType);
    b.classList.toggle('locked', G.role === 'guest');
  });
  document.querySelectorAll('#mode-list .mode').forEach((b) => {
    b.classList.toggle('on', !!G.modes[b.dataset.key]);
    b.classList.toggle('locked', G.role === 'guest');
  });
  $('mode-hint').textContent = G.role === 'guest' ? 'Choisis par l’hôte' : 'Cumulables, clique pour activer';
}

/* Aperçus animés (le mien en grand, ceux de chaque joueur en miniature). */
const previewCache = new Map();
function previewPlayer(slot, l) {
  const key = slot + '|' + (l.w || []).join(',') + '|' + (l.o || []).join(',');
  let p = previewCache.get(slot);
  if (!p || p.key !== key) {
    p = makePlayer(slot, l.w && l.w.length === 2 ? l.w : ['smg', 'bazooka'], l.o);
    p.key = key;
    p.onGround = true; p.alive = false; p.invuln = 0;
    previewCache.set(slot, p);
  }
  return p;
}
function drawLobbyPreviews(t) {
  const time = t / 1000;
  const mine = S.lobby.get(G.slot) || myEntry();
  const P = previewPlayer(G.slot, mine);
  P.aim = 0.25 * Math.sin(time * 0.9) - 0.1;
  P.facing = 1;
  const big = $('char-preview');
  drawCharacterPreview(big, P, time, big.height / 150);
  document.querySelectorAll('canvas.pmini').forEach((c) => {
    const slot = Number(c.dataset.slot);
    const l = S.lobby.get(slot);
    if (!l) return;
    const p = previewPlayer(slot, l);
    p.aim = 0.1 * Math.sin(time * 1.3 + slot) - 0.05;
    p.facing = 1;
    drawCharacterPreview(c, p, time + slot, c.height / 150);
  });
}

function enterLobby() {
  G.phase = 'lobby';
  me.r = false;
  show('lobby');
  $('overlay').classList.add('hidden');
  $('pause').classList.add('hidden');
  paused = false;
  publishMe();
}

/* Fiches d'armes (construites une fois) */
const weaponCards = new Map();
function buildWeaponCards() {
  const box = $('weapon-list');
  box.innerHTML = '';
  for (const id of WEAPON_IDS) {
    const d = WEAPONS[id];
    const el = document.createElement('button');
    el.className = 'wcard';
    const rate = d.charge ? 'charge ' + String(d.charge).replace('.', ',') + ' s'
      : d.cd < 0.2 ? Math.round(1 / d.cd) + ' tirs/s' : '1 / ' + d.cd.toString().replace('.', ',') + ' s';
    const dmg = d.pellets ? d.pellets + ' × ' + d.dmg : (d.expl ? d.expl.dmg + ' max' : d.dmg);
    const mag = d.infinite ? 'munitions infinies' : d.kind === 'boomerang' ? 'revient dans la main' : d.mag + ' par chargeur';
    el.innerHTML =
      '<canvas width="150" height="46"></canvas>' +
      '<div class="wname">' + d.name + '<span class="wslot"></span></div>' +
      bar('Dégâts', d.bars.dmg) + bar('Cadence', d.bars.rate) + bar('Portée', d.bars.range) +
      '<div class="wfacts">' + dmg + ' dégâts · ' + rate + ' · ' + mag + '</div>';
    drawWeaponIcon(el.querySelector('canvas').getContext('2d'), id, 75, 24, 130, 2.2);
    el.addEventListener('click', () => pickWeapon(id));
    box.appendChild(el);
    weaponCards.set(id, el);
  }
}
function bar(label, v) {
  return '<div class="wbar"><span>' + label + '</span><i><b style="width:' + Math.round(v * 100) + '%"></b></i></div>';
}
function pickWeapon(id) {
  const i = me.w.indexOf(id);
  if (i >= 0) {
    /* Déjà choisie : on échange simplement l'ordre (arme 1 / arme 2). */
    me.w = [me.w[1], me.w[0]];
  } else {
    me.w = [me.w[1], id];      // la plus ancienne sélection cède sa place
  }
  save('rr-weapons', me.w);
  me.r = false;
  publishMe();
}

/* Choix de la carte (hôte) avec aperçu miniature dessiné en code */
const mapCards = [];
function buildMapCards() {
  const box = $('map-list');
  box.innerHTML = '';
  MAPS.forEach((m, i) => {
    const el = document.createElement('button');
    el.className = 'mcard';
    el.innerHTML = '<canvas width="220" height="120"></canvas><div class="mname">' + m.name + '</div><div class="msub">' + m.sub + '</div>';
    drawMapPreview(el.querySelector('canvas'), m);
    el.addEventListener('click', () => {
      if (G.role === 'guest') return;
      G.mapId = i;
      if (G.role === 'host') NET.send({ t: 'map', m: i });
      /* changer de carte relance les « Prêt » de chacun */
      me.r = false;
      publishMe();
    });
    box.appendChild(el);
    mapCards.push(el);
  });
}

function paintLobby() {
  const solo = G.role === 'solo';
  $('room-box').classList.toggle('hidden', solo);
  $('lobby-title').textContent = solo ? (G.gameType === 'surv' ? 'Survie' : 'Entraînement solo') : 'Salon';
  $('room-code').textContent = G.code || '····';

  /* joueurs */
  const slots = Array.from(S.lobby.keys()).sort();
  let html = '';
  for (let s = 0; s < MAX_PLAYERS; s++) {
    const l = S.lobby.get(s);
    if (!l) { if (!solo) html += '<div class="pslot empty">Place libre</div>'; continue; }
    const wn = (l.w || []).map((id) => WEAPONS[id] ? WEAPONS[id].name : '?').join(' + ') || 'choix en cours…';
    html += '<div class="pslot' + (s === G.slot ? ' me' : '') + '" style="--c:' + COLORS[s] + '">'
         + '<canvas class="pmini" data-slot="' + s + '" width="72" height="104"></canvas><div class="pinfo"><b>' + esc(l.n || COLOR_NAMES[s]) + (s === G.slot ? ' <em>(vous)</em>' : '')
         + (s === 0 && !solo ? ' <em>· hôte</em>' : '') + '</b><span>' + wn + '</span></div>'
         + (solo ? '' : '<div class="pready' + (l.r ? ' on' : '') + '">' + (l.r ? 'Prêt' : 'Pas prêt') + '</div>') + '</div>';
  }
  $('lobby-players').innerHTML = html;

  paintOutfitUI();
  paintModesUI();

  /* armes */
  for (const [id, el] of weaponCards) {
    const i = me.w.indexOf(id);
    el.classList.toggle('on', i >= 0);
    el.querySelector('.wslot').textContent = i === 0 ? '& arme 1' : i === 1 ? 'é arme 2' : '';
  }
  /* cartes */
  mapCards.forEach((el, i) => {
    el.classList.toggle('on', i === G.mapId);
    el.classList.toggle('locked', G.role === 'guest');
  });
  $('map-hint').textContent = G.role === 'guest' ? 'Choisie par l’hôte' : 'Clique pour choisir';

  /* boutons */
  const ready = $('btn-ready'), start = $('btn-start');
  ready.classList.toggle('hidden', solo);
  ready.textContent = me.r ? 'Pas prêt' : 'Prêt !';
  ready.classList.toggle('on', me.r);
  start.classList.toggle('hidden', G.role === 'guest');
  if (solo) { start.disabled = false; start.textContent = G.gameType === 'surv' ? 'Lancer la survie' : 'Lancer l’entraînement'; return; }
  const all = slots.map((s) => S.lobby.get(s));
  const allReady = all.every((l) => l.r && l.w && l.w.length === 2);
  start.disabled = !(slots.length >= 2 && allReady);
  start.textContent = slots.length < 2 ? 'En attente d’un second joueur…'
    : !allReady ? 'En attente que tout le monde soit prêt…'
    : 'Lancer la partie (' + slots.length + ' joueurs)';
}
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ============================ PARTIE ================================== */
function startMatch(slots) {
  G.map = prepareMap(MAPS[G.mapId]);
  buildBackground(G.map);
  S.others.clear();
  const list = slots || Array.from(S.lobby.keys());
  for (const s of list) {
    if (s === G.slot) continue;
    const l = S.lobby.get(s);
    S.others.set(s, makePlayer(s, l && l.w, l && l.o));
  }
  show('game');
  resize();
  resetMatch();
}

function resetMatch() {
  resetScores();
  S.feed.length = 0;
  S.ragdolls.length = 0;
  resetProjectiles();
  FX.clearParticles();
  S.kits = G.map.kits.map((k) => ({ x: k.x, y: k.y, on: true, until: 0, reqT: 0 }));
  resetDest(G.map);
  G.hill = 0; G.hillT = HILL_TIME; G.hillOwner = -1; kothAcc = 0;
  S.P = makePlayer(G.slot, me.w, me.o);
  for (const [s, o] of S.others) {
    const l = S.lobby.get(s);
    const fresh = makePlayer(s, (l && l.w) || o.weapons, l && l.o);
    const osp = initialSpawn(s);
    fresh.x = osp.x; fresh.y = osp.y;
    S.others.set(s, fresh);
  }
  S.dummies = [];
  if (G.role === 'solo' && G.gameType === 'surv') startSurvival();
  else if (G.role === 'solo') makeDummies();
  /* Départs répartis et déterministes : personne n'apparaît sur un autre. */
  spawnLocalAt(G.role === 'solo' ? G.map.spawns[0] : initialSpawn(G.slot));
  G.time = 0; G.shake = 0; G.hurt = 0; G.winner = -1;
  G.phase = 'play';
  input.fire = false; input.fireQueued = 0;
  $('overlay').classList.add('hidden');
  snapCamera();
}

function endGame(winner, note) {
  if (G.phase !== 'play') return;
  G.phase = 'over';
  G.winner = winner;
  input.fire = false;
  const win = winner === G.slot;
  const t = $('ov-title');
  t.textContent = win ? 'Victoire !' : winner >= 0 ? playerName(winner) + ' gagne' : 'Partie terminée';
  t.className = win ? 'win' : 'lose';
  t.style.color = !win && winner >= 0 ? COLORS[winner] : '';
  const why = { dm: 'Premier à ' + WIN_KILLS + ' kills.', koth: 'Roi de la colline : ' + KOTH_TARGET + ' points.', lms: 'Dernier debout !' };
  $('ov-sub').textContent = note || (win ? why[G.gameType] : '');
  /* classement : selon le type de partie, puis kills, morts, précision */
  const key = (s) => (G.gameType === 'koth' ? S.score[s].pts : G.gameType === 'lms' ? livesLeft(s) * 1000 + S.score[s].k : S.score[s].k);
  const rows = participants().map((s) => ({ s: s, sc: S.score[s] }))
    .sort((a, b) => (b.s === winner) - (a.s === winner) || (key(b.s) - key(a.s)) || (a.sc.d - b.sc.d));
  const extra = G.gameType === 'koth' ? '<th>Points</th>' : G.gameType === 'lms' ? '<th>Vies</th>' : '';
  let html = '<tr><th>#</th><th>Joueur</th>' + extra + '<th>Kills</th><th>Morts</th><th>Précision</th></tr>';
  rows.forEach((r, i) => {
    const acc = r.sc.shots ? Math.round(r.sc.hits / r.sc.shots * 100) + ' %' : '—';
    const ex = G.gameType === 'koth' ? '<td>' + Math.floor(r.sc.pts) + '</td>' : G.gameType === 'lms' ? '<td>' + livesLeft(r.s) + '</td>' : '';
    html += '<tr style="--c:' + COLORS[r.s] + '"' + (r.s === G.slot ? ' class="me"' : '') + '><td>' + (i + 1) + '</td><td><i></i>'
         + esc(playerName(r.s)) + '</td>' + ex + '<td>' + r.sc.k + '</td><td>' + r.sc.d + '</td><td>' + acc + '</td></tr>';
  });
  $('ov-table').innerHTML = html;
  /* Plus aucun adversaire : pas de revanche possible, seulement le salon. */
  $('btn-rematch').classList.toggle('hidden', G.role !== 'solo' && participants().length < 2);
  $('btn-tolobby').classList.remove('hidden');
  $('overlay').classList.remove('hidden');
}

function hostLostScreen() {
  if (G.phase === 'lobby') { backToMenu(); status('La liaison avec l’hôte a été perdue.', 'err'); return; }
  if (G.phase === 'menu') return;
  G.phase = 'over';
  const t = $('ov-title');
  t.textContent = 'Hôte déconnecté'; t.className = ''; t.style.color = '';
  $('ov-sub').textContent = 'La liaison avec l’hôte a été perdue.';
  $('ov-table').innerHTML = '';
  $('btn-rematch').classList.add('hidden');
  $('btn-tolobby').classList.add('hidden');
  $('overlay').classList.remove('hidden');
}

function backToMenu() {
  NET.cleanupPeer();
  G.phase = 'menu';
  G.role = null;
  G.code = '';
  S.lobby.clear();
  S.others.clear();
  S.dummies = [];
  S.P = null;
  paused = false;
  $('pause').classList.add('hidden');
  $('overlay').classList.add('hidden');
  $('btn-create').disabled = false;
  $('btn-join').disabled = false;
  show('menu');
}

/* ----------------------------- Kits de soin --------------------------- */
/* L'hôte arbitre : premier arrivé, premier servi, jamais deux soins. */
events.requestKit = (i) => {
  if (G.role === 'guest') NET.send({ t: 'kreq', i: i });
  else grantKit(G.slot, i);
};
function grantKit(slot, i) {
  const k = S.kits[i];
  if (!k || !k.on || G.phase !== 'play') return;
  const m = { t: 'kit', i: i, s: slot, on: 0, rt: KIT_RESPAWN };
  applyKit(m);
  if (G.role === 'host') NET.send(m);
}
function applyKit(m) {
  const k = S.kits[m.i];
  if (!k) return;
  k.on = !!m.on;
  if (!m.on) {
    k.until = G.time + (m.rt || KIT_RESPAWN);
    if (m.s === G.slot && S.P) { healLocal(); FX.healFx(S.P.x, S.P.y); }
    else {
      const o = S.others.get(m.s);
      if (o) FX.healFx(o.x, o.y);
    }
  }
}
function hostKits() {
  if (G.role === 'guest') return;
  S.kits.forEach((k, i) => {
    if (!k.on && G.time >= k.until) {
      const m = { t: 'kit', i: i, on: 1 };
      applyKit(m);
      if (G.role === 'host') NET.send(m);
    }
  });
}

/* ------------------------ Branchements gameplay ----------------------- */
hooks.hitLocal = hitLocal;
hooks.hitDummy = hitDummy;
hooks.blastRagdolls = blastRagdolls;
hooks.boomerangCaught = boomerangCaught;
hooks.rocketContact = (id, x, y, owner) => NET.send({ t: 'x', id: id, x: Math.round(x), y: Math.round(y), o: owner });
events.afterKill = (killer) => {
  if (G.gameType === 'dm') {
    if (G.role !== 'solo' && killer >= 0 && S.score[killer].k >= WIN_KILLS) endGame(killer);
  } else if (G.gameType === 'lms') checkLastStanding();
  else if (G.gameType === 'surv' && livesLeft(G.slot) <= 0) {
    const best = survivalBest();
    saveSurvivalBest(G.wave);
    endGame(-1, 'Tu as tenu jusqu’à la vague ' + G.wave + ' · ' + Math.max(0, S.score[G.slot].k) + ' bots abattus'
      + (G.wave > best ? ' · NOUVEAU RECORD !' : ' · record : vague ' + best));
  }
};
/* Dernier debout : chaque machine compte les vies à partir des morts annoncées. */
function checkLastStanding() {
  if (G.gameType !== 'lms' || G.phase !== 'play') return;
  if (G.role === 'solo') {
    if (livesLeft(G.slot) <= 0) endGame(-1, 'Plus de vie ! Mannequins abattus : ' + Math.max(0, S.score[G.slot].k));
    return;
  }
  const standing = participants().filter((s) => livesLeft(s) > 0);
  if (standing.length <= 1) endGame(standing.length ? standing[0] : -1);
}

/* ------------------------- Roi de la colline -------------------------- */
/* L'hôte fait foi : il voit tout le monde (positions reçues), compte qui est
   seul dans la zone et diffuse les points 4 fois par seconde. */
let kothAcc = 0;
function hostKoth(dt) {
  if (G.gameType !== 'koth' || G.phase !== 'play' || !G.map.hills.length) return;
  G.hillT -= dt;
  if (G.role === 'guest') return;                   // les invités ne font qu'afficher
  let moved = false;
  if (G.hillT <= 0) { G.hill = (G.hill + 1) % G.map.hills.length; G.hillT = HILL_TIME; moved = true; }
  const h = G.map.hills[G.hill];
  const inside = [];
  const test = (slot, x, y) => { if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h + 6) inside.push(slot); };
  if (S.P && S.P.alive) test(G.slot, S.P.x, S.P.y);
  for (const [slot, p] of S.others) {
    if (!p.alive) continue;
    const last = p.buf.length ? p.buf[p.buf.length - 1] : p;
    test(slot, last.x, last.y);
  }
  const owner = inside.length === 1 ? inside[0] : inside.length > 1 ? -2 : -1;
  const changed = owner !== G.hillOwner;
  G.hillOwner = owner;
  if (owner >= 0) S.score[owner].pts += dt;
  kothAcc += dt;
  if (G.role === 'host' && (kothAcc >= KOTH_NET || moved || changed)) {
    kothAcc = 0;
    NET.send({ t: 'ks', p: S.score.map((s) => Math.round(s.pts * 10) / 10), h: G.hill, ht: Math.round(G.hillT * 10) / 10, o: owner });
  }
  if (owner >= 0 && S.score[owner].pts >= KOTH_TARGET) {
    if (G.role === 'host') NET.send({ t: 'ks', p: S.score.map((s) => Math.round(s.pts * 10) / 10), h: G.hill, ht: G.hillT, o: owner });
    endGame(owner);
  }
}
function applyKoth(m) {
  (m.p || []).forEach((v, i) => { if (S.score[i]) S.score[i].pts = v; });
  G.hill = m.h | 0; G.hillT = m.ht; G.hillOwner = m.o;
  const win = (m.p || []).findIndex((v) => v >= KOTH_TARGET);
  if (win >= 0) endGame(win);
}

/* ================================ RÉSEAU ============================== */
NET.setHandlers({
  status: status,
  net: () => {},
  opened: (code) => { G.code = code; enterLobby(); },
  fail: (text) => {
    backToMenu();
    status(text, 'err');
  },
  welcomeData: () => ({ lobby: Array.from(S.lobby.entries()), map: G.mapId, modes: G.modes, gt: G.gameType }),
  join: (slot) => {
    S.lobby.set(slot, { n: COLOR_NAMES[slot], w: [], r: false });
    status('Joueurs connectés : ' + S.lobby.size + '/' + MAX_PLAYERS + '.');
    paintLobby();
  },
  leave: (slot) => {
    S.lobby.delete(slot);
    const o = S.others.get(slot);
    S.others.delete(slot);
    if (G.phase === 'lobby') { paintLobby(); status('Un joueur a quitté le salon.'); }
    if (o && G.phase === 'play') {
      S.feed.push({ k: -1, v: slot, w: 'quit', hs: false, t: performance.now() });
      if (participants().length < 2) {
        const lead = participants().sort((a, b) => S.score[b].k - S.score[a].k)[0];
        endGame(lead, 'Tous les adversaires ont quitté la partie.');
      } else checkLastStanding();
    }
  },
  hostLost: hostLostScreen,
  heartbeat: () => { if (G.phase === 'play') sendState(); },
  data: onData,
});

function onData(m) {
  const from = m.f;
  switch (m.t) {
    case 'welcome':                                  // l'hôte m'attribue mon slot
      S.lobby.clear();
      for (const [s, l] of m.lobby || []) S.lobby.set(s, l);
      G.mapId = m.map || 0;
      G.modes = cleanModes(m.modes);
      G.gameType = cleanGameType(m.gt);
      enterLobby();
      status('Connecté ! Choisis tes armes puis clique sur Prêt.', 'ok');
      break;
    case 'lob':
      if (from === G.slot) break;
      S.lobby.set(from, { n: String(m.n || '').slice(0, 12), w: m.w, o: cleanOutfit(m.o), r: !!m.r });
      if (G.phase === 'lobby') paintLobby();
      break;
    case 'map':
      G.mapId = m.m;
      me.r = false;
      if (G.phase === 'lobby') publishMe();
      break;
    case 'gt':
      G.gameType = cleanGameType(m.g);
      me.r = false;
      if (G.phase === 'lobby') publishMe();
      break;
    case 'ks':                                       // état de la colline (hôte)
      if (G.phase === 'play' && G.role === 'guest') applyKoth(m);
      break;
    case 'dh':                                       // dégâts au décor, décidés par le tireur
      if (inGame()) applyDestDamage(m.i, m.d, from, m.g, m.x, m.y);
      break;
    case 'dr':                                       // décor reconstruit (hôte)
      if (inGame()) applyDestRespawn(m.i);
      break;
    case 'modes':
      G.modes = cleanModes(m.m);
      me.r = false;
      if (G.phase === 'lobby') publishMe();
      break;
    case 'go':
      G.mapId = m.map;
      if (m.modes) G.modes = cleanModes(m.modes);
      if (m.gt) G.gameType = cleanGameType(m.gt);
      startMatch(m.slots);
      break;
    case 's': {
      if (!inGame()) break;
      const p = S.others.get(from);
      if (p) receiveState(p, m);
      break;
    }
    case 'f':
      if (!inGame()) break;
      spawnShot(m, from);
      remoteFired(from, m.w);
      break;
    case 'h':                                        // impact confirmé par la victime (émetteur)
      if (inGame()) onHit(m, from);
      break;
    case 'k':                                        // kill annoncé par la victime
      if (G.phase === 'play') onKill(m, from);
      break;
    case 'x':                                        // roquette arrêtée par un joueur
      if (inGame()) explode(m.x, m.y, m.o, 'bazooka', m.id);
      break;
    case 'kreq':
      if (G.role === 'host') grantKit(from, m.i);
      break;
    case 'kit':
      if (inGame()) applyKit(m);
      break;
    case 'r':                                        // revanche : même carte, mêmes armes
      if (inGame()) resetMatch();
      break;
    case 'lobby':                                    // retour au salon pour tout le monde
      if (inGame()) enterLobby();
      break;
  }
}

/* ================================ BOUTONS ============================= */
function requirePeer() {
  if (NET.peerAvailable()) return true;
  status('PeerJS n’a pas pu être chargé (CDN bloqué ?). Le multijoueur est indisponible — l’entraînement solo reste possible.', 'err');
  return false;
}
$('btn-create').addEventListener('click', () => {
  if (!requirePeer()) return;
  $('btn-create').disabled = true; $('btn-join').disabled = true;
  S.lobby.clear();
  G.mapId = 0;
  G.modes = cleanModes(null);
  G.gameType = 'dm';
  NET.createRoom();
});
function join() {
  const code = ($('input-code').value || '').trim().toUpperCase();
  if (code.length < 3) { status('Saisis le code affiché chez l’hôte.', 'err'); return; }
  if (!requirePeer()) return;
  $('btn-create').disabled = true; $('btn-join').disabled = true;
  S.lobby.clear();
  NET.joinRoom(code);
}
$('btn-join').addEventListener('click', join);
$('input-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
$('btn-surv').addEventListener('click', () => {
  NET.cleanupPeer();
  G.role = 'solo'; G.slot = 0; G.code = '';
  G.gameType = 'surv';
  S.lobby.clear();
  enterLobby();
  status('Survie : choisis tes armes et une carte. Les vagues ne s’arrêtent jamais.');
});
$('btn-solo').addEventListener('click', () => {
  NET.cleanupPeer();
  G.role = 'solo'; G.slot = 0; G.code = '';
  if (G.gameType === 'surv') G.gameType = 'dm';
  S.lobby.clear();
  enterLobby();
  status('Choisis tes armes et une carte : des mannequins t’attendent.');
});
$('btn-ready').addEventListener('click', () => { me.r = !me.r; publishMe(); });
$('btn-start').addEventListener('click', () => {
  if (G.role === 'solo') { startMatch([0]); return; }
  if (G.role !== 'host') return;
  const slots = Array.from(S.lobby.keys()).sort();
  if (slots.length < 2) return;
  NET.send({ t: 'go', map: G.mapId, slots: slots, modes: G.modes, gt: G.gameType });
  startMatch(slots);
});
$('btn-leave').addEventListener('click', () => { backToMenu(); status('Prêt.'); });
$('btn-copy-code').addEventListener('click', () => copyText(G.code, 'Code copié.'));
$('btn-copy-link').addEventListener('click', () => copyText(location.href.split('#')[0] + '#' + G.code, 'Lien copié.'));
function copyText(text, ok) {
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => status(ok, 'ok'), () => status(text));
  else status(text);
}

$('btn-rematch').addEventListener('click', () => {
  if (G.role !== 'solo') { if (!G.connected) return; NET.send({ t: 'r' }); }
  resetMatch();                                       // tous les écrans relancent ensemble
});
$('btn-tolobby').addEventListener('click', () => {
  if (G.role !== 'solo') NET.send({ t: 'lobby' });
  enterLobby();
});
$('btn-quit').addEventListener('click', () => { backToMenu(); status('Prêt.'); });

/* ------------------------------ Menu pause ---------------------------- */
let paused = false;
function togglePause() {
  paused = !paused;
  $('pause').classList.toggle('hidden', !paused);
  keys.clear(); input.fire = false;
}
$('btn-resume').addEventListener('click', togglePause);
$('btn-fs').addEventListener('click', toggleFullscreen);
$('btn-fs2').addEventListener('click', toggleFullscreen);
$('btn-pause-quit').addEventListener('click', () => { backToMenu(); status('Prêt.'); });
$('btn-pause-lobby').addEventListener('click', () => {
  if (G.role === 'solo') { enterLobby(); return; }
  NET.send({ t: 'lobby' });
  enterLobby();
});

addEventListener('resize', resize);

/* ============================ BOUCLE DE JEU ========================== */
/* Simulation à pas fixe (60 Hz, accumulateur), rendu à la fréquence de
   l'écran avec interpolation entre deux pas. */
let acc = 0, last = 0;
function fixedUpdate(dt) {
  G.time += dt;
  if (G.phase === 'play') {
    updateLocal(dt);
    updateDummies(dt);
    hostKits();
    hostDestTick();
    hostKoth(dt);
    if (G.gameType === 'surv' && G.role === 'solo') { updateBots(dt); updateSurvival(dt); }
    G.netAcc += dt;
    if (G.netAcc >= NET_INTERVAL) { G.netAcc -= NET_INTERVAL; sendState(); }
  }
  updateProjectiles(dt);
  updateRagdolls(dt);
}

function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0, (t - last) / 1000));
  last = t;
  if (G.phase === 'lobby') { drawLobbyPreviews(t); return; }
  if (!inGame() || !G.map) return;
  if (paused) { input.left = input.right = input.down = input.jumpHeld = false; }
  else readKeys();
  if (paused) { const w = screenToWorld(input.sx, input.sy); input.wx = w.x; input.wy = w.y; }

  acc += dt;
  let n = 0;
  while (acc >= STEP && n < 8) { fixedUpdate(STEP); acc -= STEP; n++; }
  if (n >= 8) acc = 0;
  const alpha = acc / STEP;

  const now = performance.now();
  for (const o of S.others.values()) { interpolateRemote(o, now); animate(o, dt); }
  if (S.P) animate(S.P, dt);
  for (const d of S.dummies) animate(d, dt);
  FX.updateParticles(dt);
  ambient(dt, t / 1000);
  G.hitMarker = Math.max(0, G.hitMarker - dt);
  G.waveBanner = Math.max(0, G.waveBanner - dt);
  render(alpha, dt, t / 1000);
}
requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });

/* =============================== DÉMARRAGE ============================ */
buildWeaponCards();
buildMapCards();
buildOutfitUI();
buildModesUI();
buildGameTypeUI();
show('menu');
resize();
if (location.hash.length > 1) {
  $('input-code').value = location.hash.slice(1).toUpperCase().replace(/[^A-Z0-9]/g, '');
}
if (!NET.peerAvailable()) {
  status('PeerJS n’a pas pu être chargé (CDN bloqué ?). Le multijoueur est indisponible — l’entraînement solo reste possible.', 'err');
}
/* Accès de débogage depuis la console */
window.RR = {
  G: G, S: S, cam: cam, input: input, FX: FX,
  /* avance la simulation de n pas (tests, onglet en arrière-plan) */
  step(n) {
    for (let i = 0; i < n; i++) {
      readKeys();
      fixedUpdate(STEP);
      const now = performance.now();
      for (const o of S.others.values()) { interpolateRemote(o, now); animate(o, STEP); }
      if (S.P) animate(S.P, STEP);
      FX.updateParticles(STEP);
    }
    render(1, STEP, performance.now() / 1000);
  },
};
