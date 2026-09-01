# Architecture France IRVE canonique — TCC

Statut: **prototype non-production**, PR #51.

## 1. Inventaire physique

- Le **PAN IRVE statique dédoublonné** est la seule source autorisée à créer les stations et PDC publics non-Tesla en France.
- Tesla reste dans son pipeline séparé existant.
- Une base CPO, Electra, Electroverse ou une base tarifaire ne doit jamais créer une station physique absente du PAN.
- La présence d'un PDC dans le statique IRVE ne signifie jamais qu'il est opérationnel en temps réel.

## 2. Deux identités distinctes

Chaque station/PDC conserve deux identités quand elles sont résolues:

- `physicalOperatorId`: CPO technique / exploitant déclaré dans IRVE.
- `tariffNetworkId`: réseau ou enseigne client qui porte le tarif direct.

Le réseau tarifaire prévaut pour appliquer une grille commerciale. Un nom d'enseigne inconnu ne doit jamais hériter automatiquement du tarif générique du CPO technique.

Exemple de risque évité: un CPO technique peut exploiter Belib', Pass Pass, Ecocharge77 ou un autre réseau local sans que son propre tarif commercial s'applique.

## 3. Statut opérationnel

Granularité cible: PDC.

Ordre de priorité:

1. statut direct CPO normalisé;
2. IRVE dynamique quand aucun statut CPO direct connu n'est disponible;
3. `inconnu`.

Règles:

- seuls `en_service`, `hors_service`, `inconnu` sont nécessaires à TCC;
- `occupation_pdc` (`libre`, `occupe`, etc.) est ignoré;
- Electra et Electroverse ne sont pas des sources de statut dans cette architecture;
- un statut direct `inconnu` ne masque pas un statut IRVE dynamique connu;
- l'état station est dérivé après les filtres utilisateur de connecteur/puissance, afin qu'un PDC AC disponible ne rende pas artificiellement disponible une recherche DC 150 kW.

## 4. Tarifs

Les offres sont des couches attachées à l'inventaire IRVE, jamais des inventaires concurrents.

Ordre logique des sources:

- tarif direct du réseau/CPO;
- tarif direct avec abonnement sélectionnable;
- tarif Electroverse;
- tarif Electra;
- tarif IRVE statique en dernier recours uniquement.

Les offres structurées parallèles restent visibles simultanément: il n'existe pas de « tarif gagnant » unique entre direct, Electra et Electroverse. Le moteur TCC compare les offres réellement disponibles pour le profil utilisateur.

Les abonnements n'affectent le calcul et le classement que lorsqu'ils sont sélectionnés par l'utilisateur.

### Séparation obligatoire des composantes

- énergie `€/kWh`;
- temps de charge `€/min`;
- durée de connexion/session;
- frais de session/accès;
- frais d'occupation après charge ou seuil;
- parking uniquement lorsqu'il s'agit explicitement d'un coût de stationnement distinct.

## 5. Fallback `tarification` IRVE

Le champ IRVE `tarification` est du texte libre.

Deux états sont autorisés:

- `parsed_kwh`: extraction strictement non ambiguë d'un unique prix en €/kWh;
- `text_only`: texte conservé pour affichage/audit, jamais utilisé pour le classement.

Le parseur refuse notamment les formules contenant plusieurs prix, minute/heure, forfait, abonnement, parking/stationnement, frais de connexion/occupation ou formulation conditionnelle.

Même un candidat `parsed_kwh` n'est activé qu'en l'absence totale d'une offre structurée directe, abonnement ou itinérance applicable.

## 6. Contrat d'offre v1.1

Chaque offre normalisée distingue explicitement:

- `physicalOperatorId`;
- `tariffNetworkId`;
- `channel`: direct, subscription, roaming ou reference;
- provenance;
- méthode de rapprochement;
- règles tarifaires structurées;
- `rankable` et raisons de blocage.

Un match ambigu ou un tarif incomplet n'est jamais classable.

## 7. Pipeline d'audit PR #51

Le workflow `Audit France IRVE canonical`:

1. télécharge les snapshots PAN statique et dynamique;
2. construit l'inventaire non-Tesla canonique;
3. sépare CPO technique et réseau tarifaire;
4. normalise les premières bases existantes;
5. finalise les identités au contrat v1.1;
6. matérialise les règles tarifaires déjà présentes dans le runtime historique;
7. construit les candidats de fallback IRVE stricts;
8. résout les statuts selon direct CPO > IRVE dynamique > inconnu;
9. valide tous les JSON/JSON.GZ;
10. publie uniquement un artefact d'audit.

Aucun de ces fichiers n'est actuellement consommé par la production TCC V8.

## 8. Déploiement prévu

Ordre de validation recommandé:

1. pipeline national entièrement vert;
2. contrôle des volumes et doublons;
3. pilote Yvelines avec comparaison station par station contre TCC V8 actuel;
4. validation des tarifs/abonnements et du statut sur des cas connus;
5. preview nationale;
6. seulement ensuite, bascule du runtime France.

La PR reste en draft tant que ces contrôles ne sont pas satisfaits.
