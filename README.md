# Tesla Charge Companion V6.0 stable

Version recentrée sur les fonctions fiables.

## Fonctionnement

- tarifs Tesla renseignés et modifiés manuellement ;
- lien direct vers la fiche officielle Tesla de chaque Superchargeur ;
- date de dernière mise à jour affichée ;
- taux de change actualisés automatiquement chaque jour par GitHub Actions ;
- comparaison prix + distance, jusqu’à 20 bornes ;
- filtres Tesla uniquement ou Tesla + autres opérateurs ;
- horaires, tarifs au kWh ou à la minute, frais de connexion et d’occupation ;
- ajout, modification, désactivation temporaire et suppression des bornes.

## Ce qui a été retiré

- workflow de récupération automatique Tesla ;
- scripts Python Tesla ;
- Playwright, Chromium, extensions Firefox et Companion macOS.

Ces méthodes étaient bloquées ou insuffisamment fiables.

## Mise à jour manuelle d’un tarif Tesla

1. Dans l’onglet **Bornes**, ouvre la **Fiche Tesla** de la station.
2. Relève le prix Tesla et les éventuels créneaux.
3. Clique sur **Modifier**.
4. Modifie le ou les tarifs et la date de mise à jour.
5. Clique sur **Enregistrer**.

Les modifications réalisées dans l’application sont stockées localement sur l’appareil utilisé.
