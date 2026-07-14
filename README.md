# Tesla Charge Companion V6.5 stable

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
