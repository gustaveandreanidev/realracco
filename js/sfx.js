/* ==========================================================================
   Sons synthétisés en WebAudio (aucun fichier à charger).
   Le contexte audio n'existe qu'après une interaction de l'utilisateur :
   on le crée à la demande, au premier son joué.
   ========================================================================== */

/* ------------------------------ Réglages ------------------------------ */
const MASTER = 0.5;          // volume général

let ac = null;
function audio() {
  if (!ac) {
    const A = window.AudioContext || window.webkitAudioContext;
    if (!A) return null;
    ac = new A();
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}

/* Bruit blanc réutilisable (1 s). */
let noiseBuf = null;
function noise(a) {
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = a.createBufferSource();
  s.buffer = noiseBuf;
  return s;
}

/* « SHHHINNG » du katana : souffle aigu de la lame + résonance métallique. */
export function shing(vol) {
  if (vol <= 0.02) return;
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const out = a.createGain();
  out.gain.value = MASTER * vol;
  out.connect(a.destination);

  /* « SHHH » : bruit filtré dont la fréquence monte */
  const n = noise(a);
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(2500, t);
  bp.frequency.exponentialRampToValueAtTime(9000, t + 0.18);
  const ng = a.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.exponentialRampToValueAtTime(0.7, t + 0.03);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  n.connect(bp); bp.connect(ng); ng.connect(out);
  n.start(t); n.stop(t + 0.25);

  /* « INNG » : partiels inharmoniques qui résonnent comme une lame */
  for (const [f, g, dur] of [[3150, 0.22, 0.9], [4720, 0.14, 0.7], [6380, 0.08, 0.5], [2210, 0.1, 0.6]]) {
    const o = a.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f * 0.97, t + 0.05);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.2);
    const og = a.createGain();
    og.gain.setValueAtTime(0.0001, t + 0.05);
    og.gain.exponentialRampToValueAtTime(g, t + 0.09);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.05 + dur);
    o.connect(og); og.connect(out);
    o.start(t + 0.05); o.stop(t + 0.1 + dur);
  }
}
