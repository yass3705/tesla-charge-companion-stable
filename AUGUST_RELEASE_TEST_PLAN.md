# Tesla Charge Companion — Plan de validation V8.0 RC1 (août 2026)

Cette branche est une release candidate. La branche `main` / V7.3 reste la référence stable tant que ces tests ne sont pas validés.

## 1. Chargement et PWA

- Ouvrir l'application dans Safari iPhone puis depuis l'icône écran d'accueil.
- Vérifier que l'en-tête affiche `Version 8.0 RC1`.
- Fermer/réouvrir l'application et confirmer que la nouvelle version reste chargée.
- Vérifier qu'aucune donnée locale ou configuration GitHub n'a été perdue.

## 2. Simulation — batterie à l'arrivée

- Saisir une batterie de départ et une adresse connue.
- Vérifier que chaque borne affiche une batterie d'arrivée différente selon la distance.
- Vérifier l'affichage énergie trajet, préconditionnement Tesla éventuel et marge batterie basse.
- Tester une borne volontairement trop éloignée et vérifier le message « non atteignable ».

## 3. Trois modes de simulation

- Objectif % uniquement : vérifier coût, énergie, durée et heure de fin.
- Heure de débranchement uniquement : laisser l'objectif vide et vérifier le % final maximal, les kWh et km récupérés.
- Objectif + heure de débranchement : tester un objectif atteignable puis un objectif impossible avant l'heure de fin.

## 4. Consommation et autonomie récupérée

- Vérifier le mode moyenne véhicule.
- Vérifier le mode adaptatif et l'affichage ville / voie rapide / autoroute estimé.
- Modifier la consommation de référence et vérifier que les km récupérés et ct/km évoluent de façon cohérente.

## 5. Tarification

- Tester une borne au kWh.
- Tester une borne facturée à la minute / selon puissance.
- Tester une borne avec frais fixes ou frais après durée.
- Vérifier tarif commercial, coût effectif €/kWh et coût par km récupéré.
- Tester une session traversant un changement de créneau tarifaire, notamment One Nation autour de 21:00 / 10:00.

## 6. Congestion Tesla

- Choisir un Superchargeur contenant `teslaCongestionFeePerMinute`.
- Faire une simulation dépassant 80 %.
- Vérifier que les frais sont OFF par défaut.
- Activer le bouton de congestion et vérifier le recalcul immédiat du coût.
- Désactiver le bouton et vérifier le retour au coût normal.
- Vérifier qu'aucun JSON de station n'est modifié par ce bouton.

## 7. Filtres Comparer

- Tester AC uniquement, DC uniquement, puis AC + DC.
- Tester un seul opérateur puis plusieurs opérateurs.
- Tester Tout sélectionner / Tout désélectionner.
- Vérifier la normalisation Total Energies / TotalEnergies et les opérateurs non renseignés.
- Tester les tris coût, temps total, durée de recharge, SOC à l'arrivée et distance.

## 8. Vue carte

- Basculer Liste → Carte puis Carte → Liste.
- Vérifier les marqueurs, regroupements et fiches compactes.
- Vérifier l'itinéraire depuis un marqueur.
- Vérifier que la liste continue de fonctionner si Leaflet/OSM n'est pas joignable.

## 9. Onglet Bornes

- Rechercher par nom, ville/adresse, opérateur et identifiant.
- Tester les filtres type, opérateur, pays, puissance, source et fiches incomplètes.
- Tester les tris.
- Vérifier qu'une borne Tesla reste en lecture seule.
- Vérifier que les boutons Modifier / Dupliquer / Supprimer sont disponibles pour une borne tierce.

## 10. Modification d'une borne tierce

- Ouvrir une borne puis Annuler sans modification : date MAJ inchangée.
- Modifier un champ puis Annuler : données et date MAJ inchangées.
- Modifier un champ puis Enregistrer : date MAJ = date du jour.
- Ouvrir puis Enregistrer sans rien changer : aucune nouvelle date.
- Tester Vider le formulaire avec et sans saisies non enregistrées.
- Changer d'onglet avec des modifications non enregistrées et vérifier l'avertissement.
- Vérifier la mise en page sur iPhone : aucun champ ne se chevauche ou ne déborde.

## 11. Modèles et duplication

- Dupliquer une borne : tarifs/configuration copiés, nom/adresse/GPS non copiés.
- Appliquer un modèle fournisseur dérivé d'une borne existante.
- Créer un modèle depuis un formulaire puis le réutiliser.

## 12. Synchronisation GitHub

- Sur un appareil déjà synchronisé : vérifier que le fonctionnement V7.3 est conservé.
- Sur un appareil simulant une première synchro avec données des deux côtés : vérifier les choix Télécharger GitHub / Remplacer GitHub / Fusionner.
- Vérifier la détection de doublons potentiels.
- Tester Fusionner puis Conserver les deux.
- Vérifier que `lastUpdated` n'est pas modifié par une simple synchronisation et que `_syncUpdatedAt` continue de servir au merge.

## 13. Régression

- Devises : actualisation, taux manuels et comparaison multi-devise.
- Itinéraire Google Maps.
- Fiche Tesla.
- Borne temporairement indisponible.
- Tarifs avec plusieurs configurations de puissance sur un même site.
- Import/export sauvegarde GitHub.

## Critère de passage en stable

Aucune perte de données, aucune régression bloquante sur iPhone/Mac, simulation cohérente sur les trois modes, synchronisation multi-appareils validée et affichage mobile sans chevauchement.
