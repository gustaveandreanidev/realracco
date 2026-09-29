/* ==========================================================================
   HUD dessiné sur le canvas, en coordonnées écran (pixels réels) :
   scores, vie, armes et munitions, fil des kills, réticule, indicateurs
   d'adversaires hors champ, statut réseau, compte à rebours de réapparition.
   ========================================================================== */
import { G, S, MAX_HP, WIN_KILLS, TAU, COLORS, MODES, KOTH_TARGET, LMS_LIVES, clamp, playerName, livesLeft } from './state.js';
import { spectated, hillColor } from './render.js';
import { botsAlive, waveSize, survivalBest, SURV } from './bots.js';
import { WEAPONS, drawWeaponIcon } from './weapons.js';
import { input } from './player.js';

const FONT = 'Segoe UI, system-ui, -apple-system, sans-serif';
const FEED_TIME = 6000;     // durée d'affichage d'une ligne du fil des kills (ms)

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function font(ctx, weight, px) { ctx.font = weight + ' ' + Math.round(px) + 'px ' + FONT; }

export function participants() {
  const list = [G.slot];
  for (const k of S.others.keys()) list.push(k);
  return list;
}

export function drawHud(ctx, W, H, cam, view, time, lx, ly) {
  const u = Math.max(0.6, Math.min(W / 1600, H / 900));
  const P = S.P;
  if (!P) return;
  ctx.textBaseline = 'alphabetic';

  drawOffscreen(ctx, W, H, u, cam, view);
  drawScores(ctx, W, u);
  drawFeed(ctx, W, u);
  drawHealth(ctx, H, u, P, time);
  drawWeapons(ctx, W, H, u, P);
  drawNet(ctx, W, H, u);
  if (G.gameType === 'koth') drawHillInfo(ctx, W, H, u, cam, view);
  if (G.phase === 'play' && !P.alive) drawRespawn(ctx, W, H, u, P);
  if (P.alive && G.phase === 'play') drawCrosshair(ctx, u, cam, P, lx, ly, time);
}

/* ------------------------------ Scores -------------------------------- */
function drawScores(ctx, W, u) {
  if (G.gameType === 'surv') { drawSurvival(ctx, W, u); return; }
  if (G.role === 'solo') {
    const w = 290 * u, h = 36 * u, x = (W - w) / 2, y = 12 * u;
    ctx.fillStyle = 'rgba(8,10,24,.7)'; rr(ctx, x, y, w, h, 10 * u); ctx.fill();
    font(ctx, 700, 15 * u); ctx.textAlign = 'center'; ctx.fillStyle = '#e7ecff';
    ctx.fillText('Entraînement · mannequins abattus : ' + S.score[G.slot].k, W / 2, y + 23 * u);
    drawModes(ctx, W, u, y + h + 8 * u);
    return;
  }
  drawModes(ctx, W, u, 12 * u + 44 * u);
  const list = participants().sort((a, b) => (S.score[b].k - S.score[a].k) || (a - b));
  const cw = 150 * u, ch = 38 * u, gap = 8 * u;
  let x = (W - (list.length * cw + (list.length - 1) * gap)) / 2;
  const y = 12 * u;
  for (const s of list) {
    const me = s === G.slot;
    ctx.fillStyle = me ? 'rgba(30,40,84,.85)' : 'rgba(8,10,24,.7)';
    rr(ctx, x, y, cw, ch, 9 * u); ctx.fill();
    if (me) { ctx.strokeStyle = COLORS[s]; ctx.lineWidth = 2 * u; ctx.stroke(); }
    ctx.fillStyle = COLORS[s];
    rr(ctx, x + 5 * u, y + 7 * u, 5 * u, ch - 14 * u, 2 * u); ctx.fill();
    font(ctx, 700, 14 * u); ctx.textAlign = 'left';
    let name = playerName(s);
    if (name.length > 10) name = name.slice(0, 9) + '…';
    ctx.fillText(name, x + 16 * u, y + 24 * u);
    ctx.textAlign = 'right';
    font(ctx, 800, 20 * u); ctx.fillStyle = '#fff';
    /* valeur affichée selon le type de partie : kills, points de colline ou vies */
    let val, max, prog;
    if (G.gameType === 'koth') { val = Math.floor(S.score[s].pts); max = KOTH_TARGET; prog = S.score[s].pts / KOTH_TARGET; }
    else if (G.gameType === 'lms') { val = livesLeft(s); max = LMS_LIVES; prog = val / LMS_LIVES; }
    else { val = S.score[s].k; max = WIN_KILLS; prog = val / WIN_KILLS; }
    if (G.gameType === 'lms') {
      ctx.fillStyle = val > 0 ? '#ff5a7a' : 'rgba(255,255,255,.25)';
      font(ctx, 800, 15 * u);
      ctx.fillText(val > 0 ? '♥'.repeat(val) : 'éliminé', x + cw - 10 * u, y + 25 * u);
    } else {
      ctx.fillText(String(val), x + cw - 34 * u, y + 26 * u);
      font(ctx, 600, 12 * u); ctx.fillStyle = 'rgba(200,210,255,.6)';
      ctx.fillText('/' + max, x + cw - 10 * u, y + 26 * u);
    }
    /* jauge de progression */
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.fillRect(x + 16 * u, y + ch - 7 * u, cw - 26 * u, 3 * u);
    ctx.fillStyle = COLORS[s];
    ctx.fillRect(x + 16 * u, y + ch - 7 * u, (cw - 26 * u) * clamp(prog, 0, 1), 3 * u);
    x += cw + gap;
  }
}

