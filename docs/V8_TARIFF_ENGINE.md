# V8 tariff engine — architecture et ajout de nouveaux opérateurs

## Objectif

La V8 migre progressivement d'un empilement d'overlays spécifiques vers un contrat unique :

`source -> station physique -> offre -> éligibilité -> calcul -> classement`

La migration est volontairement progressive afin de ne pas modifier les tarifs déjà validés pendant la consolidation.

## Registre central

`data/v8_tariff_sources.json` est la source de vérité pour l'intégration technique.

Une source possède notamment :

- `id` : identifiant stable et unique ;
- `status` : `active`, `staged` ou `disabled` ;
- `integration` : famille d'intégration ;
- `artifactPaths` : fichiers qui doivent exister dans l'artefact V8 ;
- `runtimeModules` : modules nécessaires à la restitution ;
- `publish.copyFromMain` : ressources maintenues sur `main` à injecter automatiquement dans la preview.

Une source `active` ne doit jamais disparaître silencieusement : le build doit échouer si un artefact ou un module requis est absent.

## Moteur unifié

`assets/v8-tariff-engine.js` fournit le contrat commun :

- `registerOffer()` pour les tarifs directs ;
- `registerSubscription()` pour les abonnements ;
- `registerAdapter()` pour les sources station-par-station ou nécessitant une résolution spécifique ;
- `resolve()` pour réunir les offres déclaratives et les adaptateurs ;
- `isOfferEligible()` pour centraliser l'éligibilité au classement ;
- `loadCatalogue()` pour fusionner les overlays déclaratifs sans dupliquer les identifiants.

Les modules historiques restent actifs pendant la migration. Ils peuvent être remplacés un par un par des adaptateurs sans modifier le comparateur en bloc.

## Règles abonnements

Le contrat V8 impose :

1. un abonnement est `opt-in` ;
2. son tarif peut rester visible même s'il n'est pas sélectionné ;
3. il ne participe au classement que s'il est sélectionné ;
4. son coût fixe mensuel ou annuel n'est pas imputé à une session ;
5. son périmètre réseau est respecté (`operatorAliases`, CPO direct, partenaires autorisés, puissance, AC/DC) ;
6. une offre ambiguë ou non vérifiable n'est pas classable.

## Ajouter un nouvel opérateur

### Cas déclaratif simple

Si le tarif dépend seulement du réseau, de la puissance, du type AC/DC et de règles tarifaires déterministes :

1. ajouter l'offre au catalogue tarifaire ;
2. déclarer la source dans `v8_tariff_sources.json` ;
3. ajouter les éventuels fichiers dans `publish.copyFromMain` si les données vivent sur `main` ;
4. passer la source en `staged` ;
5. faire passer le test générique ;
6. passer en `active` uniquement quand le runtime est branché et vérifié.

Aucune modification du comparateur ne doit être nécessaire.

### Cas station-par-station

Pour un tarif venant d'une API, d'un fichier national ou d'un mapping EVSE :

1. publier un dataset canonique ;
2. déclarer son chemin dans `artifactPaths` ;
3. créer un adaptateur qui expose `resolve(station, context)` ;
4. enregistrer l'adaptateur avec `TCCV8TariffEngine.registerAdapter()` ;
5. utiliser le même modèle d'offre normalisé que les sources déclaratives.

### Cas abonnement partenaire

Un abonnement eMSP peut cibler plusieurs CPO avec un même `selectionId`. Une seule case utilisateur contrôle plusieurs variantes réseau. Les variantes non sélectionnées restent visibles mais hors classement.

## États d'intégration

- `staged` : données et/ou runtime présents mais restitution non garantie dans la V8 publiée ;
- `active` : artefacts présents, runtime chargé, contrat de classement respecté ;
- `disabled` : source conservée mais explicitement exclue.

Le passage `staged -> active` doit être la seule opération nécessaire pour activer une intégration déjà conforme au contrat.

## Tests

`scripts/test_v8_tariff_registry.mjs` vérifie de façon générique :

- unicité des sources ;
- présence des artefacts/modules pour les sources actives ;
- contrat de publication ;
- présence explicite de Powerdot et e-Totem dans le build ;
- fusion des overlays par identifiant ;
- validité minimale des offres ;
- caractère opt-in des abonnements ;
- ingestion par le moteur unifié ;
- éligibilité correcte abonnement sélectionné / non sélectionné.

Les tests spécifiques opérateur restent utiles pour les règles complexes, mais ils complètent désormais un socle commun au lieu de constituer le seul garde-fou.
