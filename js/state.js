/* ==========================================================================
   REALISTIC RACCO — état partagé, constantes globales et petits outils.
   Tous les modules lisent et modifient les mêmes objets G (partie) et
   S (monde) : on évite ainsi les réassignations invisibles entre modules.
   ========================================================================== */

/* ------------------------------ Règles -------------------------------- */
export const MAX_PLAYERS   = 4;
export const WIN_KILLS     = 10;      // premier à 10 kills
export const MAX_HP        = 100;
export const RESPAWN_DELAY = 2;       // délai avant réapparition (s)
export const INVULN_TIME   = 1.5;     // invulnérabilité après réapparition (s)
export const ASSIST_WINDOW = 5;       // chute / suicide : le kill va au dernier tireur des 5 dernières s
export const HEAL_AMOUNT   = 40;      // soin d'un kit
export const KIT_RESPAWN   = 20;      // réapparition d'un kit (s)

/* ---------------------------- Simulation ------------------------------ */
export const STEP         = 1 / 60;   // pas de temps fixe de la simulation (s)
export const NET_INTERVAL = 1 / 30;   // fréquence d'envoi de l'état (s)
export const INTERP_DELAY = 90;       // retard d'affichage des joueurs distants (ms)

/* --------------------------- Modes de partie -------------------------- */
/* Choisis par l'hôte dans le salon, cumulables, identiques sur toutes les
   machines (envoyés avec le coup d'envoi). */
export const MODES = [
  { key: 'bighead', name: 'Big Head', desc: 'Têtes énormes : hitbox de tête ×2' },
  { key: 'flies',   name: 'Flies',    desc: 'Sauts illimités en l’air' },
  { key: 'op',      name: 'OP',       desc: 'Chaque tir part en triple, plus dispersé' },
];
/* Types de partie (un seul à la fois, choisi par l'hôte). */
export const GAME_TYPES = [
  { key: 'dm',   name: 'Match à mort',     desc: 'Premier à 10 kills' },
  { key: 'koth', name: 'Roi de la colline', desc: 'Tiens la zone seul : 60 points' },
  { key: 'lms',  name: 'Dernier debout',   desc: '3 vies chacun, le dernier gagne' },
  { key: 'surv', name: 'Survie',           desc: 'Vagues de bots sans fin, 3 vies', solo: true },
];
export const KOTH_TARGET = 60;        // points (secondes seul dans la zone) pour gagner
export const HILL_TIME   = 25;        // la colline se déplace toutes les 25 s
export const LMS_LIVES   = 3;         // vies en mode Dernier debout
export const SURV_LIVES  = 3;         // vies en mode Survie (solo)
export const DEST_RESPAWN = 30;       // un décor détruit se reconstruit après 30 s

export const BIG_HEAD_SCALE = 2;      // taille de la tête en mode Big Head
export const OP_COPIES      = 3;      // projectiles par tir en mode OP
export const OP_SPREAD      = 7;      // dispersion supplémentaire des copies OP (degrés)

/* ------------------------------ Affichage ----------------------------- */
export const VIEW_W = 1600;           // zone visible logique (mise à l'échelle selon l'écran)
export const VIEW_H = 900;

export const COLORS      = ['#4da3ff', '#ff5a5a', '#5ce68a', '#ffd35c'];
export const COLORS_DARK = ['#173a66', '#6b1d1d', '#1b5e36', '#6b5217'];
export const COLOR_NAMES = ['Bleu', 'Rouge', 'Vert', 'Jaune'];

export const TAU = Math.PI * 2;

/* ------------------------------- Outils ------------------------------- */
export const $ = (id) => document.getElementById(id);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const approach = (v, target, d) => (v < target ? Math.min(v + d, target) : Math.max(v - d, target));
export const rand = (a, b) => a + Math.random() * (b - a);
export const angDiff = (a, b) => ((b - a + Math.PI * 3) % TAU) - Math.PI;