/* Modes actifs, rappelés sous le tableau des scores. */
function drawModes(ctx, W, u, y) {
  const on = MODES.filter((m) => G.modes[m.key]).map((m) => m.name.toUpperCase());
  if (!on.length) return;
  font(ctx, 800, 12 * u); ctx.textAlign = 'center';
  const txt = on.join('  ·  ');
  const w = ctx.measureText(txt).width + 24 * u;
  ctx.fillStyle = 'rgba(60,45,10,.75)';
  rr(ctx, (W - w) / 2, y, w, 22 * u, 11 * u); ctx.fill();
  ctx.fillStyle = '#ffc44d';
  ctx.fillText(txt, W / 2, y + 15 * u);
}

/* ------------------------------ Fil des kills ------------------------- */
function drawFeed(ctx, W, u) {
  const now = performance.now();
  let y = 14 * u;
  for (let i = S.feed.length - 1; i >= 0; i--) {
    const f = S.feed[i];
    const age = now - f.t;
    if (age > FEED_TIME) continue;
    const a = clamp((FEED_TIME - age) / 600, 0, 1);
    ctx.globalAlpha = a;
    const vName = f.v === -2 ? 'Mannequin' : f.v === -3 ? 'Bot' : playerName(f.v);
    const vCol = f.v === -2 ? '#ff9a9a' : f.v === -3 ? '#ff7a7a' : COLORS[f.v];
    const kName = f.k >= 0 && f.k !== f.v ? playerName(f.k) : '';
    font(ctx, 700, 14 * u);
    const iconW = 48 * u;
    const wk = kName ? ctx.measureText(kName).width + 10 * u : 0;
    const wv = ctx.measureText(vName).width;
    const hsW = f.hs ? 24 * u : 0;
    const suffix = !kName ? (f.w === 'quit' ? ' a quitté' : f.w === 'fall' ? ' (chute)' : ' (suicide)') : '';
    font(ctx, 500, 12 * u);
    const ws = suffix ? ctx.measureText(suffix).width : 0;
    const w = wk + iconW + hsW + wv + ws + 24 * u;
    const x = W - w - 14 * u;
    ctx.fillStyle = f.k === G.slot || f.v === G.slot ? 'rgba(40,46,90,.85)' : 'rgba(8,10,24,.7)';
    rr(ctx, x, y, w, 28 * u, 7 * u); ctx.fill();
    let cx = x + 12 * u;
    font(ctx, 700, 14 * u); ctx.textAlign = 'left';
    if (kName) { ctx.fillStyle = COLORS[f.k]; ctx.fillText(kName, cx, y + 19 * u); cx += wk; }
    if (f.w === 'fall' || f.w === 'quit') {
      ctx.save();
      ctx.translate(cx + 6 * u, y + 14 * u);
      ctx.strokeStyle = '#e7ecff'; ctx.lineWidth = 2.5 * u;
      ctx.beginPath(); ctx.moveTo(14 * u, -8 * u); ctx.lineTo(14 * u, 7 * u);
      ctx.moveTo(8 * u, 2 * u); ctx.lineTo(14 * u, 8 * u); ctx.lineTo(20 * u, 2 * u); ctx.stroke();
      ctx.restore();
    } else if (WEAPONS[f.w]) drawWeaponIcon(ctx, f.w, cx + iconW / 2, y + 14 * u, iconW - 8 * u, 0.9 * u);
    cx += iconW;
    if (f.hs) {                                    // headshot : petite cible
      ctx.strokeStyle = '#ffcf3d'; ctx.lineWidth = 2 * u;
      ctx.beginPath(); ctx.arc(cx + 8 * u, y + 14 * u, 7 * u, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#ffcf3d';
      ctx.beginPath(); ctx.arc(cx + 8 * u, y + 14 * u, 2.5 * u, 0, TAU); ctx.fill();
      cx += hsW;
    }
    ctx.fillStyle = vCol;
    ctx.fillText(vName, cx, y + 19 * u);
    if (suffix) { font(ctx, 500, 12 * u); ctx.fillStyle = 'rgba(200,210,255,.6)'; ctx.fillText(suffix, cx + wv, y + 19 * u); }
    y += 33 * u;
  }
  ctx.globalAlpha = 1;
}

/* ------------------------------ Vie ----------------------------------- */
function drawHealth(ctx, H, u, P, time) {
  const x = 22 * u, y = H - 58 * u, w = 300 * u, h = 30 * u;
  ctx.fillStyle = 'rgba(8,10,24,.72)';
  rr(ctx, x - 6 * u, y - 6 * u, w + 12 * u, h + 12 * u, 12 * u); ctx.fill();
  const k = clamp(P.hp / MAX_HP, 0, 1);
  ctx.fillStyle = 'rgba(255,255,255,.07)';
  rr(ctx, x, y, w, h, 8 * u); ctx.fill();
  const low = k <= 0.3;
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  if (low) { g.addColorStop(0, '#ff3a3a'); g.addColorStop(1, '#ff7a5a'); }
  else { g.addColorStop(0, '#2fd07a'); g.addColorStop(1, '#8cf0a8'); }
  ctx.fillStyle = g;
  ctx.globalAlpha = low ? 0.75 + 0.25 * Math.sin(time * 10) : 1;
  if (k > 0) { rr(ctx, x, y, Math.max(h * 0.5, w * k), h, 8 * u); ctx.fill(); }
  ctx.globalAlpha = 1;
  /* croix de soin */
  ctx.fillStyle = '#fff';
  ctx.fillRect(x + 10 * u, y + 12 * u, 14 * u, 6 * u);
  ctx.fillRect(x + 14 * u, y + 8 * u, 6 * u, 14 * u);
  font(ctx, 800, 18 * u); ctx.textAlign = 'left';
  ctx.fillStyle = '#fff';
  ctx.fillText(String(Math.max(0, Math.ceil(P.hp))), x + 32 * u, y + 22 * u);
  font(ctx, 600, 12 * u); ctx.fillStyle = 'rgba(255,255,255,.7)';
  ctx.fillText('/ ' + MAX_HP, x + 70 * u, y + 21 * u);
}

/* ------------------------------ Armes --------------------------------- */
function drawWeapons(ctx, W, H, u, P) {
  const sw = 176 * u, sh = 66 * u, gap = 10 * u;
  const keys = ['&', 'é'];
  for (let n = 0; n < 2; n++) {
    const id = P.weapons[n], def = WEAPONS[id];
    const active = n === P.active;
    const x = W - (2 - n) * (sw + gap) - 12 * u, y = H - sh - 20 * u - (active ? 6 * u : 0);
    ctx.globalAlpha = active ? 1 : 0.55;
    ctx.fillStyle = active ? 'rgba(30,40,84,.88)' : 'rgba(8,10,24,.7)';
    rr(ctx, x, y, sw, sh, 11 * u); ctx.fill();
    if (active) { ctx.strokeStyle = P.color; ctx.lineWidth = 2 * u; ctx.stroke(); }
    /* touche */
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    rr(ctx, x + 8 * u, y + 8 * u, 20 * u, 20 * u, 5 * u); ctx.fill();
    font(ctx, 800, 13 * u); ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
    ctx.fillText(keys[n], x + 18 * u, y + 23 * u);
    /* icône */
    drawWeaponIcon(ctx, id, x + 52 * u, y + 44 * u, 80 * u, 1.7 * u);
    font(ctx, 600, 12 * u); ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(220,228,255,.8)';
    ctx.fillText(def.name, x + sw - 10 * u, y + 22 * u);
    /* munitions (katana : infini ; boomerang : « en vol » tant qu'il n'est pas revenu) */
    const reloading = active && P.reloadT > 0;
    const flying = id === 'boomerang' && S.proj.some((b) => b.owner === P.i && b.kind === 'boomerang' && !b.dead);
    if (def.infinite) {
      font(ctx, 800, 26 * u); ctx.fillStyle = '#fff';
      ctx.fillText('∞', x + sw - 14 * u, y + 54 * u);
    } else if (flying) {
      font(ctx, 800, 15 * u); ctx.fillStyle = '#ffd35c';
      ctx.fillText('en vol…', x + sw - 12 * u, y + 52 * u);
    } else {
      font(ctx, 800, 22 * u); ctx.fillStyle = P.ammo[n] === 0 ? '#ff7a7a' : '#fff';
      ctx.fillText(reloading ? '…' : String(P.ammo[n]), x + sw - 44 * u, y + 52 * u);
      font(ctx, 600, 13 * u); ctx.fillStyle = 'rgba(200,210,255,.6)';
      ctx.fillText('/ ' + def.mag, x + sw - 10 * u, y + 52 * u);
    }
    if (active && def.charge && P.charge > 0) {                     // jauge de charge du railgun
      const k = Math.min(1, P.charge / def.charge);
      ctx.fillStyle = 'rgba(255,255,255,.12)';
      ctx.fillRect(x + 10 * u, y + sh - 8 * u, sw - 20 * u, 4 * u);
      ctx.fillStyle = k >= 1 ? '#e8fbff' : '#4dd2ff';
      ctx.fillRect(x + 10 * u, y + sh - 8 * u, (sw - 20 * u) * k, 4 * u);
    }
    /* jauge de recharge */
    if (reloading) {
      const k = 1 - P.reloadT / def.reload;
      ctx.fillStyle = 'rgba(255,255,255,.12)';
      ctx.fillRect(x + 10 * u, y + sh - 8 * u, sw - 20 * u, 4 * u);
      ctx.fillStyle = '#ffd35c';
      ctx.fillRect(x + 10 * u, y + sh - 8 * u, (sw - 20 * u) * k, 4 * u);
    } else if (P.cds[n] > 0 && def.cd > 0.3) {
      const k = 1 - P.cds[n] / def.cd;
      ctx.fillStyle = 'rgba(120,230,255,.6)';
      ctx.fillRect(x + 10 * u, y + sh - 8 * u, (sw - 20 * u) * k, 3 * u);
    }
  }
  ctx.globalAlpha = 1;
  font(ctx, 500, 11 * u); ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(200,210,255,.45)';
  ctx.fillText('R : recharger · molette : changer · clic droit : glissade', W - 14 * u, H - 94 * u);
}

/* ------------------------------ Réticule ------------------------------ */
function drawCrosshair(ctx, u, cam, P, lx, ly, time) {
  const mx = input.sx * cam.dpr, my = input.sy * cam.dpr;
  const def = WEAPONS[P.weapons[P.active]];
  /* L'écart suit la dispersion réelle : distance à l'épaule × tan(dispersion). */
  const px = (lx - cam.l) * cam.s, py = (ly - 60 - cam.t) * cam.s;
  const dist = Math.hypot(mx - px, my - py);
  let spreadDeg = def.pellets ? def.fan : P.spread;
  const gap = Math.max(5 * u, dist * Math.tan(spreadDeg * Math.PI / 180));
  const len = 9 * u;
  ctx.lineCap = 'round';
  const col = P.reloadT > 0 || P.switchT > 0 ? 'rgba(255,255,255,.35)' : '#ffffff';
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass ? col : 'rgba(0,0,0,.6)';
    ctx.lineWidth = (pass ? 2 : 4) * u;
    ctx.beginPath();
    ctx.moveTo(mx - gap - len, my); ctx.lineTo(mx - gap, my);
    ctx.moveTo(mx + gap, my); ctx.lineTo(mx + gap + len, my);
    ctx.moveTo(mx, my - gap - len); ctx.lineTo(mx, my - gap);
    ctx.moveTo(mx, my + gap); ctx.lineTo(mx, my + gap + len);
    ctx.stroke();
    if (def.pellets) { ctx.beginPath(); ctx.arc(mx, my, gap, 0, TAU); ctx.stroke(); }
  }
  ctx.fillStyle = P.color;
  ctx.beginPath(); ctx.arc(mx, my, 2.2 * u, 0, TAU); ctx.fill();
  /* charge du railgun autour du réticule */
  if (def.charge && P.charge > 0) {
    const k = Math.min(1, P.charge / def.charge);
    ctx.strokeStyle = k >= 1 ? '#e8fbff' : '#4dd2ff'; ctx.lineWidth = (k >= 1 ? 4 : 3) * u;
    ctx.beginPath(); ctx.arc(mx, my, gap + len + 8 * u, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
    if (k >= 1) { font(ctx, 800, 11 * u); ctx.textAlign = 'center'; ctx.fillStyle = '#e8fbff'; ctx.fillText('RELÂCHE !', mx, my + gap + len + 26 * u); }
  }
  /* recharge autour du réticule */
  if (P.reloadT > 0) {
    const k = 1 - P.reloadT / def.reload;
    ctx.strokeStyle = '#ffd35c'; ctx.lineWidth = 3 * u;
    ctx.beginPath(); ctx.arc(mx, my, gap + len + 8 * u, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
  }
  /* confirmation de touche (envoyée par la victime) */
  if (G.hitMarker > 0) {
    const k = G.hitMarker / 0.22;
    const r0 = 7 * u, r1 = (G.hitMarkerHs ? 18 : 13) * u;
    ctx.strokeStyle = G.hitMarkerHs ? 'rgba(255,207,61,' + k + ')' : 'rgba(255,255,255,' + k + ')';
    ctx.lineWidth = (G.hitMarkerHs ? 3.5 : 2.5) * u;
    ctx.beginPath();
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      ctx.moveTo(mx + sx * r0, my + sy * r0); ctx.lineTo(mx + sx * r1, my + sy * r1);
    }
    ctx.stroke();
  }
}

/* --------------------- Adversaires hors du champ ---------------------- */
function drawOffscreen(ctx, W, H, u, cam, view) {
  const m = 34 * u;
  const cx = W / 2, cy = H / 2;
  const list = [];
  for (const o of S.others.values()) if (o.alive && o.seen) list.push(o);
  for (const d of S.dummies) if (d.alive) list.push(d);
  for (const o of list) {
    const sx = (o.x - view.l) * cam.s, sy = (o.y - 45 - view.t) * cam.s;
    if (sx > 0 && sx < W && sy > 0 && sy < H) continue;
    const dx = sx - cx, dy = sy - cy;
    const k = Math.min((W / 2 - m) / Math.abs(dx || 1e-3), (H / 2 - m) / Math.abs(dy || 1e-3));
    const ex = cx + dx * k, ey = cy + dy * k;
    const a = Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(a);
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.beginPath(); ctx.moveTo(18 * u, 0); ctx.lineTo(-8 * u, -13 * u); ctx.lineTo(-8 * u, 13 * u); ctx.closePath(); ctx.fill();
    ctx.fillStyle = o.color;
    ctx.beginPath(); ctx.moveTo(14 * u, 0); ctx.lineTo(-5 * u, -9 * u); ctx.lineTo(-5 * u, 9 * u); ctx.closePath(); ctx.fill();
    ctx.restore();
    const dist = Math.round(Math.hypot(o.x - (view.l + view.r) / 2, o.y - (view.t + view.b) / 2) / 10);
    font(ctx, 700, 11 * u); ctx.textAlign = 'center'; ctx.fillStyle = o.color;
    ctx.fillText(dist + ' m', ex - Math.cos(a) * 26 * u, ey - Math.sin(a) * 26 * u + 4 * u);
  }
}

/* -------------------------------- Survie ------------------------------ */
/* Bandeau : vague, bots restants, vies, record ; grand « VAGUE n » à chaque vague. */
function drawSurvival(ctx, W, u) {
  const P = S.P;
  const left = botsAlive() + G.waveQueue;
  const lives = livesLeft(G.slot);
  const parts = [
    'VAGUE ' + Math.max(1, G.wave),
    G.wave ? 'bots : ' + left + ' / ' + waveSize(G.wave) : 'prépare-toi',
    'abattus : ' + Math.max(0, S.score[G.slot].k),
    'record : vague ' + survivalBest(),
  ];
  const txt = parts.join('   ·   ');
  font(ctx, 800, 15 * u); ctx.textAlign = 'center';
  const w = ctx.measureText(txt).width + 110 * u, h = 38 * u, x = (W - w) / 2, y = 12 * u;
  ctx.fillStyle = 'rgba(8,10,24,.78)'; rr(ctx, x, y, w, h, 10 * u); ctx.fill();
  ctx.strokeStyle = 'rgba(255,90,90,.6)'; ctx.lineWidth = 1.5 * u; ctx.stroke();
  ctx.fillStyle = '#e7ecff';
  ctx.fillText(txt, W / 2 - 40 * u, y + 25 * u);
  ctx.fillStyle = '#ff5a7a'; ctx.textAlign = 'right';
  ctx.fillText('♥'.repeat(lives) + '♡'.repeat(Math.max(0, 3 - lives)), x + w - 14 * u, y + 25 * u);
  /* entre deux vagues : compte à rebours */
  if (left === 0 && G.phase === 'play') {
    font(ctx, 700, 16 * u); ctx.textAlign = 'center'; ctx.fillStyle = '#ffd35c';
    ctx.fillText((G.wave ? 'Vague ' + G.wave + ' terminée ! ' : '') + 'Vague ' + (G.wave + 1) + ' dans ' + Math.max(0, Math.ceil(G.waveT)) + '…', W / 2, y + h + 26 * u);
  }
  /* grand bandeau à l'arrivée d'une vague */
  if (G.waveBanner > 0) {
    const k = G.waveBanner / 2.2;
    const pop = 1 + Math.max(0, k - 0.8) * 2;
    ctx.save();
    ctx.globalAlpha = Math.min(1, G.waveBanner * 1.5);
    ctx.translate(W / 2, H0(ctx) * 0.3);
    ctx.scale(pop, pop);
    font(ctx, 900, 64 * u); ctx.textAlign = 'center';
    ctx.lineWidth = 10 * u; ctx.strokeStyle = 'rgba(20,0,0,.85)'; ctx.lineJoin = 'round';
    const t = 'VAGUE ' + G.wave;
    ctx.strokeText(t, 0, 0);
    ctx.fillStyle = '#ff4a4a'; ctx.fillText(t, 0, 0);
    font(ctx, 700, 18 * u); ctx.fillStyle = '#ffd6d6';
    ctx.fillText(waveSize(G.wave) + ' bot' + (waveSize(G.wave) > 1 ? 's' : '') + (G.wave >= SURV.MAX_BOTS ? ' · ils deviennent plus forts' : ''), 0, 34 * u);
    ctx.restore();
  }
}
const H0 = (ctx) => ctx.canvas.height;

/* --------------------------- Roi de la colline ------------------------ */
function drawHillInfo(ctx, W, H, u, cam, view) {
  const col = hillColor();
  const who = G.hillOwner >= 0 ? playerName(G.hillOwner) + ' tient la colline'
    : G.hillOwner === -2 ? 'Colline contestée !' : 'Colline libre';
  const txt = '♛ ' + who + '  ·  déplacement dans ' + Math.max(0, Math.ceil(G.hillT)) + ' s';
  font(ctx, 800, 13 * u); ctx.textAlign = 'center';
  const y = 12 * u + 44 * u + (MODES.some((m) => G.modes[m.key]) ? 28 * u : 0);
  const w = ctx.measureText(txt).width + 28 * u;
  ctx.fillStyle = 'rgba(8,10,24,.75)';
  rr(ctx, (W - w) / 2, y, w, 24 * u, 12 * u); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 1.5 * u; ctx.stroke();
  ctx.fillStyle = col;
  ctx.fillText(txt, W / 2, y + 16.5 * u);
  /* flèche vers la colline quand elle est hors champ */
  const h = G.map.hills[G.hill];
  if (!h) return;
  const sx = (h.x + h.w / 2 - view.l) * cam.s, sy = (h.y + h.h / 2 - view.t) * cam.s;
  if (sx > 0 && sx < W && sy > 0 && sy < H) return;
  const cx = W / 2, cy = H / 2, m = 60 * u;
  const dx = sx - cx, dy = sy - cy;
  const k = Math.min((W / 2 - m) / Math.abs(dx || 1e-3), (H / 2 - m) / Math.abs(dy || 1e-3));
  const ex = cx + dx * k, ey = cy + dy * k, a = Math.atan2(dy, dx);
  ctx.save();
  ctx.translate(ex, ey); ctx.rotate(a);
  ctx.fillStyle = 'rgba(0,0,0,.5)';
  ctx.beginPath(); ctx.moveTo(24 * u, 0); ctx.lineTo(-10 * u, -17 * u); ctx.lineTo(-10 * u, 17 * u); ctx.closePath(); ctx.fill();
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(19 * u, 0); ctx.lineTo(-6 * u, -12 * u); ctx.lineTo(-6 * u, 12 * u); ctx.closePath(); ctx.fill();
  ctx.restore();
  font(ctx, 900, 14 * u); ctx.fillStyle = col;
  ctx.fillText('♛', ex - Math.cos(a) * 30 * u, ey - Math.sin(a) * 30 * u + 5 * u);
}

/* ------------------------- Réseau, réapparition ----------------------- */
function drawNet(ctx, W, H, u) {
  let text, col;
  if (G.role === 'solo') { text = G.gameType === 'surv' ? 'Survie' : 'Entraînement solo'; col = '#8f9ac6'; }
  else {
    col = G.netCls === 'on' ? '#41d98a' : G.netCls === 'off' ? '#ff5a5a' : '#ffc44d';
    text = G.netText + (G.ping !== null && G.netCls === 'on' ? ' · ' + G.ping + ' ms' : '');
  }
  font(ctx, 600, 11 * u); ctx.textAlign = 'center';
  text += '  ·  Échap : menu';
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(W / 2 - tw / 2 - 10 * u, H - 18 * u, 4 * u, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(200,210,255,.6)';
  ctx.fillText(text, W / 2, H - 14 * u);
}

function drawRespawn(ctx, W, H, u, P) {
  if (G.gameType === 'lms' && livesLeft(P.i) <= 0) {          // éliminé : spectateur
    const s = spectated();
    ctx.textAlign = 'center';
    font(ctx, 900, 30 * u); ctx.fillStyle = '#ff5a5a';
    ctx.fillText('ÉLIMINÉ', W / 2, H * 0.3);
    font(ctx, 600, 16 * u); ctx.fillStyle = 'rgba(220,228,255,.8)';
    ctx.fillText(s ? 'Tu regardes ' + playerName(s.i) + ' jusqu’à la fin de la partie' : 'Plus de vie', W / 2, H * 0.3 + 30 * u);
    return;
  }
  if (G.gameType === 'lms' || G.gameType === 'surv') {
    font(ctx, 700, 15 * u); ctx.textAlign = 'center'; ctx.fillStyle = '#ff7a8a';
    ctx.fillText('Vies restantes : ' + '♥'.repeat(livesLeft(P.i)), W / 2, H * 0.32 + 58 * u);
  }
  const last = S.feed.length ? S.feed[S.feed.length - 1] : null;
  ctx.textAlign = 'center';
  font(ctx, 800, 30 * u);
  ctx.fillStyle = 'rgba(0,0,0,.5)';
  ctx.fillText('Réapparition dans ' + Math.max(0, P.respawnT).toFixed(1) + ' s', W / 2 + 2 * u, H * 0.32 + 2 * u);
  ctx.fillStyle = '#fff';
  ctx.fillText('Réapparition dans ' + Math.max(0, P.respawnT).toFixed(1) + ' s', W / 2, H * 0.32);
  if (last && last.v === G.slot) {
    font(ctx, 600, 16 * u);
    if (last.k >= 0 && last.k !== G.slot) {
      ctx.fillStyle = COLORS[last.k];
      ctx.fillText('Éliminé par ' + playerName(last.k) + (last.hs ? ' — headshot' : ''), W / 2, H * 0.32 + 32 * u);
    } else {
      ctx.fillStyle = 'rgba(220,228,255,.75)';
      ctx.fillText(last.w === 'fall' ? 'Chute mortelle (-1)' : 'Suicide (-1)', W / 2, H * 0.32 + 32 * u);
    }
  }
}
