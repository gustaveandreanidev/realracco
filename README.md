# Realistic Racco

Shooter plateformer en vue de côté, **2 à 4 joueurs**, chacun sur son PC. Stickmen animés
procéduralement, 10 armes avec bullet drop, ragdolls, particules partout, 3 cartes.
Projet **100 % statique** : pas de build, pas de backend, pas de npm. HTML + CSS + JavaScript
(modules ES) et PeerJS chargé depuis le CDN.

## Déploiement sur GitHub Pages

1. Pousser le contenu du dossier (`index.html`, `style.css`, `README.md`, dossier `js/`) dans un dépôt.
2. **Settings → Pages → Source : Deploy from a branch**, brancher `main` / dossier `/ (root)`.
3. Ouvrir l'URL fournie (`https://<user>.github.io/<repo>/`) sur chaque PC. HTTPS, exigé par
   WebRTC, est fourni d'office par GitHub Pages.

Pour tester en local, un serveur statique suffit (les modules ES et WebRTC ne marchent pas en
`file://`) :

```bash
python -m http.server 8123
```

puis `http://localhost:8123` dans plusieurs onglets (un hôte, les autres rejoignent).

## Lancer une partie

- **Créer une partie** : un code à 4 caractères s'affiche. *Copier le lien* donne une URL
  `…/#CODE` qui pré-remplit le code chez les autres.
