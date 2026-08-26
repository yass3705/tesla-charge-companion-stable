# Audit de fiabilisation V8 RC4.8 — 2026-08-26

Objectif : réduire les petits défauts de régression (offre directe absente, abonnement non sélectionné qui gagne, source CPO masquée par un autre overlay, différence entre code de release et artefact réellement publié) sans ajouter de correctifs station-spécifiques.

## Invariants à rendre obligatoires

1. **Abonnements strictement opt-in** : une offre avec `subscriptionId` ne participe jamais au classement si cet abonnement n'est pas explicitement sélectionné.
2. **Fail closed tarifaire** : une offre ambiguë/non résolue peut être affichée comme information, mais ne devient jamais classable avec un prix deviné.
3. **Overlay non destructif** : un enrichisseur opérateur ne peut ni tronquer la liste physique globale ni supprimer les stations d'un autre CPO.
4. **Une station physique, plusieurs offres** : les variantes opérateur direct / eMSP / abonnement restent distinctes jusqu'au classement, puis sont regroupées par station + type + puissance.
5. **Statut séparé du tarif** : les sources de statut (Electroverse/Electra/flux live) ne doivent pas écraser l'identité tarifaire d'une configuration.
6. **Données de preview isolées** : un module sous `/v8-preview/` doit consommer les artefacts emballés sous `/v8-preview/data/`, pas silencieusement les données de la racine `main`.
7. **Chargement déterministe** : aucun résultat fonctionnel ne doit dépendre du fait qu'un wrapper JS ait été installé 100 ms plus tôt ou plus tard.
8. **Publication reproductible** : le contenu de la preview doit pouvoir être reconstruit et testé à partir d'un contrat explicite, sans substitution implicite non testée entre `release/2026-08` et `main`.

## Défauts confirmés pendant la passe

### 1. Classement abonnement Belib'
`assets/v8-offer-selection.js` pouvait retomber sur la première offre tarifée connue lorsque toutes les offres éligibles avaient été filtrées. Une offre résident/non-résident pouvait ainsi redevenir gagnante sans sélection utilisateur.

Correction : fallback fermé ; un groupe uniquement composé d'abonnements non sélectionnés devient non classable. Tests ajoutés dans `scripts/test_v8_subscription_ranking.mjs`.

### 2. Freshmile pouvait tronquer la liste globale
`assets/v8-freshmile-direct-overlay.js` limitait `prepared.stations` après son enrichissement. Un overlay tarifaire local pouvait donc faire disparaître des stations Powerdot/Bump/autres avant le classement final.

Correction : suppression de la troncature ; le Top N appartient uniquement au moteur de classement. Test de conservation de 125 stations non-Freshmile ajouté dans `scripts/test_freshmile_v8_runtime.mjs`.

### 3. Couplage publication `main` / `release`
La preview est construite à partir de `release/2026-08`, puis certaines ressources de `main` sont recopiées par le workflow Pages et le registre tarifaire. Le code exécuté en production preview n'est donc pas toujours identique au contenu visible dans la branche de release.

Conséquence : une validation limitée à `release/2026-08` peut être verte alors que l'artefact final diffère.

Action prévue : test de contrat sur l'artefact assemblé et isolation explicite de toutes les URL de données.

### 4. Chemins de données parent-relatifs
`main/assets/france-catalog-v8.js` référence actuellement Powerdot et e-Totem avec `../data/...`. Dans le layout Pages actuel cela peut retomber sur les données racine de `main`, ce qui masque le défaut ; en revanche la preview n'est plus autonome et peut consommer une autre version du dataset que celle attendue.

Action prévue : empaqueter/copier les artefacts dans `v8-preview/data/`, utiliser uniquement `data/...`, et faire échouer le publish si un runtime V8 contient un chemin `../data/`.

### 5. Multiplication des wrappers / ordre de chargement
`candidateStations`, `expandConfigurations`, `priceWithRules` et certaines fonctions de rendu sont enveloppées par plusieurs modules (`france-catalog-v8`, `v8-overlay-area-bridge`, `v8-direct-offer-pipeline`, Freshmile, Bump, etc.). Deux modules utilisent encore des boucles de polling longues pour se réinstaller si un autre wrapper les remplace.

Action prévue : un seul pipeline d'enrichissement ordonné, des adaptateurs opérateur enregistrés dans ce pipeline, et des événements de readiness uniquement comme filet de compatibilité temporaire.

## Audit des zones critiques

- [x] sélection / classement multi-offres
- [x] abonnement Belib' et métadonnées d'abonnement
- [x] overlay Freshmile et conservation de la liste globale
- [x] pipeline direct Powerdot/Freshmile/Bump/Driveco
- [x] pont overlay/cache et préservation des métadonnées
- [x] catalogue France enrichi (E55C, Belib', IONITY, Atlante, Powerdot, e-Totem)
- [x] workflow de publication Pages et registre `v8_tariff_sources.json`
- [x] stratégie cache/update/service worker
- [ ] matching Bump : ajouter un fallback générique sûr si les IDs/noms ne coïncident pas, sans règle dédiée à Meyerbeer
- [ ] isolation Powerdot/e-Totem dans l'artefact preview
- [ ] remplacer les boucles de polling longues par un bootstrap déterministe
- [ ] test end-to-end de l'artefact Pages assemblé
- [ ] matrice de fixtures par opérateur : station connue, puissances, offre directe, abonnements, frais, disponibilité
- [ ] test d'absence de doublons station physique / puissance après fusion
- [ ] test de stabilité mobile/iOS après reload/cache froid/cache chaud

## Stratégie de refactor ciblée

La priorité n'est pas de réécrire l'application. Le risque le plus faible est de consolider progressivement :

1. rendre les invariants ci-dessus exécutables sous forme de tests ;
2. faire passer tous les enrichisseurs par `v8-direct-offer-pipeline` ;
3. retirer ensuite les wrappers/pollings devenus redondants ;
4. tester l'artefact réellement publié, et non seulement les sources ;
5. seulement après ces garde-fous, fusionner vers `release/2026-08` puis `main`.

Aucun correctif station-spécifique ne doit être ajouté pour faire passer un cas utilisateur : si une station échoue, le matching générique ou le contrat de données doit être corrigé.