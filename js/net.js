/* ==========================================================================
   Réseau — repris de Racco Duel : WebRTC via PeerJS, topologie en étoile.

     · chaque invité n'ouvre qu'une liaison, vers l'hôte ;
     · l'hôte réexpédie aux autres tout ce qu'il reçoit ;
     · chaque message porte le slot de son émetteur (champ f), que l'hôte
       réécrit d'après la liaison d'origine avant de le relayer.

   Ce module ne connaît rien au gameplay : il transporte des messages et
   prévient main.js via des gestionnaires (setHandlers).
   ========================================================================== */
import { G, MAX_PLAYERS } from './state.js';

/* ------------------------------ Réglages ------------------------------ */
const PEER_PREFIX     = 'realistic-racco-';
const ALPHABET        = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CONNECT_TIMEOUT = 20000;   // abandon de la connexion (ms)
const LINK_TIMEOUT    = 10000;   // plus aucune nouvelle d'un joueur : on le considère parti (ms)
const HEARTBEAT       = 1000;    // battement de cœur (ms)

/* Messages que l'hôte ne relaie pas : ils ne concernent que lui. */
const HOST_ONLY = { kreq: true };

/* Les serveurs STUN suffisent dès que les joueurs sont joignables
   directement : ils servent à découvrir sa propre adresse publique. */
const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

/* ---------------------- Relais TURN (optionnel) -----------------------
   Derrière un NAT symétrique, un pare-feu d'entreprise ou une box qui
   refuse l'UDP entrant, aucune liaison directe n'est possible : il faut un
   relais TURN par lequel tout le trafic transite. Le jeu envoie environ
   4 Ko/s par joueur, la consommation reste faible.

   Les relais publics utilisables sans inscription ont tous fermé
   (openrelay.metered.ca, freeturn.net ne renvoient plus aucun candidat) :
   la liste est donc vide par défaut.

   Pour jouer entre réseaux différents : ouvrir un compte gratuit chez un
   fournisseur TURN (metered.ca, Twilio, Xirsys…) et coller les identifiants
   ici. C'est la seule modification nécessaire :

     const TURN_SERVERS = [
       { urls: 'turn:…:80',                username: '…', credential: '…' },
       { urls: 'turn:…:443?transport=tcp', username: '…', credential: '…' },
     ];

   Le second, en TCP sur le port 443, passe les réseaux les plus fermés :
   pour eux, c'est indiscernable d'une connexion web. */
const TURN_SERVERS = [];

const PEER_OPTS = {
  debug: 0,
  config: { iceServers: STUN_SERVERS.concat(TURN_SERVERS) },
};

/* ------------------------------- État --------------------------------- */
let peer = null;
let conns = [];                     // hôte : tous les invités ; invité : l'hôte seul
const lastSeen = new Map();         // slot -> date du dernier message
const rtt = new Map();              // slot -> latence mesurée (ms)
let lastRecv = 0;
let H = {};

export const isHost = () => G.role === 'host';
export const peerAvailable = () => typeof window.Peer !== 'undefined';
export function setHandlers(h) { H = h; }
const call = (name, a, b) => { if (H[name]) return H[name](a, b); };

function setNet(cls, text) {
  G.netCls = cls; G.netText = text;
  call('net', cls, text);
}

/* ------------------- Diagnostic de la liaison WebRTC ------------------ */
/* On note quels types de candidats ICE ont pu être récoltés :
   host = adresse locale, srflx = adresse publique via STUN, relay = TURN.
   Si la connexion échoue, ce relevé dit exactement où ça bloque. */
const ice = { host: false, srflx: false, relay: false, state: '' };
let connectTimer = null;
let icePc = null;

function attachIceProbe(c) {
  const bind = (pc) => {
    icePc = pc;
    pc.addEventListener('icecandidate', (e) => {
      if (!e.candidate || !e.candidate.candidate) return;
      const type = e.candidate.type || e.candidate.candidate.split(' ')[7];
      if (type === 'host') ice.host = true;
      else if (type === 'srflx') ice.srflx = true;
      else if (type === 'relay') ice.relay = true;
    });
    pc.addEventListener('iceconnectionstatechange', () => {
      ice.state = pc.iceConnectionState;
      if (ice.state === 'failed' && !G.connected) failConnection('Échec de la liaison directe entre les machines.');
    });
  };
  /* Côté appelant la RTCPeerConnection existe déjà ; côté hôte elle est
     créée à la réception de l'offre, d'où la petite attente active. */
  if (c.peerConnection) { bind(c.peerConnection); return; }
  let tries = 0;
  const poll = setInterval(() => {
    if (c.peerConnection) { clearInterval(poll); bind(c.peerConnection); }
    else if (++tries > 100) clearInterval(poll);
  }, 50);
}

/* Les candidats récoltés avant l'attachement de la sonde figurent quand
   même dans la description locale : on la relit pour le rapport. */