/* Hachage FNV-1a d'une chaîne : sert de graine aux tirs dispersés. */
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
/* Générateur pseudo-aléatoire déterministe (mulberry32) : même graine,
   même suite de nombres sur toutes les machines. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const seededRng = (str) => mulberry32(hashStr(str));
/* Bruit entier stable, pour le décor (fenêtres allumées, étoiles…). */
export function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* -------------------------------- État -------------------------------- */
export const G = {
  phase: 'menu',        // 'menu' | 'lobby' | 'play' | 'over'
  role: null,           // 'host' | 'guest' | 'solo'
  slot: 0,              // mon slot (0 = hôte, couleur du joueur)
  connected: false,
  code: '',
  mapId: 0,
  map: null,            // carte en cours (objet construit par maps.js)
  time: 0,              // temps de jeu (s), avancé par la simulation fixe
  netAcc: 0,
  netCls: 'waiting',    // statut réseau affiché par le HUD
  netText: 'Hors ligne',
  ping: null,
  quality: 'high',      // 'high' | 'low'
  shake: 0,             // traumatisme de la caméra (0..1)
  hurt: 0,              // flash rouge quand on encaisse
  hitMarker: 0,         // confirmation de touche (croix blanche)
  hitMarkerHs: false,
  winner: -1,
  modes: { bighead: false, flies: false, op: false },
  gameType: 'dm',       // 'dm' | 'koth' | 'lms'
  hill: 0,              // colline active (Roi de la colline)
  hillT: 0,             // temps avant le déplacement de la colline
  hillOwner: -1,        // qui tient la colline : slot, -1 personne, -2 contestée
  wave: 0,              // Survie : numéro de vague
  waveT: 0,             // Survie : temps avant la prochaine vague
  waveQueue: 0,         // Survie : bots encore à faire apparaître
  waveSpawnT: 0,
  waveBanner: 0,        // Survie : affichage « VAGUE n »
};
export const headScale = () => (G.modes.bighead ? BIG_HEAD_SCALE : 1);

/* Textes affichés au hasard quand on élimine un adversaire. */
export const KILL_TEXTS = [
  'DEMOLISHED', 'ONE SHOT', 'BOOM!', 'WASTED', 'OBLITERATED', 'DESTROYED', 'REKT',
  'ANNIHILATED', 'SMOKED', 'KO!', 'TERMINATED', 'ERASED', 'DELETED', 'OUTPLAYED',
  'SENT HOME', 'NO MERCY', 'BYE BYE', 'CRUSHED', 'EZ', 'SPLAT!',
];
let lastKillText = '';
export function pickKillText() {
  let t;
  do t = KILL_TEXTS[Math.floor(Math.random() * KILL_TEXTS.length)]; while (t === lastKillText && KILL_TEXTS.length > 1);
  lastKillText = t;
  return t;
}

export const S = {
  P: null,              // joueur local
  others: new Map(),    // slot -> joueur distant
  dummies: [],          // mannequins de l'entraînement solo
  proj: [],             // projectiles en vol
  ragdolls: [],
  kits: [],
  score: [],            // par slot : { k, d, shots, hits }
  feed: [],             // fil des kills
  lobby: new Map(),     // slot -> { n: pseudo, w: [arme1, arme2], r: prêt }
};

export function resetScores() {
  S.score = [];
  for (let i = 0; i < MAX_PLAYERS; i++) S.score.push({ k: 0, d: 0, shots: 0, hits: 0, pts: 0 });
}
resetScores();

/* Vies restantes en mode Dernier debout (déduites des morts annoncées). */
export const livesLeft = (slot) =>
  Math.max(0, (G.gameType === 'surv' ? SURV_LIVES : LMS_LIVES) - (S.score[slot] ? S.score[slot].d : 0));

export function playerName(slot) {
  if (G.gameType === 'surv' && slot !== G.slot) return 'Bot';
  const l = S.lobby.get(slot);
  return (l && l.n) || COLOR_NAMES[slot];
}
