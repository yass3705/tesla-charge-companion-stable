# Version 7.0.2

- Les coordonnées GPS sont utilisées en priorité pour les itinéraires Google Maps ; l’adresse reste affichée comme libellé.
- La mise à jour des devises enregistre la date de la source et l’heure de vérification séparément.
- Le workflow de devises affiche et valide les taux avant de les publier.
- Le bouton d’actualisation force toujours une lecture sans cache.

# Changelog

## V7.0.1 stable

- Correction définitive de la migration des anciens taux manuels.
- Le bouton « Effacer les corrections manuelles » ne permet plus au MAD de réapparaître.
- Suppression de l'ancienne clé locale lors de la remise à zéro.
- Indicateurs distincts : Publié, Manuel, Secours et Base.
- Les taux intégrés sans date sont désormais clairement marqués « Secours ».
- Réinitialisation propre de l'affichage à chaque rendu.
- Cache PWA renouvelé.

# Changelog

## V7.0 stable

- Refonte complète des devises.
- Affichage du coût local et de son équivalent EUR.
- Liste ciblée Europe + Maghreb.
- Correction du bug où un ancien taux local EUR-only masquait les taux publiés.
- Séparation entre taux publiés et corrections manuelles.
- Conservation du dernier taux valide.
- Source et date visibles dans l'interface.
- Mise à jour quotidienne avec fournisseur principal et fournisseur de secours.
- Migration automatique des anciens taux manuels.
- Cache PWA renouvelé.