- Les autres saisissent le code et cliquent **Rejoindre** (jusqu'à 3 invités).
- Dans le salon, chacun choisit **2 armes différentes** (fiches : dégâts, cadence, portée) ; le
  choix de chacun est visible par tous. L'hôte choisit **la carte** (aperçus dessinés en code).
- Chacun **habille son personnage** (chapeau, veste, pantalon, chaussures) avec un aperçu animé ;
  la tenue de chacun est visible par tous, dans le salon comme en jeu.
- L'hôte active les **modes** (cumulables) : voir plus bas.
- Chacun clique **Prêt**, puis l'hôte lance. La salle est alors fermée aux retardataires.
- **Entraînement solo** : mêmes armes et cartes, contre des mannequins (sans réseau).
- **Survie** (solo) : des vagues de bots sans fin, voir plus bas.

## Contrôles

| Action | Touche |
|---|---|
| Gauche / droite | Q / D (AZERTY), A / D (QWERTY), flèches |
| Sauter, double saut | Z, W, Espace, flèche haut (relâcher tôt = saut court) |
| Dash latéral | Double appui rapide sur Q ou D (ou ← / →) : ~185 px, recharge 0,9 s, un seul en l'air |
| Glissade | Clic droit au sol : grosse vitesse, corps couché (les balles passent au-dessus). Sauter pendant la glissade garde l'élan |
| Plongeon | Clic droit en l'air : chute rapide qui se change en glissade à l'atterrissage |
| Descendre d'une plateforme traversable | S, flèche bas |
| Viser | Souris, 360° |
| Tirer | Clic gauche (maintien pour la mitraillette) |
| Arme 1 / arme 2 | `&` / `é` (touches `Digit1` / `Digit2`, donc aussi 1 / 2 en QWERTY) |
| Changer d'arme | Molette |
| Recharger | R (automatique quand le chargeur est vide) |
| Plein écran | F, ou le bouton en haut à gauche |
| Menu (qualité, salon, quitter) | Échap (la partie continue derrière) |

Les touches sont lues à la fois par `e.code` (position physique) et `e.key` (caractère).
Le menu contextuel est neutralisé sur le canvas.

## Types de partie

Choisi par l'hôte dans le salon (un seul à la fois), cumulable avec les modes.

| Type | Victoire |
|---|---|
| Match à mort | Premier à 10 kills |
| Roi de la colline | Premier à 60 points : 1 point par seconde passée **seul** dans la zone. À plusieurs dedans, la colline est contestée et personne ne marque. Elle se déplace toutes les 25 s (flèche en bord d'écran quand elle est hors champ) |
| Dernier debout | 3 vies chacun, pas de réapparition après la dernière (on devient spectateur), le dernier en vie gagne |
| Survie (solo) | Vagues de bots sans fin, 3 vies : tenir le plus de vagues possible |

## Survie (solo)

Bouton **Survie : vagues de bots** sur l'écran d'accueil (ou type de partie « Survie » en solo).

- La vague *n* fait apparaître **min(n, 10) bots en même temps** : 1 bot à la vague 1, 10 à
  partir de la vague 10. La vague suivante commence 4 s après la chute du dernier bot, **sans fin**.
- Les bots deviennent plus coriaces à chaque vague : PV (60 + 6 par vague, jusqu'à 180), visée
  plus précise, cadence plus élevée, et de nouvelles armes (vague 3 : grenades, lance-flammes,
  katana ; vague 6 : sniper, bazooka, railgun, dont la charge lumineuse prévient avant le tir).
- **3 vies**, les kits de soin restent disponibles. Fin de partie : vague atteinte, bots abattus
  et **record** (gardé dans le navigateur).
- IA des bots (`js/bots.js`) : ils calculent un chemin sur un **graphe de navigation** des
  surfaces de la carte (sauts, doubles sauts, chutes), prennent leur distance de combat selon leur
  arme, ne tirent que s'ils te voient, viennent te chercher si tu te caches, évitent le vide et se
  rabattent vers le sol s'ils sont projetés. Un bot égaré 25 s réapparaît plus près.

## Règles

- **100 PV**, **premier à 10 kills**.
- Réapparition après 2 s sur le point de spawn **le plus éloigné des adversaires**, avec 1,5 s
  d'invulnérabilité (le stickman clignote).
- Chute dans le vide, dans l'eau ou hors carte = mort. Le kill va au **dernier joueur qui t'a
  touché dans les 5 dernières secondes**, sinon c'est un suicide : aucun point, −1 pour soi.
  Même règle pour une mort par sa propre explosion.
- **Headshot ×1,5** pour les balles ; sniper à la tête = mort ; couteaux à la tête = ×2 ;
  jamais de headshot sur les explosions.
- Les blocs pleins arrêtent tous les projectiles ; les plateformes traversables non.
- **Kits de soin** (3 à 4 par carte) : +40 PV plafonnés à 100, réapparition en 20 s (anneau de
  recharge à l'emplacement). L'hôte arbitre : jamais deux joueurs soignés par le même kit.
- Fin de partie : classement (kills, morts, précision), **Rejouer** (même carte, mêmes armes,
  tous les écrans relancent ensemble) ou **Retour au salon**.

## Décor destructible

Sur les trois cartes, une partie du décor se casse sous les tirs et les explosions, se fissure et
tremble quand on le touche, puis se reconstruit 30 s plus tard (seulement si personne n'est dessus) :

- **Caisses** : les caisses empilées s'effondrent quand celle du dessous casse.
- **Barils explosifs** (rouges) : ils explosent, blessent et projettent tout autour, déclenchent les
  barils voisins et abîment le reste du décor. Le kill revient à celui qui a fait sauter le baril.
- **Climatiseurs**, **vitres** (toits), **rochers** et **jarres** (temple).
- **Ponts de planches** du temple : les explosions les font céder, on tombe.

Synchronisation : seule la machine du tireur décide des dégâts de ses tirs et explosions sur le
décor, et les diffuse (`dh`). Toutes les machines appliquent les mêmes messages et cassent donc le
même objet au même moment. L'hôte seul décide de la reconstruction (`dr`).

## Personnage et modes

**Tenues** (`js/outfit.js`) : 9 chapeaux (casquette, haut-de-forme, couronne, cowboy, bonnet,
viking, chapeau de fête, casserole…), 7 vestes, 7 pantalons, 6 paires de chaussures, plus un
bouton « tenue au hasard ». La tenue est gardée dans le navigateur et envoyée avec le message de
salon. À la mort, le chapeau s'envole et rebondit sur le décor. Les mannequins de l'entraînement
portent une tenue au hasard.

**Modes** (choisis par l'hôte, cumulables, rappelés en jeu sous les scores) :

| Mode | Effet |
|---|---|
| Big Head | Têtes ×2, hitbox de tête ×2 (headshots bien plus faciles) |
| Flies | Sauts illimités en l'air |
| OP | Chaque tir part en triple (roquettes et grenades comprises), copies plus dispersées |

Changer un mode ou la carte relance les « Prêt ». Les modes partent avec le coup d'envoi, et la
volée du mode OP reste déterministe (même graine), donc identique sur toutes les machines.

## Armes

| Arme | Dégâts | Cadence | Projectile | Gravité | Chargeur | Recharge | Particularités |
|---|---|---|---|---|---|---|---|
| Mitraillette | 9 | 12 tirs/s | 1300 px/s | 300 | 30 | 1,6 s | Dispersion ±3° qui s'ouvre en rafale |
| Sniper | 85 | 1 / 1,4 s | 3200 px/s | 60 | 5 | 2,2 s | Traçante, laser de visée, headshot = mort |
| Bazooka | 70 max | 1 / 1,1 s | 750 px/s | 900 | 1 | 1,5 s | Rayon 130 px, dégressif, 50 % sur soi, rocket jump |
| Couteaux | 45 | 1 / 0,45 s | 1000 px/s | 1400 | 6 | 1,8 s | Rotation, se plantent dans les murs, headshot ×2 |
| Fusil à pompe | 8 × 12 | 1 / 0,9 s | 1400 px/s | 500 | 4 | 2 s | Portée ~450 px, gerbe déterministe |
| Grenades | 80 max | 1 / 0,8 s | 850 px/s + élan | 1300 | 2 | 2,5 s | Rebonds (0,45), explosent après 2 s, rayon 140 px |
| Lance-flammes | 4 / flamme | 20 flammes/s | 1100 px/s, freinées | −140 (montent) | 80 | 2,2 s | Portée moyenne (~420 px), traverse les joueurs, **met le feu** (2 PV / 0,3 s pendant 2,2 s), éteint par l'eau, brûle bien le bois |
| Railgun | 95 | charge 0,9 s | instantané | 0 | 3 | 2,5 s | **Maintenir pour charger, relâcher pour tirer**. Traverse joueurs, murs et décor ; headshot = mort |
| Boomerang | 35 | 1 / 0,3 s | 1150 px/s | 0 | — | — | Revient dans la main, touche à l'aller **et** au retour, rebondit sur les murs ; il faut le rattraper pour le relancer |
| Katana | 55 | 1 / 0,55 s | onde 1150 px/s | 0 | ∞ | — | Chaque entaille fait **« SHHHINNG! »** (son + texte vus par tous) et envoie une onde courte (~300 px) qui traverse les joueurs et les projette |

Chaque arme garde sa propre cadence ; changer d'arme prend 0,25 s et annule un rechargement.
Les projectiles « perçants » (flammes, railgun, boomerang, onde du katana) touchent chaque joueur
une seule fois par passage, et la victime arbitre toujours ses dégâts (brûlure comprise).
La dispersion augmente en course et en l'air ; le réticule s'écarte en conséquence.

## Cartes

1. **Toits de ville** (4400 × 2000) : immeubles séparés par des vides mortels, château d'eau,
   néons qui grésillent, pluie, reflets sur les toits mouillés, éclairs.
2. **Entrepôt** (3800 × 2200) : carte fermée, passerelles sur plusieurs étages, conteneurs,
   caisses, lampes suspendues avec cônes de lumière, poussière, étincelles.
3. **Temple jungle** (3200 × 3600) : carte verticale, pyramide à degrés, longues lignes de vue,
   fosse d'eau mortelle, cascades, lianes, lucioles, torches.

Les cartes sont des données (`js/maps.js`) : on ne décrit que la moitié gauche, la moitié droite
est générée en miroir. Toutes sont donc parfaitement symétriques.

## Architecture

```
index.html      écrans (accueil, salon, jeu) et chargement des modules
style.css
js/state.js     constantes de règles, état partagé (G = partie, S = monde), outils, PRNG seedé
js/maps.js      les 3 cartes en données, miroir, grille d'accélération, aperçus du salon
js/physics.js   physique plateformer : pas fixe, AABB, plateformes traversables, hitbox tête/corps
js/weapons.js   table des armes, tirs déterministes, projectiles, explosions, dessin des armes
js/player.js    joueur local, interpolation des distants, pose du stickman, ragdoll, dégâts, mannequins
js/particles.js pool de 4000 particules préallouées, décalques, tous les émetteurs d'effets
js/render.js    caméra, parallaxe prérendue, décor, stickmen, éclairage, ambiance par carte
js/hud.js       HUD sur canvas : scores, vie, armes, fil des kills, réticule, indicateurs
js/outfit.js    tenues : catalogue, dessin des chapeaux et chaussures
js/destruct.js  décor destructible : dégâts, effondrements, barils, reconstruction
js/sfx.js       sons synthétisés en WebAudio (le « SHHHINNG » du katana)
js/bots.js      mode Survie : vagues, IA des bots, graphe de navigation
js/net.js       réseau PeerJS repris de Racco Duel
js/main.js      entrées, salon, déroulement de la partie, aiguillage des messages, boucle
```

La simulation tourne à **pas fixe de 60 Hz** (accumulateur) ; le rendu suit la fréquence de
l'écran et interpole le joueur local et les projectiles entre deux pas.

## Architecture réseau

WebRTC pair-à-pair via **PeerJS 1.5.4** et son serveur de signalisation public : rien à héberger.
Même modèle que Racco Duel :

- **Topologie en étoile** : chaque invité n'a qu'une liaison, vers l'hôte, qui relaie tout.
  Chaque message porte le slot de son émetteur (`f`), que l'hôte réécrit d'après la liaison.
- **Autorité partagée** : chaque client simule son propre joueur sans latence et diffuse son état
  30 fois par seconde. Les autres joueurs sont affichés avec 90 ms de retard et interpolés entre
  deux paquets (courte extrapolation si un paquet manque).
- **Tirs = événements** (bouche du canon, angle, arme, identifiant, dispersion). Chaque machine
  reconstruit la même volée : la dispersion de la mitraillette et la gerbe du pompe viennent d'un
  générateur pseudo-aléatoire (mulberry32) **seedé par l'identifiant du tir**, et les projectiles
  avancent tous au même pas fixe.
- **La victime arbitre les dégâts** : chaque client teste les projectiles et explosions adverses
  contre son propre joueur, décompte ses PV et diffuse l'impact (`h`). Quand elle meurt, elle
  annonce elle-même le kill et son auteur (`k`). Toutes les machines tiennent le même tableau des
  scores à partir de ces annonces.
- **L'hôte arbitre les kits** : une demande (`kreq`) n'est jamais relayée ; l'hôte valide la
  première et diffuse le ramassage (`kit`), puis la réapparition 20 s plus tard.
- Particules, ragdolls, douilles, décalques : **purement locaux**, jamais synchronisés.

| Message | Contenu |
|---|---|
| `welcome` | slot attribué + état du salon et carte |
| `lob` / `map` / `modes` / `go` | salon : pseudo, armes, tenue, prêt · carte · modes · coup d'envoi |
| `s` | état du joueur (position, vitesse, visée, arme, PV, vie, invulnérabilité…) |
| `f` | tir |
| `h` / `k` | impact confirmé par la victime / kill annoncé par la victime |
| `x` | roquette arrêtée sur un joueur : explosion au point de contact |
| `kreq` / `kit` | demande de kit (vers l'hôte) / ramassage ou réapparition |
| `dh` / `dr` | dégâts au décor (décidés par le tireur) / décor reconstruit (hôte) |
| `gt` / `ks` | type de partie choisi / état de la colline : points, position, qui la tient (hôte) |
| `r` / `lobby` | revanche / retour au salon pour tout le monde |
| `p` / `q` / `quit` | ping / réponse / départ d'un joueur |

Un **battement de cœur** (1 s) mesure la latence, détecte les coupures (fermeture brutale d'un
onglet) et rediffuse l'état quand l'onglet est en arrière-plan (`requestAnimationFrame` y est
suspendu). Un joueur muet depuis 10 s est retiré ; s'il ne reste qu'un joueur, la partie se
termine. Côté invité, perdre l'hôte termine la partie.

Conséquence assumée : avec une latence élevée, le tireur peut voir un impact que la victime,
seule juge de sa position, n'enregistre pas. C'est le compromis habituel en faveur d'un ressenti
sans lag pour ses propres actions.

## Réglages

Toutes les constantes sont regroupées et commentées en haut des fichiers concernés :

- `js/state.js` : PV, kills pour gagner, délais de réapparition et d'invulnérabilité, fenêtre
  d'attribution des kills, soin et recharge des kits, fréquences réseau, zone visible.
- `js/physics.js` : gravité, vitesses, accélérations, sauts, dash (vitesse, durée, recharge,
  délai du double appui), coyote time, buffer de saut, hitbox.
- `js/weapons.js` : table `WEAPONS` (dégâts, cadence, vitesse, gravité, chargeur, recharge,
  dispersion, explosion, knockback…).
- `js/player.js` : délai de changement d'arme, ragdolls, mannequins.
- `js/particles.js` : plafond de particules, part gardée en qualité Basse, décalques.
- `js/render.js` : caméra (lissage, regard vers la souris), secousses.
- `js/maps.js` : géométrie des cartes, spawns, kits, décor.
- `js/outfit.js` : catalogue et dessin des tenues.
- `js/state.js` : `KOTH_TARGET`, `HILL_TIME`, `LMS_LIVES`, `SURV_LIVES`, `DEST_RESPAWN`.
- `js/bots.js` : réglages de la Survie (`SURV` : bots max, pauses, PV, précision, cadence…),
  armes débloquées par vague (`POOLS`) et distances de combat (`PREF`).
- `js/physics.js` : glissade (`SLIDE_*`) et plongeon (`DIVE_V`).
- `js/maps.js` : décor destructible (tout élément avec `hp`) et zones de colline (`hills`).
- `js/state.js` : `MODES`, `BIG_HEAD_SCALE`, `OP_COPIES`, `OP_SPREAD`.

La qualité **Haute / Basse** (accueil ou menu Échap) réduit le nombre de particules et coupe les
halos coûteux. Le `devicePixelRatio` est plafonné à 2 et seul ce qui est à l'écran est dessiné.

## Si la connexion échoue entre deux PC

La tentative est abandonnée au bout de 20 s et le statut indique quels types d'adresses ont été
récoltés (locale, publique via STUN, relais via TURN) et la cause probable :

- **Adresse locale ok, publique ok, relais aucun** : les machines ne peuvent pas se joindre
  directement (NAT symétrique, pare-feu, isolation des clients sur le Wi-Fi). Il faut un relais
  TURN : renseigner `TURN_SERVERS` en haut de `js/net.js`.
- **Aucune adresse récoltée** : WebRTC est bloqué sur la machine (VPN, extension anti-pistage,
  politique d'entreprise).
- **« PeerJS n'a pas pu être chargé »** : le CDN unpkg est bloqué ; l'entraînement solo reste
  disponible.

Les relais TURN publics gratuits sans inscription ont fermé (`openrelay.metered.ca`,
`freeturn.net`). Un compte gratuit chez un fournisseur TURN (metered.ca, Twilio, Xirsys…)
suffit : le jeu consomme environ 4 Ko/s par joueur.

## Débogage

La console expose `RR` : `RR.G` (partie), `RR.S` (monde), `RR.cam`, et `RR.step(n)` qui avance la
simulation de `n` pas, pratique pour tester dans un onglet en arrière-plan.
