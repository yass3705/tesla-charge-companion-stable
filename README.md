# Tesla Charge Companion V6.3 stable

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