function scanIceSdp() {
  if (!icePc) return;
  const sdp = (icePc.localDescription && icePc.localDescription.sdp) || '';
  if (sdp.indexOf(' typ host') >= 0) ice.host = true;
  if (sdp.indexOf(' typ srflx') >= 0) ice.srflx = true;
  if (sdp.indexOf(' typ relay') >= 0) ice.relay = true;
  if (icePc.iceConnectionState) ice.state = icePc.iceConnectionState;
}

export function iceReport() {
  scanIceSdp();
  return 'Diagnostic — adresse locale : ' + (ice.host ? 'ok' : 'aucune')
       + ' · adresse publique (STUN) : ' + (ice.srflx ? 'ok' : 'aucune')
       + ' · relais (TURN) : ' + (ice.relay ? 'ok' : 'aucun')
       + (ice.state ? ' · ICE : ' + ice.state : '')
       + ' — ' + iceDiagnosis();
}

/* Traduit le relevé en cause probable. */
function iceDiagnosis() {
  if (G.connected || ice.state === 'connected' || ice.state === 'completed') {
    return 'la liaison média elle-même est établie.';
  }
  if (!ice.host && !ice.srflx && !ice.relay) {
    return 'aucune adresse récoltée : WebRTC semble bloqué sur cette machine (VPN, extension, pare-feu).';
  }
  if (!ice.srflx && !ice.relay) return 'pas de sortie vers Internet pour le média : STUN est injoignable.';
  if (!ice.relay) {
    return 'les machines ne peuvent pas se joindre directement et aucun relais TURN'
         + " n'est configuré (voir TURN_SERVERS en haut de js/net.js).";
  }
  return 'le relais est disponible mais la liaison a tout de même échoué.';
}

function resetIce() {
  ice.host = ice.srflx = ice.relay = false;
  ice.state = '';
  icePc = null;
}

function armConnectTimeout() {
  clearTimeout(connectTimer);
  connectTimer = setTimeout(() => {
    if (!G.connected) failConnection('Délai dépassé : la liaison n’a pas pu s’établir.');
  }, CONNECT_TIMEOUT);
}

function failConnection(reason) {
  clearTimeout(connectTimer);
  cleanupPeer();
  call('fail', reason + ' ' + iceReport());
}

/* --------------------------- Envoi / relais --------------------------- */
export function send(msg) {
  msg.f = G.slot;
  for (const c of conns) if (c.open) { try { c.send(msg); } catch (e) {} }
}
/* Envoi à un seul joueur (hôte uniquement). */
export function sendTo(slot, msg) {
  msg.f = G.slot;
  for (const c of conns) if (c.slot === slot && c.open) { try { c.send(msg); } catch (e) {} }
}
function relayFrom(sender, msg) {
  for (const c of conns) if (c !== sender && c.open) { try { c.send(msg); } catch (e) {} }
}

