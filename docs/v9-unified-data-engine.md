# Tesla Charge Companion V9 — moteur de données unifié

## Pourquoi une V9

V8 a grandi par couches successives : catalogue Tesla, catalogue France, DOT-NL, puis des overlays opérateurs, tarifs, abonnements, statuts et correctifs UI. Plusieurs de ces couches réécrivent ou enveloppent les mêmes fonctions (`candidateStations`, cache de zone, liste opérateurs). Cela crée plusieurs états concurrents et rend l'ordre de chargement significatif.

V9 remplace ce modèle par un pipeline unique. Aucun adaptateur pays ou opérateur n'a le droit de modifier l'UI, de remplacer une fonction globale ou de tronquer la liste des stations.

## Principe central

Une requête de zone passe toujours par la même séquence :

1. déterminer les sources applicables à la zone ;
2. charger en parallèle les tuiles / inventaires nécessaires ;
3. normaliser chaque source vers le même contrat ;
4. résoudre les entités et fusionner les fragments ;
5. appliquer les priorités champ par champ ;
6. attacher toutes les offres tarifaires valides ;
7. appliquer les statuts dynamiques ;
8. appliquer les filtres utilisateur ;
9. dériver **une seule fois** la liste opérateurs depuis le résultat final ;
10. sélectionner ensuite seulement les candidats à router / simuler ;
11. classer et afficher le Top N.

Il n'existe plus de `slice(0,80)` avant l'union des sources.

## « Toutes les données d'un coup »

Cela ne signifie pas télécharger toute l'Europe en RAM à chaque recherche. Le moteur charge **toutes les sources pertinentes pour la requête**, mais chaque grande base reste tuilée géographiquement. Une recherche à Eindhoven peut donc agréger dans une seule transaction :

- Tesla global ;
- DOT-NL ;
- tarifs directs Fastned / IONITY / Lidl ;
- abonnements sélectionnés ;
- statut dynamique disponible ;
- éventuelles données utilisateur.

L'UI ne voit qu'un seul résultat canonique.

## Contrat canonique StationEntity

```js
{
  id: "station:...",              // identifiant canonique stable
  aliases: ["source:id", ...],
  countryCode: "NL",
  name: "...",
  address: "...",
  latitude: 0,
  longitude: 0,
  physicalOperator: { id: "fastned", name: "Fastned" },
  networkBrand: "Fastned",
  evses: [...],
  access: {...},
  status: {
    state: "available|out_of_service|unknown",
    updatedAt: "...",
    sourceId: "..."
  },
  offers: [...],
  provenance: [
    { sourceId: "dotnl", sourceStationId: "...", updatedAt: "..." }
  ]
}
```

## Contrat canonique Offer

```js
{
  id: "fastned-gold",
  provider: "Fastned",
  kind: "public|direct|subscription|roaming|national_fallback",
  subscriptionId: "fastned-gold", // null si non requis
  operatorIds: ["fastned"],
  countries: ["FR", "NL", "DE"],
  currency: "EUR",
  pricing: {...},
  ratesByCountry: { NL: {...}, FR: {...} },
  sourceId: "fastned-direct",
  priority: 90,
  validFrom: null,
  validTo: null
}
```

Un abonnement européen est donc défini **une seule fois**. Son tarif est matérialisé selon le pays de la station.

## Priorités par champ

La fusion ne remplace jamais une station entière par une autre. Elle choisit le meilleur fragment pour chaque famille de champs.

| Famille | Priorité indicative |
|---|---|
| identité / coordonnées | Tesla ou CPO direct > base nationale > fallback |
| connecteurs / puissance | CPO direct > NAP/base nationale > fallback |
| horaires / accès | source explicite la plus fiable et la plus fraîche |
| statut | dynamique CPO/NAP > snapshot > statique |
| tarifs | abonnements sélectionnés et direct vérifié > eMSP vérifié > tarif national fallback |

Toutes les offres utiles peuvent rester attachées à la station ; la simulation choisit ensuite le meilleur **coût total de session**, pas simplement le plus petit €/kWh.

## Résolution d'entités

Ordre de rapprochement :

1. identifiant canonique déjà connu ;
2. alias source exact (OCPI location/EVSE, identifiant Tesla, CPO) ;
3. table d'alias persistée ;
4. rapprochement géographique strict + opérateur compatible ;
5. sinon nouvelle entité.

Aucune source n'a le droit de supprimer une entité provenant d'une autre source.

## État runtime unique

```js
TCC_AREA = {
  query: {...},
  stations: [...],      // vérité unique après fusion et filtres
  operators: [...],     // dérivé de stations, jamais stocké séparément
  freshness: {...},
  routes: new Map(),
  diagnostics: {...}
}
```

Le panneau opérateurs, la carte, la liste et le simulateur lisent tous `TCC_AREA`. Il n'y a plus de photographie parallèle du DOM à réparer ensuite.

## Budget de routage

Le coût OSRM est contrôlé **après** l'union et les filtres :

- préfiltre géographique peu coûteux ;
- filtres AC/DC, puissance, statut, opérateurs, horaires ;
- garantie d'au moins quelques candidats par opérateur visible ;
- complément avec les plus proches à vol d'oiseau ;
- routage de ce sous-ensemble ;
- simulation et Top 20.

Une zone dense ne peut donc plus faire disparaître Tesla, IONITY ou un petit réseau avant même que l'utilisateur puisse le sélectionner.

## Registre des sources

`data/v9/source-registry.json` décrit les sources. Ajouter un pays ou un opérateur doit principalement nécessiter :

1. une entrée de registre ;
2. un adaptateur vers le contrat canonique ;
3. des fixtures/tests ;
4. éventuellement un workflow de collecte.

Le front ne contient aucune condition `if country === ...` pour charger un opérateur.

## Migration depuis V8

La migration réutilise les fichiers actuels avant de réécrire les collecteurs :

- `TeslaAdapter` → `data/tesla_stations.json` ;
- `NationalCompactAdapter` → France et DOT-NL ;
- `DirectOfferAdapter` → bases opérateurs actuelles ;
- `SubscriptionAdapter` → plans multi-pays ;
- `UserStationAdapter` → stations locales/personnalisées.

Ainsi la refonte peut être validée progressivement sans interrompre V8.

## Invariants obligatoires

1. l'ordre de chargement des sources ne change pas le résultat ;
2. aucune source ne supprime les stations d'une autre source ;
3. la liste opérateurs est dérivée du jeu final ;
4. aucune limite de performance n'est appliquée avant la fusion ;
5. les limites de routage garantissent une représentation par opérateur ;
6. les abonnements sont globaux avec tarifs par pays ;
7. chaque champ et offre garde sa provenance ;
8. V8 reste inchangée jusqu'à ce que les tests V9 couvrent France + Pays-Bas + Tesla + principaux overlays.

## Étapes de livraison

### Phase 1 — fondations
- moteur pur sans DOM ;
- registre ;
- tests d'invariants ;
- adaptateurs Tesla + bases nationales.

### Phase 2 — offres
- adaptateurs opérateurs directs ;
- abonnements multi-pays ;
- moteur tarifaire unique.

### Phase 3 — runtime
- `queryArea()` unique ;
- cache unique ;
- budget routage ;
- UI V9 branchée sur `TCC_AREA`.

### Phase 4 — validation
- Eindhoven dense ;
- grandes villes françaises ;
- frontières / pays multiples ;
- mobile Safari ;
- performances.

### Phase 5 — preview V9
Une `/v9-preview/` distincte de V8 est publiée uniquement lorsque les tests de parité sont verts. V8 reste le filet de sécurité jusqu'à validation complète.
