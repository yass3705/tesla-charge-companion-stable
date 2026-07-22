# Tesla Charge Companion V7.1.0 stable

## Nouveauté : plusieurs puissances sur un même site

Une borne/site peut contenir plusieurs configurations de recharge.

Exemple Lidl Saint-Cyr :

- 2 points AC de 22 kW ;
- 2 points DC de 180 kW.

Dans l’onglet **Bornes**, Lidl reste affiché sur une seule fiche. Dans les résultats de comparaison, les configurations AC 22 kW et DC 180 kW sont évaluées séparément et peuvent apparaître toutes les deux si elles font partie des 20 meilleurs résultats prix + distance.

Le formulaire **Ajouter / Modifier** permet d’ajouter ou supprimer autant de configurations que nécessaire. Le tarif, l’adresse et les horaires restent communs au site.

Les taux de change restent actualisés quotidiennement par GitHub Actions. Les tarifs Tesla restent manuels.


## Tarifs par configuration

Chaque configuration de puissance possède désormais sa propre tarification.

Exemple Lidl Saint-Cyr :

- 2 × AC 22 kW : 0,29 €/kWh ;
- 2 × DC 180 kW : 0,39 €/kWh.

Le site reste regroupé sur une seule fiche dans l’onglet Bornes, mais les configurations sont calculées séparément dans les résultats.


## Frais déclenchés après une durée

Chaque tarif peut désormais inclure :

- un montant par minute ;
- un seuil de déclenchement en minutes ;
- un plafond facultatif ;
- un créneau horaire pendant lequel le plafond s’applique.

Pour Izivia – Gymnase du Levant :

- recharge : 0,39 €/kWh ;
- frais supplémentaires : 0,05 €/min après 180 minutes de connexion ;
- plafond nocturne : 4 € entre 20 h et 8 h.

La durée prise en compte est la durée totale de connexion. Si une heure de débranchement est renseignée, elle est utilisée ; sinon l’application suppose un débranchement à la fin de la recharge.


## Distance maximale

Avant de lancer une simulation, il est possible de définir une distance maximale depuis l’adresse de départ, par exemple :

- 10 km ;
- 20 km ;
- 50 km.

Le filtre utilise la distance routière OSRM lorsqu’elle est disponible. À défaut, il utilise la distance à vol d’oiseau. Une valeur vide ou égale à 0 désactive la limite.

Les résultats restent limités aux 20 meilleures configurations selon le classement prix + distance.


## Correction de la limite de distance

La limite est désormais stricte :

- aucune borne au-delà du nombre de kilomètres saisi n’est affichée ;
- l’application ne complète jamais la liste avec des bornes plus éloignées ;
- le cache des anciennes distances est vidé à chaque simulation ;
- le calcul routier est effectué par petits lots pour plus de fiabilité ;
- un second filtre est appliqué juste avant le classement final.


## Tarification à la minute selon la puissance

Une configuration peut désormais appliquer un tarif différent selon la puissance instantanée estimée.

Exemple intégré : Tesla Casablanca — Onomo

- 0 à 60 kW : 1,10 MAD/min ;
- 60 à 100 kW : 2,30 MAD/min ;
- 100 à 150 kW : 3,50 MAD/min ;
- parking fixe : 6 MAD ;
- congestion/occupation après charge : jusqu’à 4,50 MAD/min.

Le calcul utilise la courbe de charge simulée minute par minute. Une même session peut donc traverser plusieurs tranches tarifaires.

Le géocodage n’est plus limité à la France. Il accepte également une adresse internationale ou des coordonnées sous la forme `33.6189855, -7.4823168`.


## V7.0 — nouveau moteur de devises

Devises prises en charge :

- Europe : EUR, CHF, GBP, NOK, SEK, DKK, PLN, CZK, HUF, RON et BGN ;
- Maghreb : MAD, DZD et TND.

Principes :

- prix local affiché dans la devise de la borne ;
- équivalent EUR affiché sous le prix local ;
- classement effectué en EUR ;
- taux publiés prioritaires ;
- corrections manuelles limitées à l'appareil ;
- conservation du dernier taux valide en cas de panne ;
- migration des anciens taux manuels ;
- mise à jour GitHub quotidienne via deux fournisseurs successifs.


## Correctif V7.0.1

Après la publication, effectue un rechargement forcé (`⌘ ⇧ R`).
Le bouton « Effacer les corrections manuelles » enregistre maintenant explicitement un objet vide et marque la migration comme terminée. Les anciens taux V1 ne peuvent donc plus réapparaître.