function randomCode(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

/* ------------------------------- Salle -------------------------------- */
export function createRoom() {
  cleanupPeer();
  resetIce();
  G.role = 'host';
  G.slot = 0;                        // l'hôte occupe toujours le slot 0
  setNet('waiting', 'En attente…');
  call('status', 'Ouverture de la salle…');
  openHostPeer(randomCode(4), 0);
}

function openHostPeer(code, attempt) {
  G.code = code;
  peer = new window.Peer(PEER_PREFIX + code, PEER_OPTS);

  peer.on('open', () => {
    call('opened', code);
    call('status', 'Salle ouverte — transmets le code aux autres joueurs.');
  });
  /* Se déclenche dès qu'un joueur a trouvé la salle via le serveur de
     signalisation : sépare « il ne me trouve pas » de « le lien ne s'ouvre pas ». */
  peer.on('connection', (c) => {
    if (G.phase !== 'lobby') { c.close(); return; }                 // partie en cours : salle fermée
    if (conns.length >= MAX_PLAYERS - 1) { c.close(); return; }     // salle pleine
    call('status', 'Un joueur se connecte — établissement du lien…');
    attachIceProbe(c);
    armConnectTimeout();
    setupConn(c);
  });
  peer.on('disconnected', () => {
    if (peer && !peer.destroyed) { try { peer.reconnect(); } catch (e) {} }
  });
  peer.on('error', (err) => {
    if (err.type === 'unavailable-id' && attempt < 5) {   // code déjà pris : on en tire un autre
      try { peer.destroy(); } catch (e) {}
      openHostPeer(randomCode(4), attempt + 1);
      return;
    }
    if (err.type === 'peer-unavailable') return;
    call('fail', 'Erreur réseau : ' + err.type);
  });
}

export function joinRoom(code) {
  cleanupPeer();
  resetIce();
  G.role = 'guest';
  G.code = code;
  G.slot = -1;
  setNet('waiting', 'Connexion…');
  call('status', 'Contact du serveur de signalisation…');

  peer = new window.Peer(PEER_OPTS);
  peer.on('open', () => {
    call('status', 'Appel de la salle ' + code + ' — établissement du lien direct…');
    const c = peer.connect(PEER_PREFIX + code, { reliable: true });
    attachIceProbe(c);
    armConnectTimeout();
    setupConn(c);
  });
  peer.on('disconnected', () => {
    if (!G.connected && peer && !peer.destroyed) { try { peer.reconnect(); } catch (e) {} }
  });
  peer.on('error', (err) => {
    clearTimeout(connectTimer);
    if (err.type === 'peer-unavailable') call('fail', 'Aucune partie trouvée avec le code ' + code + '.');
    else call('fail', 'Erreur réseau : ' + err.type + '. ' + iceReport());
    cleanupPeer();
  });
}

function freeSlot() {
  const taken = conns.map((c) => c.slot);
  for (let i = 1; i < MAX_PLAYERS; i++) if (taken.indexOf(i) < 0) return i;
  return -1;
}

function setupConn(c) {
  conns.push(c);
  c.on('open', () => {
    clearTimeout(connectTimer);
    G.connected = true;
    lastRecv = performance.now();
    setNet('on', 'Connecté');
    if (isHost()) {
      c.slot = freeSlot();
      if (c.slot < 0) { c.close(); return; }
      lastSeen.set(c.slot, performance.now());
      const extra = call('welcomeData', c.slot) || {};
      c.send(Object.assign({ t: 'welcome', slot: c.slot, f: 0 }, extra));
      call('join', c.slot);
    } else {
      call('status', 'Connecté ! En attente de l’hôte…', 'ok');
    }
  });
  c.on('data', (m) => {
    if (!m || typeof m !== 'object') return;
    if (isHost()) {
      if (c.slot === undefined) return;
      m.f = c.slot;                           // le slot fait foi d'après la liaison
      if (!HOST_ONLY[m.t]) relayFrom(c, m);   // l'hôte est le point de passage de tous
    }
    receive(m);
  });
  c.on('close', () => onConnClosed(c));
  c.on('error', () => onConnClosed(c));
}

function receive(m) {
  lastRecv = performance.now();
  if (m.f !== undefined && m.f !== G.slot) lastSeen.set(m.f, lastRecv);
  switch (m.t) {
    case 'welcome':
      G.slot = m.slot;
      lastSeen.set(0, lastRecv);
      break;
    case 'p':                                  // ping : on répond à l'émetteur
      send({ t: 'q', ts: m.ts, to: m.f });
      return;
    case 'q':
      if (m.to === G.slot) {
        rtt.set(m.f, Math.round(performance.now() - m.ts));
        if (isHost()) G.ping = Math.max.apply(null, Array.from(rtt.values()));
        else if (m.f === 0) G.ping = rtt.get(0);
      }
      return;
    case 'quit':
      lastSeen.delete(m.s);
      rtt.delete(m.s);
      call('leave', m.s);
      return;
  }
  call('data', m);
}

function dropSlot(slot) {
  lastSeen.delete(slot);
  rtt.delete(slot);
  send({ t: 'quit', s: slot });
  call('leave', slot);
}

function onConnClosed(c) {
  const i = conns.indexOf(c);
  if (i < 0) return;
  conns.splice(i, 1);
  if (isHost()) {
    if (c.slot !== undefined && c.slot >= 0) dropSlot(c.slot);
    if (!conns.length) { G.connected = false; setNet('waiting', 'En attente…'); }
    return;
  }
  /* Invité : perdre l'hôte, c'est perdre la partie. */
  if (!G.connected) return;
  G.connected = false;
  setNet('off', 'Déconnecté');
  call('hostLost');
}

/* Battement de cœur : mesure de latence, détection de coupure (la fermeture
   brutale d'un onglet n'émet pas toujours 'close' côté WebRTC) et
   rediffusion de secours de l'état quand l'onglet est en arrière-plan
   (requestAnimationFrame y est suspendu, pas setInterval). */
setInterval(() => {
  if (!G.connected) return;
  send({ t: 'p', ts: performance.now() });
  call('heartbeat');
  const now = performance.now();
  if (isHost()) {
    for (const c of conns.slice()) {
      if (c.slot === undefined) continue;
      const seen = lastSeen.get(c.slot) || now;
      if (now - seen <= LINK_TIMEOUT) continue;
      /* La liaison morte doit aussi quitter la liste, sinon son slot reste
         réservé et la salle finit par paraître pleine à tort. */
      conns.splice(conns.indexOf(c), 1);
      try { c.close(); } catch (e) {}
      dropSlot(c.slot);
    }
    if (!conns.length) { G.connected = false; setNet('waiting', 'En attente…'); }
  } else if (now - lastRecv > LINK_TIMEOUT) {
    onConnClosed(conns[0] || { });
    if (G.connected) { G.connected = false; setNet('off', 'Déconnecté'); call('hostLost'); }
  }
}, HEARTBEAT);

export function connectedSlots() {
  return conns.map((c) => c.slot).filter((s) => s !== undefined && s >= 0);
}

export function cleanupPeer() {
  clearTimeout(connectTimer);
  for (const c of conns) { try { c.close(); } catch (e) {} }
  conns = [];
  lastSeen.clear();
  rtt.clear();
  if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
  G.connected = false;
  G.ping = null;
  setNet('waiting', 'Hors ligne');
}
